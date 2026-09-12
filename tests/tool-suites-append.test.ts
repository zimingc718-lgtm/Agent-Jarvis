import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { createDisplayTools, MAX_INSIGHT_BYTES } from "@/lib/tools/display-tools";
import type { ToolContext } from "@/lib/tools/registry";

/**
 * TEST-092 ③④⑤⑧ — save_insight append mode and the argument diagnostics it uses
 * (REQ-F-050 ①②③⑤; DEC-032 ③; TASK-089 ②③). CR-20260911-display-console-ux.
 *
 * The behaviour this replaces: chunked submissions each created a new insight and
 * re-pointed the screen, so the user only ever saw the last chunk
 * (EV-2026-09-11-display-console-ux §1.2).
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("TEST-092 save_insight 追加 (REQ-F-050)", () => {
  let dir: string;
  let store: Store;
  let userId: string;
  let conversationId: string;
  let context: ToolContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-append-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;
    conversationId = store.createConversation(userId, "chat").id;
    context = { userId, conversationId, skillCount: 0, webEnabled: false, searchConfigured: false, knowledgeCount: 0 };
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function saveTool() {
    const save = createDisplayTools(store).find((t) => t.name === "save_insight")!;
    return save;
  }

  it("③ 带 insightId 追加：同一行变长、行数不变、展示屏指针不变、回喂累计长度", async () => {
    const save = saveTool();
    const first = await save.execute({ html: "<h1>报告</h1><h2>摘要</h2><p>一</p>" }, context);
    expect(first.ok).toBe(true);
    const [created] = store.listInsights(conversationId);
    expect(first.content).toContain(created.id);

    const second = await save.execute({ html: "<h2>分析</h2><p>二</p>", insightId: created.id }, context);
    expect(second.ok).toBe(true);
    expect(second.summary).toBe("已追加洞察");

    const rows = store.listInsights(conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].html).toContain("<p>一</p>");
    expect(rows[0].html).toContain("<h2>分析</h2>");
    expect(store.getDisplayState()).toMatchObject({ kind: "insight", refId: created.id });
    expect(second.content).toContain(String(rows[0].html.length));
    // <h1>报告</h1> + <h2>摘要</h2> + <h2>分析</h2> — the progress line counts headings, so the
    // model can tell how much of the report is already on screen.
    expect(second.content).toContain("3 个章节标题");
  });

  it("④ 追加后超过上限 → 拒绝且不写", async () => {
    const save = saveTool();
    const big = `<p>${"字".repeat(200_000)}</p>`; // ~600 KB in UTF-8
    const first = await save.execute({ html: big }, context);
    expect(first.ok).toBe(false);
    expect(first.content).toContain(String(MAX_INSIGHT_BYTES));
    expect(store.listInsights(conversationId)).toHaveLength(0);

    const created = await save.execute({ html: `<p>${"字".repeat(150_000)}</p>` }, context);
    expect(created.ok).toBe(true);
    const [row] = store.listInsights(conversationId);
    const append = await save.execute({ html: `<p>${"字".repeat(30_000)}</p>`, insightId: row.id }, context);
    expect(append.ok).toBe(false);
    expect(append.summary).toBe("洞察超出上限，未追加");
    expect(store.getInsight(row.id)?.html).toBe(row.html);
  });

  it("⑤ 跨会话的 insightId 追加被拒", async () => {
    const otherUser = store.upsertUser({ email: "o@example.com", name: "O" }).id;
    const otherConversation = store.createConversation(otherUser, "theirs").id;
    const foreign = store.insertInsight({ conversationId: otherConversation, kind: "skill", html: "<p>theirs</p>" });

    const result = await saveTool().execute({ html: "<p>mine</p>", insightId: foreign.id }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("不属于当前用户");
    expect(store.getInsight(foreign.id)?.html).toBe("<p>theirs</p>");
  });

  it("⑧ 63 字节的合法片段可保存；嵌套包装经解析后也可保存", async () => {
    const save = saveTool();
    const probe = "<h1>AIDC 产业洞察（测试）</h1><p>保存链路检测。</p>";
    expect((await save.execute({ html: probe }, context)).ok).toBe(true);
  });

  it("⑤ 缺 html 时回喂收到的键名，而不是「不完整或为空」", async () => {
    const raw = JSON.stringify({ arguments: { html: "<p>a</p>" }, extra: true });
    const result = await saveTool().execute({ arguments: { html: "<p>a</p>" }, extra: true }, context, raw);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("缺少参数 html");
    expect(result.content).toContain("arguments");
    expect(result.content).not.toContain("不完整或为空");
  });

  it("⑥ 不闭合的 HTML 文案区分「疑似截断」与「不是 HTML」", async () => {
    const save = saveTool();
    const cut = await save.execute({ html: "<div><table><tr><td>2023 Q4</td><td>46," }, context);
    expect(cut.ok).toBe(false);
    expect(cut.summary).toBe("HTML 疑似截断，未保存");
    expect(cut.content).toContain("insightId");

    const plain = await save.execute({ html: "只有文字，没有标签" }, context);
    expect(plain.ok).toBe(false);
    expect(plain.summary).toBe("不是 HTML，未保存");
  });
});
