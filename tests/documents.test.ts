import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearDocumentCache,
  DocumentPathError,
  docxXmlToText,
  extractDocumentText,
  isReadableDocument,
  labelFor,
  listDocuments,
  parseRoots,
  resolveWithinRoots,
  searchDocuments,
  serializeRoots,
  validateRoot,
  type DocumentRoot,
} from "@/lib/documents";

/**
 * TEST-170 — the local original-document layer and its path guard
 * (REQ-F-110, REQ-NF-050; DEC-090; TASK-170). CR-20260912-local-documents.
 *
 * The guard is the filesystem twin of `url-guard`: everything is resolved through
 * `realpath` first and only then tested for containment, because a string check on an
 * unresolved path lets both `..` and symlinks walk straight out of the root.
 */

let dir: string;
let docsRoot: string;
let secretDir: string;
let roots: DocumentRoot[];

function write(rel: string, body: string): string {
  const full = join(docsRoot, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
  return full;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-jarvis-docs-"));
  docsRoot = join(dir, "资料");
  secretDir = join(dir, "私密");
  mkdirSync(docsRoot, { recursive: true });
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(join(secretDir, "credentials.txt"), "API_KEY=should-never-be-read", "utf8");
  roots = [{ label: "资料", path: docsRoot }];
  clearDocumentCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TEST-170 ① 路径守卫 (REQ-NF-050)", () => {
  it("`..` 走不出根目录——解析之后才比较，而不是比字符串", async () => {
    write("规格/整流柜.md", "# 整流柜\n额定容量 1200 kW。");
    await expect(resolveWithinRoots("资料/../私密/credentials.txt", roots)).rejects.toThrow(DocumentPathError);
    await expect(resolveWithinRoots("资料/规格/../../私密/credentials.txt", roots)).rejects.toThrow(DocumentPathError);
  });

  it("指向根外的符号链接被拒——这正是字符串前缀检查会放过的那一类", async () => {
    const linkPath = join(docsRoot, "外链.txt");
    try {
      symlinkSync(join(secretDir, "credentials.txt"), linkPath, "file");
    } catch {
      // Windows without developer mode cannot create symlinks; the guard is unchanged.
      return;
    }
    await expect(resolveWithinRoots("资料/外链.txt", roots)).rejects.toThrow(DocumentPathError);
    // And it is not even listed: a listing that showed it would disclose that it exists.
    const metas = await listDocuments(roots);
    expect(metas.map((meta) => meta.name)).not.toContain("外链.txt");
  });

  it("根名前缀相同的另一个目录不算「在根内」——docs 不包含 docs-private", async () => {
    const sibling = join(dir, "资料-private");
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "x.txt"), "secret", "utf8");
    // Reached from the 资料 root, this must not resolve, whatever the string looks like.
    await expect(resolveWithinRoots("资料/../资料-private/x.txt", roots)).rejects.toThrow(DocumentPathError);
  });

  it("未配置目录、目录名不存在、指向目录本身，各给各的说法而不是同一句「失败」", async () => {
    await expect(resolveWithinRoots("资料/x.md", [])).rejects.toThrow(/尚未配置/);
    await expect(resolveWithinRoots("不存在的库/x.md", roots)).rejects.toThrow(/没有名为/);
    mkdirSync(join(docsRoot, "子目录"), { recursive: true });
    await expect(resolveWithinRoots("资料/子目录", roots)).rejects.toThrow(/是目录/);
  });

  it("拒绝越界时不回显目标的真实位置", async () => {
    try {
      await resolveWithinRoots("资料/../私密/credentials.txt", roots);
      throw new Error("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(secretDir);
      expect(message).not.toContain("credentials");
    }
  });

  it("正常路径解析成功，并返回相对路径（不是绝对路径）", async () => {
    write("规格/整流柜.md", "# 整流柜");
    const resolved = await resolveWithinRoots("资料/规格/整流柜.md", roots);
    expect(resolved.relPath).toBe("规格/整流柜.md");
    expect(resolved.root.label).toBe("资料");
  });
});

describe("TEST-170 ② 遍历与格式 (REQ-F-110)", () => {
  it("只列可读格式，跳过隐藏文件与 node_modules 这类目录", async () => {
    write("规格/整流柜.md", "a");
    write("论文/液冷.txt", "b");
    write("图片/机房.png", "c");
    write(".隐藏/私货.md", "d");
    write("node_modules/pkg/readme.md", "e");
    const metas = await listDocuments(roots);
    const ids = metas.map((meta) => meta.id);
    expect(ids).toContain("资料/规格/整流柜.md");
    expect(ids).toContain("资料/论文/液冷.txt");
    expect(ids).not.toContain("资料/图片/机房.png");
    expect(ids.some((id) => id.includes("隐藏"))).toBe(false);
    expect(ids.some((id) => id.includes("node_modules"))).toBe(false);
  });

  it("标识用「目录名/相对路径」，从不外泄绝对路径", async () => {
    write("规格/整流柜.md", "a");
    const metas = await listDocuments(roots);
    for (const meta of metas) {
      expect(meta.id.startsWith("资料/")).toBe(true);
      expect(meta.id).not.toContain(dir);
    }
  });

  it("docx 的 XML 被还原为带换行的正文", () => {
    const xml =
      "<w:document><w:body><w:p><w:r><w:t>供电架构</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>额定容量 </w:t></w:r><w:r><w:t>1200 kW</w:t></w:r></w:p></w:body></w:document>";
    const text = docxXmlToText(xml);
    expect(text).toContain("供电架构");
    // Runs inside one paragraph join up; paragraphs stay on separate lines.
    expect(text).toContain("额定容量 1200 kW");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("扩展名判定认得 PDF / docx / 文本，不认图片", () => {
    expect(isReadableDocument("a.pdf")).toBe(true);
    expect(isReadableDocument("a.DOCX")).toBe(true);
    expect(isReadableDocument("a.md")).toBe(true);
    expect(isReadableDocument("a.png")).toBe(false);
    expect(isReadableDocument("a.doc")).toBe(false);
  });

  it("扩展名是 .pdf 但文件头不是 PDF → 明确报错，而不是当文本读出乱码", async () => {
    const path = write("假的.pdf", "这其实是纯文本");
    await expect(extractDocumentText(path, 30)).rejects.toThrow(/文件头不是 PDF/);
  });
});

describe("TEST-170 ③ 检索 (REQ-F-110)", () => {
  it("按正文命中，并给出片段；命中来源标为正文", async () => {
    write("规格/整流柜.md", "# 整流柜\n本机柜采用液冷方案，额定容量 1200 kW。");
    write("规格/变压器.md", "# 变压器\n干式变压器，风冷。");
    const { hits, scanned } = await searchDocuments(roots, "液冷", 5);
    expect(scanned).toBe(2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe("资料/规格/整流柜.md");
    expect(hits[0]!.matched).toBe("content");
    expect(hits[0]!.snippet).toContain("液冷");
  });

  it("按文件名也能命中——正文读不出来的文件至少还找得到", async () => {
    write("论文/液冷散热综述.txt", "无关内容");
    const { hits } = await searchDocuments(roots, "液冷散热综述", 5);
    expect(hits.map((hit) => hit.id)).toContain("资料/论文/液冷散热综述.txt");
  });

  it("没命中时返回空，而不是硬塞一个最接近的", async () => {
    write("规格/整流柜.md", "液冷");
    const { hits } = await searchDocuments(roots, "完全无关的词汇xyzzy", 5);
    expect(hits).toHaveLength(0);
  });

  it("缓存按 mtime+size 失效：改了内容再检索能读到新内容", async () => {
    const path = write("规格/整流柜.md", "第一版内容 风冷");
    await searchDocuments(roots, "风冷", 5);
    // Same path, new content and a new mtime.
    await new Promise((done) => setTimeout(done, 12));
    writeFileSync(path, "第二版内容 液冷", "utf8");
    const { hits } = await searchDocuments(roots, "液冷", 5);
    expect(hits.map((hit) => hit.id)).toContain("资料/规格/整流柜.md");
  });
});

describe("TEST-170 ④ 配置 (REQ-F-110)", () => {
  it("目录校验：相对路径、不存在、指向文件，各自被拒且说明原因", async () => {
    expect(await validateRoot("相对/路径")).toMatchObject({ ok: false });
    expect(await validateRoot(join(dir, "不存在"))).toMatchObject({ ok: false });
    const file = write("规格/整流柜.md", "a");
    expect(await validateRoot(file)).toMatchObject({ ok: false, message: expect.stringContaining("文件夹") });
    expect(await validateRoot(docsRoot)).toMatchObject({ ok: true });
  });

  it("配置的读写是对称的，坏 JSON 退化为空而不是抛异常", () => {
    const value = serializeRoots(roots);
    expect(parseRoots(value)).toEqual(roots);
    expect(parseRoots("不是 JSON")).toEqual([]);
    expect(parseRoots(null)).toEqual([]);
    expect(parseRoots('[{"label":"","path":"/x"}]')).toEqual([]);
  });

  it("目录名重复时自动去重，避免两个根共用一个标识", () => {
    expect(labelFor("/a/资料", [])).toBe("资料");
    expect(labelFor("/b/资料", ["资料"])).toBe("资料-2");
  });
});
