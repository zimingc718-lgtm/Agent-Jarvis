import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { extractPdfText, looksLikePdf } from "./pdf-text";
import { rankBm25, snippetFor, tokenize, type IndexedDoc } from "./knowledge";
import { readZipEntries } from "./zip";
import { htmlToMarkdown } from "./html-text";

/**
 * The local original-document layer (REQ-F-110, DEC-090, TASK-170).
 *
 * The distinction that makes this a separate module from `knowledge.ts`: these are the
 * user's own files, read where they lie. Nothing is copied, rewritten or adopted. The
 * knowledge base is the opposite — curated entries the model proposes and the user accepts.
 * Conflating the two is what left the conversation with no way to reach a product
 * specification sitting in a folder on disk (EV-2026-09-12-local-documents §1).
 *
 * Read-only by construction: this module exports no writer. The only filesystem calls are
 * `readdir`, `stat`, `realpath` and `readFile`.
 */

/** Where the user keeps documents. JSON array of absolute paths, empty when unset. */
export const SETTING_DOCUMENT_ROOTS = "documents.roots";

/** Extensions we can turn into text without adding a dependency. */
export const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".log", ".xml", ".yaml", ".yml"];
export const PDF_EXTENSIONS = [".pdf"];
export const OFFICE_EXTENSIONS = [".docx"];
/**
 * 网页存档（CR-20260915-library-adoption CP-6）。
 *
 * 此前 .html 不在可读之列，于是资料库 258 个文件里的 139 份网页存档在「对话查阅」里
 * 根本不存在——用户会以为审过的东西模型读得到，其实半个资料库是哑的。标签由
 * `html-text.ts` 剥掉，取正文而不是取源码。
 */
export const HTML_EXTENSIONS = [".html", ".htm"];
export const READABLE_EXTENSIONS = [...TEXT_EXTENSIONS, ...HTML_EXTENSIONS, ...PDF_EXTENSIONS, ...OFFICE_EXTENSIONS];

/** Per-file ceilings. A PDF is routinely larger than a page, so it gets its own. */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_BYTES = 24 * 1024 * 1024;
export const MAX_DOCX_BYTES = 24 * 1024 * 1024;

/** Traversal ceilings, so a root pointed at a whole disk cannot hang a turn. */
export const MAX_WALK_FILES = 5_000;
export const MAX_WALK_DEPTH = 8;
/** How many bytes one `search_documents` call may spend extracting text it has not cached. */
export const SEARCH_EXTRACT_BUDGET_BYTES = 48 * 1024 * 1024;

/** Directories that are never worth walking and are large when present. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".venv", "venv",
  ".next", "dist", "build", ".cache", "$RECYCLE.BIN", "System Volume Information",
]);

export class DocumentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPathError";
  }
}

export type DocumentRoot = { label: string; path: string };

export type DocumentMeta = {
  /** `<label>/<relative path>` — stable, human-readable, and never an absolute path. */
  id: string;
  root: string;
  relPath: string;
  name: string;
  ext: string;
  bytes: number;
  modifiedAt: string;
};

export type DocumentText = {
  text: string;
  /** True when the extractor stopped at a ceiling rather than at the end of the file. */
  truncated: boolean;
  kind: "text" | "pdf" | "docx";
  /** Content streams read, when the source was a PDF. Diagnostics only. */
  streams?: number;
};

export type DocumentHit = DocumentMeta & { score: number; snippet: string; matched: "name" | "content" };

export function parseRoots(raw: string | null | undefined): DocumentRoot[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((row): row is DocumentRoot =>
        typeof row === "object" && row !== null &&
        typeof (row as DocumentRoot).path === "string" && typeof (row as DocumentRoot).label === "string")
      .map((row) => ({ label: row.label.trim(), path: row.path }))
      .filter((row) => row.label.length > 0 && row.path.length > 0);
  } catch {
    return [];
  }
}

export function serializeRoots(roots: DocumentRoot[]): string {
  return JSON.stringify(roots);
}

/** A label that can sit in front of a `/` without being mistaken for a path segment. */
export function labelFor(path: string, taken: string[] = []): string {
  const base = basename(path.replace(/[\\/]+$/, "")) || "docs";
  const clean = base.replace(/[\\/:*?"<>|]/g, "").trim() || "docs";
  if (!taken.includes(clean)) {
    return clean;
  }
  for (let n = 2; n < 100; n += 1) {
    if (!taken.includes(`${clean}-${n}`)) {
      return `${clean}-${n}`;
    }
  }
  return `${clean}-${Date.now()}`;
}

export async function validateRoot(raw: string): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "路径为空。" };
  }
  if (!isAbsolute(trimmed)) {
    return { ok: false, message: "请填绝对路径。" };
  }
  let real: string;
  try {
    real = await realpath(trimmed);
  } catch {
    return { ok: false, message: "路径不存在，或当前账户没有访问权限。" };
  }
  const info = await stat(real);
  if (!info.isDirectory()) {
    return { ok: false, message: "请指向一个文件夹，而不是单个文件。" };
  }
  return { ok: true, path: real };
}

/**
 * The filesystem twin of `url-guard`'s address check (REQ-NF-050 ①②).
 *
 * `realpath` first, containment second. Resolving before comparing is what defeats `..`
 * and symlinks alike — a symlink inside a root that points at `C:\Users\...\.ssh` resolves
 * outside the root and is refused here, where a string-prefix check on the unresolved path
 * would have let it through.
 *
 * Containment is decided with `relative()` rather than `startsWith`, because a root
 * `/srv/docs` must not appear to contain `/srv/docs-private`.
 */
export async function resolveWithinRoots(id: string, roots: DocumentRoot[]): Promise<{ absPath: string; root: DocumentRoot; relPath: string }> {
  if (roots.length === 0) {
    throw new DocumentPathError("尚未配置任何文档目录。请在 ☰ 菜单「本地文档」中添加一个文件夹。");
  }
  const trimmed = id.trim().replace(/\\/g, "/");
  if (!trimmed) {
    throw new DocumentPathError("文档标识为空。");
  }
  if (trimmed.includes("\0")) {
    throw new DocumentPathError("文档标识含有非法字符。");
  }

  const slash = trimmed.indexOf("/");
  const label = slash < 0 ? trimmed : trimmed.slice(0, slash);
  const rest = slash < 0 ? "" : trimmed.slice(slash + 1);
  const root = roots.find((candidate) => candidate.label === label);
  if (!root) {
    const names = roots.map((candidate) => candidate.label).join("、");
    throw new DocumentPathError(`没有名为「${label}」的文档目录。当前已配置：${names}。标识形如「${roots[0]!.label}/子目录/文件.pdf」。`);
  }
  if (!rest) {
    throw new DocumentPathError(`「${label}」是目录本身，不是文件。用 list_documents 看看里面有什么。`);
  }

  let rootReal: string;
  try {
    rootReal = await realpath(root.path);
  } catch {
    throw new DocumentPathError(`文档目录「${label}」已不可访问（可能被移动或所在磁盘未挂载）。`);
  }

  let absReal: string;
  try {
    absReal = await realpath(resolve(rootReal, rest));
  } catch {
    throw new DocumentPathError(`「${trimmed}」不存在。用 search_documents 或 list_documents 确认名称。`);
  }

  const rel = relative(rootReal, absReal);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    // The one message that must not leak where the target actually is.
    throw new DocumentPathError("该路径解析后落在已配置的文档目录之外，已拒绝。");
  }
  const info = await stat(absReal);
  if (!info.isFile()) {
    throw new DocumentPathError(`「${trimmed}」是目录，不是文件。用 list_documents 看看里面有什么。`);
  }
  return { absPath: absReal, root, relPath: rel.split(sep).join("/") };
}

export function isReadableDocument(path: string): boolean {
  return READABLE_EXTENSIONS.includes(extname(path).toLowerCase());
}

async function walk(root: DocumentRoot, budget: { files: number }): Promise<DocumentMeta[]> {
  let rootReal: string;
  try {
    rootReal = await realpath(root.path);
  } catch {
    return [];
  }
  const found: DocumentMeta[] = [];

  async function descend(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH || budget.files <= 0) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable subfolder: skip it rather than fail the whole listing.
    }
    for (const entry of entries) {
      if (budget.files <= 0) {
        return;
      }
      // Symlinks are skipped outright during traversal. `resolveWithinRoots` would refuse
      // an escaping one at read time anyway, but listing it would still disclose that it
      // exists, and a symlink loop would make the walk unbounded.
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await descend(full, depth + 1);
        }
        continue;
      }
      if (!entry.isFile() || !isReadableDocument(entry.name)) {
        continue;
      }
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      budget.files -= 1;
      const rel = relative(rootReal, full).split(sep).join("/");
      found.push({
        id: `${root.label}/${rel}`,
        root: root.label,
        relPath: rel,
        name: entry.name,
        ext: extname(entry.name).toLowerCase(),
        bytes: info.size,
        modifiedAt: new Date(info.mtimeMs).toISOString(),
      });
    }
  }

  await descend(rootReal, 0);
  return found;
}

export async function listDocuments(roots: DocumentRoot[]): Promise<DocumentMeta[]> {
  const budget = { files: MAX_WALK_FILES };
  const all: DocumentMeta[] = [];
  for (const root of roots) {
    all.push(...(await walk(root, budget)));
  }
  return all.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.id.localeCompare(b.id));
}

/** `word/document.xml` with its tags stripped; paragraph and line breaks become newlines. */
export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:p\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractDocumentText(absPath: string, bytes: number): Promise<DocumentText> {
  const ext = extname(absPath).toLowerCase();

  if (HTML_EXTENSIONS.includes(ext)) {
    if (bytes > MAX_TEXT_BYTES) {
      throw new DocumentPathError(`网页存档超过 ${MAX_TEXT_BYTES / 1024 / 1024} MiB 上限，未读取。`);
    }
    const raw = await readFile(absPath, "utf8");
    const text = htmlToMarkdown(raw).trim();
    if (!text) {
      throw new DocumentPathError("这份网页存档里没有可读的正文（可能整页是脚本或图片）。");
    }
    return { text, truncated: false, kind: "text" };
  }

  if (PDF_EXTENSIONS.includes(ext)) {
    if (bytes > MAX_PDF_BYTES) {
      throw new DocumentPathError(`PDF 超过 ${MAX_PDF_BYTES / 1024 / 1024} MiB 上限，未读取。`);
    }
    const buffer = await readFile(absPath);
    if (!looksLikePdf(buffer)) {
      throw new DocumentPathError("扩展名是 .pdf，但文件头不是 PDF。");
    }
    const extraction = extractPdfText(buffer);
    if (extraction.encrypted) {
      throw new DocumentPathError("这份 PDF 有加密保护，读不出文字。");
    }
    if (!extraction.text.trim()) {
      throw new DocumentPathError("这份 PDF 没有文字层——通常是扫描件（整页为图片）。本工具不做 OCR。");
    }
    return { text: extraction.text, truncated: false, kind: "pdf", streams: extraction.streams };
  }

  if (OFFICE_EXTENSIONS.includes(ext)) {
    if (bytes > MAX_DOCX_BYTES) {
      throw new DocumentPathError(`文档超过 ${MAX_DOCX_BYTES / 1024 / 1024} MiB 上限，未读取。`);
    }
    const buffer = await readFile(absPath);
    const { entries } = readZipEntries(buffer, { maxArchiveBytes: MAX_DOCX_BYTES });
    const body = entries.find((entry) => entry.path === "word/document.xml");
    if (!body) {
      throw new DocumentPathError("这不是一个标准的 .docx（找不到 word/document.xml）。旧的 .doc 二进制格式本工具读不了。");
    }
    const text = docxXmlToText(body.content.toString("utf8"));
    if (!text) {
      throw new DocumentPathError("这份 .docx 的正文是空的，或内容全在图片/嵌入对象里。");
    }
    return { text, truncated: false, kind: "docx" };
  }

  if (bytes > MAX_TEXT_BYTES) {
    const handle = await readFile(absPath);
    return { text: handle.subarray(0, MAX_TEXT_BYTES).toString("utf8"), truncated: true, kind: "text" };
  }
  return { text: await readFile(absPath, "utf8"), truncated: false, kind: "text" };
}

type CacheRow = { signature: string; tokens: string[]; text: string };
/** Extracted text, keyed by document id and invalidated by mtime+size. In memory only. */
const textCache = new Map<string, CacheRow>();

function signatureOf(meta: DocumentMeta): string {
  return `${meta.modifiedAt}:${meta.bytes}`;
}

export function clearDocumentCache(): void {
  textCache.clear();
}

/**
 * Filename matches are free; content matches cost an extraction. So names are always
 * scored, and content is scored over whatever is already cached plus as much new
 * extraction as `SEARCH_EXTRACT_BUDGET_BYTES` allows. A large folder therefore answers
 * immediately on the first call and gets better as the cache fills, instead of hanging.
 */
export async function searchDocuments(
  roots: DocumentRoot[],
  query: string,
  limit = 5
): Promise<{ hits: DocumentHit[]; scanned: number; indexed: number; pending: number }> {
  const terms = tokenize(query);
  const metas = await listDocuments(roots);
  if (terms.length === 0) {
    return { hits: [], scanned: metas.length, indexed: 0, pending: 0 };
  }

  let spent = 0;
  let pending = 0;
  const docs: IndexedDoc[] = [];
  const byId = new Map<string, DocumentMeta>();

  for (const meta of metas) {
    byId.set(meta.id, meta);
    const signature = signatureOf(meta);
    const cached = textCache.get(meta.id);
    if (cached && cached.signature === signature) {
      docs.push({ id: meta.id, tokens: cached.tokens });
      continue;
    }
    if (spent + meta.bytes > SEARCH_EXTRACT_BUDGET_BYTES) {
      pending += 1;
      continue;
    }
    spent += meta.bytes;
    try {
      const extracted = await extractDocumentText(await realpath(join(rootPathFor(roots, meta), meta.relPath)), meta.bytes);
      const tokens = tokenize(`${meta.name}\n${extracted.text}`);
      textCache.set(meta.id, { signature, tokens, text: extracted.text });
      docs.push({ id: meta.id, tokens });
    } catch {
      // Unreadable (scanned PDF, legacy .doc, permission denied): remember that it is
      // unreadable so the next search does not pay for it again.
      textCache.set(meta.id, { signature, tokens: tokenize(meta.name), text: "" });
      docs.push({ id: meta.id, tokens: tokenize(meta.name) });
    }
  }

  const ranked = rankBm25(docs, terms).slice(0, Math.max(1, Math.min(limit, 20)));
  const hits: DocumentHit[] = ranked
    .map((row) => {
      const meta = byId.get(row.id);
      if (!meta) {
        return null;
      }
      const body = textCache.get(meta.id)?.text ?? "";
      const inName = terms.some((term) => meta.name.toLowerCase().includes(term));
      return {
        ...meta,
        score: row.score,
        snippet: body ? snippetFor(body, terms) : "（这份文件没有可提取的文字，仅按文件名匹配）",
        matched: body && !inName ? ("content" as const) : ("name" as const),
      };
    })
    .filter((hit): hit is DocumentHit => hit !== null);

  return { hits, scanned: metas.length, indexed: docs.length, pending };
}

function rootPathFor(roots: DocumentRoot[], meta: DocumentMeta): string {
  return roots.find((root) => root.label === meta.root)?.path ?? "";
}
