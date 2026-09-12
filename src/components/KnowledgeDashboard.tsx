"use client";

import { useCallback, useEffect, useState } from "react";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";

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
  createdAt: string;
  unread: boolean;
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
  act?: (method: "POST" | "DELETE" | "PATCH", url: string, body?: unknown) => Promise<{ ok: boolean; message?: string }>;
  /** Hands a pre-filled question to the chat instead of running anything here. */
  onAsk?: (question: string) => void;
};

const EMPTY_BOARD: DashboardData = { entities: [], pending: [], proposals: [] };
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

export function KnowledgeDashboard({
  initialData = EMPTY_BOARD,
  initialOverview = EMPTY_OVERVIEW,
  loadBoard = () => getJson<DashboardData>("/api/entities", EMPTY_BOARD),
  loadOverview = () => getJson<OverviewData>("/api/knowledge/overview", EMPTY_OVERVIEW),
  act = actViaApi,
  onAsk,
}: Props) {
  const [board, setBoard] = useState<DashboardData>(initialData);
  const [overview, setOverview] = useState<OverviewData>(initialOverview);
  const [openName, setOpenName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  useEffect(() => {
    reload();
    window.addEventListener(KNOWLEDGE_CHANGED_EVENT, reload);
    return () => window.removeEventListener(KNOWLEDGE_CHANGED_EVENT, reload);
  }, [reload]);

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
  };

  const byKind = (kind: DashboardEntity["kind"]) => board.entities.filter((entity) => entity.kind === kind);
  const competitors = byKind("competitor");
  const authorities = byKind("authority");
  const customers = byKind("customer");
  const unreadCount = board.entities.filter((entity) => entity.unread).length;
  const brokenCount = board.entities.filter((entity) => entity.health === "failed_fetch" || entity.health === "parse_failed").length;
  const waiting = board.pending.length + board.proposals.length;

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
            {entity.capacity ? (
              <span className="rounded bg-muted px-1.5 text-xs text-foreground">{entity.capacity}</span>
            ) : null}
            {entity.nextDate ? (
              <span className="ml-auto text-xs text-muted-foreground">
                {entity.nextLabel || "下一步"} {entity.nextDate}
              </span>
            ) : null}
          </span>
          {entity.summary ? <span className="truncate text-xs text-muted-foreground">{entity.summary}</span> : null}
          <span className={`truncate text-xs ${entity.unread ? "text-foreground" : "text-muted-foreground"}`}>
            {entity.change || "无新变更"}
          </span>
          <span className={`flex items-center gap-1.5 text-xs ${HEALTH_COLOR[entity.health]}`}>
            <SignalIcon className="shrink-0" />
            {HEALTH_TEXT[entity.health]}
            <span className="text-muted-foreground">{`· 库内 ${docs} 篇`}</span>
          </span>
        </button>

        {open ? (
          <div className="knowledge-dashboard__detail mt-2 flex flex-col gap-2 border-t border-border pt-2">
            <p className="text-xs font-medium text-muted-foreground">采集源</p>
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
          </div>
        ) : null}
      </li>
    );
  };

  const lane = (title: string, hint: string, rows: DashboardEntity[], grid: boolean) => (
    <section aria-label={title} className="knowledge-dashboard__lane flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">还没有{title}。在对话里说一句，让 Jarvis 提议一个。</p>
      ) : (
        <ul className={grid ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" : "flex flex-col gap-2"}>
          {rows.map(card)}
        </ul>
      )}
    </section>
  );

  return (
    <section aria-label="知识看板" className="knowledge-dashboard mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">知识看板</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-accent px-2 py-0.5 text-accent-foreground">{unreadCount} 项未读变更</span>
          <span className={`rounded px-2 py-0.5 ${brokenCount > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
            {brokenCount} 个采集异常
          </span>
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">{waiting} 条待采纳</span>
        </div>
      </div>

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

      {lane("友商", "顺序固定，不按新鲜度重排", competitors, true)}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {lane("规则与准入方", "状态是容量与窗口", authorities, false)}
        {lane("客户", "容量与其技术发布", customers, false)}
      </div>

      <section aria-label="知识库总览" className="knowledge-dashboard__library flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-tight">知识库</h3>
          <span className="text-xs text-muted-foreground">
            共 {overview.total} 条 · 无归属 {overview.unowned} 条
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">按类型</p>
            {Object.keys(overview.byType).length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">知识库为空。</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {Object.entries(overview.byType).map(([type, count]) => (
                  <li className="flex items-center justify-between gap-2 text-xs" key={type}>
                    <span className={type === "未分类" ? "text-amber-700 dark:text-amber-500" : ""}>{type}</span>
                    <span className={type === "未分类" ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground"}>{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {notice ? (
        <p className="knowledge-dashboard__notice text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
