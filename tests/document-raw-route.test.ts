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
  return { ...actual, convertToHtml: vi.fn() };
});

const { getServerSession } = await import("next-auth");
const { convertToHtml } = await import("@/lib/markitdown");
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
});
