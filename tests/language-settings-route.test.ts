import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-570 — `/api/settings/language` (REQ-F-330 ②③, DEC-450; CR-20260927-reply-language).
 * One global setting, default zh, only "zh" | "en" accepted.
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-language-route-"));
process.env.JARVIS_DB_PATH = join(dir, "language.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const route = await import("@/app/api/settings/language/route");
const { getStore } = await import("@/lib/store-singleton");
const { SETTING_LANGUAGE, readLanguage } = await import("@/lib/language");

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function put(body: unknown): Request {
  return new Request("http://test/api/settings/language", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  as("owner@example.com");
  getStore().setSetting(SETTING_LANGUAGE, null);
});

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/settings/language (TEST-570)", () => {
  it("① 未登录 401", async () => {
    as(null);
    expect((await route.GET()).status).toBe(401);
    expect((await route.PUT(put({ language: "en" }))).status).toBe(401);
  });

  it("② 未设置时默认中文", async () => {
    expect(await (await route.GET()).json()).toEqual({ language: "zh" });
    expect(readLanguage(getStore())).toBe("zh");
  });

  it("③ PUT en 持久化，GET 与 readLanguage 都读到 en；再 PUT zh 切回", async () => {
    const saved = await route.PUT(put({ language: "en" }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, language: "en" });
    expect(await (await route.GET()).json()).toEqual({ language: "en" });
    expect(readLanguage(getStore())).toBe("en");

    expect((await route.PUT(put({ language: "zh" }))).status).toBe(200);
    expect(readLanguage(getStore())).toBe("zh");
  });

  it("④ 非法取值 400 且不改设置；坏 JSON 同样 400", async () => {
    await route.PUT(put({ language: "en" }));
    const bad = await route.PUT(put({ language: "fr" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toContain("zh");
    expect(readLanguage(getStore())).toBe("en");
    expect((await route.PUT(put("not json"))).status).toBe(400);
    expect((await route.PUT(put({}))).status).toBe(400);
  });

  it("⑤ 库里出现意料之外的值时按默认中文读，不抛错", async () => {
    getStore().setSetting(SETTING_LANGUAGE, "klingon");
    expect(readLanguage(getStore())).toBe("zh");
    expect(await (await route.GET()).json()).toEqual({ language: "zh" });
  });
});
