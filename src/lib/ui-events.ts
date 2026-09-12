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
