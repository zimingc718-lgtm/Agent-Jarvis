import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * TEST-551 (tool half) — `register_skill` files a proposal instead of writing
 * (REQ-F-320 ①, DEC-430 ②, TASK-550; CR-20260925-write-approval-action-log). Supersedes
 * TEST-530's `confirmed` protocol (CR-20260921-chat-skill-register): the model can no longer
 * attest the user's consent — only the adoption click, exercised here through
 * `adoptSkillProposal`, reaches `registerSkill()`.
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
const { adoptSkillProposal, discardSkillProposal } = await import("@/lib/skill-proposals");
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

describe("register_skill → skill proposal (DEC-430 ②)", () => {
  it("① SKILLS_ROOT 已被隔离到临时目录（否则下面的用例会写进真实 .data/skills）", () => {
    expect(SKILLS_ROOT).toBe(skillsRoot);
  });

  it("② 调用只落一条待确认提议：磁盘与技能表都不动，结果带 skill_pending 事件并告知用户去卡片 / ☰ 采纳", async () => {
    const result = await tool().execute(good, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("尚未注册");
    expect(result.content).toContain("采纳");
    expect(existsSync(skillsRoot)).toBe(false);
    expect(store.listSkills(userId)).toHaveLength(0);

    const pending = store.listPendingSkillProposals(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ name: "文档排版", description: good.description, body: good.body, status: "pending", conversationId: "c1" });
    expect(result.events).toEqual([{ type: "skill_pending", id: pending[0]!.id, name: "文档排版", description: good.description }]);
  });

  it("③ 采纳：SKILL.md 落盘到 SKILLS_ROOT/<slug>/，技能表多一行，read_skill 能读回，提议转 adopted 并离开队列", async () => {
    await tool().execute(good, context);
    const [proposal] = store.listPendingSkillProposals(userId);
    const decision = await adoptSkillProposal(store, userId, proposal!.id);
    expect(decision.ok).toBe(true);

    const rows = store.listSkills(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("文档排版");
    expect(rows[0]!.dirPath.startsWith(skillsRoot)).toBe(true);
    const skillMd = readFileSync(join(rows[0]!.dirPath, "SKILL.md"), "utf8");
    expect(skillMd.split("\n")[1]).toBe("name: 文档排版");
    expect(skillMd).toContain("只整理排版，不改内容");

    const [, read] = createSkillTools(store);
    const back = await read.execute({ name: "文档排版" }, { ...context, skillCount: 1 });
    expect(back.ok).toBe(true);
    expect(back.content).toContain("只整理排版，不改内容");

    expect(store.getSkillProposal(userId, proposal!.id)?.status).toBe("adopted");
    expect(store.listPendingSkillProposals(userId)).toHaveLength(0);
  });

  it("④ 忽略：提议转 discarded，磁盘与表不动；对已处理的提议再采纳 / 再忽略都不再生效", async () => {
    await tool().execute(good, context);
    const [proposal] = store.listPendingSkillProposals(userId);
    expect(discardSkillProposal(store, userId, proposal!.id)?.status).toBe("discarded");
    expect(existsSync(skillsRoot)).toBe(false);
    expect(store.listSkills(userId)).toHaveLength(0);

    expect(discardSkillProposal(store, userId, proposal!.id)).toBeNull();
    const again = await adoptSkillProposal(store, userId, proposal!.id);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.status).toBe(404);
    }
    expect(store.listSkills(userId)).toHaveLength(0);
  });

  it("⑤ 重名：已注册同名技能时提交被拒；提议在名字被占用之后再采纳则 409 且仍保持 pending", async () => {
    await tool().execute(good, context);
    const [first] = store.listPendingSkillProposals(userId);
    expect((await adoptSkillProposal(store, userId, first!.id)).ok).toBe(true);

    const refused = await tool().execute({ ...good, body: "别的正文" }, context);
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain("同名");
    expect(store.listPendingSkillProposals(userId)).toHaveLength(0);

    // Filed while the name was still free, adopted after it was taken: the adoption-time
    // rule (the same `registerSkill()` conflict) refuses and leaves it pending.
    const second = store.insertSkillProposal({ userId, conversationId: "c1", name: "文档排版", description: "d", body: "b" });
    const decision = await adoptSkillProposal(store, userId, second.id);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(409);
      expect(decision.message).toContain("同名");
    }
    expect(store.getSkillProposal(userId, second.id)?.status).toBe("pending");
    expect(store.listSkills(userId)).toHaveLength(1);
    expect(readdirSync(skillsRoot)).toHaveLength(1);
  });

  it("⑥ 参数缺失（空 name/description/body）拒绝且不落提议；名字里的换行被压掉不会破坏 frontmatter", async () => {
    expect((await tool().execute({ ...good, body: "  " }, context)).ok).toBe(false);
    expect((await tool().execute({ ...good, name: "" }, context)).ok).toBe(false);
    expect(store.listPendingSkillProposals(userId)).toHaveLength(0);

    const result = await tool().execute({ ...good, name: "多行\n名字" }, context);
    expect(result.ok).toBe(true);
    const [proposal] = store.listPendingSkillProposals(userId);
    expect(proposal!.name).toBe("多行 名字");
    expect((await adoptSkillProposal(store, userId, proposal!.id)).ok).toBe(true);
    const row = store.listSkills(userId)[0]!;
    expect(readFileSync(join(row.dirPath, "SKILL.md"), "utf8").split("\n")[1]).toBe("name: 多行 名字");
  });

  it("⑦ 正文超过 32 KB 上限拒绝，不落提议", async () => {
    const result = await tool().execute({ ...good, body: "字".repeat(40_000) }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("KB");
    expect(store.listPendingSkillProposals(userId)).toHaveLength(0);
    expect(existsSync(skillsRoot)).toBe(false);
  });

  it("⑧ 没有任何技能时也可用（第一个技能就是靠它提议的），而三个只读工具此时不可用", () => {
    const tools = createSkillTools(store);
    const empty = { ...context, skillCount: 0 };
    expect(tool().available(empty)).toBe(true);
    expect(tools.filter((candidate) => candidate.name !== "register_skill").some((candidate) => candidate.available(empty))).toBe(false);
  });

  it("⑨ 路径穿越名字：提议原样存名，采纳时由既有 slug 规则收进 SKILLS_ROOT 之内", async () => {
    await tool().execute({ ...good, name: "../../evil" }, context);
    const [proposal] = store.listPendingSkillProposals(userId);
    expect(proposal!.name).toBe("../../evil");
    expect((await adoptSkillProposal(store, userId, proposal!.id)).ok).toBe(true);
    const row = store.listSkills(userId)[0]!;
    expect(row.dirPath.startsWith(skillsRoot)).toBe(true);
    expect(readdirSync(skillsRoot)).toHaveLength(1);
  });

  it("⑩ 模型再也没有可以自述的 confirmed：参数表只有 name / description / body", () => {
    const params = tool().parameters as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(params.properties)).toEqual(["name", "description", "body"]);
    expect(params.required).toEqual(["name", "description", "body"]);
    expect(tool().description).toContain("采纳");
  });
});
