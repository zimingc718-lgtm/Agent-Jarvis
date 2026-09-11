import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPending, saveKnowledge, searchKnowledge } from "@/lib/knowledge";
import { createKnowledgeTools } from "@/lib/tools/knowledge-tools";
import { ToolRegistry, type ToolContext } from "@/lib/tools/registry";

/** TEST-086 — the knowledge tool suite (REQ-F-045, REQ-F-046 ③, REQ-NF-013 ③; TASK-083). */

describe("knowledge tools", () => {
  let root: string;
  let context: ToolContext;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-kt-"));
    await saveKnowledge({ title: "部署说明", content: "生产环境部署端口是 8443，反向代理用 Caddy。", source: "manual" }, root);
    await saveKnowledge({ title: "回答风格", content: "用户偏好中文回答。", source: "conversation" }, root);
    context = { userId: "u", conversationId: "c", skillCount: 0, webEnabled: false, searchConfigured: false, knowledgeCount: 2 };
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("① 描述都在 200 字符内，能注册进 ToolRegistry", () => {
    const registry = new ToolRegistry();
    for (const tool of createKnowledgeTools({ root })) {
      expect(() => registry.register(tool)).not.toThrow();
    }
    expect(registry.availableFor(context).map((tool) => tool.name)).toEqual(["search_knowledge", "read_knowledge", "save_knowledge"]);
  });

  it("② 知识库为空时只注册 save_knowledge，检索与读取不占提示词预算（REQ-NF-008 ④）", () => {
    const empty = { ...context, knowledgeCount: 0 };
    const names = createKnowledgeTools({ root })
      .filter((tool) => tool.available(empty))
      .map((tool) => tool.name);
    expect(names).toEqual(["save_knowledge"]);
  });

  it("③ search_knowledge 返回名称｜标题：片段；read_knowledge 返回全文；未知名称失败并提示先检索", async () => {
    const [search, read] = createKnowledgeTools({ root });
    const hits = await search.execute({ query: "部署端口" }, context);
    expect(hits.ok).toBe(true);
    expect(hits.content).toContain("部署说明｜部署说明：");
    expect(hits.content).toContain("8443");
    expect(hits.summary).toContain("知识检索到 1 条");

    const full = await read.execute({ name: "部署说明" }, context);
    expect(full.ok).toBe(true);
    expect(full.content).toContain("# 部署说明");
    expect(full.content).toContain("Caddy");

    const missing = await read.execute({ name: "不存在" }, context);
    expect(missing.ok).toBe(false);
    expect(missing.content).toContain("search_knowledge");

    expect((await search.execute({}, context)).ok).toBe(false);
    expect((await search.execute({ query: "量子计算" }, context)).content).toContain("没有与「量子计算」相关的条目");
  });

  it("④ read_knowledge 的结果受子预算截断并留可见标记（REQ-NF-013 ③）", async () => {
    await saveKnowledge({ title: "巨型", content: "字".repeat(15_000), source: "manual" }, root);
    const [, read] = createKnowledgeTools({ root });
    const result = await read.execute({ name: "巨型" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("[内容超出预算，已截断]");
    expect(result.summary).toContain("（已截断）");
  });

  it("⑤ save_knowledge 只写待采纳区：不进检索，附带 knowledge_pending 事件（REQ-F-046 ③）", async () => {
    const [search, , save] = createKnowledgeTools({ root });
    const result = await save.execute({ title: "用户偏好", content: "偏好用中文回答，代码用 TypeScript。" }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("提议知识：用户偏好");
    expect(result.events).toEqual([{ type: "knowledge_pending", name: "用户偏好", title: "用户偏好" }]);
    expect((await listPending(root)).map((entry) => entry.source)).toEqual(["model"]);
    // Invisible until a human adopts it.
    expect(await searchKnowledge("TypeScript", 5, root)).toEqual([]);
    expect((await search.execute({ query: "TypeScript" }, context)).content).toContain("没有与");
  });

  it("⑥ save_knowledge 拒绝空内容与超大内容，作为失败结果回喂而非抛错", async () => {
    const [, , save] = createKnowledgeTools({ root });
    const empty = await save.execute({ title: "x", content: "  " }, context);
    expect(empty.ok).toBe(false);
    expect(empty.content).toContain("为空");
    const huge = await save.execute({ title: "x", content: "字".repeat(70_000) }, context);
    expect(huge.ok).toBe(false);
    expect(huge.content).toContain("KB");
    expect(await listPending(root)).toEqual([]);
  });
});
