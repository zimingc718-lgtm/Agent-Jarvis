import type { DisplayView } from "./ui-events";
import { getStore } from "./store-singleton";

export type { DisplayView } from "./ui-events";

// MOD-DISPLAY server helpers. The raw single-row primitives live on the store
// (`getDisplayState` / `setDisplayState`, DEC-017 ①); this module joins the
// pointer to its insight HTML and gives the two writers their intent-named calls.

export function resolveDisplayView(): DisplayView {
  const store = getStore();
  const state = store.getDisplayState();
  const html = state.kind === "insight" && state.refId ? store.getInsight(state.refId)?.html ?? null : null;
  return { kind: state.kind, refId: state.refId, html };
}

/** Point the display screen at a freshly captured insight. */
export function showInsight(insightId: string): void {
  getStore().setDisplayState({ kind: "insight", refId: insightId });
}

/** Return the display screen to its default title view. */
export function showHome(): void {
  getStore().setDisplayState({ kind: "home", refId: null });
}
