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
