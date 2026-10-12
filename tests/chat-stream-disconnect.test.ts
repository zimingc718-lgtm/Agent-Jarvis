import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChatTurn } from "@/lib/chat";
import { createStore, type Store } from "@/lib/store";

/**
 * TEST-630 — a consumer that lets go mid-turn (DEC-510, TASK-630; CR-20261006-chat-stream-disconnect).
 *
 * The measured failure this guards (EV-2026-10-06-chat-stream-disconnect §1): four sends in
 * production answered nothing at all, each leaving one
 * `chat.turn_failed stage="stream" TypeError: Invalid state: Controller is already closed`.
 * The stream source only learned it was closed from its own `finally`, so a cancel turned into
 * a throw out of `emit` — which skipped `agent-loop`'s `stopped` branch (the conversation kept
 * the user's row and no answer at all), threw again on the `catch`'s `send`, and a third time on
 * `controller.close()`, taking `onSettled` with it. The leaked in-flight slot then cost the next
 * send in that conversation a full `SUPERSEDE_WAIT_MS` — 15.1 s measured.
 *
 * So the four assertions below are the four symptoms, in the order a user met them.
 */
const encryptionKey = "0123456789abcdef0123456789abcdef";

type Line = Record<string, unknown>;

/** Lines are read before `mockRestore()` — vitest's restore also resets `mock.calls`. */
async function captureLines(run: () => Promise<void>): Promise<Line[]> {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await run();
    return [...out.mock.calls, ...err.mock.calls]
      .map((call) => String(call[0]).trim())
      .filter((text) => text.startsWith("{"))
      .map((text) => JSON.parse(text) as Line);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe("a reader that lets go mid-turn", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    // This file asserts on log lines, so it turns the log back on for itself (stdout only).
    process.env.JARVIS_SERVER_LOG = "on";
    process.env.JARVIS_SERVER_LOG_PATH = "";
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-disconnect-"));
    store = createStore(join(dir, "test.sqlite"), encryptionKey);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    process.env.JARVIS_SERVER_LOG = "off";
    delete process.env.JARVIS_SERVER_LOG_PATH;
  });

  function provider(userId: string): string {
    return store.saveProvider(userId, {
      name: "Local",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama",
      enabled: true,
    }).id;
  }

  /** Streams one delta, pauses long enough for the cancel to land, then would stream a second. */
  async function* twoPartReply() {
    yield { type: "delta" as const, text: "part one" };
    await new Promise((resolve) => setTimeout(resolve, 200));
    yield { type: "delta" as const, text: " part two" };
  }

  /** Reads until the first `delta` event has arrived, then lets go exactly as a closed tab would. */
  async function readOneDeltaThenCancel(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (let i = 0; i < 10; i += 1) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (decoder.decode(value, { stream: true }).includes('"type":"delta"')) {
        break;
      }
    }
    await reader.cancel();
    // Let the aborted turn wind down and persist on its own.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  it("keeps what the model already produced, as a stopped assistant row", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = provider(user.id);

    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "first",
      providerStream: twoPartReply,
    });
    await readOneDeltaThenCancel(stream);

    const conversationId = store.listRecentConversations(user.id)[0].id;
    // User ruling 2026-10-06 (INPUT-2026-10-06-001 ①): a disconnect is a clean "stop", so the
    // text that did stream is kept rather than the turn vanishing. Before the fix this was
    // `[user]` alone — a question left hanging with no answer under it.
    expect(store.listMessages(conversationId)).toEqual([
      expect.objectContaining({ role: "user", content: "first", status: "complete" }),
      expect.objectContaining({ role: "assistant", content: "part one", status: "stopped" }),
    ]);
  });

  it("releases the in-flight slot, so the next send does not wait out the supersede window", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = provider(user.id);

    const first = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "first",
      providerStream: twoPartReply,
    });
    await readOneDeltaThenCancel(first);
    const conversationId = store.listRecentConversations(user.id)[0].id;

    const began = Date.now();
    const second = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      conversationId,
      message: "second",
      providerStream: async function* () {
        yield { type: "delta" as const, text: "reply to second" };
      },
    });
    const body = await new Response(second).text();
    const waited = Date.now() - began;

    expect(body).toContain("event: done");
    expect(body).toContain("reply to second");
    // 15100 ms measured before the fix; the whole send is well under two seconds after it.
    expect(waited).toBeLessThan(2_000);
  });

  it("logs one info line naming the abandonment, and no turn_failed", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = provider(user.id);

    const lines = await captureLines(async () => {
      const stream = await runChatTurn({
        store,
        userId: user.id,
        providerId,
        message: "first",
        providerStream: twoPartReply,
      });
      await readOneDeltaThenCancel(stream);
    });

    const abandoned = lines.filter((line) => line.event === "chat.turn_abandoned");
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ level: "info", noticedAt: "cancel" });
    expect(abandoned[0].conversationId).toEqual(expect.any(String));
    // The point of the line: whoever reads the log can tell a reader walking away from a
    // provider fault. Before the fix this was an `error` with a `TypeError` and a stack.
    expect(lines.filter((line) => line.event === "chat.turn_failed")).toHaveLength(0);
  });

  it("still reports a genuine stream fault as turn_failed", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = provider(user.id);

    const lines = await captureLines(async () => {
      const stream = await runChatTurn({
        store,
        userId: user.id,
        providerId,
        message: "first",
        providerStream: async function* () {
          yield { type: "delta" as const, text: "half an answer" };
          throw new Error("socket hung up");
        },
      });
      await new Response(stream).text();
    });

    // The guard added for the abandoned case must not swallow a real one.
    const failed = lines.filter((line) => line.event === "chat.turn_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: "error", stage: "stream" });
    expect(lines.filter((line) => line.event === "chat.turn_abandoned")).toHaveLength(0);
  });
});
