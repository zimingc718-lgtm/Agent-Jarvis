import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { clearDocumentCache, serializeRoots, SETTING_DOCUMENT_ROOTS } from "@/lib/documents";
import { createDocumentTools } from "@/lib/tools/document-tools";
import { BUDGET_SHARES, budgetTokens } from "@/lib/tools/budget";
import type { ToolContext, ToolDescriptor } from "@/lib/tools/registry";

/**
 * TEST-171 — the three document tools as the model meets them
 * (REQ-F-110 ②③④⑤; DEC-090; TASK-170). CR-20260912-local-documents.
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

const context: ToolContext = {
  userId: "u1",
  conversationId: "c1",
  skillCount: 0,
  webEnabled: false,
  searchConfigured: false,
  knowledgeCount: 0,
  contextWindow: 128_000,
};

let dir: string;
let docsRoot: string;
let store: Store;

function toolNamed(name: string): ToolDescriptor {
  const tool = createDocumentTools(store).find((candidate) => candidate.name === name);
  expect(tool, `工具 ${name} 应当存在`).toBeTruthy();
  return tool!;
}

function configureRoot() {
  store.setSetting(SETTING_DOCUMENT_ROOTS, serializeRoots([{ label: "资料", path: docsRoot }]));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-jarvis-doctools-"));
  docsRoot = join(dir, "资料");
  mkdirSync(join(docsRoot, "规格"), { recursive: true });
  store = createStore(join(dir, "db.sqlite"), encryptionKey);
  // 资料库是内置文档根（CR-20260915-library-adoption CP-5），不指开的话这些用例会读到
  // 仓库里那个真的 258 个文件的资料库——测试从此依赖仓库内容。这里指到一个不存在的路径，
  // 让这一组回到「只有用户自己配的目录」的场景；资料库自己的行为由 TEST-420 覆盖。
  process.env.JARVIS_LIBRARY_PATH = join(dir, "没有资料库");
  clearDocumentCache();
});

afterEach(() => {
  store.close();
  delete process.env.JARVIS_LIBRARY_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("TEST-171 本地文档工具 (REQ-F-110)", () => {
  it("① 未配置目录时三个工具仍然注册，并说清楚去哪配——不是从工具表里消失", async () => {
    const tools = createDocumentTools(store);
    expect(tools.map((tool) => tool.name).sort()).toEqual(["list_documents", "read_document", "search_documents"]);
    // available() must not depend on configuration: a tool that vanishes cannot explain
    // its own absence, which is exactly how search_knowledge became invisible.
    for (const tool of tools) {
      expect(tool.available(context)).toBe(true);
    }
    const result = await toolNamed("search_documents").execute({ query: "液冷" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("本地文档");
    expect(result.summary).toContain("未配置");
  });

  it("② 检索返回标识、文件名与片段；标识可直接喂给 read_document", async () => {
    writeFileSync(join(docsRoot, "规格", "整流柜.md"), "# 整流柜\n本机柜采用液冷方案，额定容量 1200 kW。", "utf8");
    configureRoot();

    const found = await toolNamed("search_documents").execute({ query: "液冷" }, context);
    expect(found.ok).toBe(true);
    expect(found.content).toContain("资料/规格/整流柜.md");

    const read = await toolNamed("read_document").execute({ id: "资料/规格/整流柜.md" }, context);
    expect(read.ok).toBe(true);
    expect(read.content).toContain("额定容量 1200 kW");
    // The reply states where it came from and that it is read-only.
    expect(read.content).toContain("只读");
  });

  it("③ 越界标识被拒，且不回显真实路径", async () => {
    writeFileSync(join(dir, "私密.txt"), "API_KEY=x", "utf8");
    configureRoot();
    const result = await toolNamed("read_document").execute({ id: "资料/../私密.txt" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).not.toContain(dir);
    expect(result.summary).toContain("不可读");
  });

  it("③ 目录为空、检索无结果、标识不存在，各给各的说法", async () => {
    configureRoot();
    const empty = await toolNamed("search_documents").execute({ query: "液冷" }, context);
    expect(empty.ok).toBe(true);
    expect(empty.content).toContain("没有可读的文件");

    writeFileSync(join(docsRoot, "规格", "整流柜.md"), "风冷", "utf8");
    clearDocumentCache();
    const miss = await toolNamed("search_documents").execute({ query: "完全无关xyzzy" }, context);
    expect(miss.ok).toBe(true);
    expect(miss.content).toContain("没有检索到");

    const gone = await toolNamed("read_document").execute({ id: "资料/不存在.md" }, context);
    expect(gone.ok).toBe(false);
    expect(gone.content).toContain("不存在");
  });

  it("④ 结果按当前模型的窗口截断，而不是按常量", async () => {
    writeFileSync(join(docsRoot, "规格", "长文.md"), "液冷散热。".repeat(40_000), "utf8");
    configureRoot();

    const small = await toolNamed("read_document").execute({ id: "资料/规格/长文.md" }, { ...context, contextWindow: 8_192 });
    const large = await toolNamed("read_document").execute({ id: "资料/规格/长文.md" }, { ...context, contextWindow: 128_000 });
    expect(small.ok && large.ok).toBe(true);
    expect(large.content.length).toBeGreaterThan(small.content.length * 4);
    expect(small.content.length).toBeLessThan(budgetTokens(8_192, BUDGET_SHARES.singleToolResult) * 4 + 400);
  });

  it("④ 小窗口下被挤掉时出现在「未加载」名单里——能被说明，而不是无声消失", async () => {
    const { buildRegistry } = await import("@/lib/chat");
    const registry = buildRegistry(store);
    const fit = registry.fitFor(context, budgetTokens(8_192, BUDGET_SHARES.toolDefinitions));
    const dropped = fit.dropped.map((tool) => tool.name);
    const loaded = fit.loaded.map((tool) => tool.name);
    // Whichever side they land on, the catalogue names the dropped ones, so the model can
    // tell the user the capability exists but did not fit this model's window.
    for (const name of ["search_documents", "read_document"]) {
      expect([...loaded, ...dropped]).toContain(name);
    }
    // The board's read tools keep their place at a small window (existing invariant).
    expect(loaded).toContain("read_entity");
    const catalogue = registry.catalogueFor(context, fit);
    if (dropped.length > 0) {
      expect(catalogue).toContain("未加载");
    }
  });

  it("⑤ 这一层没有写入口：三个工具都只读，模块也不导出任何写函数", async () => {
    writeFileSync(join(docsRoot, "规格", "整流柜.md"), "原文", "utf8");
    configureRoot();
    await toolNamed("read_document").execute({ id: "资料/规格/整流柜.md" }, context);
    await toolNamed("list_documents").execute({}, context);

    const documents = await import("@/lib/documents");
    const writers = Object.keys(documents).filter((name) => /^(save|write|delete|remove|update|create)/i.test(name));
    expect(writers).toEqual([]);
  });

  it("⑤ 列目录按修改时间倒序，并在超出上限时说明还有多少没列", async () => {
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(docsRoot, "规格", `文件${i}.md`), `内容 ${i}`, "utf8");
    }
    configureRoot();
    const result = await toolNamed("list_documents").execute({ limit: 2 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("共 5 份");
    expect(result.content).toContain("另有 3 份未列出");
  });
});
