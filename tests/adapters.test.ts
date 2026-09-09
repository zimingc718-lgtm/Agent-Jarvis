import { describe, expect, it } from "vitest";
import { normalizeOpenAICompatibleChunk, testProviderConnection } from "@/lib/adapters";

describe("provider adapters", () => {
  it("normalizes OpenAI-compatible chat completion chunks to ChatDelta", () => {
    expect(normalizeOpenAICompatibleChunk({ choices: [{ delta: { content: "world" } }] })).toEqual({
      type: "delta",
      text: "world",
    });
    expect(normalizeOpenAICompatibleChunk({ choices: [{ delta: {} }] })).toBeNull();
  });
});

describe("testProviderConnection", () => {
  it("reports success when /models is reachable", async () => {
    const fetcher = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(testProviderConnection({ baseUrl: "http://local/v1", secret: null }, fetcher)).resolves.toEqual({
      ok: true,
      message: "Connection OK.",
    });
  });

  it("returns a readable message for auth failures", async () => {
    const fetcher = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(
      testProviderConnection({ baseUrl: "https://api.openai.com/v1", secret: "bad" }, fetcher)
    ).resolves.toEqual({ ok: false, message: "Authentication failed — check the API key." });
  });

  it("returns a readable message when the host is unreachable", async () => {
    const fetcher = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const result = await testProviderConnection({ baseUrl: "https://nope.invalid/v1", secret: null }, fetcher);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Could not reach provider/);
  });
});
