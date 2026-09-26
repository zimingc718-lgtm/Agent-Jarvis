"use client";

import { useState } from "react";
import { SKILLS_CHANGED_EVENT } from "@/lib/ui-events";

/**
 * 对话内技能提议卡（REQ-F-320 ①，DEC-430 ②；CR-20260925-write-approval-action-log）。
 *
 * 与 `EntityProposalCard` 同一形态、同一原则：这张卡不是新的写入口，只是把 ☰「技能」里的
 * 「采纳 / 忽略」搬到对话里，调用的是同一条 `/api/skills/proposals/[id]` 路由。模型只能把
 * 技能**提议**出来（`register_skill` 不再写文件、不再插表），卡片只能转发用户的点击。
 */

export type SkillProposalPayload = { id: string; name: string; description: string };

type Outcome = { kind: "adopted" | "discarded"; note: string } | { kind: "error"; note: string };

type SkillProposalCardProps = {
  payload: SkillProposalPayload;
  /** 测试缝。 */
  act?: (method: "POST" | "DELETE", url: string) => Promise<{ ok: boolean; message?: string }>;
};

async function actViaApi(method: "POST" | "DELETE", url: string) {
  const response = await fetch(url, { method });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: body.message };
}

export function SkillProposalCard({ payload, act = actViaApi }: SkillProposalCardProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const decide = async (decision: "adopted" | "discarded") => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await act(decision === "adopted" ? "POST" : "DELETE", `/api/skills/proposals/${encodeURIComponent(payload.id)}`);
      if (result.ok) {
        setOutcome({
          kind: decision,
          note: decision === "adopted" ? `已注册技能「${payload.name}」。` : "已忽略，未注册。",
        });
        // ☰「技能」是同一份数据的另一扇门：这边有了结果，那边的待确认区与技能列表都要跟着动。
        window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
      } else {
        setOutcome({ kind: "error", note: result.message ?? "操作失败。" });
      }
    } catch {
      setOutcome({ kind: "error", note: "操作失败：网络错误。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-label={`提议注册技能「${payload.name}」`}
      className="skill-proposal-card flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs"
      role="region"
    >
      <p>
        模型提议注册技能「{payload.name}」：<span className="text-muted-foreground">{payload.description}</span>
      </p>
      {outcome ? (
        <p className={outcome.kind === "error" ? "text-destructive" : "text-muted-foreground"} role="status">
          {outcome.note}
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            className="skill-proposal-card__adopt rounded px-1 underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={() => void decide("adopted")}
            type="button"
          >
            采纳
          </button>
          <button
            className="skill-proposal-card__discard rounded px-1 text-muted-foreground underline underline-offset-2 disabled:opacity-50"
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
