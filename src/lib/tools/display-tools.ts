import type { Store } from "../store";
import type { ToolDescriptor } from "./registry";

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
    description: "把展示屏切回标题视图（首页）。用户说「回到首页」「显示标题」时调用。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      store.setDisplayState({ kind: "home", refId: null });
      return { ok: true, content: "展示屏已切回首页。", summary: "展示屏 → 首页" };
    },
  };

  const insight: ToolDescriptor = {
    name: "show_insight",
    description: "把展示屏切到一份已存在的洞察报告。参数 insightId 为该报告的 id。",
    parameters: {
      type: "object",
      properties: { insightId: { type: "string", description: "洞察 id" } },
      required: ["insightId"],
    },
    available: () => true,
    async execute(args, context) {
      const insightId = typeof args.insightId === "string" ? args.insightId.trim() : "";
      if (!insightId) {
        return { ok: false, content: "缺少参数 insightId。", summary: "参数缺失" };
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
    description: "把一份 HTML 报告保存为洞察并显示在展示屏上。参数 html 为完整 HTML 片段。",
    parameters: {
      type: "object",
      properties: { html: { type: "string", description: "完整的 HTML 内容" } },
      required: ["html"],
    },
    available: () => true,
    async execute(args, context) {
      const html = typeof args.html === "string" ? args.html : "";
      if (!looksLikeCompleteHtml(html)) {
        return {
          ok: false,
          content: "HTML 不完整或为空，未保存。请给出完整的 HTML 片段。",
          summary: "HTML 不完整，未保存",
        };
      }
      const record = store.insertInsight({ conversationId: context.conversationId, kind: "skill", html });
      store.setDisplayState({ kind: "insight", refId: record.id });
      return { ok: true, content: `洞察已保存（id ${record.id}）并显示在展示屏上。`, summary: "已生成洞察" };
    },
  };

  return [home, insight, save];
}
