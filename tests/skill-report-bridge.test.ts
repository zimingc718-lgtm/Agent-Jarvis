import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { createDisplayTools } from "@/lib/tools/display-tools";
import { createSkillTools, HOST_OUTPUT_NOTE } from "@/lib/tools/skill-tools";
import type { ToolContext, ToolDescriptor } from "@/lib/tools/registry";

/**
 * TEST-200 — a skill written for another host can still deliver a report here
 * (REQ-F-140 ①②③; DEC-120; TASK-200). CR-20260912-skill-report-bridge.
 *
 * Measured origin: `multi-agent-insight-reviewer` is 167,755 characters across twenty
 * reference files with a full standalone HTML template, tells the model to "generate or
 * update the final HTML or Word report artifact directly", and never once names
 * `save_insight` — the only way anything reaches this screen. The model improvised, and one
 * real report came out ordered 八、九、十、十一、1、2…7 because append was the only write it had.
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

let dir: string;
let store: Store;
let context: ToolContext;

function tool(name: string): ToolDescriptor {
  const found = [...createDisplayTools(store), ...createSkillTools(store)].find((t) => t.name === name);
  expect(found, `工具 ${name} 应当存在`).toBeTruthy();
  return found!;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-jarvis-bridge-"));
  store = createStore(join(dir, "db.sqlite"), encryptionKey);
  const user = store.upsertUser({ email: "u@example.com", name: "U" });
  const conversation = store.createConversation(user.id, "报告");
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

describe("TEST-200 ① 宿主产出约定 (REQ-F-140 ①)", () => {
  it("read_skill 的结果末尾带上本机的产出约定——放在最后，截断削不掉它", async () => {
    const skillsRoot = join(dir, "skills");
    mkdirSync(join(skillsRoot, "demo"), { recursive: true });
    writeFileSync(join(skillsRoot, "demo", "SKILL.md"), "---\nname: demo\ndescription: d\n---\n写一份报告。", "utf8");
    store.insertSkill(context.userId, { name: "demo", description: "d", dirPath: join(skillsRoot, "demo") });

    const result = await tool("read_skill").execute({ name: "demo" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("写一份报告。");
    expect(result.content.endsWith(HOST_OUTPUT_NOTE)).toBe(true);
  });

  it("约定把四件会出错的事都说清楚了", () => {
    // No files and no Word: the skill's own workflow offers both and neither exists here.
    expect(HOST_OUTPUT_NOTE).toContain("save_insight");
    expect(HOST_OUTPUT_NOTE).toContain("Word");
    // One report, one id — the mistake that split a report in two.
    expect(HOST_OUTPUT_NOTE).toContain("拆成两份");
    // Fix in place instead of appending the opening to the end.
    expect(HOST_OUTPUT_NOTE).toContain("mode=replace");
    // Carry the skill's own <style>, or all its design is lost to the generic fallback.
    expect(HOST_OUTPUT_NOTE).toContain("<style>");
    // One numbering scheme.
    expect(HOST_OUTPUT_NOTE).toContain("编号");
  });
});

describe("TEST-200 ② 整篇重写 (REQ-F-140 ②)", () => {
  it("mode=replace 覆盖全文，顺序写错了不必再把开头追加到结尾", async () => {
    const save = tool("save_insight");
    const first = await save.execute({ html: "<section><h2>八、证据</h2></section>" }, context);
    const id = /id ([0-9a-f-]{36})/.exec(first.content)![1]!;

    const fixed = await save.execute(
      { html: "<section><h2>1. 执行摘要</h2></section><section><h2>八、证据</h2></section>", insightId: id, mode: "replace" },
      context
    );
    expect(fixed.ok).toBe(true);
    const html = store.getInsight(id)!.html;
    expect(html.indexOf("1. 执行摘要")).toBeLessThan(html.indexOf("八、证据"));
    // Replaced, not appended: the stray opening must not still be sitting at the end.
    expect(html.match(/八、证据/g)).toHaveLength(1);
  });

  it("append 仍是默认行为——既有分块流程不受影响", async () => {
    const save = tool("save_insight");
    const first = await save.execute({ html: "<section><h1>标题</h1></section>" }, context);
    const id = /id ([0-9a-f-]{36})/.exec(first.content)![1]!;
    await save.execute({ html: "<section><h2>第二块</h2></section>", insightId: id }, context);
    const html = store.getInsight(id)!.html;
    expect(html).toContain("标题");
    expect(html).toContain("第二块");
  });

  it("mode=replace 不带 insightId 被拒，并说明不带 id 本来就是新建", async () => {
    const result = await tool("save_insight").execute({ html: "<p>x</p>", mode: "replace" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("insightId");
  });
});

describe("TEST-200 ③ 重复新建会被点名 (REQ-F-140 ③)", () => {
  it("同一会话里第二次新建 → 回喂里点出已有洞察的 id 与体量，并说清后果", async () => {
    const save = tool("save_insight");
    const first = await save.execute({ html: "<section><h1>第一份</h1></section>" }, context);
    const firstId = /id ([0-9a-f-]{36})/.exec(first.content)![1]!;
    expect(first.content).not.toContain("注意：本会话此前已有");

    const second = await save.execute({ html: "<section><h2>续写</h2></section>" }, context);
    expect(second.ok).toBe(true);
    expect(second.content).toContain("注意：本会话此前已有");
    expect(second.content).toContain(firstId);
    // The consequence is the part that makes it actionable, not just the fact.
    expect(second.content).toContain("展示屏只显示较新的一份");
  });

  it("首次新建不带这条提醒——没有旧洞察时它是噪音", async () => {
    const result = await tool("save_insight").execute({ html: "<p>唯一一份</p>" }, context);
    expect(result.content).toContain("mode=replace");
    expect(result.content).not.toContain("注意：本会话此前已有");
  });
});
