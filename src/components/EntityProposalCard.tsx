"use client";

import { useState } from "react";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";

/**
 * 对话内提议卡（INPUT-2026-09-15-029 第 2 条「支持对话阅读，编辑」；CR-20260915-entity-proposal-card）。
 *
 * 「编辑」走的仍是采纳闸——这张卡片不是一个新的写入口，只是把看板上早已存在的采纳/忽略
 * 按钮搬到了对话里，调用的是同一条 `/api/entities/pending/*` 或 `/api/entities/proposals/*`
 * 路由。模型只能把字段改动**提议**出来（`propose_entity`/`propose_entity_update`，两个工具
 * 都不直接写），这张卡片同样只能**转发**用户的点击，不能替用户点。「不绕过审批」这件事，
 * 审批闸本身已经守住了，这张卡片没有、也不需要另外再守一遍。
 *
 * 只在事件带全必要标识时才渲染（`propose_entity`/`propose_entity_update` 两个单件工具都
 * 带；`extract_fields` 一次可能提议好几个字段，带不出一个能用的单一 id，调用方那一层会
 * 退回旧的纯文字通知，不会渲染这张卡）。
 */

export type EntityProposalPayload =
  | { what: "entity"; name: string; title: string }
  | { what: "update"; id: string; entity: string; field: string; value: string };

type Outcome = { kind: "adopted" | "discarded"; note: string } | { kind: "error"; note: string };

type EntityProposalCardProps = {
  payload: EntityProposalPayload;
  /** 测试缝。 */
  act?: (method: "POST" | "DELETE", url: string) => Promise<{ ok: boolean; message?: string }>;
};

async function actViaApi(method: "POST" | "DELETE", url: string) {
  const response = await fetch(url, { method });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: body.message };
}

function routeFor(payload: EntityProposalPayload): string {
  return payload.what === "entity"
    ? `/api/entities/pending/${encodeURIComponent(payload.name)}`
    : `/api/entities/proposals/${encodeURIComponent(payload.id)}`;
}

export function EntityProposalCard({ payload, act = actViaApi }: EntityProposalCardProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const decide = async (decision: "adopted" | "discarded") => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await act(decision === "adopted" ? "POST" : "DELETE", routeFor(payload));
      if (result.ok) {
        setOutcome({ kind: decision, note: decision === "adopted" ? "已采纳。" : "已忽略。" });
        // 看板是同一份数据的另一扇门：卡片这边一旦有了结果，那边的待采纳队列也要跟着动。
        window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
      } else {
        setOutcome({ kind: "error", note: result.message ?? "操作失败。" });
      }
    } catch {
      setOutcome({ kind: "error", note: "操作失败：网络错误。" });
    } finally {
      setBusy(false);
    }
  };

  const headline =
    payload.what === "entity"
      ? `模型提议跟踪对象「${payload.title}」`
      : `模型提议把「${payload.entity}」的 ${payload.field} 改为「${payload.value}」`;

  return (
    <div
      aria-label={payload.what === "entity" ? `提议新对象「${payload.title}」` : `提议修改「${payload.entity}」的 ${payload.field}`}
      className="entity-proposal-card flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs"
      role="region"
    >
      <p>{headline}</p>
      {outcome ? (
        <p className={outcome.kind === "error" ? "text-destructive" : "text-muted-foreground"} role="status">
          {outcome.note}
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            className="entity-proposal-card__adopt rounded px-1 underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={() => void decide("adopted")}
            type="button"
          >
            采纳
          </button>
          <button
            className="entity-proposal-card__discard rounded px-1 text-muted-foreground underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={() => void decide("discarded")}
            type="button"
          >
            忽略
          </button>
        </div>
      )}
    </div>
  );
}
