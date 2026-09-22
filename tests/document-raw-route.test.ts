import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-445 — `/api/documents/raw`（REQ-F-032 ⑤；CR-20260915-document-display CP-1）。
 *
 * 环境变量必须在 import 之前设好：资料库根与知识库根是模块级常量，加载那一刻就定死了。
 * 资料库夹具目录用 ASCII 名——理由同 `library-routes.test.ts`：中文名反复 rmSync(recursive)
 * 会拖垮 vitest 的 worker。
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-doc-raw-"));
const libRoot = join(dir, "lib-root");
process.env.JARVIS_LIBRARY_PATH = libRoot;
process.env.JARVIS_LIBRARY_STATE_PATH = join(dir, "state");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_DB_PATH = join(dir, "doc-raw.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/markitdown", async () => {
  const actual = await vi.importActual<typeof import("@/lib/markitdown")>("@/lib/markitdown");
  return { ...actual, convertToHtml: vi.fn(), convertToMarkdown: vi.fn(), renderMarkdown: vi.fn() };
});
// 只替换真正会调模型的 formatDocument；resolveFormatterSkill / SETTING_FORMAT_SKILL 用真实实现，
// 这样「设置指向已删除技能」这条路径走的是真代码（CR-20260921-format-skill CP-4）。
vi.mock("@/lib/document-format", async () => {
  const actual = await vi.importActual<typeof import("@/lib/document-format")>("@/lib/document-format");
  return { ...actual, formatDocument: vi.fn() };
});

const { getServerSession } = await import("next-auth");
const { convertToHtml, convertToMarkdown, renderMarkdown } = await import("@/lib/markitdown");
const { formatDocument, SETTING_FORMAT_SKILL } = await import("@/lib/document-format");
const rawRoute = await import("@/app/api/documents/raw/route");
const { getStore } = await import("@/lib/store-singleton");
const { clearDocumentCache, serializeRoots, SETTING_DOCUMENT_ROOTS } = await import("@/lib/documents");
const { decideLibrary } = await import("@/lib/library");

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function get(id: string): Request {
  return new Request(`http://test/api/documents/raw?id=${encodeURIComponent(id)}`);
}

function libraryOptions() {
  return { root: libRoot, stateDir: join(dir, "state"), knowledgeRoot: join(dir, "knowledge") };
}

let docsRoot: string;

beforeEach(() => {
  as("owner@example.com");
  vi.mocked(convertToHtml).mockReset();
  vi.mocked(convertToMarkdown).mockReset();
  vi.mocked(renderMarkdown).mockReset();
  vi.mocked(formatDocument).mockReset();
  getStore().setSetting(SETTING_FORMAT_SKILL, null);
  rmSync(libRoot, { recursive: true, force: true });
  docsRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-doc-raw-cfg-"));
  mkdirSync(join(docsRoot, "规格"), { recursive: true });
  writeFileSync(join(docsRoot, "规格", "整流柜.md"), "# 整流柜\n原样字节。", "utf8");
  writeFileSync(join(docsRoot, "规格", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  getStore().setSetting(SETTING_DOCUMENT_ROOTS, serializeRoots([{ label: "资料", path: docsRoot }]));
  clearDocumentCache();
});

afterEach(() => {
  rmSync(docsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  delete process.env.JARVIS_LIBRARY_PATH;
  delete process.env.JARVIS_LIBRARY_STATE_PATH;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/documents/raw", () => {
  it("① 未登录 401", async () => {
    as(null);
    expect((await rawRoute.GET(get("资料/规格/整流柜.md"))).status).toBe(401);
  });

  it("② 配置目录里的文件按原样字节返回，Content-Type 对应扩展名", async () => {
    const response = await rawRoute.GET(get("资料/规格/整流柜.md"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("# 整流柜\n原样字节。");
  });

  it("③ 越界/不存在的标识 404，不回显真实路径", async () => {
    const escaped = await rawRoute.GET(get("../evil"));
    expect(escaped.status).toBe(404);
    const body = (await escaped.json()) as { message: string };
    expect(body.message).not.toContain(dir);

    const missing = await rawRoute.GET(get("资料/规格/不存在.md"));
    expect(missing.status).toBe(404);
  });

  it("④ 不在可读扩展名白名单里的文件被拒（400），即使它确实存在于配置目录内", async () => {
    const response = await rawRoute.GET(get("资料/规格/logo.png"));
    expect(response.status).toBe(400);
  });

  it("⑤ 资料库里未采纳的文件 403，采纳后转 HTML 显示（CR-20260921-markitdown-display）", async () => {
    mkdirSync(join(libRoot, "AIDC", "02_原文"), { recursive: true });
    writeFileSync(join(libRoot, "AIDC", "02_原文", "P1.pdf"), "%PDF-1.4 fake", "utf8");
    clearDocumentCache();

    const blocked = await rawRoute.GET(get("资料库/AIDC/02_原文/P1.pdf"));
    expect(blocked.status).toBe(403);
    expect(vi.mocked(convertToHtml)).not.toHaveBeenCalled();

    await decideLibrary(["AIDC/02_原文/P1.pdf"], "adopted", libraryOptions());
    clearDocumentCache();
    vi.mocked(convertToHtml).mockResolvedValue({ ok: true, html: "<h1>转换结果</h1><table><tr><td>1</td></tr></table>" });
    const shown = await rawRoute.GET(get("资料库/AIDC/02_原文/P1.pdf"));
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toContain("text/html");
    const body = await shown.text();
    expect(body).toContain("<h1>转换结果</h1>");
    expect(body).toContain("<table><tr><td>1</td></tr></table>");
    // 从未把原始字节（"%PDF-1.4 fake"）当正文吐回去——转换分支不该悄悄退回原样直传。
    expect(body).not.toContain("%PDF-1.4 fake");
  });

  it("⑥ `?raw=1` 绕过转换，拿到原始 PDF 字节（下载/另存为用）", async () => {
    mkdirSync(join(libRoot, "AIDC", "02_原文"), { recursive: true });
    writeFileSync(join(libRoot, "AIDC", "02_原文", "P1.pdf"), "%PDF-1.4 fake", "utf8");
    await decideLibrary(["AIDC/02_原文/P1.pdf"], "adopted", libraryOptions());
    clearDocumentCache();

    const response = await rawRoute.GET(
      new Request(`http://test/api/documents/raw?id=${encodeURIComponent("资料库/AIDC/02_原文/P1.pdf")}&raw=1`)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(await response.text()).toBe("%PDF-1.4 fake");
    expect(vi.mocked(convertToHtml)).not.toHaveBeenCalled();
  });

  it("⑦ 转换失败时如实报 502，不静默退回二进制字节，且指出 `raw=1` 出口", async () => {
    mkdirSync(join(libRoot, "AIDC", "02_原文"), { recursive: true });
    writeFileSync(join(libRoot, "AIDC", "02_原文", "P1.pdf"), "%PDF-1.4 fake", "utf8");
    await decideLibrary(["AIDC/02_原文/P1.pdf"], "adopted", libraryOptions());
    clearDocumentCache();
    vi.mocked(convertToHtml).mockResolvedValue({ ok: false, reason: "timeout" });

    const response = await rawRoute.GET(get("资料库/AIDC/02_原文/P1.pdf"));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { message: string; rawUrl: string };
    expect(body.message).toContain("超时");
    expect(body.rawUrl).toContain("raw=1");
  });

  it("⑧ 设置了排版技能：走 markdown→formatDocument→render，不再调 convertToHtml；排版完整时无页顶提示（CR-20260921-format-skill）", async () => {
    mkdirSync(join(libRoot, "AIDC", "02_原文"), { recursive: true });
    writeFileSync(join(libRoot, "AIDC", "02_原文", "P1.pdf"), "%PDF-1.4 fake", "utf8");
    await decideLibrary(["AIDC/02_原文/P1.pdf"], "adopted", libraryOptions());
    clearDocumentCache();
    const record = getStore().insertSkill("owner@example.com", { name: "排版", description: "d", dirPath: docsRoot });
    getStore().setSetting(SETTING_FORMAT_SKILL, record.id);

    vi.mocked(convertToMarkdown).mockResolvedValue({ ok: true, markdown: "原始 markdown" });
    vi.mocked(formatDocument).mockResolvedValue({
      markdown: "# 排好了",
      status: "formatted",
      note: "",
      chunks: 1,
      keptVerbatim: 0,
    });
    vi.mocked(renderMarkdown).mockResolvedValue({ ok: true, html: "<h1>排好了</h1>" });

    const response = await rawRoute.GET(get("资料库/AIDC/02_原文/P1.pdf"));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("<h1>排好了</h1>");
    expect(body).not.toContain('role="status"');
    expect(vi.mocked(convertToHtml)).not.toHaveBeenCalled();
    // 传给排版的是 markitdown 的 Markdown 与解析到的技能，不是别的东西。
    const call = vi.mocked(formatDocument).mock.calls[0]![0];
    expect(call.markdown).toBe("原始 markdown");
    expect(call.skill.id).toBe(record.id);
    // 渲染的是排版结果，不是抽取结果。
    expect(vi.mocked(renderMarkdown)).toHaveBeenCalledWith("# 排好了");
  });

  it("⑨ 设置指向已删除的技能：退回结构转换，并在页顶如实提示；partial/unformatted 的 note 同样上页顶", async () => {
    mkdirSync(join(libRoot, "AIDC", "02_原文"), { recursive: true });
    writeFileSync(join(libRoot, "AIDC", "02_原文", "P1.pdf"), "%PDF-1.4 fake", "utf8");
    await decideLibrary(["AIDC/02_原文/P1.pdf"], "adopted", libraryOptions());
    clearDocumentCache();

    getStore().setSetting(SETTING_FORMAT_SKILL, "deleted-skill");
    vi.mocked(convertToHtml).mockResolvedValue({ ok: true, html: "<p>结构转换</p>" });
    const stale = await rawRoute.GET(get("资料库/AIDC/02_原文/P1.pdf"));
    expect(stale.status).toBe(200);
    const staleBody = await stale.text();
    expect(staleBody).toContain("<p>结构转换</p>");
    expect(staleBody).toContain('role="status"');
    expect(staleBody).toContain("已不存在");
    expect(vi.mocked(formatDocument)).not.toHaveBeenCalled();

    // 技能存在但模型没排成：note 上页顶，正文仍是（未经排版的）渲染结果。
    // 名字与 ⑧ 不同：同一用户下技能名唯一（insertSkill 会拒绝重名），而两条用例共用同一个 sqlite。
    const record = getStore().insertSkill("owner@example.com", { name: "排版二", description: "d", dirPath: docsRoot });
    getStore().setSetting(SETTING_FORMAT_SKILL, record.id);
    vi.mocked(convertToMarkdown).mockResolvedValue({ ok: true, markdown: "原文" });
    vi.mocked(formatDocument).mockResolvedValue({
      markdown: "原文",
      status: "unformatted",
      note: "本次未经排版：当前没有可用的模型 Provider。",
      chunks: 0,
      keptVerbatim: 0,
    });
    vi.mocked(renderMarkdown).mockResolvedValue({ ok: true, html: "<p>原文</p>" });
    const unformatted = await rawRoute.GET(get("资料库/AIDC/02_原文/P1.pdf"));
    const unformattedBody = await unformatted.text();
    expect(unformattedBody).toContain("本次未经排版");
    expect(unformattedBody).toContain("<p>原文</p>");
  });
});
