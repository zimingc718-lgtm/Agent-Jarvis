import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, ProviderSecretError, type Store } from "@/lib/store";

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("local SQLite store", () => {
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

  it("requires an encryption key", () => {
    expect(() => createStore(join(dir, "nokey.sqlite"), "")).toThrow(/JARVIS_SECRET_KEY/);
  });

  it("stores provider credentials encrypted and returns only sanitized summaries", () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    store.saveProvider(user.id, {
      name: "OpenAI",
      kind: "openai",
      authMode: "api_key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5",
      enabled: true,
      secret: "sk-live-secret",
    });

    const raw = store.dumpProviderSecretsForTest();
    expect(raw[0].encryptedSecret).not.toContain("sk-live-secret");

    const providers = store.listProviders(user.id);
    expect(providers[0]).toMatchObject({
      name: "OpenAI",
      kind: "openai",
      authMode: "api_key",
      connected: true,
      secretPreview: "sk-l...cret",
      note: null,
    });
    expect(JSON.stringify(providers)).not.toContain("sk-live-secret");
  });

  it("updates a provider in place instead of creating a duplicate, keeping the stored secret", () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const first = store.saveProvider(user.id, {
      name: "OpenAI",
      kind: "openai",
      authMode: "api_key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5",
      enabled: true,
      secret: "sk-original",
    });
    expect(first.created).toBe(true);

    const second = store.saveProvider(user.id, {
      id: first.id,
      name: "OpenAI (main)",
      kind: "openai",
      authMode: "api_key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5-mini",
      enabled: true,
    });
    expect(second).toEqual({ id: first.id, created: false });

    const providers = store.listProviders(user.id);
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ name: "OpenAI (main)", defaultModel: "gpt-5-mini" });
    expect(store.getProviderForUser(user.id, first.id)?.secret).toBe("sk-original");
  });

  it("ignores updates aimed at another user's provider", () => {
    const owner = store.upsertUser({ email: "owner@example.com", name: "Owner" });
    const attacker = store.upsertUser({ email: "attacker@example.com", name: "Attacker" });
    const created = store.saveProvider(owner.id, {
      name: "Local",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama",
      enabled: true,
    });

    const result = store.saveProvider(attacker.id, {
      id: created.id,
      name: "Hijacked",
      kind: "local",
      authMode: "local",
      baseUrl: "http://evil.example/v1",
      defaultModel: "llama",
      enabled: true,
    });

    expect(result.created).toBe(true);
    expect(result.id).not.toBe(created.id);
    expect(store.listProviders(owner.id)[0]).toMatchObject({ name: "Local", baseUrl: "http://127.0.0.1:11434/v1" });
  });

  it("enables, disables, and deletes providers only for the owner", () => {
    const owner = store.upsertUser({ email: "owner@example.com", name: "Owner" });
    const other = store.upsertUser({ email: "other@example.com", name: "Other" });
    const created = store.saveProvider(owner.id, {
      name: "Local",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama",
      enabled: true,
    });

    expect(store.setProviderEnabled(other.id, created.id, false)).toBe(false);
    expect(store.setProviderEnabled(owner.id, created.id, false)).toBe(true);
    expect(store.listProviders(owner.id)[0].enabled).toBe(false);
    expect(store.getProviderForUser(owner.id, created.id)).toBeNull();

    expect(store.deleteProvider(other.id, created.id)).toBe(false);
    expect(store.deleteProvider(owner.id, created.id)).toBe(true);
    expect(store.listProviders(owner.id)).toHaveLength(0);
  });

  it("returns a decrypted runtime provider only for the owning user", () => {
    const userA = store.upsertUser({ email: "a@example.com", name: "A" });
    const userB = store.upsertUser({ email: "b@example.com", name: "B" });
    const provider = store.saveProvider(userA.id, {
      name: "DeepSeek",
      kind: "deepseek",
      authMode: "api_key",
      baseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-chat",
      enabled: true,
      secret: "sk-deepseek",
    });

    expect(store.getProviderForUser(userA.id, provider.id)).toMatchObject({
      id: provider.id,
      kind: "deepseek",
      secret: "sk-deepseek",
    });
    expect(store.getProviderForUser(userB.id, provider.id)).toBeNull();
  });

  it("flags providers whose stored secret cannot be decrypted", () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const provider = store.saveProvider(user.id, {
      name: "OpenAI",
      kind: "openai",
      authMode: "api_key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5",
      enabled: true,
      secret: "sk-live-secret",
    });
    store.close();

    const rotated = createStore(join(dir, "test.sqlite"), "totally-different-key-000000000000");
    const summary = rotated.listProviders(user.id)[0];
    expect(summary.connected).toBe(false);
    expect(summary.note).toMatch(/API Key/);
    expect(() => rotated.getProviderForUser(user.id, provider.id)).toThrow(ProviderSecretError);
    rotated.close();
    // Re-open with the right key so afterEach cleanup works normally.
    store = createStore(join(dir, "test.sqlite"), encryptionKey);
  });

  it("keeps conversations and messages isolated by user and resolves ownership", () => {
    const userA = store.upsertUser({ email: "a@example.com", name: "A" });
    const userB = store.upsertUser({ email: "b@example.com", name: "B" });

    const conversation = store.createConversation(userA.id, "First chat");
    store.addMessage(conversation.id, "user", "hello", "complete");
    store.addMessage(conversation.id, "assistant", "world", "complete");

    expect(store.listRecentConversations(userA.id)).toHaveLength(1);
    expect(store.listRecentConversations(userB.id)).toHaveLength(0);
    expect(store.getConversationForUser(userA.id, conversation.id)?.title).toBe("First chat");
    expect(store.getConversationForUser(userB.id, conversation.id)).toBeNull();
    expect(store.listMessages(conversation.id)).toEqual([
      expect.objectContaining({ role: "user", content: "hello", status: "complete" }),
      expect.objectContaining({ role: "assistant", content: "world", status: "complete" }),
    ]);
  });
});
