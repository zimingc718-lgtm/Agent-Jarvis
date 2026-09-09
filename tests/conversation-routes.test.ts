import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-conv-routes-"));
process.env.JARVIS_DB_PATH = join(dir, "conv.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const messagesRoute = await import("@/app/api/conversations/[id]/messages/route");
const recentRoute = await import("@/app/api/conversations/recent/route");
const { getStore } = await import("@/lib/store-singleton");

function as(email: string) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { email } } as never);
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/conversations/[id]/messages", () => {
  it("returns a conversation's messages to its owner and 404 to everyone else", async () => {
    const store = getStore();
    // The auth guard resolves a Google session with no user.id to the email, so routes key data by email.
    const conversation = store.createConversation("owner@example.com", "Restore me");
    store.addMessage(conversation.id, "user", "earlier question", "complete");
    store.addMessage(conversation.id, "assistant", "earlier answer", "complete");

    as("owner@example.com");
    const ok = await messagesRoute.GET(new Request("http://test"), { params: Promise.resolve({ id: conversation.id }) });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.conversation.title).toBe("Restore me");
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(["earlier question", "earlier answer"]);

    as("intruder@example.com");
    const denied = await messagesRoute.GET(new Request("http://test"), {
      params: Promise.resolve({ id: conversation.id }),
    });
    expect(denied.status).toBe(404);
  });

  it("recent list is scoped to the caller", async () => {
    as("owner@example.com");
    const mine = await (await recentRoute.GET()).json();
    expect(mine.conversations.length).toBeGreaterThan(0);

    as("nobody@example.com");
    const theirs = await (await recentRoute.GET()).json();
    expect(theirs.conversations).toEqual([]);
  });
});
