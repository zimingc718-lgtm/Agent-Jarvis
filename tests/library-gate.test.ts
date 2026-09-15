import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { clearDocumentCache } from "@/lib/documents";
import { decideLibrary } from "@/lib/library";
import { createDocumentTools } from "@/lib/tools/document-tools";
import type { ToolContext, ToolDescriptor } from "@/lib/tools/registry";

/**
 * TEST-420 — 采纳闸与网页存档（REQ-F-230；CR-20260915-library-adoption CP-4、CP-5、CP-6）。
 *
 * 三件事一起验，因为它们描述的是同一条路：审批 → 可见 → 读得出正文。少了任何一段，用户
 * 那句「审批通过后支持对话查阅」就不成立。
 *
 * 夹具目录用 ASCII 名，理由见 `library-routes.test.ts` 的注释。
 */

const context: ToolContext = {
  userId: "u1",
  conversationId: "c1",
  skillCount: 0,
  webEnabled: false,
  searchConfigured: false,
  knowledgeCount: 0,
  contextWindow: 128_000,
};

const REPORT = "AIDC/01_报告/整流柜.html";
const SOURCE = "AIDC/02_原文/P1_diablo.pdf";

let dir: string;
let root: string;
let store: Store;

function toolNamed(name: string): ToolDescriptor {
  const tool = createDocumentTools(store).find((candidate) => candidate.name === name);
  expect(tool, `工具 ${name} 应当存在`).toBeTruthy();
  return tool!;
}

function options() {
  return { root, stateDir: join(dir, "state"), knowledgeRoot: join(dir, "knowledge") };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-jarvis-library-gate-"));
  root = join(dir, "lib-root");
  process.env.JARVIS_LIBRARY_PATH = root;
  process.env.JARVIS_LIBRARY_STATE_PATH = join(dir, "state");
  mkdirSync(join(root, "AIDC", "01_报告"), { recursive: true });
  mkdirSync(join(root, "AIDC", "02_原文"), { recursive: true });
  writeFileSync(
    join(root, "AIDC", "01_报告", "整流柜.html"),
    "<html><head><title>t</title><style>p{}</style></head><body><h1>整流柜</h1><p>800V 直流母线与液冷回路。</p></body></html>",
    "utf8"
  );
  writeFileSync(join(root, "AIDC", "02_原文", "P1_diablo.pdf"), "%PDF-1.4 fake", "utf8");
  store = createStore(join(dir, "db.sqlite"), "0123456789abcdef0123456789abcdef");
  clearDocumentCache();
});

afterEach(() => {
  store.close();
  delete process.env.JARVIS_LIBRARY_PATH;
  delete process.env.JARVIS_LIBRARY_STATE_PATH;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TEST-420 资料库的采纳闸 (REQ-F-230)", () => {
  it("① 资料库不用配置就是一个文档根，但待采纳的一份都不露出——并且报数", async () => {
    const result = await toolNamed("list_documents").execute({}, context);
    expect(result.ok).toBe(true);
    expect(result.content).not.toContain("整流柜.html");
    // 静默过滤是不行的：「没有结果」和「有 2 份还没审」是两件事。
    expect(result.content).toContain("2 份");
    expect(result.content).toContain("没审批");
  });

  it("② 采纳之后同一个工具就能看见它，检索也命中", async () => {
    await decideLibrary([REPORT], "adopted", options());
    clearDocumentCache();

    const listed = await toolNamed("list_documents").execute({}, context);
    expect(listed.content).toContain("整流柜.html");

    const found = await toolNamed("search_documents").execute({ query: "液冷" }, context);
    expect(found.ok).toBe(true);
    expect(found.content).toContain("整流柜.html");
    // 另一份仍待采纳，仍要报数。
    expect(found.content).toContain("1 份");
  });

  it("③ 未采纳的读不了，但说清为什么、怎么办——不是「文件不存在」", async () => {
    const blocked = await toolNamed("read_document").execute({ id: `资料库/${SOURCE}` }, context);
    expect(blocked.ok).toBe(false);
    expect(blocked.content).toContain("待采纳");
    expect(blocked.content).toContain("资料库");
    expect(blocked.summary).toContain("未采纳");

    await decideLibrary([SOURCE], "rejected", options());
    const rejected = await toolNamed("read_document").execute({ id: `资料库/${SOURCE}` }, context);
    expect(rejected.content).toContain("已被拒绝");
  });

  it("④ 采纳后的网页存档能读出正文——标签剥掉，脚本与样式不混进来（CP-6）", async () => {
    await decideLibrary([REPORT], "adopted", options());
    clearDocumentCache();
    const read = await toolNamed("read_document").execute({ id: `资料库/${REPORT}` }, context);
    expect(read.ok).toBe(true);
    expect(read.content).toContain("800V 直流母线与液冷回路");
    expect(read.content).not.toContain("<p>");
    expect(read.content).not.toContain("p{}");
  });

  it("⑤ 撤回采纳后立刻又读不到了——闸是活的，不是一次性的", async () => {
    await decideLibrary([REPORT], "adopted", options());
    clearDocumentCache();
    expect((await toolNamed("read_document").execute({ id: `资料库/${REPORT}` }, context)).ok).toBe(true);

    await decideLibrary([REPORT], "pending", options());
    clearDocumentCache();
    const after = await toolNamed("read_document").execute({ id: `资料库/${REPORT}` }, context);
    expect(after.ok).toBe(false);
    expect(after.content).toContain("待采纳");
  });
});
