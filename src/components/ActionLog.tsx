"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/components/LanguageProvider";
import type { MessageKey } from "@/lib/i18n";

/**
 * 操作记录（REQ-F-320 ②，DEC-430 ①；CR-20260925-write-approval-action-log）。
 *
 * 模型跨会话做过的每一次工具调用：时间、所在会话、工具、参数摘要、结果。默认只列
 * 「写」与「出网」两类——只读调用也入库，但要翻开「显示全部」才看得到（用户 2026-09-25
 * 裁定）。入口行与 `SearchSettings` 同形态，列表在弹窗里，抽屉本身保持一行一项。
 */

export type ActionLogEntry = {
  id: string;
  conversationId: string;
  conversationTitle?: string | null;
  tool: string;
  effect: "read" | "write" | "network";
  argsSummary: string;
  outcome: "ok" | "failed" | "aborted" | "refused" | "not_run";
  summary: string;
  createdAt: string;
};

type ActionLogProps = {
  /** 测试缝：按筛选取一页记录。 */
  load?: (input: { effects: ActionLogEntry["effect"][] | null; limit: number }) => Promise<ActionLogEntry[]>;
};

const DEFAULT_EFFECTS: ActionLogEntry["effect"][] = ["write", "network"];
const PAGE = 100;

const EFFECT_LABEL: Record<ActionLogEntry["effect"], MessageKey> = {
  read: "actions.effect.read",
  write: "actions.effect.write",
  network: "actions.effect.network",
};
const OUTCOME_LABEL: Record<ActionLogEntry["outcome"], MessageKey> = {
  ok: "actions.outcome.ok",
  failed: "actions.outcome.failed",
  aborted: "actions.outcome.aborted",
  refused: "actions.outcome.refused",
  not_run: "actions.outcome.notRun",
};

async function loadFromApi(input: { effects: ActionLogEntry["effect"][] | null; limit: number }) {
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.effects) {
    query.set("effects", input.effects.join(","));
  }
  const response = await fetch(`/api/actions?${query.toString()}`, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`actions fetch failed (${response.status})`);
  }
  const body = (await response.json()) as { actions?: ActionLogEntry[] };
  return body.actions ?? [];
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function ActionLog({ load = loadFromApi }: ActionLogProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [entries, setEntries] = useState<ActionLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setError(null);
    load({ effects: showAll ? null : DEFAULT_EFFECTS, limit: PAGE })
      .then((next) => {
        if (!cancelled) {
          setEntries(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("actions.loadFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, showAll, load]);

  return (
    <section className="action-log flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label={t("actions.title")}>
      <h3 className="action-log__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("actions.title")}</h3>

      {/* Entry row: same shape as 「搜索设置」, so the drawer reads as one list. */}
      <Button type="button" variant="ghost" className="w-full justify-start gap-2" onClick={() => setOpen(true)}>
        <History aria-hidden="true" className="size-4" />
        {t("actions.open")}
      </Button>
      <p className="action-log__summary px-3 text-xs text-muted-foreground">{t("actions.subtitle")}</p>

      <Dialog open={open} title={t("actions.title")} onClose={() => setOpen(false)}>
        <div className="action-log__body flex flex-col gap-3">
          <label className="action-log__filter flex items-center justify-between gap-2 text-sm">
            <span>
              {t("actions.showAll")}
              <span className="mt-0.5 block text-xs text-muted-foreground">{t("actions.showAllHint")}</span>
            </span>
            <Switch aria-label={t("actions.showAllAria")} checked={showAll} onCheckedChange={setShowAll} />
          </label>

          {error ? (
            <p className="action-log__error text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : entries === null ? (
            <p className="action-log__loading text-xs text-muted-foreground" role="status">
              {t("common.loading")}
            </p>
          ) : entries.length === 0 ? (
            <p className="action-log__empty text-xs text-muted-foreground" role="status">
              {showAll ? t("actions.emptyAll") : t("actions.emptyFiltered")}
            </p>
          ) : (
            <ul className="action-log__items flex max-h-[60vh] flex-col gap-1 overflow-y-auto text-xs">
              {entries.map((entry) => (
                <li key={entry.id} className={`action-log__item action-log__item--${entry.outcome} flex flex-col gap-0.5 rounded border border-border/60 px-2 py-1`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <time className="action-log__time text-muted-foreground" dateTime={entry.createdAt}>
                      {formatTime(entry.createdAt)}
                    </time>
                    <span className="action-log__effect rounded bg-muted px-1 text-[11px]">{t(EFFECT_LABEL[entry.effect])}</span>
                    <span className="action-log__tool font-medium">{entry.tool}</span>
                    <span className={`action-log__outcome ${entry.outcome === "ok" ? "text-muted-foreground" : "text-destructive"}`}>
                      {t(OUTCOME_LABEL[entry.outcome])}
                    </span>
                  </div>
                  <span className="action-log__args truncate text-muted-foreground" title={entry.argsSummary}>
                    {entry.argsSummary}
                  </span>
                  <span className="action-log__result truncate" title={entry.summary}>
                    {entry.summary}
                  </span>
                  <span className="action-log__conversation truncate text-muted-foreground" title={entry.conversationTitle ?? entry.conversationId}>
                    {t("actions.conversation", { title: entry.conversationTitle ?? entry.conversationId })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </section>
  );
}
