import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-wake-route-"));
process.env.JARVIS_DB_PATH = join(dir, "w.sqlite");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const settingsRoute = await import("@/app/api/settings/wake/route");
const wakeRoute = await import("@/app/api/chat/wake/route");
const { getStore } = await import("@/lib/store-singleton");

/** TEST-102 — the wake settings and wake trigger routes (REQ-F-060 ①②③⑤, REQ-F-061; TASK-101). */

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

const put = (body: unknown) =>
  new Request("http://test/api/settings/wake", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const post = (body: unknown) =>
  new Request("http://test/api/chat/wake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/settings/wake + /api/chat/wake", () => {
  it("401s an unauthenticated caller", async () => {
    as(null);
    expect((await settingsRoute.GET()).status).toBe(401);
    expect((await settingsRoute.PUT(put({ enabled: true }))).status).toBe(401);
    expect((await wakeRoute.POST(post({}))).status).toBe(401);
  });

  it("① GET returns the defaults (off, 30 min, 20000) plus today's zero usage", async () => {
    as("owner@example.com");
    const body = await (await settingsRoute.GET()).json();
    expect(body).toMatchObject({ enabled: false, intervalMinutes: 30, dailyTokenCap: 20_000 });
    expect(body.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, runs: 0, notices: 0 });
  });

  it("② PUT validates: bad interval / cap / enabled → 400 with the reason; good values persist", async () => {
    as("owner@example.com");
    expect((await settingsRoute.PUT(put({ intervalMinutes: 0 }))).status).toBe(400);
    expect((await (await settingsRoute.PUT(put({ dailyTokenCap: -5 }))).json()).message).toContain("上限");
    expect((await settingsRoute.PUT(put({ enabled: "on" }))).status).toBe(400);
    const ok = await settingsRoute.PUT(put({ enabled: true, intervalMinutes: 15, dailyTokenCap: 500 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, enabled: true, intervalMinutes: 15, dailyTokenCap: 500 });
    expect(await (await settingsRoute.GET()).json()).toMatchObject({ enabled: true, intervalMinutes: 15 });
  });

  it("③ POST wake without a provider is a 200 'skipped', never an error", async () => {
    as("owner@example.com");
    const body = await (await wakeRoute.POST(post({ manual: true }))).json();
    expect(body).toMatchObject({ kind: "skipped", reason: "no-provider" });
  });

  it("④ POST wake with a provider makes ONE bounded non-streaming call and reports the outcome; the server enforces the switch", async () => {
    as("owner@example.com");
    const store = getStore();
    const userId = "owner@example.com";
    store.saveProvider(userId, { name: "Local", kind: "local", authMode: "local", baseUrl: "http://127.0.0.1:1/v1", defaultModel: "m", enabled: true });
    const conversationId = store.createConversation(userId, "x").id;
    store.appendMessage({ conversationId, role: "user", content: "记得明天配 8443。", status: "complete" });

    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ choices: [{ message: { content: "明天要配 8443 的反向代理。" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    // Switch off + not manual → the timer's request spends nothing.
    await settingsRoute.PUT(put({ enabled: false }));
    expect(await (await wakeRoute.POST(post({ manual: false }))).json()).toMatchObject({ kind: "skipped", reason: "disabled" });
    expect(calls).toHaveLength(0);

    // Manual → one call, bounded, non-streaming.
    const body = await (await wakeRoute.POST(post({ manual: true }))).json();
    expect(body.kind).toBe("notice");
    expect(body.text).toContain("主动提醒：明天要配 8443");
    expect(calls).toHaveLength(1);
    expect(calls[0].stream).toBe(false);
    expect(calls[0].max_tokens).toBe(200);
    expect(body.usage.runs).toBe(1);
    expect(store.listMessages(conversationId).at(-1)).toMatchObject({ role: "system", status: "wake" });
  });
});
