/**
 * The custom DOM event that tells the full-screen DisplayScreen to refetch
 * (CR-20260909-display-screen CP-9). Kept in its own zero-dependency module so
 * `FloatingChat` can dispatch it without importing the DisplayScreen component,
 * and so the shared view type is importable from client code.
 */
export const DISPLAY_CHANGED_EVENT = "jarvis:display-changed";

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
