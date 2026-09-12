import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-sweep-route-"));
process.env.JARVIS_DB_PATH = join(dir, "s.sqlite");
process.env.JARVIS_ENTITIES_PATH = join(dir, "entities");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const route = await import("@/app/api/entities/sweep/route");
const { getStore } = await import("@/lib/store-singleton");

/** TEST-129 ⑪⑫ — the sweep route (CR-20260911-scheduled-sweep). */

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

const put = (body: unknown) =>
  new Request("http://test/api/entities/sweep", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const post = (body: unknown) =>
  new Request("http://test/api/entities/sweep", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/entities/sweep", () => {
  it("未登录一律 401", async () => {
    as(null);
    expect((await route.GET()).status).toBe(401);
    expect((await route.PUT(put({ enabled: true }))).status).toBe(401);
    expect((await route.POST(post({}))).status).toBe(401);
  });

  it("① GET 给出默认值：关、180 分钟、每轮 6 个，且从未巡检", async () => {
    as("owner@example.com");
    const body = await (await route.GET()).json();
    expect(body).toMatchObject({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" });
  });

  it("② PUT 校验越界值并给出理由，合法值落库", async () => {
    as("owner@example.com");
    const tooFast = await route.PUT(put({ intervalMinutes: 5 }));
    expect(tooFast.status).toBe(400);
    expect((await tooFast.json()).message).toContain("30");

    expect((await route.PUT(put({ maxPerRound: 0 }))).status).toBe(400);

    const good = await route.PUT(put({ enabled: true, intervalMinutes: 60, maxPerRound: 3 }));
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ ok: true, enabled: true, intervalMinutes: 60, maxPerRound: 3 });
    expect(await (await route.GET()).json()).toMatchObject({ enabled: true, intervalMinutes: 60 });
  });

  it("③ POST 在没有任何采集源时如实说明，而不是报成功", async () => {
    as("owner@example.com");
    const body = await (await route.POST(post({}))).json();
    expect(body).toMatchObject({ ran: false, reason: "还没有任何对象配置了采集源。" });
  });
});
