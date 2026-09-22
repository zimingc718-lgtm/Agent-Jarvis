import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * TEST-530 — `register_skill`（REQ-F-300；DEC-410；TASK-530；CR-20260921-chat-skill-register）。
 *
 * `JARVIS_SKILLS_PATH` is read into `SKILLS_ROOT` at module load, so it is set before the
 * dynamic import — the same discipline as `skills-route.test.ts`. No provider, no network:
 * an authored SKILL.md with frontmatter never triggers generation.
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-register-skill-"));
const skillsRoot = join(dir, "skills");
process.env.JARVIS_SKILLS_PATH = skillsRoot;

const { createStore } = await import("@/lib/store");
const { createSkillTools } = await import("@/lib/tools/skill-tools");
const { SKILLS_ROOT } = await import("@/lib/skills");
type Store = import("@/lib/store").Store;
type ToolContext = import("@/lib/tools/registry").ToolContext;

const encryptionKey = "0123456789abcdef0123456789abcdef";
let store: Store;
let userId: string;
let context: ToolContext;

function tool() {
  const tools = createSkillTools(store);
  const found = tools.find((candidate) => candidate.name === "register_skill");
  expect(found, "register_skill 应当在技能工具组里").toBeTruthy();
  return found!;
}

const good = { name: "文档排版", description: "把抽取出的 Markdown 排成可读版本", body: "## 规则\n\n只整理排版，不改内容。" };

beforeEach(() => {
  rmSync(skillsRoot, { recursive: true, force: true });
  store?.close?.();
  store = createStore(join(dir, `db-${Date.now()}-${Math.random()}.sqlite`), encryptionKey);
  userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;
  context = { userId, conversationId: "c1", skillCount: 0, webEnabled: false, searchConfigured: false, knowledgeCount: 0, contextWindow: 128_000 };
});

afterAll(() => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("register_skill", () => {
  it("① SKILLS_ROOT 已被隔离到临时目录（否则下面的用例会写进真实 .data/skills）", () => {
    expect(SKILLS_ROOT).toBe(skillsRoot);
  });

  it("② 没有 confirmed=true 一律拒绝，磁盘与表都不动，并把「先给用户看全文」的约定说回给模型", async () => {
    const result = await tool().execute({ ...good, confirmed: false }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("注册");
    expect(result.content).toContain("confirmed");
    expect(existsSync(skillsRoot)).toBe(false);
    expect(store.listSkills(userId)).toHaveLength(0);
  });

  it("③ confirmed=true：SKILL.md 落盘到 SKILLS_ROOT/<slug>/，技能表多一行，read_skill 能读回正文，结果提醒用户 ☰ 位置", async () => {
    const result = await tool().execute({ ...good, confirmed: true }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("文档排版");
    expect(result.content).toContain("☰");

    const rows = store.listSkills(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("文档排版");
    expect(rows[0]!.dirPath.startsWith(skillsRoot)).toBe(true);
    const skillMd = readFileSync(join(rows[0]!.dirPath, "SKILL.md"), "utf8");
    expect(skillMd).toContain("name: 文档排版");
    expect(skillMd).toContain("只整理排版，不改内容");

    const [, read] = createSkillTools(store);
    const back = await read.execute({ name: "文档排版" }, { ...context, skillCount: 1 });
    expect(back.ok).toBe(true);
    expect(back.content).toContain("只整理排版，不改内容");
  });

  it("④ 重名：第二次注册同名技能返回可读的冲突说明，不新建目录、不加行", async () => {
    await tool().execute({ ...good, confirmed: true }, context);
    const again = await tool().execute({ ...good, body: "别的正文", confirmed: true }, context);
    expect(again.ok).toBe(false);
    expect(again.content).toContain("同名");
    expect(store.listSkills(userId)).toHaveLength(1);
    expect(readdirSync(skillsRoot)).toHaveLength(1);
  });

  it("⑤ 参数缺失（空 name/description/body）拒绝；名字里的换行被压掉不会破坏 frontmatter", async () => {
    expect((await tool().execute({ ...good, body: "  ", confirmed: true }, context)).ok).toBe(false);
    expect((await tool().execute({ ...good, name: "", confirmed: true }, context)).ok).toBe(false);
    const result = await tool().execute({ ...good, name: "多行\n名字", confirmed: true }, context);
    expect(result.ok).toBe(true);
    const row = store.listSkills(userId)[0]!;
    expect(row.name).toBe("多行 名字");
    expect(readFileSync(join(row.dirPath, "SKILL.md"), "utf8").split("\n")[1]).toBe("name: 多行 名字");
  });

  it("⑥ 正文超过 32 KB 上限拒绝，不写入", async () => {
    const result = await tool().execute({ ...good, body: "字".repeat(40_000), confirmed: true }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("KB");
    expect(existsSync(skillsRoot)).toBe(false);
  });

  it("⑦ 没有任何技能时也可用（第一个技能就是靠它创建的），而三个只读工具此时不可用", () => {
    const tools = createSkillTools(store);
    const empty = { ...context, skillCount: 0 };
    expect(tool().available(empty)).toBe(true);
    expect(tools.filter((candidate) => candidate.name !== "register_skill").some((candidate) => candidate.available(empty))).toBe(false);
  });

  it("⑧ 名字里的路径穿越字符被 slug 规则收进 SKILLS_ROOT 之内", async () => {
    const result = await tool().execute({ ...good, name: "../../evil", confirmed: true }, context);
    expect(result.ok).toBe(true);
    const row = store.listSkills(userId)[0]!;
    expect(row.dirPath.startsWith(skillsRoot)).toBe(true);
    expect(readdirSync(skillsRoot)).toHaveLength(1);
  });
});
