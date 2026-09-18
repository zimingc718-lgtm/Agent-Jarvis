"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LibraryBrowseView, loadBrowseFromApi, type BrowsePageView } from "@/components/LibraryPanel";

/**
 * The knowledge board (CR-20260911-home-dashboard; design in `design/`).
 *
 * Two zones for two different behaviours. The top is "what changed", scanned daily, so
 * its order is FIXED and never re-sorted by recency: a board people scan every day has
 * to keep its shape or they lose the ability to find a card by where it sits. The bottom
 * is "what do we have", which people come to with a question.
 *
 * Every card carries TWO indicators, not one: whether there is an unread change, and
 * whether collection is still working. An entity with no source and an entity whose
 * source went quiet both look silent, and only the second indicator tells them apart.
 * This project has already shipped that bug once, when "not yet probed" was read as
 * "does not support" and web search silently became unreachable.
 */

export type ParamState = "unknown" | "meets" | "unmet";
export type DashboardParam = { name: string; value: string; status: ParamState };

export type DashboardEntity = {
  name: string;
  kind: "competitor" | "authority" | "customer";
  title: string;
  summary: string;
  capacity: string;
  nextLabel: string;
  nextDate: string;
  health: "fresh" | "stale" | "failed_fetch" | "parse_failed" | "unconfigured";
  checkedAt: string;
  change: string;
  changeAt: string;
  seenAt: string;
  sources: string[];
  /** Named technical requirements — the board's spine (用户 2026-09-12). */
  params: DashboardParam[];
  createdAt: string;
  unread: boolean;
  /** Derived server-side: how many of this object's requirements we do not meet. */
  unmet: number;
  /**
   * Field and parameter names whose value was checked word for word against a stored
   * entry (REQ-F-180 ⑥). Everything not in here is inferred — the model may have been
   * right, but nothing verified it, and the card must not let the two look alike.
   */
  quoted?: string[];
  /**
   * Fields and parameters that carry a citation at all. Without it the card cannot tell
   * 「没有出处」 from 「有出处但没核对过」——and only the second one is an inference. A
   * value the user typed in has no citation and is not an inference; marking it as one
   * would be its own kind of lie.
   */
  cited?: string[];
};

/**
 * One collected change, mechanically derived — never model-written (mirrors
 * `sources.ts#describeChange`'s own reasoning). A card's message list is this array,
 * newest first (CR-20260918-change-history-and-sources, CP-1).
 */
export type HistoryEntry = { at: string; url: string; change: string };

/**
 * 「不属于任何跟踪对象」的具名归属（REQ-F-170 ②③）。
 *
 * 与 `knowledge-tools.ts` 的 `GENERAL_ENTITY` 是同一个字面量，写两份是因为那个模块碰
 * 文件系统、进不了客户端；`tests/knowledge-dashboard.test.tsx` 有一条断言把两边钉在
 * 一起，免得哪天一边改了另一边不知道。
 */
const GENERAL_ENTITY = "__通用__";

const PARAM_STATE_LABEL: Record<ParamState, string> = { unknown: "未判定", meets: "满足", unmet: "不满足" };

/** 有出处、但那份出处没有被逐字核对过（REQ-F-180 ⑥）。 */
function isInferred(entity: DashboardEntity, field: string): boolean {
  return Boolean(entity.cited?.includes(field)) && !entity.quoted?.includes(field);
}

function InferredTag() {
  return (
    <span
      className="knowledge-dashboard__inferred shrink-0 rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-500"
      title="没有可核对的条目原文，本条记为推断"
    >
      推断
    </span>
  );
}
/** Clicking cycles through the three; there is no fourth state to hide in. */
const NEXT_PARAM_STATE: Record<ParamState, ParamState> = { unknown: "meets", meets: "unmet", unmet: "unknown" };
const PARAM_STATE_CLASS: Record<ParamState, string> = {
  unknown: "text-muted-foreground",
  meets: "text-emerald-700 dark:text-emerald-500",
  unmet: "text-destructive",
};

export type DashboardProposal = {
  id: string;
  entity: string;
  field: string;
  value: string;
  url: string;
  locator: string;
  createdAt: string;
};

export type DashboardData = { entities: DashboardEntity[]; pending: DashboardEntity[]; proposals: DashboardProposal[] };
export type OverviewData = {
  total: number;
  byEntity: Record<string, number>;
  byType: Record<string, number>;
  unowned: number;
  misses: Array<{ query: string; count: number; last: string }>;
};

type Props = {
  initialData?: DashboardData;
  initialOverview?: OverviewData;
  /** Test seams. */
  loadBoard?: () => Promise<DashboardData>;
  loadOverview?: () => Promise<OverviewData>;
  /** 资料库统一浏览（CR-20260918-library-in-board CP-1），与 `LibraryPanel.tsx` 共用同一实现。 */
  loadBrowse?: (offset: number) => Promise<BrowsePageView>;
  act?: (method: "POST" | "DELETE" | "PATCH", url: string, body?: unknown) => Promise<{ ok: boolean; message?: string }>;
  /** Hands a pre-filled question to the chat instead of running anything here. */
  onAsk?: (question: string) => void;
  /** Scheduled collection seams (CR-20260911-scheduled-sweep). */
  loadSweep?: () => Promise<SweepState>;
  saveSweep?: (patch: Partial<SweepState>) => Promise<SweepState>;
  runSweepRound?: (force: boolean) => Promise<SweepRun>;
  /** Injected in tests; the real schedule only ticks while the board is on screen. */
  isVisible?: () => boolean;
  /** Test seam for a card's message list (CR-20260918-change-history-and-sources). */
  loadHistory?: (name: string) => Promise<HistoryEntry[]>;
};

export type SweepState = { enabled: boolean; intervalMinutes: number; maxPerRound: number; lastRun: string };
export type SweepRun = { ran: boolean; reason: string; remaining: number };

const EMPTY_BOARD: DashboardData = { entities: [], pending: [], proposals: [] };
const EMPTY_SWEEP: SweepState = { enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" };
/**
 * How often the board CHECKS whether a round is due — not how often it collects.
 * The server decides what is due; this only wakes up to ask.
 */
const SWEEP_TICK_MS = 60_000;
const SWEEP_INTERVAL_MIN = 30;
const SWEEP_INTERVAL_MAX = 24 * 60;
/** Auto-save waits for a pause in typing; Enter and blur bypass it and commit at once. */
const SWEEP_INTERVAL_SAVE_DEBOUNCE_MS = 500;

function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString("zh-CN", { hour12: false });
}
const EMPTY_OVERVIEW: OverviewData = { total: 0, byEntity: {}, byType: {}, unowned: 0, misses: [] };

const KIND_LABEL = { competitor: "友商", authority: "规则与准入方", customer: "客户" } as const;
const HEALTH_TEXT = {
  fresh: "采集正常",
  stale: "信息陈旧",
  failed_fetch: "抓取失败",
  parse_failed: "解析失败",
  unconfigured: "未配置采集源",
} as const;
/** Warning and error read differently: a stale source is old, a failed one is broken. */
const HEALTH_COLOR = {
  fresh: "text-muted-foreground",
  stale: "text-amber-700 dark:text-amber-500",
  failed_fetch: "text-destructive",
  parse_failed: "text-destructive",
  unconfigured: "text-amber-700 dark:text-amber-500",
} as const;

async function getJson<T>(url: string, fallback: T): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    return fallback;
  }
  return (await response.json()) as T;
}

async function saveSweepViaApi(patch: Partial<SweepState>): Promise<SweepState> {
  const response = await fetch("/api/entities/sweep", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<SweepState> & { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? "保存失败");
  }
  return { ...EMPTY_SWEEP, ...data };
}

async function runSweepViaApi(force: boolean): Promise<SweepRun> {
  const response = await fetch("/api/entities/sweep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ force }),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<SweepRun> & { message?: string };
  return { ran: data.ran === true, reason: data.reason ?? data.message ?? "巡检未执行。", remaining: data.remaining ?? 0 };
}

async function actViaApi(method: "POST" | "DELETE" | "PATCH", url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: data.message };
}

/** Collection health, drawn rather than spelled with a glyph so it scales and recolors. */
function SignalIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height="12" viewBox="0 0 12 12" width="12">
      <path d="M2 9.5V7.75M6 9.5V5.25M10 9.5V2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * 缺省的取数与可见性判定，**提到模块层**以保住函数身份（CR-20260915-board-tick-burst）。
 *
 * 此前这四个写成参数默认值 `loadBoard = () => …`——参数默认值在每次渲染都是一个新函数，
 * 而它们全在 effect 的依赖里。于是每次渲染都重跑三个 effect：看板与总览各重取一次、
 * 巡检 tick 立刻再发一次。2026-09-15 用真浏览器打开看板，一挂载就连发十几个
 * `POST /api/entities/sweep`——那正是注释里说「不该从隐藏标签页去打别人服务器」时
 * 想避免的形状，只是这次打的是自己的服务器。
 */
const defaultLoadBoard = () => getJson<DashboardData>("/api/entities", EMPTY_BOARD);
const defaultLoadOverview = () => getJson<OverviewData>("/api/knowledge/overview", EMPTY_OVERVIEW);
const defaultLoadSweep = () => getJson<SweepState>("/api/entities/sweep", EMPTY_SWEEP);
const defaultIsVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
const defaultLoadHistory = (name: string) =>
  getJson<{ entries: HistoryEntry[] }>(`/api/entities/${encodeURIComponent(name)}/history`, { entries: [] }).then(
    (data) => data.entries
  );

export function KnowledgeDashboard({
  initialData = EMPTY_BOARD,
  initialOverview = EMPTY_OVERVIEW,
  loadBoard = defaultLoadBoard,
  loadOverview = defaultLoadOverview,
  loadBrowse = loadBrowseFromApi,
  act = actViaApi,
  onAsk,
  loadSweep = defaultLoadSweep,
  saveSweep = saveSweepViaApi,
  runSweepRound = runSweepViaApi,
  isVisible = defaultIsVisible,
  loadHistory = defaultLoadHistory,
}: Props) {
  const [board, setBoard] = useState<DashboardData>(initialData);
  const [overview, setOverview] = useState<OverviewData>(initialOverview);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browsePage, setBrowsePage] = useState<BrowsePageView | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Per-entity message list, fetched lazily when a card opens — not part of `board`,
   *  which is refetched on every change event and would otherwise refetch every card's
   *  full history on every unrelated update. */
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  /** Per-kind: is that lane's `+` tile expanded into the new-entity form right now. */
  const [addOpenKind, setAddOpenKind] = useState<Partial<Record<DashboardEntity["kind"], boolean>>>({});
  const [sweep, setSweep] = useState<SweepState>(EMPTY_SWEEP);
  /**
   * Whether the interval field currently has the user's attention. While true, a
   * server-driven refresh of `sweep` (background tick, checkbox save, "run now", or
   * this field's own save landing after a newer keystroke) must not clobber the
   * `intervalMinutes` the user is mid-editing — every other field still updates. A ref
   * (not state) so the tick effect below always reads the live value instead of the
   * one captured when the effect last re-subscribed.
   */
  const editingIntervalRef = useRef(false);
  const intervalSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Merge a server-fresh `SweepState` in, keeping the local interval while it is being edited. */
  const applySweep = useCallback((next: SweepState) => {
    setSweep((current) => (editingIntervalRef.current ? { ...next, intervalMinutes: current.intervalMinutes } : next));
  }, []);

  const reload = useCallback(() => {
    loadBoard()
      .then(setBoard)
      .catch(() => {
        /* keep what is on screen */
      });
    loadOverview()
      .then(setOverview)
      .catch(() => {
        /* keep what is on screen */
      });
  }, [loadBoard, loadOverview]);

  // 资料库浏览是独立于 board/overview 的一套状态（同 LibraryPanel.tsx 的浏览模式），只按
  // offset 取数，不挂 KNOWLEDGE_CHANGED_EVENT——翻页之外没有别的驱动，跟板面其它区域的
  // 刷新节奏不绑在一起。
  useEffect(() => {
    let cancelled = false;
    loadBrowse(browseOffset)
      .then((page) => {
        if (!cancelled) {
          setBrowsePage(page);
          setBrowseError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrowseError("读不到资料库列表。服务可能正在重启，稍后再打开一次。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [browseOffset, loadBrowse]);

  useEffect(() => {
    reload();
    window.addEventListener(KNOWLEDGE_CHANGED_EVENT, reload);
    return () => window.removeEventListener(KNOWLEDGE_CHANGED_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    loadSweep()
      .then(applySweep)
      .catch(() => {
        /* the board still works without a schedule */
      });
  }, [loadSweep, applySweep]);

  /**
   * The schedule ticks only while this board is on screen.
   *
   * Collection spends no model tokens, but it does spend someone else's bandwidth, and
   * a hidden tab quietly hitting other people's servers is not a thing to start without
   * the user present. The server still decides what is due; this only asks.
   */
  useEffect(() => {
    if (!sweep.enabled) {
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled || !isVisible()) {
        return;
      }
      void runSweepRound(false)
        .then((outcome) => {
          if (cancelled || !outcome.ran) {
            return;
          }
          setNotice(outcome.remaining > 0 ? `${outcome.reason}还有 ${outcome.remaining} 个源排队。` : outcome.reason);
          reload();
          return loadSweep().then(applySweep);
        })
        .catch(() => {
          /* a failed round is not worth interrupting the user over */
        });
    };
    const timer = setInterval(tick, SWEEP_TICK_MS);
    tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sweep.enabled, isVisible, runSweepRound, reload, loadSweep, applySweep]);

  /** Cancel any pending interval-save debounce on unmount so it cannot fire (or setState) after. */
  useEffect(
    () => () => {
      if (intervalSaveTimerRef.current) {
        clearTimeout(intervalSaveTimerRef.current);
      }
    },
    []
  );

  /**
   * Commit the interval now: cancel any pending debounce and save. Blur, Enter, and the
   * debounce timeout itself all funnel through here, so there is exactly one save path
   * and one notice for all three triggers.
   */
  const commitInterval = (value: number) => {
    if (intervalSaveTimerRef.current) {
      clearTimeout(intervalSaveTimerRef.current);
      intervalSaveTimerRef.current = null;
    }
    void saveSweep({ intervalMinutes: value })
      .then((result) => {
        applySweep(result);
        setNotice(`巡检间隔已保存为 ${result.intervalMinutes} 分钟。`);
      })
      .catch((error: Error) => setNotice(error.message));
  };

  /** Auto-save after a pause in typing — the number input's own version of 改即存. */
  const scheduleIntervalSave = (value: number) => {
    if (intervalSaveTimerRef.current) {
      clearTimeout(intervalSaveTimerRef.current);
    }
    intervalSaveTimerRef.current = setTimeout(() => {
      intervalSaveTimerRef.current = null;
      commitInterval(value);
    }, SWEEP_INTERVAL_SAVE_DEBOUNCE_MS);
  };

  const run = async (key: string, label: string, method: "POST" | "DELETE" | "PATCH", url: string, body?: unknown) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await act(method, url, body);
      setNotice(result.ok ? label : (result.message ?? "操作失败。"));
      if (result.ok) {
        reload();
      }
    } catch {
      setNotice("操作失败：网络错误。");
    } finally {
      setBusy(null);
    }
  };

  /** Opening the card IS the read receipt (user ruling, 2026-09-11) — no separate button. */
  const toggleCard = (entity: DashboardEntity) => {
    const next = openName === entity.name ? null : entity.name;
    setOpenName(next);
    if (next && entity.unread) {
      void act("PATCH", `/api/entities/${encodeURIComponent(entity.name)}`, { action: "seen" }).then(reload);
    }
    // Fetched on every open, not cached across opens: it is cheap (one small JSON GET)
    // and a card left open across a sweep tick should show new messages on next open,
    // not a stale list from when it was last expanded.
    if (next) {
      setHistoryBusy(entity.name);
      void loadHistory(entity.name)
        .then((entries) => setHistory((current) => ({ ...current, [entity.name]: entries })))
        .catch(() => {
          /* leave whatever was cached, if anything — the message list is a convenience,
             not the record itself (that stays the file on disk). */
        })
        .finally(() => setHistoryBusy(null));
    }
  };

  const byKind = (kind: DashboardEntity["kind"]) => board.entities.filter((entity) => entity.kind === kind);
  const competitors = byKind("competitor");
  const authorities = byKind("authority");
  const customers = byKind("customer");
  const unreadCount = board.entities.filter((entity) => entity.unread).length;
  const brokenCount = board.entities.filter((entity) => entity.health === "failed_fetch" || entity.health === "parse_failed").length;
  const waiting = board.pending.length + board.proposals.length;
  const generalCount = overview.byEntity[GENERAL_ENTITY] ?? 0;
  const unmetTotal = board.entities.reduce((total, entity) => total + (entity.unmet ?? 0), 0);
  const paramTotal = board.entities.reduce((total, entity) => total + (entity.params?.length ?? 0), 0);

  const card = (entity: DashboardEntity) => {
    const open = openName === entity.name;
    const docs = overview.byEntity[entity.name] ?? 0;
    return (
      <li className="knowledge-dashboard__card rounded-md border border-border bg-card p-3" key={entity.name}>
        <button
          aria-expanded={open}
          className="knowledge-dashboard__card-toggle flex w-full flex-col gap-1 text-left"
          onClick={() => toggleCard(entity)}
          type="button"
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full border-[1.5px] ${entity.unread ? "border-primary bg-primary" : "border-border"}`}
            />
            <span className="text-sm font-medium">{entity.title}</span>
            {/* The chip slot goes to requirements; capacity stays inside the card. */}
            {entity.params?.length ? (
              <span
                className={`rounded px-1.5 text-xs ${entity.unmet > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"}`}
              >
                {entity.unmet > 0 ? `未对上 ${entity.unmet}/${entity.params.length}` : `${entity.params.length} 条要求`}
              </span>
            ) : null}
            {entity.nextDate ? (
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                {entity.nextLabel || "下一步"} {entity.nextDate}
                {isInferred(entity, "nextDate") ? <InferredTag /> : null}
              </span>
            ) : null}
          </span>
          {entity.summary ? <span className="truncate text-xs text-muted-foreground">{entity.summary}</span> : null}
          <span className={`flex items-center gap-1 text-xs ${entity.unread ? "text-foreground" : "text-muted-foreground"}`}>
            <span className="truncate">{entity.change || "无新变更"}</span>
            {isInferred(entity, "change") ? <InferredTag /> : null}
          </span>
          <span className={`flex items-center gap-1.5 text-xs ${HEALTH_COLOR[entity.health]}`}>
            <SignalIcon className="shrink-0" />
            {HEALTH_TEXT[entity.health]}
            <span className="text-muted-foreground">{`· 库内 ${docs} 篇`}</span>
          </span>
        </button>

        {open ? (
          <div className="knowledge-dashboard__detail mt-2 flex flex-col gap-2 border-t border-border pt-2">
            {/* 新消息清单：点击进源链接（CR-20260918-change-history-and-sources CP-1）。折叠态
                的单行 entity.change 保持不动（快速一瞥），这里是打开卡片后的完整列表。 */}
            <p className="text-xs font-medium text-muted-foreground">最近消息</p>
            {historyBusy === entity.name ? (
              <p className="text-xs text-muted-foreground">加载中…</p>
            ) : (history[entity.name]?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">还没有采集到变化。</p>
            ) : (
              <ul className="knowledge-dashboard__history flex flex-col gap-1">
                {history[entity.name]!.map((item, index) => (
                  <li className="flex items-start gap-2 text-xs" key={`${item.at}-${index}`}>
                    <span className="shrink-0 text-muted-foreground">{formatWhen(item.at)}</span>
                    <a
                      className="min-w-0 flex-1 truncate text-primary underline underline-offset-2"
                      href={item.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {item.change}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs font-medium text-muted-foreground">技术参数与要求</p>
            {(entity.params?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">
                还没有登记。可以在对话里让 Jarvis 从已入库的材料里抽，或者在下面直接写一条。
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {entity.params.map((param) => (
                  <li className="flex items-center gap-2 text-xs" key={param.name}>
                    <span className="min-w-0 flex-1 truncate">
                      {param.name} = {param.value || "（无值）"}
                    </span>
                    {/* 推断项必须一眼可辨（REQ-F-180 ⑥）。没有标记的才是核对过原文的那一类，
                        所以标记打在「没验证过」这一侧——沉默永远意味着更弱的那个断言。 */}
                    {isInferred(entity, param.name) ? <InferredTag /> : null}
                    {/* Only a person sets this: no source page says whether WE meet it. */}
                    <button
                      aria-label={`${entity.title} 的 ${param.name}：我方${PARAM_STATE_LABEL[param.status]}，点击切换`}
                      className={`knowledge-dashboard__param-status shrink-0 rounded px-1 underline underline-offset-2 disabled:opacity-50 ${PARAM_STATE_CLASS[param.status]}`}
                      disabled={busy === `param:${entity.name}`}
                      onClick={() =>
                        void run(
                          `param:${entity.name}`,
                          `已标记「${param.name}」为${PARAM_STATE_LABEL[NEXT_PARAM_STATE[param.status]]}。`,
                          "PATCH",
                          `/api/entities/${encodeURIComponent(entity.name)}`,
                          { action: "paramStatus", param: param.name, status: NEXT_PARAM_STATE[param.status] }
                        )
                      }
                      type="button"
                    >
                      我方{PARAM_STATE_LABEL[param.status]}
                    </button>
                    <button
                      aria-label={`删除 ${entity.title} 的参数 ${param.name}`}
                      className="knowledge-dashboard__remove-param shrink-0 rounded px-1 text-destructive underline underline-offset-2 disabled:opacity-50"
                      disabled={busy === `param:${entity.name}`}
                      onClick={() =>
                        void run(`param:${entity.name}`, "已删除参数。", "PATCH", `/api/entities/${encodeURIComponent(entity.name)}`, {
                          action: "removeParam",
                          param: param.name,
                        })
                      }
                      type="button"
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex items-center gap-2 text-xs"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const nameInput = form.elements.namedItem("param") as HTMLInputElement | null;
                const valueInput = form.elements.namedItem("value") as HTMLInputElement | null;
                const paramName = nameInput?.value.trim();
                if (!paramName) {
                  return;
                }
                void run(`param:${entity.name}`, "已写入参数。", "PATCH", `/api/entities/${encodeURIComponent(entity.name)}`, {
                  action: "setParam",
                  param: paramName,
                  value: valueInput?.value.trim() ?? "",
                });
                nameInput!.value = "";
                if (valueInput) {
                  valueInput.value = "";
                }
              }}
            >
              <input
                aria-label={`为 ${entity.title} 添加技术要求`}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1"
                name="param"
                placeholder="要求名，如 LVRT 持续时间"
              />
              <input
                aria-label={`${entity.title} 的要求取值`}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1"
                name="value"
                placeholder="取值，如 150 ms"
              />
              <button className="shrink-0 rounded px-1 underline underline-offset-2" type="submit">
                写入
              </button>
            </form>
            {entity.capacity ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                容量：{entity.capacity}
                {isInferred(entity, "capacity") ? <InferredTag /> : null}
              </p>
            ) : null}

            {/* 采集源从卡片内联改为弹窗配置（CR-20260918-change-history-and-sources CP-3）——
                卡片里只留一个小按钮，展开的表单挪进 Dialog，卡片本身不再随源的数量变长。 */}
            <Dialog>
              <DialogTrigger asChild>
                <button
                  className="knowledge-dashboard__sources-trigger self-start rounded px-1 text-xs underline underline-offset-2"
                  type="button"
                >
                  采集源设置（{entity.sources.length}）
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{entity.title} 的采集源</DialogTitle>
                  <DialogDescription>登记官网、权威媒体等地址；巡检会定期抓取比对，发现变化即写入上方的消息列表。</DialogDescription>
                </DialogHeader>
                {entity.sources.length === 0 ? (
                  <p className="text-xs text-muted-foreground">未配置。没有源时，这张卡的安静不代表任何事实。</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {entity.sources.map((url) => (
                      <li className="flex items-center gap-2 text-xs" key={url}>
                        <span className="min-w-0 flex-1 truncate">{url}</span>
                        <button
                          aria-label={`立即采集 ${entity.title} 的 ${url}`}
                          className="knowledge-dashboard__fetch-source shrink-0 rounded px-1 underline underline-offset-2 disabled:opacity-50"
                          disabled={busy === `src:${entity.name}`}
                          onClick={() =>
                            void run(`src:${entity.name}`, "已采集。", "PATCH", `/api/entities/${encodeURIComponent(entity.name)}`, {
                              action: "fetch",
                              url,
                            })
                          }
                          type="button"
                        >
                          立即采集
                        </button>
                        <button
                          aria-label={`移除 ${entity.title} 的采集源 ${url}`}
                          className="knowledge-dashboard__remove-source shrink-0 rounded px-1 text-destructive underline underline-offset-2 disabled:opacity-50"
                          disabled={busy === `src:${entity.name}`}
                          onClick={() =>
                            void run(`src:${entity.name}`, "已移除采集源。", "PATCH", `/api/entities/${encodeURIComponent(entity.name)}`, {
                              action: "removeSource",
                              url,
                            })
                          }
                          type="button"
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const input = event.currentTarget.elements.namedItem("url") as HTMLInputElement | null;
                    const url = input?.value.trim();
                    if (url) {
                      void run(`src:${entity.name}`, "已添加采集源。", "PATCH", `/api/entities/${encodeURIComponent(entity.name)}`, {
                        action: "addSource",
                        url,
                      });
                      input!.value = "";
                    }
                  }}
                >
                  <input
                    aria-label={`为 ${entity.title} 添加采集源`}
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    name="url"
                    placeholder="https://"
                  />
                  <button className="shrink-0 rounded px-1 text-xs underline underline-offset-2" type="submit">
                    添加
                  </button>
                </form>
                {/* 自动配置走既有的「交给对话」路径（onAsk 已经是本卡「问 Jarvis」按钮在用的同一
                    条机制），不是让弹窗自己悄悄调模型——一次会花 token 的调用理应出现在对话
                    历史里，让用户看见问的是什么、答的是什么（CR-20260918-change-history-and-sources
                    CP-2 的「非目标」：不新增一条「弹窗直接触发模型」的旁路）。 */}
                {onAsk ? (
                  <button
                    className="knowledge-dashboard__auto-sources self-start rounded px-1 text-xs text-primary underline underline-offset-2"
                    onClick={() =>
                      onAsk(`请帮「${entity.title}」自动查找官网、权威媒体等正式信息来源，找到后登记为采集源。`)
                    }
                    type="button"
                  >
                    自动配置来源（交给对话）
                  </button>
                ) : null}
              </DialogContent>
            </Dialog>
            {/* The card hands off to the chat rather than growing a second app inside it. */}
            {onAsk ? (
              <button
                className="knowledge-dashboard__ask self-start rounded px-1 text-xs text-primary underline underline-offset-2"
                onClick={() => onAsk(`关于「${entity.title}」，`)}
                type="button"
              >
                问 Jarvis 关于这个对象
              </button>
            ) : null}
            {/* Deleting the whole card is heavier than removing one param or source, so it
                sits behind the same expand step as those, plus a confirm — not on the
                collapsed header where a stray click could reach it. */}
            <button
              aria-label={`删除跟踪对象「${entity.title}」`}
              className="knowledge-dashboard__delete-entity self-start rounded px-1 text-xs text-destructive underline underline-offset-2 disabled:opacity-50"
              disabled={busy === `delete:${entity.name}`}
              onClick={() => {
                if (!window.confirm(`删除「${entity.title}」？会移出看板，仍留一份归档可以找回。`)) {
                  return;
                }
                void run(`delete:${entity.name}`, `已删除「${entity.title}」。`, "DELETE", `/api/entities/${encodeURIComponent(entity.name)}`);
              }}
              type="button"
            >
              删除这张卡片
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  /** New-entity form lives inside a card shaped like the others, not a permanent row below
   * the list (CR-20260915-board-card-lifecycle) — collapsed to a `+` tile by default, one
   * open state per kind so opening one lane's tile does not affect the others. */
  const addCard = (title: string, kind: DashboardEntity["kind"]) => {
    const open = addOpenKind[kind] === true;
    const setOpen = (value: boolean) => setAddOpenKind((current) => ({ ...current, [kind]: value }));
    return (
      <li
        className="knowledge-dashboard__add-card flex min-h-24 items-center justify-center rounded-md border border-dashed border-border p-3"
        key="__add__"
      >
        {open ? (
          <form
            className="knowledge-dashboard__add flex w-full items-center gap-2 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement | null;
              const value = input?.value.trim();
              if (!value) {
                return;
              }
              void run(`new:${kind}`, `已添加「${value}」。`, "POST", "/api/entities", { kind, title: value });
              setOpen(false);
            }}
          >
            <input
              aria-label={`新增${title}`}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1"
              name="title"
              placeholder={`新增${title}，填名称`}
            />
            <button
              className="shrink-0 rounded px-1 underline underline-offset-2 disabled:opacity-50"
              disabled={busy === `new:${kind}`}
              type="submit"
            >
              添加
            </button>
            <button
              aria-label={`取消新增${title}`}
              className="shrink-0 rounded px-1 text-muted-foreground underline underline-offset-2"
              onClick={() => setOpen(false)}
              type="button"
            >
              取消
            </button>
          </form>
        ) : (
          <button
            aria-label={`新增${title}`}
            className="knowledge-dashboard__add-toggle text-lg text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(true)}
            type="button"
          >
            +
          </button>
        )}
      </li>
    );
  };

  const lane = (title: string, hint: string, rows: DashboardEntity[], grid: boolean, kind: DashboardEntity["kind"]) => (
    <section aria-label={title} className="knowledge-dashboard__lane flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {rows.length === 0 ? (
        // The chat is one way in, not the only one: proposing through the model needs a
        // configured provider, and an empty board should not depend on that.
        <p className="text-xs text-muted-foreground">还没有{title}。可以点 + 直接添加，也可以在对话里让 Jarvis 提议。</p>
      ) : null}
      <ul className={grid ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" : "flex flex-col gap-2"}>
        {rows.map(card)}
        {addCard(title, kind)}
      </ul>
    </section>
  );

  return (
    <section aria-label="知识看板" className="knowledge-dashboard mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">知识看板</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* The spine reads first: what have we not matched. */}
          <span
            className={`rounded px-2 py-0.5 ${unmetTotal > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
          >
            {paramTotal === 0 ? "还没有登记技术要求" : `${unmetTotal} 条要求未对上 · 共 ${paramTotal} 条`}
          </span>
          <span className="rounded bg-accent px-2 py-0.5 text-accent-foreground">{unreadCount} 项未读变更</span>
          <span className={`rounded px-2 py-0.5 ${brokenCount > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
            {brokenCount} 个采集异常
          </span>
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">{waiting} 条待采纳</span>
        </div>
      </div>

      <section
        aria-label="定时巡检"
        className="knowledge-dashboard__sweep flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs"
      >
        <label className="flex items-center gap-1.5">
          <input
            checked={sweep.enabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              setSweep((current) => ({ ...current, enabled }));
              void saveSweep({ enabled })
                .then(applySweep)
                .catch(() => setNotice("巡检开关保存失败。"));
            }}
            type="checkbox"
          />
          定时巡检
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          每
          <input
            aria-label="巡检间隔（分钟）"
            className="w-16 rounded border border-input bg-background px-1 py-0.5 text-right"
            max={SWEEP_INTERVAL_MAX}
            min={SWEEP_INTERVAL_MIN}
            onBlur={(event) => {
              editingIntervalRef.current = false;
              commitInterval(Number(event.target.value));
            }}
            onChange={(event) => {
              const value = Number(event.target.value);
              editingIntervalRef.current = true;
              setSweep((current) => ({ ...current, intervalMinutes: value }));
              scheduleIntervalSave(value);
            }}
            onFocus={() => {
              editingIntervalRef.current = true;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitInterval(Number(event.currentTarget.value));
              }
            }}
            type="number"
            value={sweep.intervalMinutes}
          />
          分钟（{SWEEP_INTERVAL_MIN}–{SWEEP_INTERVAL_MAX}），一轮最多 {sweep.maxPerRound} 个源
        </label>
        <button
          className="knowledge-dashboard__sweep-now rounded px-1 underline underline-offset-2 disabled:opacity-50"
          disabled={busy === "sweep"}
          onClick={() => {
            setBusy("sweep");
            setNotice(null);
            void runSweepRound(true)
              .then((outcome) => {
                setNotice(outcome.remaining > 0 ? `${outcome.reason}还有 ${outcome.remaining} 个源排队。` : outcome.reason);
                reload();
                return loadSweep().then(applySweep);
              })
              .catch(() => setNotice("巡检失败：网络错误。"))
              .finally(() => setBusy(null));
          }}
          type="button"
        >
          立即巡检一轮
        </button>
        {/* "Never collected" and "they have been quiet" look the same; say which it is. */}
        <span className="text-muted-foreground">{sweep.lastRun ? `上次巡检 ${formatWhen(sweep.lastRun)}` : "还没有巡检过"}</span>
      </section>

      {waiting > 0 ? (
        <section
          aria-label="待采纳的提议"
          className="knowledge-dashboard__pending flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
        >
          <p className="text-xs font-medium">待采纳（{waiting}）— 模型提议，采纳后才进看板</p>
          <ul className="flex flex-col gap-1.5">
            {board.pending.map((entity) => (
              <li className="flex flex-wrap items-center gap-2 text-xs" key={`p-${entity.name}`}>
                <span className="font-medium">新对象：{entity.title}</span>
                <span className="text-muted-foreground">{KIND_LABEL[entity.kind]}</span>
                <button
                  aria-label={`采纳新对象「${entity.title}」`}
                  className="knowledge-dashboard__adopt rounded px-1 underline underline-offset-2 disabled:opacity-50"
                  disabled={busy === `pe:${entity.name}`}
                  onClick={() => void run(`pe:${entity.name}`, `已采纳「${entity.title}」。`, "POST", `/api/entities/pending/${encodeURIComponent(entity.name)}`)}
                  type="button"
                >
                  采纳
                </button>
                <button
                  aria-label={`忽略新对象「${entity.title}」`}
                  className="rounded px-1 text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                  disabled={busy === `pe:${entity.name}`}
                  onClick={() => void run(`pe:${entity.name}`, `已忽略「${entity.title}」。`, "DELETE", `/api/entities/pending/${encodeURIComponent(entity.name)}`)}
                  type="button"
                >
                  忽略
                </button>
              </li>
            ))}
            {board.proposals.map((proposal) => (
              <li className="flex flex-wrap items-center gap-2 text-xs" key={proposal.id}>
                <span className="font-medium">
                  {proposal.entity} · {proposal.field} → {proposal.value}
                </span>
                <a className="text-muted-foreground underline underline-offset-2" href={proposal.url} rel="noreferrer noopener" target="_blank">
                  出处
                </a>
                <button
                  aria-label={`采纳修改 ${proposal.entity} 的 ${proposal.field}`}
                  className="knowledge-dashboard__adopt-proposal rounded px-1 underline underline-offset-2 disabled:opacity-50"
                  disabled={busy === `pp:${proposal.id}`}
                  onClick={() => void run(`pp:${proposal.id}`, "已采纳该修改。", "POST", `/api/entities/proposals/${encodeURIComponent(proposal.id)}`)}
                  type="button"
                >
                  采纳
                </button>
                <button
                  aria-label={`忽略修改 ${proposal.entity} 的 ${proposal.field}`}
                  className="rounded px-1 text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                  disabled={busy === `pp:${proposal.id}`}
                  onClick={() => void run(`pp:${proposal.id}`, "已忽略该修改。", "DELETE", `/api/entities/proposals/${encodeURIComponent(proposal.id)}`)}
                  type="button"
                >
                  忽略
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lane("友商", "顺序固定，不按新鲜度重排", competitors, true, "competitor")}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {lane("规则与准入方", "状态是容量与窗口", authorities, false, "authority")}
        {lane("客户", "容量与其技术发布", customers, false, "customer")}
      </div>

      {/* CR-20260918-library-in-board CP-1：知识看板里原来只有统计数字的「知识库」板块，
          改名「资料库」并加上真的能翻页浏览的内容——已采纳原件 + 真实知识条目按
          CR-20260915-knowledge-library-merge 已经建好的同一套桥接机制合并展示，与
          LibraryPanel.tsx 的浏览模式共用同一份组件实现，不重新发明一套卡片。「按类型」
          统计box 由 LibraryBrowseView 自带的类型统计取代（覆盖面更大：含已采纳原件，不止
          知识条目）；REQ-F-170 ②③ 要求的「无归属/通用」两个数**原样保留**——那是已批准的
          既有要求，与本次改动无关，不因为共处同一节就顺手删掉。 */}
      <section aria-label="资料库" className="knowledge-dashboard__library flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-tight">资料库</h3>
          <span className="text-xs text-muted-foreground">
            共 {overview.total} 条 · 无归属 {overview.unowned} 条
            {/* 具名分组，不并进「无归属」（REQ-F-170 ③）：那是空串桶，这是模型明确说
                「不属于任何对象」的一桶。两者混在一起，就看不出模型是不是在偷懒。 */}
            {generalCount > 0 ? ` · 通用 ${generalCount} 条` : ""}
          </span>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">内容缺口 · 搜索无结果</p>
          {overview.misses.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">还没有查不到的检索。这里只记录真实搜过但库里没有的词。</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {overview.misses.map((miss) => (
                <li className="flex items-center gap-2 text-xs" key={miss.query}>
                  <span className="min-w-0 flex-1 truncate">{miss.query}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5">{miss.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <LibraryBrowseView page={browsePage} error={browseError} offset={browseOffset} onPage={setBrowseOffset} />
      </section>

      {notice ? (
        <p className="knowledge-dashboard__notice text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
