import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runChatTurn } from "@/lib/chat";
import { createStore, type Store } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

const encryptionKey = "0123456789abcdef0123456789abcdef";

function localProvider(store: Store, userId: string): string {
  return store.saveProvider(userId, {
    name: "Local",
    kind: "local",
    authMode: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama",
    enabled: true,
  }).id;
}

async function readSse(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("runChatTurn", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-"));
    store = createStore(join(dir, "test.sqlite"), encryptionKey);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams provider deltas, persists the conversation, and returns start/delta/done", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "Explain gravity",
      providerStream: async function* () {
        yield { type: "delta", text: "Gravity" };
        yield { type: "delta", text: " pulls." };
      },
    });

    const body = await readSse(stream);
    const [conversation] = store.listRecentConversations(user.id);

    expect(body).toContain("event: start");
    expect(body).toContain('"text":"Gravity"');
    expect(body).toContain("event: done");
    expect(conversation.title).toBe("Explain gravity");
    expect(store.listMessages(conversation.id)).toEqual([
      expect.objectContaining({ role: "user", content: "Explain gravity", status: "complete" }),
      expect.objectContaining({ role: "assistant", content: "Gravity pulls.", status: "complete" }),
    ]);
  });

  it("continues an existing conversation and replays prior turns as model context", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const first = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "My name is Ada.",
      providerStream: async function* () {
        yield { type: "delta", text: "Nice to meet you, Ada." };
      },
    });
    const firstBody = await readSse(first);
    const conversationId = JSON.parse(firstBody.match(/data: (\{"type":"start".*)/)![1]).conversationId as string;

    let received: ChatMessage[] = [];
    const second = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      conversationId,
      message: "What is my name?",
      providerStream: async function* (input) {
        received = input.messages;
        yield { type: "delta", text: "Your name is Ada." };
      },
    });
    await readSse(second);

    expect(store.listRecentConversations(user.id)).toHaveLength(1);
    expect(received[0]).toEqual({ role: "system", content: expect.stringContaining("Agent-Jarvis") });
    expect(received.map((m) => m.content)).toEqual([
      expect.stringContaining("Agent-Jarvis"),
      "My name is Ada.",
      "Nice to meet you, Ada.",
      "What is my name?",
    ]);
  });

  it("rejects a conversation the user does not own", async () => {
    const owner = store.upsertUser({ email: "owner@example.com", name: "Owner" });
    const attacker = store.upsertUser({ email: "attacker@example.com", name: "Attacker" });
    const providerId = localProvider(store, attacker.id);
    const conversation = store.createConversation(owner.id, "Owner chat");

    await expect(
      runChatTurn({ store, userId: attacker.id, providerId, conversationId: conversation.id, message: "hi" })
    ).rejects.toMatchObject({ status: 404, message: "Conversation not found." });
  });

  it("persists a stopped status and partial text when the provider stream is aborted", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);
    const controller = new AbortController();

    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "Long answer please",
      signal: controller.signal,
      providerStream: async function* () {
        yield { type: "delta", text: "partial" };
        controller.abort();
        yield { type: "stopped" };
      },
    });

    const body = await readSse(stream);
    const [conversation] = store.listRecentConversations(user.id);

    expect(body).toContain("event: stopped");
    expect(body).not.toContain("event: done");
    expect(store.listMessages(conversation.id).at(-1)).toMatchObject({
      role: "assistant",
      content: "partial",
      status: "stopped",
    });
  });

  it("surfaces provider errors without storing the error text as an assistant reply", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "trigger failure",
      providerStream: async function* () {
        yield { type: "delta", text: "half" };
        yield { type: "error", message: "Provider request failed (401): bad key." };
      },
    });

    const body = await readSse(stream);
    const [conversation] = store.listRecentConversations(user.id);
    const assistant = store.listMessages(conversation.id).at(-1);

    expect(body).toContain('"message":"Provider request failed (401): bad key."');
    expect(assistant).toMatchObject({ role: "assistant", content: "half", status: "error" });
    expect(assistant?.content).not.toContain("401");
  });

  it("rejects missing providers before creating a conversation", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });

    await expect(
      runChatTurn({ store, userId: user.id, providerId: "missing", message: "hello" })
    ).rejects.toMatchObject({ status: 404, message: "Selected model provider is not connected." });
    expect(store.listRecentConversations(user.id)).toHaveLength(0);
  });

  // CR-20260909 — TASK-022 / TEST-025 / TEST-026
  it("resolves the highest-priority connected provider when the turn names none", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const first = store.saveProvider(user.id, {
      name: "Primary",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:1/v1",
      defaultModel: "primary-model",
      enabled: true,
    }).id;
    store.saveProvider(user.id, {
      name: "Secondary",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:2/v1",
      defaultModel: "secondary-model",
      enabled: true,
    });

    let sentModel = "";
    const stream = await runChatTurn({
      store,
      userId: user.id,
      message: "hi",
      providerStream: async function* (input) {
        sentModel = input.provider.defaultModel;
        yield { type: "delta", text: "ok" };
      },
    });
    await readSse(stream);
    expect(sentModel).toBe("primary-model");

    // Raising the second provider makes it the resolved one.
    store.reorderProvider(user.id, first, "down");
    let secondModel = "";
    const stream2 = await runChatTurn({
      store,
      userId: user.id,
      message: "hi again",
      providerStream: async function* (input) {
        secondModel = input.provider.defaultModel;
        yield { type: "delta", text: "ok" };
      },
    });
    await readSse(stream2);
    expect(secondModel).toBe("secondary-model");
  });

  it("falls through to the next provider when the top one is not connected", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    // api_key provider with no secret -> not connected; must be skipped.
    store.saveProvider(user.id, {
      name: "Broken",
      kind: "openai",
      authMode: "api_key",
      baseUrl: "http://127.0.0.1:1/v1",
      defaultModel: "broken-model",
      enabled: true,
    });
    store.saveProvider(user.id, {
      name: "Working",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:2/v1",
      defaultModel: "working-model",
      enabled: true,
    });

    let used = "";
    const stream = await runChatTurn({
      store,
      userId: user.id,
      message: "hi",
      providerStream: async function* (input) {
        used = input.provider.defaultModel;
        yield { type: "delta", text: "ok" };
      },
    });
    await readSse(stream);
    expect(used).toBe("working-model");
  });

  it("rejects with 409 and creates no conversation when nothing is connected", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    store.saveProvider(user.id, {
      name: "Disabled",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:1/v1",
      defaultModel: "m",
      enabled: false,
    });

    await expect(runChatTurn({ store, userId: user.id, message: "hi" })).rejects.toMatchObject({ status: 409 });
    expect(store.listRecentConversations(user.id)).toHaveLength(0);
  });
});
