"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * 资料库审批面板（REQ-F-220 ③，CR-20260915-library-adoption CP-3）。
 *
 * 用户 2026-09-15 的裁定是**逐文件**审批、界面在动态屏。为什么不是目录级一刀切：一个合集里
 * 混着成品报告、一手规范和新闻页，整体收下等于把三种可信度不同的东西一起放进检索；但逐条点
 * 258 次也不合理，所以「本组全选」是一次带上一串具体 id 的批量调用——落到登记里仍然是逐条
 * 的判断，谁在什么时候被采纳可以一条条回溯。
 *
 * 面板默认只看**待采纳**：审批是个消耗队列，处理完就该空掉；要回看已通过/已拒绝的，切筛选。
 */

export type LibraryItemView = {
  id: string;
  collection: string;
  group: string;
  name: string;
  ext: string;
  bytes: number;
  status: "pending" | "adopted" | "rejected";
  decidedAt: string;
  no: string;
  title: string;
  sourceUrl: string;
  org: string;
  level: string;
  retrieval: string;
};

export type LibraryCountsView = { total: number; pending: number; adopted: number; rejected: number };

export type LibraryPanelValue = { items: LibraryItemView[]; counts: LibraryCountsView };

type Filter = "pending" | "adopted" | "rejected" | "all";

type LibraryPanelProps = {
  /** 测试缝。 */
  load?: (filter: Filter) => Promise<LibraryPanelValue>;
  decide?: (ids: string[], status: "adopted" | "rejected" | "pending") => Promise<void>;
};

const FILTER_LABEL: Record<Filter, string> = {
  pending: "待采纳",
  adopted: "已采纳",
  rejected: "已拒绝",
  all: "全部",
};

async function loadFromApi(filter: Filter): Promise<LibraryPanelValue> {
  const query = filter === "all" ? "" : `?status=${filter}`;
  const response = await fetch(`/api/library${query}`, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`library fetch failed (${response.status})`);
  }
  return (await response.json()) as LibraryPanelValue;
}

async function decideViaApi(ids: string[], status: "adopted" | "rejected" | "pending"): Promise<void> {
  const response = await fetch("/api/library/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, status }),
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { message?: string }) => body.message)
      .catch(() => null);
    throw new Error(message ?? `裁定失败（${response.status}）`);
  }
}

function sizeOf(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function LibraryPanel({ load = loadFromApi, decide = decideViaApi }: LibraryPanelProps) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [value, setValue] = useState<LibraryPanelValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (next: Filter) => {
      try {
        setValue(await load(next));
        setError(null);
      } catch {
        setError("读不到资料库清单。服务可能正在重启，稍后再打开一次。");
      }
    },
    [load]
  );

  useEffect(() => {
    void reload(filter);
  }, [filter, reload]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, LibraryItemView[]>();
    for (const item of value?.items ?? []) {
      const key = item.group ? `${item.collection} / ${item.group}` : item.collection;
      const bucket = byGroup.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        byGroup.set(key, [item]);
      }
    }
    return [...byGroup.entries()];
  }, [value]);

  const act = useCallback(
    async (ids: string[], status: "adopted" | "rejected" | "pending") => {
      if (ids.length === 0 || busy) {
        return;
      }
      setBusy(true);
      try {
        await decide(ids, status);
        await reload(filter);
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : "裁定失败。");
      } finally {
        setBusy(false);
      }
    },
    [busy, decide, filter, reload]
  );

  if (error && !value) {
    return (
      <p className="library-panel__error text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (!value) {
    return <p className="library-panel__loading text-sm text-muted-foreground">正在读取资料库…</p>;
  }

  return (
    <div className="library-panel flex flex-col gap-4">
      <p className="library-panel__summary text-sm text-muted-foreground">
        共 {value.counts.total} 份 · 待采纳 {value.counts.pending} · 已采纳 {value.counts.adopted} · 已拒绝{" "}
        {value.counts.rejected}
        <span className="mt-1 block text-xs">
          只有已采纳的资料能在对话里被检索和引用；待采纳的会被挡住，但会告诉你有多少份被挡。
        </span>
      </p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="筛选">
        {(["pending", "adopted", "rejected", "all"] as Filter[]).map((option) => (
          <button
            aria-pressed={filter === option}
            className={`rounded border px-2 py-1 text-xs ${
              filter === option ? "border-foreground font-medium" : "border-border text-muted-foreground"
            }`}
            key={option}
            onClick={() => setFilter(option)}
            type="button"
          >
            {FILTER_LABEL[option]}
          </button>
        ))}
      </div>

      {error ? (
        <p className="library-panel__error text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="library-panel__empty text-sm text-muted-foreground">
          {filter === "pending" ? "待采纳区是空的——都审完了。" : `没有${FILTER_LABEL[filter]}的资料。`}
        </p>
      ) : null}

      {groups.map(([key, items]) => (
        <section aria-label={key} className="flex flex-col gap-1.5" key={key}>
          <header className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{key}</h3>
            <span className="text-xs text-muted-foreground">{items.length} 份</span>
            {filter === "pending" ? (
              <button
                className="library-panel__bulk rounded border border-border px-2 py-0.5 text-xs"
                disabled={busy}
                onClick={() => void act(items.map((item) => item.id), "adopted")}
                type="button"
              >
                本组全部通过
              </button>
            ) : null}
          </header>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li className="rounded-md border border-border px-3 py-2" key={item.id}>
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{item.title || item.name}</span>
                  {item.no ? <span className="text-xs text-muted-foreground">{item.no}</span> : null}
                  {item.level ? <span className="text-xs text-muted-foreground">{item.level}</span> : null}
                  <span className="text-xs text-muted-foreground">
                    {item.ext.slice(1).toUpperCase() || "文件"} · {sizeOf(item.bytes)}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.name}
                  {item.org ? ` · ${item.org}` : ""}
                  {item.retrieval ? ` · ${item.retrieval}` : ""}
                </span>
                {item.sourceUrl ? (
                  <a
                    className="mt-0.5 block truncate text-xs underline"
                    href={item.sourceUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {item.sourceUrl}
                  </a>
                ) : null}
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {item.status !== "adopted" ? (
                    <button
                      className="library-panel__adopt rounded border border-border px-2 py-0.5 text-xs"
                      disabled={busy}
                      onClick={() => void act([item.id], "adopted")}
                      type="button"
                    >
                      通过
                    </button>
                  ) : null}
                  {item.status !== "rejected" ? (
                    <button
                      className="library-panel__reject rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
                      disabled={busy}
                      onClick={() => void act([item.id], "rejected")}
                      type="button"
                    >
                      拒绝
                    </button>
                  ) : null}
                  {item.status !== "pending" ? (
                    <button
                      className="library-panel__revert rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
                      disabled={busy}
                      onClick={() => void act([item.id], "pending")}
                      type="button"
                    >
                      撤回判断
                    </button>
                  ) : null}
                  {item.status !== "pending" && item.decidedAt ? (
                    <span className="text-xs text-muted-foreground">
                      {item.status === "adopted" ? "已采纳" : "已拒绝"} · {item.decidedAt.slice(0, 10)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
