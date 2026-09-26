import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * TEST-550 (route half) — the audit trail's read side (REQ-F-320 ②, DEC-430 ①;
 * CR-20260925-write-approval-action-log): `GET /api/actions` returns the caller's own
 * rows, newest first, with the default `effects` filter the 操作记录 page relies on.
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-actions-route-"));
process.env.JARVIS_DB_PATH = join(dir, "a.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const route = await import("@/app/api/actions/route");
const { getStore } = await import("@/lib/store-singleton");

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function get(query = ""): Promise<Response> {
  return route.GET(new Request(`http://test/api/actions${query}`));
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("GET /api/actions (TEST-550)", () => {
  it("401s an unauthenticated caller", async () => {
    as(null);
    expect((await get()).status).toBe(401);
  });

  it("lists only the caller's rows, newest first, with the conversation title joined", async () => {
    const store = getStore();
    // `requireUserId` resolves the session email as the user id, so rows are seeded under
    // the email itself (`createConversation` creates the user row on the way).
    const owner = "owner@example.com";
    const other = "other@example.com";
    const conversation = store.createConversation(owner, "并网规则跟踪");
    const foreign = store.createConversation(other, "别人的");

    const base = { userId: owner, conversationId: conversation.id, argsSummary: "{}", summary: "ok" } as const;
    store.insertAction({ ...base, tool: "list_skills", effect: "read", outcome: "ok" });
    store.insertAction({ ...base, tool: "save_knowledge", effect: "write", outcome: "ok" });
    store.insertAction({ ...base, tool: "read_url", effect: "network", outcome: "failed", summary: "失败：403" });
    store.insertAction({ userId: other, conversationId: foreign.id, tool: "save_knowledge", effect: "write", outcome: "ok", argsSummary: "{}", summary: "ok" });

    as("owner@example.com");
    const all = (await (await get()).json()) as { actions: Array<Record<string, unknown>> };
    expect(all.actions.map((row) => row.tool)).toEqual(["read_url", "save_knowledge", "list_skills"]);
    expect(all.actions.every((row) => row.userId === owner)).toBe(true);
    expect(all.actions[0]).toMatchObject({ effect: "network", outcome: "failed", conversationTitle: "并网规则跟踪" });

    // The page's default filter: writes and outbound calls, reads hidden.
    const narrowed = (await (await get("?effects=write,network")).json()) as { actions: Array<{ tool: string }> };
    expect(narrowed.actions.map((row) => row.tool)).toEqual(["read_url", "save_knowledge"]);

    // Paging by createdAt and a hard cap.
    const one = (await (await get("?limit=1")).json()) as { actions: Array<{ tool: string; createdAt: string }> };
    expect(one.actions.map((row) => row.tool)).toEqual(["read_url"]);
    const older = (await (await get(`?before=${encodeURIComponent(one.actions[0].createdAt)}`)).json()) as { actions: Array<{ tool: string }> };
    expect(older.actions.map((row) => row.tool)).not.toContain("read_url");
  });

  it("400s an unknown effect instead of silently returning everything", async () => {
    as("owner@example.com");
    const response = await get("?effects=write,bogus");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain("bogus");
  });
});
