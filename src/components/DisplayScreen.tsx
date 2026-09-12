"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KnowledgeDashboard } from "@/components/KnowledgeDashboard";
import { ShieldAlert } from "lucide-react";
import { ASK_JARVIS_EVENT, DISPLAY_CHANGED_EVENT, type DisplayView } from "@/lib/ui-events";

const NOTICE_TEXT =
  "以下内容由大模型生成，未做安全隔离。请勿在其中输入敏感信息。";

/**
 * The opening (CR-20260912-display-stage; user ruling 2026-09-11).
 *
 * 「首页还是当前的界面，可以增加下科幻动画……可以等待 3 秒钟自动切入，也可以鼠标到达
 * 展板或者动画标题，就可以切换。」 Three things follow from that sentence and each one is
 * a decision worth keeping:
 *
 * ① **3 秒是上限，不是时长。** Any sign of work — the pointer arriving, a click, focus
 *    landing in the console — switches at once. The timer only covers the case where
 *    nobody does anything. (Not a key listener: see the effect below.)
 * ② **切换不由动画结束驱动.** The animation loops; if the switch waited for it, a slow
 *    machine would sit on the title screen longer than a fast one, for no reason the
 *    user could see.
 * ③ **一次会话只播一次.** Coming back from an insight should land on the board, not
 *    replay the intro. The flag lives in sessionStorage, so a new tab plays it again.
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

type DisplayScreenProps = {
  /** SSR-resolved state so the first paint is already correct (DEC-017 ④, same pattern as DEC-011). */
  initial: DisplayView;
  /** Test seam. */
  fetchView?: () => Promise<DisplayView>;
};

async function fetchViewFromApi(): Promise<DisplayView> {
  const response = await fetch("/api/display", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`display fetch failed (${response.status})`);
  }
  return (await response.json()) as DisplayView;
}

export function DisplayScreen({ initial, fetchView = fetchViewFromApi }: DisplayScreenProps) {
  const [view, setView] = useState<DisplayView>(initial);
  /** `opening` is the title screen; `board` is the knowledge board (出口义务 1). */
  const [stage, setStage] = useState<"opening" | "board">("opening");
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const enterBoard = useCallback(() => {
    if (stageRef.current === "board") {
      return;
    }
    rememberOpeningPlayed();
    setStage("board");
  }, []);

  useEffect(() => {
    if (openingAlreadyPlayed()) {
      setStage("board");
      return;
    }
    const timer = window.setTimeout(enterBoard, OPENING_MAX_MS);
    // Work starting, in the two forms it takes: a click anywhere, or focus arriving in
    // the console. Deliberately NOT a key listener — UI contract LB-09 forbids key
    // handling in this component so that the unsandboxed-HTML notice can never be
    // dismissed with Escape (CP-7), and typing needs focus first anyway.
    window.addEventListener("pointerdown", enterBoard);
    window.addEventListener("focusin", enterBoard);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", enterBoard);
      window.removeEventListener("focusin", enterBoard);
    };
  }, [enterBoard]);

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

  if (view.kind === "insight" && view.html != null) {
    return (
      <section
        className="display-screen display-screen--insight fixed inset-0 z-0 flex flex-col bg-background"
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
        {/* DEC-015 / CP-11: rendered without a sandbox attribute — the user accepts the risk. */}
        <iframe
          className="display-screen__frame min-h-0 w-full flex-1 border-0 bg-background"
          title="技能洞察报告"
          srcDoc={view.html}
        />
      </section>
    );
  }

  // Work has started: the board is the working surface (出口义务 1).
  if (stage === "board") {
    // A plain container, not a landmark: the board inside already IS the 「知识看板」
    // region, and two landmarks sharing one name is worse than none.
    return (
      <div className="display-screen display-screen--board fixed inset-0 z-0 overflow-y-auto bg-background">
        {/* pb-36 keeps the last row clear of the fixed bottom console. */}
        <div className="pb-36">
          <KnowledgeDashboard
            onAsk={(question) => window.dispatchEvent(new CustomEvent(ASK_JARVIS_EVENT, { detail: { text: question } }))}
          />
        </div>
      </div>
    );
  }

  // "home" and every unrecognised kind fall back to the title view (CP-6).
  return (
    <section
      className="display-screen display-screen--home fixed inset-0 z-0 flex items-center justify-center bg-background px-6"
      aria-label="Agent-Jarvis"
      // The pointer arriving IS the signal that work is starting (user ruling).
      onPointerEnter={enterBoard}
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
