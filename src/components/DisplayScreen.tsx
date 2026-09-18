"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KnowledgeDashboard } from "@/components/KnowledgeDashboard";
import { CompetitorBoard } from "@/components/CompetitorBoard";
import { Archive, ArrowLeft, ShieldAlert } from "lucide-react";
import { ModelSettings } from "@/components/ModelSettings";
import type { ProviderTemplate } from "@/lib/providers";
import type { ProviderSummary } from "@/lib/types";
import { SkillList } from "@/components/SkillList";
import { ToolPanel } from "@/components/ToolPanel";
import { LibraryPanel } from "@/components/LibraryPanel";
import { buildInsightDocument, readDocumentTheme, type InsightTheme } from "@/lib/display-document";
import {
  ASK_JARVIS_EVENT,
  DISPLAY_CHANGED_EVENT,
  DISPLAY_STAGE_EVENT,
  SETTINGS_PANEL_EVENT,
  SETTINGS_PANEL_LABEL,
  type DisplayStage,
  type DisplayView,
  type SettingsPanel,
} from "@/lib/ui-events";

const NOTICE_TEXT =
  "以下内容由大模型生成，在沙箱中隔离显示。内容未经核实，请勿在其中输入敏感信息。";

/**
 * The opening (CR-20260912-display-stage; user ruling 2026-09-11).
 *
 * 「首页还是当前的界面，可以增加下科幻动画……可以等待 3 秒钟自动切入，也可以鼠标到达
 * 展板或者动画标题，就可以切换。」 Three things follow from that sentence and each one is
 * a decision worth keeping:
 *
 * ① **3 秒是上限，不是时长。** A deliberate sign of work — a click, or focus landing in
 *    the console — switches at once. The timer only covers the case where nobody does
 *    anything. (Not a key listener: see the effect below.)
 * ② **切换不由动画结束驱动.** The animation loops; if the switch waited for it, a slow
 *    machine would sit on the title screen longer than a fast one, for no reason the
 *    user could see.
 * ③ **一次会话只播一次.** Coming back from an insight should land on the board, not
 *    replay the intro. The flag lives in sessionStorage, so a new tab plays it again.
 *
 * Two corrections from CR-20260912-stage-reach, both from what real use showed:
 *
 * ④ **鼠标移动不算开始工作.** The pointer is already over the window when the page loads,
 *    so treating its arrival as a signal made the opening unobservable — the user reported
 *    it as「首页没有动画效果」. Only a click or focus counts now.
 * ⑤ **阶段必须可以被对话改回去.** `stage` lives in the component and outranks the persisted
 *    `display_state` when rendering, so once it reached `board` the title view was gone for
 *    the rest of the session and `show_home` ran to no visible effect. Both stages are now
 *    reachable through `DISPLAY_STAGE_EVENT`, and returning to the opening clears the
 *    played flag so it does not bounce straight back.
 */
export const OPENING_MAX_MS = 3_000;
export const OPENING_PLAYED_KEY = "jarvis:opening-played";

function openingAlreadyPlayed(): boolean {
  try {
    return window.sessionStorage.getItem(OPENING_PLAYED_KEY) === "1";
  } catch {
    // Private windows and blocked storage: play it, which is the harmless direction.
    return false;
  }
}

function rememberOpeningPlayed(): void {
  try {
    window.sessionStorage.setItem(OPENING_PLAYED_KEY, "1");
  } catch {
    /* nothing to do; the worst case is it plays again next render */
  }
}

/** Lets `show_home` bring the opening back (REQ-F-102 ①). */
function forgetOpeningPlayed(): void {
  try {
    window.sessionStorage.removeItem(OPENING_PLAYED_KEY);
  } catch {
    /* nothing to do; the flag only ever suppresses a replay */
  }
}

type DisplayScreenProps = {
  /** SSR-resolved state so the first paint is already correct (DEC-017 ④, same pattern as DEC-011). */
  initial: DisplayView;
  /** Test seam. */
  fetchView?: () => Promise<DisplayView>;
  /** 测试缝：归档一份报告（REQ-F-190 ⑦）。 */
  archiveInsight?: (insightId: string) => Promise<{ ok: boolean; id?: string; message?: string }>;
  /** 「模型」面板要的两份服务端数据；缺省时该面板提示去 ☰ 配置（REQ-F-200 ②）。 */
  providerTemplates?: ProviderTemplate[];
  savedProviders?: ProviderSummary[];
};

async function fetchViewFromApi(): Promise<DisplayView> {
  const response = await fetch("/api/display", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`display fetch failed (${response.status})`);
  }
  return (await response.json()) as DisplayView;
}

async function archiveViaApi(insightId: string) {
  const response = await fetch("/api/insights/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ insightId }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  return response.ok ? { ok: true, id: body.id } : { ok: false, message: body.message ?? `归档失败（${response.status}）。` };
}

export function DisplayScreen({
  initial,
  fetchView = fetchViewFromApi,
  archiveInsight = archiveViaApi,
  providerTemplates,
  savedProviders,
}: DisplayScreenProps) {
  /** 屏上当前打开的设置面板；null 表示没开（REQ-F-200 ②）。 */
  const [panel, setPanel] = useState<SettingsPanel | null>(null);
  // 归档结果就地回话：写到哪儿了、或者为什么没写成。不弹窗——报告是主角。
  const [archiveNote, setArchiveNote] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [view, setView] = useState<DisplayView>(initial);
  /**
   * `opening` is the title screen; `board` is the knowledge board (出口义务 1);
   * `competitor-board` is the friend-comparison table (CR-20260918-competitor-board).
   */
  const [stage, setStage] = useState<DisplayStage>("opening");
  const stageRef = useRef(stage);
  stageRef.current = stage;
  // REQ-F-052 ②: the iframe is its own document, so the host theme is passed in by hand.
  // Light first so server and client markup agree; the real value is adopted after mount
  // and followed live through the same `data-theme` attribute ThemeToggle writes.
  const [theme, setTheme] = useState<InsightTheme>("light");

  useEffect(() => {
    const root = document.documentElement;
    setTheme(readDocumentTheme(root));
    const observer = new MutationObserver(() => setTheme(readDocumentTheme(root)));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const enterBoard = useCallback(() => {
    if (stageRef.current === "board") {
      return;
    }
    rememberOpeningPlayed();
    setStage("board");
  }, []);

  /**
   * The conversation can move between the two stages (REQ-F-102 ③, CR-20260912-stage-reach).
   *
   * Going back to the opening also clears the played flag, otherwise the next render would
   * immediately bounce to the board again and `show_home` would still do nothing visible —
   * which is the regression this closes.
   */
  useEffect(() => {
    const onStage = (event: Event) => {
      const stage = (event as CustomEvent<{ stage?: DisplayStage }>).detail?.stage;
      if (stage === "board" || stage === "competitor-board") {
        rememberOpeningPlayed();
        setStage(stage);
      } else if (stage === "opening") {
        forgetOpeningPlayed();
        setStage("opening");
      }
    };
    window.addEventListener(DISPLAY_STAGE_EVENT, onStage);
    return () => window.removeEventListener(DISPLAY_STAGE_EVENT, onStage);
  }, []);

  useEffect(() => {
    if (openingAlreadyPlayed()) {
      setStage("board");
      return;
    }
    const timer = window.setTimeout(enterBoard, OPENING_MAX_MS);
    // Work starting, in the two forms it takes: a click anywhere, or focus arriving in
    // the console. Deliberately NOT a key listener — UI contract LB-09 forbids key
    // handling in this component so that the HTML notice can never be dismissed with
    // Escape (CP-7), and typing needs focus first anyway.
    //
    // Pointer *movement* used to count too, via `onPointerEnter` on the title section
    // (REQ-F-102 ④). It made the opening unobservable in practice: the pointer is already
    // over the window on load, so the first mouse twitch skipped it. Moving the mouse is
    // not starting work — clicking or typing is.
    window.addEventListener("pointerdown", enterBoard);
    window.addEventListener("focusin", enterBoard);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", enterBoard);
      window.removeEventListener("focusin", enterBoard);
    };
  }, [enterBoard]);

  /**
   * 对话框唤起设置面板（REQ-F-200 ①②）。
   *
   * 与 `DISPLAY_STAGE_EVENT` 一样是**瞬时事件**、不落库：设置面板是「此刻在看什么」，
   * 不是「这台机器该显示什么」。落库会让它跨会话粘住，下次打开还停在设置页上。
   */
  useEffect(() => {
    const onPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ panel?: SettingsPanel | null }>).detail;
      setPanel(detail?.panel ?? null);
    };
    window.addEventListener(SETTINGS_PANEL_EVENT, onPanel);
    return () => window.removeEventListener(SETTINGS_PANEL_EVENT, onPanel);
  }, []);

  // CR-20260909-display-screen CP-9: refetch on the custom event only — no polling, no SSE.
  useEffect(() => {
    let cancelled = false;
    const onChange = () => {
      fetchView()
        .then((next) => {
          if (!cancelled) {
            setView(next);
          }
        })
        .catch(() => {
          /* leave the current view in place */
        });
    };
    window.addEventListener(DISPLAY_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(DISPLAY_CHANGED_EVENT, onChange);
    };
  }, [fetchView]);

  if (panel) {
    return (
      <section
        className="display-screen display-screen--settings fixed inset-x-0 top-0 z-0 flex flex-col overflow-y-auto bg-background"
        style={{ bottom: "var(--jarvis-console-h, 0px)" }}
        aria-label={`${SETTINGS_PANEL_LABEL[panel]}设置`}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <button
            className="display-screen__settings-back rounded border border-border px-2 py-1 text-xs text-muted-foreground"
            onClick={() => setPanel(null)}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="mr-1 inline size-3.5" />
            返回
          </button>
          <h2 className="text-sm font-medium">{SETTINGS_PANEL_LABEL[panel]}</h2>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          {panel === "tools" ? <ToolPanel /> : null}
          {panel === "library" ? <LibraryPanel /> : null}
          {panel === "skills" ? <SkillList /> : null}
          {panel === "models" ? (
            providerTemplates && providerTemplates.length > 0 ? (
              <ModelSettings providers={savedProviders ?? []} templates={providerTemplates} />
            ) : (
              // 没拿到模板就明说，而不是画一个空表单让人填了保存不了。
              <p className="text-sm text-muted-foreground">
                这台服务尚未就绪（存储未配置或未登录），模型设置暂时打不开。配置好后刷新页面即可。
              </p>
            )
          ) : null}
        </div>
      </section>
    );
  }

  if (view.kind === "insight" && view.html != null) {
    return (
      <section
        className="display-screen display-screen--insight fixed inset-x-0 top-0 z-0 flex flex-col bg-background"
        style={{ bottom: "var(--jarvis-console-h, 0px)" }}
        aria-label="技能洞察"
      >
        {/* CP-7: non-dismissible — no close control, no Escape handler. */}
        <div
          className="display-screen__notice flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          role="note"
        >
          <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
          <span>{NOTICE_TEXT}</span>
        </div>
        {/* 归档动作单独一行，不放进提示条：那条提示「不可关闭」是一条 UI 契约（LB-09），
            它的断言方式是「提示条里没有任何按钮」。把动作塞进去会把那条守卫一起拆掉——
            守卫的价值恰恰在于没人能往里偷加一个关闭。 */}
        {view.refId ? (
          <div className="display-screen__actions flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
            <button
              className="display-screen__archive rounded border border-border px-2 py-1 text-xs text-muted-foreground disabled:opacity-60"
              disabled={archiving}
              onClick={async () => {
                setArchiving(true);
                setArchiveNote(null);
                const result = await archiveInsight(view.refId as string);
                setArchiving(false);
                setArchiveNote(result.ok ? `已归档为 ${result.id}` : result.message ?? "归档失败。");
              }}
              type="button"
            >
              <Archive aria-hidden="true" className="mr-1 inline size-3.5" />
              {archiving ? "归档中…" : "归档到本地文档库"}
            </button>
            {archiveNote ? (
              <span className="display-screen__archive-note min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
                {archiveNote}
              </span>
            ) : null}
          </div>
        ) : null}
        <iframe
          className="display-screen__frame min-h-0 w-full flex-1 border-0 bg-background"
          sandbox="allow-scripts"
          title="技能洞察报告"
          srcDoc={buildInsightDocument(view.html, theme)}
        />
      </section>
    );
  }

  if (view.kind === "document" && view.refId) {
    const refId = view.refId;
    const filename = refId.split("/").pop() || refId;
    const dot = filename.lastIndexOf(".");
    const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
    const rawUrl = `/api/documents/raw?id=${encodeURIComponent(refId)}`;
    // 浏览器原生能内嵌渲染的格式才走 iframe；docx 等没有原生查看器的格式给一个新标签页
    // 链接——那也是「原件」，只是这台浏览器打不开，不该假装能预览。故意不从
    // `@/lib/documents` 导入同名常量：那个模块顶部 `import "node:fs/promises"`，混进客户端
    // 组件会把整条服务端依赖链一起打进浏览器包。
    const inline = [".pdf", ".html", ".htm", ".txt", ".md", ".markdown", ".csv", ".json", ".log", ".xml", ".yaml", ".yml"].includes(ext);
    return (
      <section
        className="display-screen display-screen--document fixed inset-x-0 top-0 z-0 flex flex-col bg-background"
        style={{ bottom: "var(--jarvis-console-h, 0px)" }}
        aria-label="本机文档"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{filename}</h2>
          <a
            className="display-screen__document-open shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground"
            href={rawUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            新标签页打开
          </a>
        </div>
        {inline ? (
          <iframe
            className="display-screen__frame min-h-0 w-full flex-1 border-0 bg-background"
            sandbox=""
            src={rawUrl}
            title={filename}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            <p>
              「{ext ? ext.slice(1).toUpperCase() : "该"}」格式浏览器无法直接预览，点右上角「新标签页打开」查看或下载原文件。
            </p>
          </div>
        )}
      </section>
    );
  }

  // Work has started: the board is the working surface (出口义务 1).
  if (stage === "board") {
    // A plain container, not a landmark: the board inside already IS the 「知识看板」
    // region, and two landmarks sharing one name is worse than none.
    return (
      <div
        className="display-screen display-screen--board fixed inset-x-0 top-0 z-0 overflow-y-auto bg-background"
        style={{ bottom: "var(--jarvis-console-h, 0px)" }}
      >
        <div className="pb-6">
          <KnowledgeDashboard
            onAsk={(question) => window.dispatchEvent(new CustomEvent(ASK_JARVIS_EVENT, { detail: { text: question } }))}
          />
        </div>
      </div>
    );
  }

  // 友商看板：同一套「不落数据库、纯会话态」的道理（CR-20260918-competitor-board）。
  if (stage === "competitor-board") {
    return (
      <div
        className="display-screen display-screen--competitor-board fixed inset-x-0 top-0 z-0 overflow-y-auto bg-background"
        style={{ bottom: "var(--jarvis-console-h, 0px)" }}
      >
        <CompetitorBoard />
      </div>
    );
  }

  // "home" and every unrecognised kind fall back to the title view (CP-6).
  return (
    <section
      className="display-screen display-screen--home fixed inset-0 z-0 flex items-center justify-center bg-background px-6"
      aria-label="Agent-Jarvis"
    >
      {/* Sci-fi opening, CSS only: a sweep and a slow pulse, both switched off under
          prefers-reduced-motion. No library, no canvas, nothing to keep painting once
          the board takes over. */}
      <div aria-hidden="true" className="display-screen__sweep pointer-events-none absolute inset-0 overflow-hidden">
        <div className="display-screen__scan absolute inset-x-0 h-px bg-primary/40 motion-reduce:hidden" />
        <div className="display-screen__grid absolute inset-0 opacity-[0.06] motion-reduce:opacity-[0.03]" />
      </div>
      <div className="display-screen__title relative mx-auto -mt-24 max-w-2xl text-center">
        <h1 className="display-screen__wordmark text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Agent-Jarvis
        </h1>
        <p className="mt-4 text-balance text-base text-muted-foreground">
          本机运行的动态显示屏。在下方对话框提问；技能洞察与其它内容会在这里呈现。
        </p>
        <button
          className="display-screen__enter mt-6 rounded px-2 py-1 text-xs text-muted-foreground underline underline-offset-4"
          onClick={enterBoard}
          type="button"
        >
          进入知识看板
        </button>
      </div>
    </section>
  );
}
