"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";
import { useT } from "@/components/LanguageProvider";
import type { MessageKey } from "@/lib/i18n";

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

const SOURCE_LABEL: Record<string, MessageKey> = {
  manual: "knowledge.source.manual",
  file: "knowledge.source.file",
  conversation: "knowledge.source.chat",
  model: "knowledge.source.proposal",
};

/**
 * The ☰ menu's knowledge base (REQ-F-044 ③④, REQ-F-046 ③, REQ-F-241; TASK-085, TASK-441).
 *
 * Two sections. 「待采纳」 is the approval queue for what the model proposed with
 * `save_knowledge`: nothing there is searchable until 采纳 moves it down into the base.
 *
 * The count badge renders first and is never collapsible — missing that a queue exists
 * is the failure this mechanism exists to prevent. The queue's *contents* default to
 * collapsed (REQ-F-241 ①): 抽屉本就是收纳，打开菜单不该像打开另一个要处理的收件箱。
 * Clicking the badge expands the same adopt/discard controls in place — not a second
 * surface, not a re-routed "go elsewhere" link to a board section that (as of this CR)
 * does not actually list knowledge proposals at all.
 */
export function KnowledgeList({
  initial = { entries: [], pending: [] },
  fetchKnowledge = fetchFromApi,
  request = requestApi,
}: KnowledgeListProps) {
  const t = useT();
  const [data, setData] = useState<KnowledgeListData>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // REQ-F-241：菜单默认不显示待采纳内容本体，只给计数——折叠而不是搬走，复用同一套
  // 采纳/忽略逻辑，不用另起一个「去哪里处理」的新入口。
  const [pendingOpen, setPendingOpen] = useState(false);

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
      setNotice(result.ok ? done : (result.message ?? t("knowledge.actionFailed", { label })));
      if (result.ok) {
        refresh();
      }
    } catch {
      setNotice(t("knowledge.actionFailedNetwork", { label }));
    } finally {
      setBusy(null);
    }
  };

  const adopt = (entry: KnowledgeListEntry) =>
    act(t("common.adopt"), "POST", `/api/knowledge/pending/${encodeURIComponent(entry.name)}`, t("knowledge.adopted", { title: entry.title }), `p:${entry.name}`);
  const discard = (entry: KnowledgeListEntry) =>
    act(t("common.ignore"), "DELETE", `/api/knowledge/pending/${encodeURIComponent(entry.name)}`, t("knowledge.ignored", { title: entry.title }), `p:${entry.name}`);
  const remove = (entry: KnowledgeListEntry) => {
    if (!window.confirm(t("knowledge.deleteConfirm", { title: entry.title }))) {
      return;
    }
    void act(t("common.delete"), "DELETE", `/api/knowledge/${encodeURIComponent(entry.name)}`, t("knowledge.deleted", { title: entry.title }), `e:${entry.name}`);
  };

  return (
    <section className="knowledge-list flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label={t("knowledge.aria")}>
      <h3 className="knowledge-list__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("knowledge.title")}</h3>

      {data.pending.length > 0 ? (
        <div className="knowledge-list__pending rounded border border-amber-500/40 bg-amber-500/5" role="region" aria-label={t("knowledge.pendingAria")}>
          <button
            type="button"
            className="knowledge-list__pending-toggle flex w-full items-center justify-between px-1.5 py-1 text-left text-xs font-medium"
            aria-expanded={pendingOpen}
            onClick={() => setPendingOpen((open) => !open)}
          >
            <span>{t("knowledge.pendingHeading", { count: data.pending.length })}</span>
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5 shrink-0 transition-transform", pendingOpen && "rotate-180")}
            />
          </button>
          {pendingOpen ? (
            <ul className="knowledge-list__pending-items flex flex-col gap-1 border-t border-amber-500/30 p-1.5">
              {data.pending.map((entry) => (
                <li key={entry.name} className="knowledge-list__pending-item flex flex-col">
                  <span className="text-sm">{entry.title}</span>
                  <span className="mt-0.5 flex gap-2">
                    <button
                      type="button"
                      className="knowledge-list__adopt rounded px-1 text-xs underline underline-offset-2 disabled:opacity-50"
                      aria-label={t("knowledge.adoptAria", { title: entry.title })}
                      disabled={busy === `p:${entry.name}`}
                      onClick={() => void adopt(entry)}
                    >
                      {t("common.adopt")}
                    </button>
                    <button
                      type="button"
                      className="knowledge-list__discard rounded px-1 text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                      aria-label={t("knowledge.ignoreAria", { title: entry.title })}
                      disabled={busy === `p:${entry.name}`}
                      onClick={() => void discard(entry)}
                    >
                      {t("common.ignore")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {data.entries.length === 0 ? (
        <p className="knowledge-list__empty text-sm text-muted-foreground">{t("knowledge.empty")}</p>
      ) : (
        <ul className="knowledge-list__items flex flex-col gap-1">
          {data.entries.map((entry) => (
            <li key={entry.name} className="knowledge-list__item flex flex-col">
              <span className="knowledge-list__name text-sm font-medium">{entry.title}</span>
              <span className="knowledge-list__meta text-xs text-muted-foreground">
                {SOURCE_LABEL[entry.source] ? t(SOURCE_LABEL[entry.source]) : entry.source} · {entry.name}
              </span>
              <span className="knowledge-list__actions mt-1 flex gap-2">
                <button
                  type="button"
                  className="knowledge-list__delete rounded px-1 text-xs text-destructive underline underline-offset-2 disabled:opacity-50"
                  aria-label={t("knowledge.deleteAria", { title: entry.title })}
                  disabled={busy === `e:${entry.name}`}
                  onClick={() => remove(entry)}
                >
                  {t("common.delete")}
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
