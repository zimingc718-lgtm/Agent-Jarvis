import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type Store } from "@/lib/store";

/**
 * These cases open real SQLite files. Under a full-suite run (64 files in parallel on
 * this machine) a single case has been measured at ~2 s, and three of them have twice
 * touched the 5 s default and failed as timeouts while passing in 2 s when run alone.
 * The work is not slow, the machine is busy — so the budget moves, not the test.
 */
vi.setConfig({ testTimeout: 20_000 });

const encryptionKey = "0123456789abcdef0123456789abcdef";

// ---------------------------------------------------------------------------
// TEST-039 — display_state get-or-create + single-row semantics (DEC-017 ①)
// ---------------------------------------------------------------------------
describe("display_state store (TASK-036)", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-display-"));
    store = createStore(join(dir, "d.sqlite"), encryptionKey);
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the home view when nothing has been set", () => {
    expect(store.getDisplayState()).toMatchObject({ kind: "home", refId: null });
  });

  it("round-trips a set value", () => {
    store.setDisplayState({ kind: "insight", refId: "insight-1" });
    expect(store.getDisplayState()).toMatchObject({ kind: "insight", refId: "insight-1" });
  });

  it("keeps exactly one row no matter how many times it is written", () => {
    store.setDisplayState({ kind: "insight", refId: "a" });
    store.setDisplayState({ kind: "insight", refId: "b" });
    store.setDisplayState({ kind: "home" });
    expect(store.dumpDisplayStateRowsForTest()).toHaveLength(1);
    expect(store.getDisplayState()).toMatchObject({ kind: "home", refId: null });
  });

  it("refreshes updated_at on every write", async () => {
    store.setDisplayState({ kind: "home" });
    const first = store.getDisplayState().updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.setDisplayState({ kind: "insight", refId: "x" });
    expect(store.getDisplayState().updatedAt).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Route tests — GET /api/insights (TEST-037), GET /api/display, showHome/showInsight
// ---------------------------------------------------------------------------
const routeDir = mkdtempSync(join(tmpdir(), "agent-jarvis-display-routes-"));
process.env.JARVIS_DB_PATH = join(routeDir, "routes.sqlite");
process.env.JARVIS_SECRET_KEY = encryptionKey;
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const insightsRoute = await import("@/app/api/insights/route");
const displayRoute = await import("@/app/api/display/route");
const { resolveDisplayView, showHome, showInsight } = await import("@/lib/display");
const { getStore } = await import("@/lib/store-singleton");

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(routeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("GET /api/insights (TEST-037, principle 13)", () => {
  it("returns a conversation's insights newest-first to its owner, 404 to others, 401 unauthenticated", async () => {
    const store = getStore();
    const conversation = store.createConversation("owner@example.com", "with insights");
    store.insertInsight({ conversationId: conversation.id, kind: "skill", html: "<p>first</p>" });
    await new Promise((r) => setTimeout(r, 2));
    store.insertInsight({ conversationId: conversation.id, kind: "skill", html: "<p>second</p>" });

    as("owner@example.com");
    const ok = await insightsRoute.GET(new Request(`http://test/api/insights?conversationId=${conversation.id}`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.insights.map((i: { html: string }) => i.html)).toEqual(["<p>second</p>", "<p>first</p>"]);

    as("intruder@example.com");
    const denied = await insightsRoute.GET(
      new Request(`http://test/api/insights?conversationId=${conversation.id}`)
    );
    expect(denied.status).toBe(404);

    as(null);
    const unauth = await insightsRoute.GET(
      new Request(`http://test/api/insights?conversationId=${conversation.id}`)
    );
    expect(unauth.status).toBe(401);
  });

  it("400s without a conversationId", async () => {
    as("owner@example.com");
    const bad = await insightsRoute.GET(new Request("http://test/api/insights"));
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/display + showHome/showInsight (DEC-017)", () => {
  it("defaults to the home view, then follows showInsight and showHome", async () => {
    const store = getStore();
    showHome();
    as("viewer@example.com");
    expect(await (await displayRoute.GET()).json()).toMatchObject({ kind: "home", html: null });

    const conversation = store.createConversation("viewer@example.com", "c");
    const insight = store.insertInsight({ conversationId: conversation.id, kind: "skill", html: "<h1>Report</h1>" });
    showInsight(insight.id);

    const view = await (await displayRoute.GET()).json();
    expect(view).toMatchObject({ kind: "insight", refId: insight.id, html: "<h1>Report</h1>" });
    expect(resolveDisplayView().html).toBe("<h1>Report</h1>");

    showHome();
    expect(await (await displayRoute.GET()).json()).toMatchObject({ kind: "home", html: null });
  });

  it("401s an unauthenticated viewer", async () => {
    as(null);
    expect((await displayRoute.GET()).status).toBe(401);
  });
});
