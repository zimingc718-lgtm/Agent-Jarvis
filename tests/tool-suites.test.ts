import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { createDisplayTools, looksLikeCompleteHtml } from "@/lib/tools/display-tools";
import { createSkillTools } from "@/lib/tools/skill-tools";
import type { ToolContext } from "@/lib/tools/registry";

/**
 * TEST-069 / TEST-070 — the skill and display tool suites
 * (REQ-F-030, REQ-F-032, REQ-F-023/024/025; TASK-067/068).
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("skill tools (REQ-F-030)", () => {
  let dir: string;
  let store: Store;
  let userId: string;
  let context: ToolContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-st-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;

    const skillDir = join(dir, "reporter");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: reporter\ndescription: 写报告\n---\n\n按季度汇总。");
    store.insertSkill(userId, { name: "reporter", description: "写报告", dirPath: skillDir });

    context = { userId, conversationId: "c1", skillCount: 1, webEnabled: false, searchConfigured: false };
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("① list_skills / read_skill / search_skills 各自可用", async () => {
    const [list, read, search] = createSkillTools(store);

    expect((await list.execute({}, context)).content).toContain("reporter");
    expect((await read.execute({ name: "reporter" }, context)).content).toContain("按季度汇总");
    expect((await search.execute({ query: "报告" }, context)).content).toContain("reporter");
  });

  it("④ 一轮内可以读多个技能（无「仅当轮」硬边界）", async () => {
    const other = join(dir, "translator");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "SKILL.md"), "---\nname: translator\ndescription: 翻译\n---\n\n中英互译。");
    store.insertSkill(userId, { name: "translator", description: "翻译", dirPath: other });

    const [, read] = createSkillTools(store);
    const first = await read.execute({ name: "reporter" }, { ...context, skillCount: 2 });
    const second = await read.execute({ name: "translator" }, { ...context, skillCount: 2 });

    expect(first.ok && second.ok).toBe(true);
    expect(second.content).toContain("中英互译");
  });

  it("⑤ 没有技能时三个工具都不注册", () => {
    const tools = createSkillTools(store);
    const empty = { ...context, skillCount: 0 };
    expect(tools.every((tool) => tool.available(empty))).toBe(false);
    expect(tools.some((tool) => tool.available(empty))).toBe(false);
  });

  it("读取不存在的技能作失败回喂，并提示可用 list_skills", async () => {
    const [, read] = createSkillTools(store);
    const result = await read.execute({ name: "nope" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("list_skills");
  });
});

describe("display tools (REQ-F-032 / REQ-F-023)", () => {
  let dir: string;
  let store: Store;
  let userId: string;
  let conversationId: string;
  let context: ToolContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-dt-"));
    process.env.JARVIS_DB_PATH = join(dir, "db.sqlite");
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;
    conversationId = store.createConversation(userId, "chat").id;
    context = { userId, conversationId, skillCount: 0, webEnabled: false, searchConfigured: false };
  });

  afterEach(() => {
    store.close();
    delete process.env.JARVIS_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it("③ show_insight 校验属主：跨会话 id 被拒，展示屏不变", async () => {
    // `insights` carries no user_id, so ownership has to come from the conversation it
    // hangs off — otherwise a guessed id puts someone else's HTML on screen (CP-43).
    const otherUser = store.upsertUser({ email: "other@example.com", name: "O" }).id;
    const otherConversation = store.createConversation(otherUser, "theirs").id;
    const foreign = store.insertInsight({ conversationId: otherConversation, kind: "skill", html: "<p>theirs</p>" });

    const [, showInsight] = createDisplayTools(store);
    const result = await showInsight.execute({ insightId: foreign.id }, context);

    expect(result.ok).toBe(false);
    expect(result.content).toContain("不属于当前用户");
  });

  it("③ 不存在的 insightId 作失败回喂", async () => {
    const [, showInsight] = createDisplayTools(store);
    expect((await showInsight.execute({ insightId: "nope" }, context)).ok).toBe(false);
  });

  it("⑤ HTML 不完整时失败回喂，且不写 insights 行", async () => {
    const [, , saveInsight] = createDisplayTools(store);
    const result = await saveInsight.execute({ html: "<div><p>truncated mid-ta" }, context);

    expect(result.ok).toBe(false);
    expect(store.listInsights(conversationId)).toHaveLength(0);
  });

  it("④ 完整 HTML 写入 insights", async () => {
    const [, , saveInsight] = createDisplayTools(store);
    const result = await saveInsight.execute({ html: "<h1>季度报告</h1><p>正文</p>" }, context);

    expect(result.ok).toBe(true);
    expect(store.listInsights(conversationId)).toHaveLength(1);
  });

  it("⑧ 已接受的风险如实记录：save_insight 不对 HTML 来源做任何过滤", async () => {
    // Registered as `skill-html-unsandboxed-web-source`. The user was shown the chain
    // (web_search → read_url → prompt injection → save_insight → unsandboxed
    // same-origin iframe) and chose to accept it. This test asserts what the code
    // ACTUALLY does so the risk stays visible, rather than implying a defence that
    // does not exist.
    const [, , saveInsight] = createDisplayTools(store);
    const injected = '<div><img src=x onerror="fetch(\'/api/providers\')"></div>';
    const result = await saveInsight.execute({ html: injected }, context);

    expect(result.ok).toBe(true);
    const [stored] = store.listInsights(conversationId);
    // Stored verbatim — no sanitising, no CSP, no script stripping (REQ-F-025 ①).
    expect(stored.html).toBe(injected);
  });

  it("looksLikeCompleteHtml 区分完整与截断", () => {
    expect(looksLikeCompleteHtml("<p>ok</p>")).toBe(true);
    expect(looksLikeCompleteHtml("<div><p>cut off mid-tag <sp")).toBe(false);
    expect(looksLikeCompleteHtml("")).toBe(false);
    expect(looksLikeCompleteHtml("no tags at all")).toBe(false);
  });
});
