import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-521（部分）— `/api/settings/documents` 的排版技能字段（REQ-F-290 ②；CR-20260921-format-skill CP-4）。
 * 此前该路由没有独立测试；这里只覆盖本 CR 新增的字段与既有 `archive` 字段的共存。
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-doc-settings-"));
process.env.JARVIS_LIBRARY_PATH = join(dir, "lib-root");
process.env.JARVIS_LIBRARY_STATE_PATH = join(dir, "state");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_DB_PATH = join(dir, "settings.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const route = await import("@/app/api/settings/documents/route");
const { getStore } = await import("@/lib/store-singleton");
const { SETTING_FORMAT_SKILL } = await import("@/lib/document-format");

const EMAIL = "owner@example.com";

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function patch(body: unknown): Request {
  return new Request("http://test/api/settings/documents", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Payload = { formatSkill: string; formatSkillName: string; formatSkillStale: boolean; archive: string };

let skillDir: string;

beforeEach(() => {
  as(EMAIL);
  getStore().setSetting(SETTING_FORMAT_SKILL, null);
  skillDir = join(dir, `skill-${Date.now()}`);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: 排版\n---\n规则", "utf8");
});

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/settings/documents · 排版技能", () => {
  it("① 未登录 401", async () => {
    as(null);
    expect((await route.GET()).status).toBe(401);
    expect((await route.PATCH(patch({ formatSkill: "x" }))).status).toBe(401);
  });

  it("② 未设置时 GET 回显空 formatSkill 且非 stale", async () => {
    const body = (await (await route.GET()).json()) as Payload;
    expect(body.formatSkill).toBe("");
    expect(body.formatSkillName).toBe("");
    expect(body.formatSkillStale).toBe(false);
  });

  it("③ PATCH 指向自己已注册的技能 → 保存并回显名字；指向不存在的 id → 400 且不写入", async () => {
    const record = getStore().insertSkill(EMAIL, { name: "排版", description: "d", dirPath: skillDir });

    const bad = await route.PATCH(patch({ formatSkill: "no-such-skill" }));
    expect(bad.status).toBe(400);
    expect(getStore().getSetting(SETTING_FORMAT_SKILL)).toBeNull();

    const ok = await route.PATCH(patch({ formatSkill: record.id }));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Payload;
    expect(body.formatSkill).toBe(record.id);
    expect(body.formatSkillName).toBe("排版");
    expect(body.formatSkillStale).toBe(false);
  });

  it("④ PATCH 空串清除设置", async () => {
    const record = getStore().insertSkill(EMAIL, { name: "排版二", description: "d", dirPath: skillDir });
    getStore().setSetting(SETTING_FORMAT_SKILL, record.id);
    const response = await route.PATCH(patch({ formatSkill: "" }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as Payload).formatSkill).toBe("");
    expect(getStore().getSetting(SETTING_FORMAT_SKILL)).toBeNull();
  });

  it("⑤ 设置指向的技能被删后，GET 回显 stale=true，formatSkill 仍是原 id（面板据此提示重新选择）", async () => {
    getStore().setSetting(SETTING_FORMAT_SKILL, "deleted-skill-id");
    const body = (await (await route.GET()).json()) as Payload;
    expect(body.formatSkillStale).toBe(true);
    expect(body.formatSkill).toBe("deleted-skill-id");
    expect(body.formatSkillName).toBe("");
  });

  it("⑥ PATCH 既无 archive 也无 formatSkill → 400；只带 archive 空串仍按原逻辑清除归档目录", async () => {
    expect((await route.PATCH(patch({}))).status).toBe(400);
    const cleared = await route.PATCH(patch({ archive: "" }));
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as Payload).archive).toBe("");
  });
});
