"use client";

import { useEffect, useState } from "react";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";

export type KnowledgeListEntry = { name: string; title: string; source: string; createdAt: string; bytes: number };
export type KnowledgeListData = { entries: KnowledgeListEntry[]; pending: KnowledgeListEntry[] };

type KnowledgeListProps = {
  /** SSR-resolved lists so the menu is already correct on first open. */
  initial?: KnowledgeListData;
  /** Test seams. */
  fetchKnowledge?: () => Promise<KnowledgeListData>;
  request?: (method: "POST" | "DELETE", url: string) => Promise<{ ok: boolean; message?: string }>;
};

async function fetchFromApi(): Promise<KnowledgeListData> {
  const response = await fetch("/api/knowledge", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`knowledge fetch failed (${response.status})`);
  }
  const body = (await response.json()) as Partial<KnowledgeListData>;
  return { entries: body.entries ?? [], pending: body.pending ?? [] };
}

async function requestApi(method: "POST" | "DELETE", url: string) {
  const response = await fetch(url, { method });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: body.message };
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "手动",
  file: "文件",
  conversation: "对话",
  model: "模型提议",
};

/**
 * The ☰ menu's knowledge base (REQ-F-044 ③④, REQ-F-046 ③; TASK-085).
 *
 * Two sections. 「待采纳」 is the approval queue for what the model proposed with
 * `save_knowledge`: nothing there is searchable until 采纳 moves it down into the base.
 * That queue is the whole approval mechanism, so it has to be impossible to miss —
 * hence it renders first, with a count, whenever it is non-empty.
 */
export function KnowledgeList({
  initial = { entries: [], pending: [] },
  fetchKnowledge = fetchFromApi,
  request = requestApi,
}: KnowledgeListProps) {
  const [data, setData] = useState<KnowledgeListData>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      fetchKnowledge()
        .then((next) => {
          if (!cancelled) {
            setData(next);
          }
        })
        .catch(() => {
          /* keep whatever is on screen */
        });
    };
    reload();
    window.addEventListener(KNOWLEDGE_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(KNOWLEDGE_CHANGED_EVENT, reload);
    };
  }, [fetchKnowledge]);

  const refresh = () => window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));

  const act = async (label: string, method: "POST" | "DELETE", url: string, done: string, key: string) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await request(method, url);
      setNotice(result.ok ? done : (result.message ?? `${label}失败。`));
      if (result.ok) {
        refresh();
      }
    } catch {
      setNotice(`${label}失败：网络错误。`);
    } finally {
      setBusy(null);
    }
  };

  const adopt = (entry: KnowledgeListEntry) =>
    act("采纳", "POST", `/api/knowledge/pending/${encodeURIComponent(entry.name)}`, `已采纳「${entry.title}」。`, `p:${entry.name}`);
  const discard = (entry: KnowledgeListEntry) =>
    act("忽略", "DELETE", `/api/knowledge/pending/${encodeURIComponent(entry.name)}`, `已忽略「${entry.title}」。`, `p:${entry.name}`);
  const remove = (entry: KnowledgeListEntry) => {
    if (!window.confirm(`删除知识条目「${entry.title}」？该操作不可撤销。`)) {
      return;
    }
    void act("删除", "DELETE", `/api/knowledge/${encodeURIComponent(entry.name)}`, `已删除「${entry.title}」。`, `e:${entry.name}`);
  };

  return (
    <section className="knowledge-list flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label="本地知识库">
      <h3 className="knowledge-list__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">知识库</h3>

      {data.pending.length > 0 ? (
        <div className="knowledge-list__pending flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/5 p-1.5" role="region" aria-label="待采纳的知识提议">
          <p className="text-xs font-medium">待采纳（{data.pending.length}）— 模型提议，采纳后才会被检索</p>
          <ul className="flex flex-col gap-1">
            {data.pending.map((entry) => (
              <li key={entry.name} className="knowledge-list__pending-item flex flex-col">
                <span className="text-sm">{entry.title}</span>
                <span className="mt-0.5 flex gap-2">
                  <button
                    type="button"
                    className="knowledge-list__adopt rounded px-1 text-xs underline underline-offset-2 disabled:opacity-50"
                    aria-label={`采纳知识提议「${entry.title}」`}
                    disabled={busy === `p:${entry.name}`}
                    onClick={() => void adopt(entry)}
                  >
                    采纳
                  </button>
                  <button
                    type="button"
                    className="knowledge-list__discard rounded px-1 text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                    aria-label={`忽略知识提议「${entry.title}」`}
                    disabled={busy === `p:${entry.name}`}
                    onClick={() => void discard(entry)}
                  >
                    忽略
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.entries.length === 0 ? (
        <p className="knowledge-list__empty text-sm text-muted-foreground">知识库为空。拖入 .md / .txt 文件，或在回复上点「存入知识库」。</p>
      ) : (
        <ul className="knowledge-list__items flex flex-col gap-1">
          {data.entries.map((entry) => (
            <li key={entry.name} className="knowledge-list__item flex flex-col">
              <span className="knowledge-list__name text-sm font-medium">{entry.title}</span>
              <span className="knowledge-list__meta text-xs text-muted-foreground">
                {SOURCE_LABEL[entry.source] ?? entry.source} · {entry.name}
              </span>
              <span className="knowledge-list__actions mt-1 flex gap-2">
                <button
                  type="button"
                  className="knowledge-list__delete rounded px-1 text-xs text-destructive underline underline-offset-2 disabled:opacity-50"
                  aria-label={`删除知识条目「${entry.title}」`}
                  disabled={busy === `e:${entry.name}`}
                  onClick={() => remove(entry)}
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {notice ? (
        <p className="knowledge-list__notice text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
