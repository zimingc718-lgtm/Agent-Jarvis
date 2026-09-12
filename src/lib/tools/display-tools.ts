import type { Store } from "../store";
import { describeArgsProblem, TOOL_PRIORITY, type ToolDescriptor } from "./registry";

/** Hard cap on one insight's body (REQ-F-050 ②). Appending past it is refused, not clipped. */
export const MAX_INSIGHT_BYTES = 512 * 1024;

/** Rough section count for the progress line the model gets back after an append. */
function countSections(html: string): number {
  return (html.match(/<h[12][\s>]/gi) ?? []).length;
}

/**
 * Display-screen control as tools (REQ-F-032, REQ-F-023 rewritten; TASK-068).
 *
 * These replace two mechanisms at once: the routing call's `display` field (which lost
 * its host when the router was deleted) and the "last ```html fence of a skill turn"
 * capture (which lost its trigger when "skill turn" stopped being a concept). Both now
 * happen because the model asked, and both take effect **mid-loop** rather than in the
 * post-persist `onFinal` hook — DEC-017 ⑤ as revised.
 */

/** Cheap structural check: enough to reject a stream that was cut mid-tag. */
export function looksLikeCompleteHtml(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const opens = (trimmed.match(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g) ?? []).length;
  const closes = (trimmed.match(/<\/[a-zA-Z][\w-]*>/g) ?? []).length;
  const selfClosing = (trimmed.match(/<[a-zA-Z][\w-]*(\s[^>]*)?\/>/g) ?? []).length;
  if (opens === 0) {
    return false;
  }
  // A trailing `<` or an unterminated tag is the usual shape of a truncated stream.
  if (/<[^>]*$/.test(trimmed)) {
    return false;
  }
  return closes + selfClosing >= Math.max(1, Math.floor((opens - selfClosing) * 0.5));
}

export function createDisplayTools(store: Store): ToolDescriptor[] {
  const home: ToolDescriptor = {
    name: "show_home",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切回标题视图（首页，带开场动画）。用户说「回到首页」「显示标题」时调用。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      store.setDisplayState({ kind: "home", refId: null });
      // REQ-F-102 ①. Clearing the persisted state is not enough on its own: the board is a
      // session stage held in the component, and it outranks `home` when rendering. Without
      // this event the tool reported success while the user went on seeing the board — the
      // regression e2e caught (EV-2026-09-12-stage-reach §1).
      return {
        ok: true,
        content: "展示屏已切回首页。",
        summary: "展示屏 → 首页",
        events: [{ type: "display_stage", stage: "opening" }],
      };
    },
  };

  const board: ToolDescriptor = {
    name: "show_board",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切到知识看板（跟踪对象与知识库总览）。用户说「打开看板」「看一下跟踪对象」时调用。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      // The board sits below a persisted insight, so an insight left on screen would cover
      // it. Clearing to `home` first is what makes the stage visible (REQ-F-102 ②).
      store.setDisplayState({ kind: "home", refId: null });
      return {
        ok: true,
        content: "展示屏已切到知识看板。看板上的内容由用户采纳的条目构成，我不能绕过用户直接改动它。",
        summary: "展示屏 → 知识看板",
        events: [{ type: "display_stage", stage: "board" }],
      };
    },
  };

  const insight: ToolDescriptor = {
    name: "show_insight",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切到一份已存在的洞察报告。参数 insightId 为该报告的 id。",
    parameters: {
      type: "object",
      properties: { insightId: { type: "string", description: "洞察 id" } },
      required: ["insightId"],
    },
    available: () => true,
    async execute(args, context, raw) {
      const insightId = typeof args.insightId === "string" ? args.insightId.trim() : "";
      if (!insightId) {
        const problem = describeArgsProblem(raw ?? "", args, ["insightId"]) ?? "缺少参数 insightId。";
        return { ok: false, content: problem, summary: "参数缺失" };
      }
      const record = store.getInsight(insightId);
      // `insights` has no `user_id`; ownership comes from the conversation it hangs off
      // (CP-43). Without this a guessed id would put another conversation's HTML on screen.
      const owner = record ? store.getConversationForUser(context.userId, record.conversationId) : null;
      if (!record || !owner) {
        return {
          ok: false,
          content: `找不到 id 为 ${insightId} 的洞察，或它不属于当前用户。`,
          summary: `洞察不可用：${insightId}`,
        };
      }
      store.setDisplayState({ kind: "insight", refId: insightId });
      return { ok: true, content: "展示屏已切到该洞察。", summary: "展示屏 → 洞察" };
    },
  };

  const save: ToolDescriptor = {
    name: "save_insight",
    priority: TOOL_PRIORITY.management,
    description:
      "把 HTML 报告保存为洞察并显示在展示屏上。长报告请分块：首块不带 insightId 新建，后续块带上返回的 insightId 追加到同一份。",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "本块的 HTML 片段（标签须闭合）" },
        insightId: { type: "string", description: "可选。已有洞察 id：把本块追加到它的末尾，而不是新建" },
      },
      required: ["html"],
    },
    available: () => true,
    async execute(args, context, raw) {
      const html = typeof args.html === "string" ? args.html : "";
      if (!html) {
        // REQ-F-050 ⑤: say what arrived, not just "empty" — the 63-byte probe that was
        // rejected for a wrapper key is the case this fixes.
        const problem = describeArgsProblem(raw ?? "", args, ["html"]) ?? "缺少参数 html。";
        return { ok: false, content: `${problem} 未保存。`, summary: "参数缺失，未保存" };
      }
      if (!looksLikeCompleteHtml(html)) {
        const noTags = !/<[a-zA-Z]/.test(html);
        return {
          ok: false,
          content: noTags
            ? "html 里没有任何 HTML 标签，未保存。请给出 HTML 片段。"
            : `HTML 疑似被截断（末尾：${JSON.stringify(html.trim().slice(-40))}），未保存。请缩短本块，或分成更小的块用 insightId 追加。`,
          summary: noTags ? "不是 HTML，未保存" : "HTML 疑似截断，未保存",
        };
      }

      const insightId = typeof args.insightId === "string" ? args.insightId.trim() : "";
      if (insightId) {
        // REQ-F-050 ①: append to an existing insight. Same ownership check as show_insight.
        const existing = store.getInsight(insightId);
        const owner = existing ? store.getConversationForUser(context.userId, existing.conversationId) : null;
        if (!existing || !owner) {
          return {
            ok: false,
            content: `找不到 id 为 ${insightId} 的洞察，或它不属于当前用户；本块未保存。不带 insightId 可新建。`,
            summary: `洞察不可用：${insightId}`,
          };
        }
        const nextBytes = Buffer.byteLength(existing.html, "utf8") + Buffer.byteLength(html, "utf8");
        if (nextBytes > MAX_INSIGHT_BYTES) {
          return {
            ok: false,
            content: `追加后将达 ${nextBytes} 字节，超过单份洞察上限 ${MAX_INSIGHT_BYTES} 字节；本块未保存。请精简内容。`,
            summary: "洞察超出上限，未追加",
          };
        }
        const updated = store.appendInsightHtml(insightId, `\n${html}`);
        if (!updated) {
          return { ok: false, content: `追加失败：洞察 ${insightId} 已不存在。`, summary: "追加失败" };
        }
        // Re-pointing (even to the same id) refreshes updated_at, so the screen refetches.
        store.setDisplayState({ kind: "insight", refId: insightId });
        return {
          ok: true,
          content: `已追加到洞察 ${insightId}：累计 ${updated.html.length} 字符、${countSections(updated.html)} 个章节标题，展示屏已刷新。继续追加请仍带此 insightId。`,
          summary: "已追加洞察",
        };
      }

      if (Buffer.byteLength(html, "utf8") > MAX_INSIGHT_BYTES) {
        return {
          ok: false,
          content: `HTML 有 ${Buffer.byteLength(html, "utf8")} 字节，超过单份洞察上限 ${MAX_INSIGHT_BYTES} 字节；未保存。`,
          summary: "洞察超出上限，未保存",
        };
      }
      const record = store.insertInsight({ conversationId: context.conversationId, kind: "skill", html });
      store.setDisplayState({ kind: "insight", refId: record.id });
      return {
        ok: true,
        content: `洞察已保存（id ${record.id}，${html.length} 字符）并显示在展示屏上。要继续补充内容，请再次调用并带 insightId ${record.id}。`,
        summary: "已生成洞察",
      };
    },
  };

  return [home, board, insight, save];
}
