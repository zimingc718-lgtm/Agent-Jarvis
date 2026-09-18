/**
 * Custom DOM events shared between client components, plus the view types they
 * carry. Zero dependencies on purpose: a client component can import these
 * without pulling in a server module (`store-singleton` → `node:sqlite`), and two
 * client components can talk without importing each other.
 *
 * (Renamed from `display-events.ts` by CR-20260910-skill-intake TASK-043 ⑤ once a
 * second event joined it — one shared module beats one file per constant.)
 */

/** Tells the full-screen DisplayScreen to refetch (CR-20260909-display-screen CP-9). */
export const DISPLAY_CHANGED_EVENT = "jarvis:display-changed";

/**
 * Tells the ☰ menu's SkillList to refetch after a registration
 * (CR-20260910-skill-intake CP-4, mirroring the existing `jarvis:providers-changed`).
 */
export const SKILLS_CHANGED_EVENT = "jarvis:skills-changed";

/**
 * Carries the conversation's running token totals to the ☰ menu (REQ-F-037 ①).
 * `detail` is a `TokenUsage`. The chat owns the stream, the menu owns the display, and
 * neither imports the other.
 */
export const USAGE_CHANGED_EVENT = "jarvis:usage-changed";

/**
 * Carries THIS turn's running total to the ☰ menu (REQ-NF-060 ④).
 *
 * Separate from `USAGE_CHANGED_EVENT` because the two answer different questions:
 * the conversation total says what the session has cost, this says what the question
 * you just asked cost. A 1M-token research turn was invisible while only the former
 * existed — it simply moved a large number slightly larger.
 */
export const TURN_USAGE_EVENT = "jarvis:turn-usage";

/**
 * Tells the ☰ menu's KnowledgeList to refetch — after a drop, a 「存入知识库」 click, or a
 * `knowledge_pending` event from the stream (CR-20260911-knowledge-base, REQ-F-044 ④).
 */
export const KNOWLEDGE_CHANGED_EVENT = "jarvis:knowledge-changed";

/**
 * The board hands a half-written question to the chat (CR-20260912-display-stage).
 * `detail` is `{ text }`. The board never runs anything itself — a card's 「问 Jarvis」
 * fills the console and stops there, which is what keeps the board from growing into a
 * second application.
 */
export const ASK_JARVIS_EVENT = "jarvis:ask";

/**
 * Moves the display screen between its two **session** stages — the title opening and the
 * knowledge board (CR-20260912-stage-reach). `detail` is `{ stage }`.
 *
 * Why an event rather than a fourth `display_state` value: CR-20260912-display-stage
 * rejected persisting the board, because a sticky board would fight `show_home` /
 * `show_insight` across sessions. That decision stands. What it missed is that a stage
 * held only in the component silently outranks the persisted state, so once anything had
 * happened in the session the title view became unreachable and `show_home` ran to no
 * visible effect. A transient event keeps the board out of the database and still lets the
 * conversation reach both stages.
 */
export const DISPLAY_STAGE_EVENT = "jarvis:display-stage";

/** The two session stages of the display screen. Insight is persistent and sits above both. */
export type DisplayStage = "opening" | "board" | "org-chart-board";

/**
 * 把设置类界面唤到动态屏上（REQ-F-200，用户 2026-09-13 决策 3）。`detail` 是 `{ panel }`；
 * `panel` 为 null 表示退回看板。
 *
 * 为什么不是弹窗：弹窗盖住正在看的东西，而这些面板恰恰是要对着屏幕上的东西改的（换 Provider
 * 之后看报告还在不在、开了技能之后工具表变不变）。动态屏本来就是「现在该看什么」的那块地方。
 *
 * 为什么入口在对话框而不在 ☰：抽屉是收纳，对话框是正在用的地方。☰ 里的入口一并保留——
 * 同一个面板两个入口，不是两套实现。
 */
export const SETTINGS_PANEL_EVENT = "jarvis:settings-panel";

/** 动态屏上可以呈现的设置面板。 */
export type SettingsPanel = "models" | "skills" | "tools" | "library";

export const SETTINGS_PANEL_LABEL: Record<SettingsPanel, string> = {
  models: "模型",
  skills: "技能",
  tools: "工具",
  // 资料库的审批界面也走这条路（CR-20260915-library-adoption CP-3）：它同样是「对话里
  // 唤起、动态屏上呈现」的那一类，不该另起一套入口。
  library: "资料库",
};

/**
 * Proactive wake-up (CR-20260911-proactive-wake). `WAKE_CHANGED_EVENT` tells the chat
 * that the schedule changed in the ☰ menu; `WAKE_NOTICE_EVENT` carries a reminder the
 * menu's 「现在唤醒」 produced, so the chat can show it — `detail` is `{ text, messageId }`.
 */
export const WAKE_CHANGED_EVENT = "jarvis:wake-changed";
export const WAKE_NOTICE_EVENT = "jarvis:wake-notice";

/** What `GET /api/settings/wake` returns (REQ-F-060). */
export type WakeClientSettings = {
  enabled: boolean;
  intervalMinutes: number;
  dailyTokenCap: number;
  usage: { date: string; inputTokens: number; outputTokens: number; runs: number; notices: number };
};

/** What `POST /api/chat/wake` returns (REQ-F-061). */
export type WakeClientOutcome =
  | { kind: "skipped"; reason: string; message: string; usage: WakeClientSettings["usage"] }
  | { kind: "noop"; usage: WakeClientSettings["usage"] }
  | { kind: "notice"; text: string; conversationId: string; messageId: string; usage: WakeClientSettings["usage"] };

/**
 * What `GET /api/display` returns and what `<DisplayScreen>` renders (DEC-017).
 * `kind` is an extension point — the client falls back to the title view for
 * anything it does not recognise.
 */
export type DisplayView = {
  kind: string;
  refId: string | null;
  /** The insight HTML when `kind === "insight"` and the row still exists; otherwise null. */
  html: string | null;
};
