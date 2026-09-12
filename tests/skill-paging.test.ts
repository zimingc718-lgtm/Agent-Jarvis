import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { createSkillTools } from "@/lib/tools/skill-tools";
import type { ToolContext, ToolDescriptor } from "@/lib/tools/registry";

/**
 * TEST-210 — a big skill becomes navigable instead of arbitrarily truncated
 * (REQ-F-150 ①②; DEC-130; TASK-210). CR-20260912-skill-paging.
 *
 * Measured origin: `multi-agent-insight-reviewer` is 167,755 characters across twenty
 * reference files. `read_skill` used to concatenate the lot, cut it at a 32KB folder cap and
 * again at 8,000 tokens, so the model saw roughly a fifth of its own instructions — and
 * *which* fifth was decided by alphabetical order (EV-2026-09-12-skill-paging §1).
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

let dir: string;
let skillDir: string;
let store: Store;
let context: ToolContext;

function tool(name: string): ToolDescriptor {
  const found = createSkillTools(store).find((t) => t.name === name);
  expect(found, `工具 ${name} 应当存在`).toBeTruthy();
  return found!;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-jarvis-paging-"));
  skillDir = join(dir, "big-skill");
  mkdirSync(join(skillDir, "references"), { recursive: true });
  mkdirSync(join(skillDir, "assets"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: big-skill\ndescription: d\n---\n这是入口说明。", "utf8");
  // One oversized file that used to swallow the whole read, plus small ones after it
  // alphabetically — exactly the shape that made later references unreachable.
  writeFileSync(join(skillDir, "assets", "template.html"), "<!doctype html><style>.x{}</style>" + "B".repeat(60 * 1024), "utf8");
  writeFileSync(join(skillDir, "references", "report-templates.md"), "报告骨架：标题、摘要、结论。", "utf8");
  writeFileSync(join(skillDir, "references", "review-rubric.md"), "评审标准：证据、反驳、置信度。", "utf8");
  writeFileSync(join(skillDir, "logo.png"), "binary-ish", "utf8");

  store = createStore(join(dir, "db.sqlite"), encryptionKey);
  const user = store.upsertUser({ email: "u@example.com", name: "U" });
  store.insertSkill(user.id, { name: "big-skill", description: "d", dirPath: skillDir });
  const conversation = store.createConversation(user.id, "c");
  context = {
    userId: user.id,
    conversationId: conversation.id,
    skillCount: 1,
    webEnabled: false,
    searchConfigured: false,
    knowledgeCount: 0,
    contextWindow: 128_000,
  };
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("TEST-210 大技能可逐文件读取 (REQ-F-150)", () => {
  it("① 不带 file → 返回 SKILL.md 与文件清单，而不是拼接后的一大块", async () => {
    const result = await tool("read_skill").execute({ name: "big-skill" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("这是入口说明。");
    expect(result.content).toContain("本技能的文件清单");
    for (const path of ["assets/template.html", "references/report-templates.md", "references/review-rubric.md"]) {
      expect(result.content, `${path} 应出现在清单里`).toContain(path);
    }
    // Non-readable formats are not offered at all.
    expect(result.content).not.toContain("logo.png");
    // The 60KB template must NOT have been inlined — that is the whole point.
    expect(result.content).not.toContain("BBBBBBBBBB");
  });

  it("① 清单给出体量，模型据此决定先读哪个", async () => {
    const result = await tool("read_skill").execute({ name: "big-skill" }, context);
    expect(result.content).toMatch(/assets\/template\.html（\d+ KB）/);
    expect(result.content).toContain("不要假设你已经看过它们");
  });

  it("② 带 file → 只取那一个文件，小文件不再被大文件挤掉", async () => {
    // Alphabetically `assets/template.html` came first and used the whole budget, so this
    // file was previously unreachable through `read_skill` at all.
    const result = await tool("read_skill").execute(
      { name: "big-skill", file: "references/review-rubric.md" },
      context
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("评审标准：证据、反驳、置信度。");
    expect(result.summary).toContain("review-rubric.md");
  });

  it("② 大文件单独读时按本轮预算截断，且说明被截断了", async () => {
    const result = await tool("read_skill").execute({ name: "big-skill", file: "assets/template.html" }, context);
    expect(result.ok).toBe(true);
    // Its own budget, not the whole skill's: the opening of the template survives.
    expect(result.content).toContain("<style>");
    expect(result.summary).toContain("已截断");
  });

  it("② 越界与非可读格式被拒，且不回显真实路径", async () => {
    writeFileSync(join(dir, "outside.md"), "不该读到", "utf8");
    const escaped = await tool("read_skill").execute({ name: "big-skill", file: "../outside.md" }, context);
    expect(escaped.ok).toBe(false);
    expect(escaped.content).not.toContain(dir);

    const binary = await tool("read_skill").execute({ name: "big-skill", file: "logo.png" }, context);
    expect(binary.ok).toBe(false);
    expect(binary.content).toContain("不是可读的文本格式");
  });

  it("② 清单里没有的文件 → 指回不带 file 的那次调用", async () => {
    const result = await tool("read_skill").execute({ name: "big-skill", file: "references/nope.md" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("文件清单");
  });

  it("① 宿主约定仍在结果末尾，且提醒参考文件要按清单读", async () => {
    const result = await tool("read_skill").execute({ name: "big-skill" }, context);
    expect(result.content).toContain("read_skill(name, file)");
    expect(result.content).toContain("不要凭技能名猜它的规范");
  });
});
