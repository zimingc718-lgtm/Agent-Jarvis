import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveEntity } from "@/lib/entities";
import { listKnowledge, saveKnowledge, searchKnowledge } from "@/lib/knowledge";
import { createKnowledgeTools } from "@/lib/tools/knowledge-tools";
import { ToolRegistry, type ToolContext } from "@/lib/tools/registry";

/**
 * TEST-230 — 知识元数据全链路（CR-20260912-knowledge-attribution）。
 *
 * 实测：对话里明确要求归属与来源，落盘仍是 `entity:"" docType:"" sourceUrl:""`，
 * 因为 `save_knowledge` 的参数只有 title 与 content；读取工具也不回传这三个字段，
 * 于是模型把一条已归属的条目报成「未归属」；索引又只取 title 与 content，
 * 所以按对象的中文名根本检索不到——三处是同一根因的三个面。
 */

const context = (knowledgeCount: number): ToolContext => ({
  userId: "u",
  conversationId: "c",
  skillCount: 0,
  webEnabled: false,
  searchConfigured: false,
  knowledgeCount,
  contextWindow: 128_000,
});

describe("知识写入带归属", () => {
  let root: string;
  let entitiesRoot: string;

  const tools = () => createKnowledgeTools({ root, entitiesRoot });
  const byName = (name: string) => tools().find((tool) => tool.name === name)!;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-ka-"));
    entitiesRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-ka-e-"));
    await saveEntity({ kind: "competitor", title: "维谛技术 Vertiv" }, entitiesRoot);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(entitiesRoot, { recursive: true, force: true });
  });

  it("三个字段落盘，不再是孤儿条目", async () => {
    const result = await byName("save_knowledge").execute(
      {
        title: "GB300 参考架构",
        content: "冷板式液冷，800VDC 供电。",
        entity: "维谛技术-vertiv",
        source_url: "https://vertiv.example/news/1",
        doc_type: "厂商新闻稿",
      },
      context(0)
    );

    expect(result.ok).toBe(true);
    const [entry] = await listKnowledge(join(root, "pending"));
    expect(entry?.entity).toBe("维谛技术-vertiv");
    expect(entry?.sourceUrl).toBe("https://vertiv.example/news/1");
    expect(entry?.docType).toBe("厂商新闻稿");
  });

  it("传了不存在的对象就拒绝，并回列现有对象名", async () => {
    const result = await byName("save_knowledge").execute(
      { title: "x", content: "y", entity: "施耐德-schneider" },
      context(0)
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("维谛技术-vertiv");
    expect(await listKnowledge(join(root, "pending"))).toHaveLength(0);
  });

  it("`__通用__` 是一个合法归属，不是「未分类」", async () => {
    const result = await byName("save_knowledge").execute(
      { title: "我方产能约束", content: "二期产线 2027 投产。", entity: "__通用__" },
      context(0)
    );

    expect(result.ok).toBe(true);
    const [entry] = await listKnowledge(join(root, "pending"));
    expect(entry?.entity).toBe("__通用__");
  });

  it("read_knowledge 在正文前带元数据头，模型能回答「这条哪来的」", async () => {
    await saveKnowledge(
      {
        title: "GB300 参考架构",
        content: "冷板式液冷。",
        source: "file",
        entity: "维谛技术-vertiv",
        docType: "厂商新闻稿",
        sourceUrl: "https://vertiv.example/news/1",
      },
      root
    );

    const result = await byName("read_knowledge").execute({ name: "gb300-参考架构" }, context(1));
    expect(result.ok).toBe(true);
    expect(result.content).toContain("维谛技术-vertiv");
    expect(result.content).toContain("https://vertiv.example/news/1");
    expect(result.content).toContain("厂商新闻稿");
  });
});

describe("按归属对象名找回条目", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-ka-s-"));
    // 双语 fixture：正文全英文，中文只出现在 entity 上——正是实测那条的形状。
    await saveKnowledge(
      {
        title: "Vertiv develops cooling and power reference architecture",
        content: "Vertiv today announced a reference architecture for the NVIDIA GB300 NVL72 platform.",
        source: "file",
        entity: "维谛技术-vertiv",
        docType: "厂商新闻稿",
        sourceUrl: "https://vertiv.example/news/1",
      },
      root
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("用对象的中文名可以命中正文为英文的条目", async () => {
    const hits = await searchKnowledge("维谛", 5, root);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.name).toBeTruthy();
  });

  it("英文检索照旧命中，中文能力不是拿英文换来的", async () => {
    expect(await searchKnowledge("Vertiv", 5, root)).toHaveLength(1);
  });

  it("命中项带 entity，便于模型按对象归类", async () => {
    const [hit] = await searchKnowledge("维谛", 5, root);
    expect(hit?.entity).toBe("维谛技术-vertiv");
  });

  it("正文里没有的词仍然不命中——不能靠放宽匹配换命中率", async () => {
    expect(await searchKnowledge("浸没", 5, root)).toHaveLength(0);
  });
});

describe("list_knowledge 枚举", () => {
  let root: string;
  const tools = () => createKnowledgeTools({ root });
  const list = () => tools().find((tool) => tool.name === "list_knowledge")!;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-ka-l-"));
    for (const [i, entity] of ["维谛技术-vertiv", "维谛技术-vertiv", "施耐德-schneider"].entries()) {
      await saveKnowledge(
        { title: `条目 ${i}`, content: `正文 ${i}`, source: "file", entity, sourceUrl: `https://x.example/${i}` },
        root
      );
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("返回条目并按对象分组计数", async () => {
    const result = await list().execute({}, context(3));
    expect(result.ok).toBe(true);
    expect(result.content).toContain("维谛技术-vertiv");
    expect(result.content).toContain("施耐德-schneider");
    expect(result.summary).toContain("3");
  });

  it("可按对象过滤", async () => {
    const result = await list().execute({ entity: "施耐德-schneider" }, context(3));
    expect(result.content).toContain("条目 2");
    expect(result.content).not.toContain("条目 0");
  });

  it("零条目时仍然注册——模型要能回答「库是空的」", () => {
    const registry = new ToolRegistry();
    for (const tool of createKnowledgeTools({ root })) {
      registry.register(tool);
    }
    const names = registry.availableFor(context(0)).map((tool) => tool.name);
    expect(names).toContain("list_knowledge");
    // 既有约束不变：其余读取工具在零条目时仍不注册（REQ-F-045 ③）。
    expect(names).not.toContain("read_knowledge");
  });
});
