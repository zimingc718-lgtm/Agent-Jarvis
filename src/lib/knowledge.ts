import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { estimateTokens } from "./adapters";

/**
 * Local knowledge base (REQ-F-044..046, REQ-NF-013, DEC-031; CR-20260911-knowledge-base).
 *
 * Knowledge is a folder of Markdown files, one entry per file, with a three-line
 * frontmatter. Not a table. Three reasons, all of them about the user rather than us:
 * the files are readable and editable with anything; dropping a `.md` into the folder
 * *is* adding knowledge; and rolling the feature back leaves a folder of notes rather
 * than a schema to migrate down — so the door stays two-way (DEC-021 ①).
 *
 * Retrieval is BM25 over CJK bigrams plus Latin words, written here in ~60 lines rather
 * than pulled in as a dependency: the architecture treats a new runtime dependency as an
 * L3 change, and a few hundred notes do not need more than this.
 *
 * Model-proposed entries land in `pending/` and are excluded from retrieval until the
 * user adopts them (REQ-F-046 ③) — that is the minimal approval mechanism the
 * A-phase non-goals demanded before any write-class tool could ship.
 */

export const KNOWLEDGE_ROOT = process.env.JARVIS_KNOWLEDGE_PATH ?? join(process.cwd(), ".data", "knowledge");
export const PENDING_DIR = "pending";
/** What a dropped file may be to count as a note (REQ-F-046 ①). */
export const KNOWLEDGE_TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];
/** One entry's body; a note, not a book (REQ-NF-013 ②). */
export const MAX_ENTRY_BYTES = 64 * 1024;
export const MAX_TITLE_CHARS = 120;
const MAX_NAME_CHARS = 60;

export type KnowledgeSummary = {
  /** File stem; the id the tools and the API use. */
  name: string;
  title: string;
  /** `manual` | `file` | `conversation` | `model`; free text tolerated for hand-written files. */
  source: string;
  createdAt: string;
  bytes: number;
};

export type KnowledgeEntry = KnowledgeSummary & { content: string };

export class KnowledgeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 = 400
  ) {
    super(message);
    this.name = "KnowledgeError";
  }
}

// ---------------------------------------------------------------- names & paths

/** Filesystem-safe stem: keeps letters (any script), digits, `-` and `_`. */
export function slugifyKnowledgeName(raw: string): string {
  const slug = raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_CHARS)
    .replace(/-+$/g, "");
  return slug;
}

function isSafeName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_CHARS && /^[\p{L}\p{N}_-]+$/u.test(name);
}

/** Second line of defence behind the slug: nothing may escape the root (REQ-NF-013 ①). */
function assertInside(root: string, target: string): void {
  const rootAbs = resolve(root);
  const targetAbs = resolve(target);
  if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) {
    throw new KnowledgeError("知识条目路径越界", 400);
  }
}

function entryPath(root: string, name: string, pending = false): string {
  if (!isSafeName(name)) {
    throw new KnowledgeError(`非法的条目名称「${name}」`, 400);
  }
  const path = pending ? join(root, PENDING_DIR, `${name}.md`) : join(root, `${name}.md`);
  assertInside(root, path);
  return path;
}

export function isKnowledgeTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  return KNOWLEDGE_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ---------------------------------------------------------------- file format

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function renderEntryFile(entry: { title: string; source: string; createdAt: string; content: string }): string {
  const title = entry.title.replace(/\r?\n/g, " ").trim();
  return `---\ntitle: ${title}\nsource: ${entry.source}\ncreated: ${entry.createdAt}\n---\n\n${entry.content.trim()}\n`;
}

/**
 * Parse an entry file. Hand-written files without frontmatter are welcome: the title
 * falls back to the first heading, then the first line, then the file name.
 */
export function parseEntryFile(raw: string, fallback: { name: string; createdAt: string }): Omit<KnowledgeEntry, "name" | "bytes"> {
  const text = raw.replace(/^﻿/, "");
  const match = FRONTMATTER.exec(text);
  const meta: Record<string, string> = {};
  let body = text;
  if (match) {
    body = text.slice(match[0].length);
    for (const line of match[1].split(/\r?\n/)) {
      const at = line.indexOf(":");
      if (at > 0) {
        meta[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
      }
    }
  }
  const content = body.trim();
  const heading = /^#{1,6}\s+(.+)$/m.exec(content)?.[1]?.trim();
  const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const title = (meta.title || heading || firstLine || fallback.name).slice(0, MAX_TITLE_CHARS);
  return {
    title,
    source: meta.source || "file",
    createdAt: meta.created || fallback.createdAt,
    content,
  };
}

// ---------------------------------------------------------------- CRUD

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((file) => file.toLowerCase().endsWith(".md")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readEntryAt(path: string, name: string): Promise<KnowledgeEntry | null> {
  let raw: string;
  let info: { mtime: Date; size: number };
  try {
    [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = parseEntryFile(raw, { name, createdAt: info.mtime.toISOString() });
  return { name, bytes: info.size, ...parsed };
}

async function listEntries(dir: string): Promise<KnowledgeEntry[]> {
  const files = await listDir(dir);
  const entries = await Promise.all(
    files.map((file) => {
      const name = file.slice(0, -3);
      return isSafeName(name) ? readEntryAt(join(dir, file), name) : Promise.resolve(null);
    })
  );
  return entries
    .filter((entry): entry is KnowledgeEntry => entry !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.name.localeCompare(b.name)));
}

const summarize = ({ content: _content, ...summary }: KnowledgeEntry): KnowledgeSummary => summary;

export async function listKnowledge(root: string = KNOWLEDGE_ROOT): Promise<KnowledgeSummary[]> {
  return (await listEntries(root)).map(summarize);
}

export async function listPending(root: string = KNOWLEDGE_ROOT): Promise<KnowledgeSummary[]> {
  return (await listEntries(join(root, PENDING_DIR))).map(summarize);
}

export async function readKnowledge(name: string, root: string = KNOWLEDGE_ROOT): Promise<KnowledgeEntry | null> {
  if (!isSafeName(name)) {
    return null;
  }
  return readEntryAt(entryPath(root, name), name);
}

export type SaveKnowledgeInput = {
  title?: string;
  content: string;
  source: string;
  /** Model proposals go here and stay out of retrieval until adopted (REQ-F-046 ③). */
  pending?: boolean;
  /** Preferred stem, e.g. a dropped file's name. */
  preferredName?: string;
  now?: () => Date;
};

async function uniqueName(dir: string, base: string): Promise<string> {
  const taken = new Set((await listDir(dir)).map((file) => file.slice(0, -3)));
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, MAX_NAME_CHARS - 4)}-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new KnowledgeError("同名条目过多", 409);
}

export async function saveKnowledge(input: SaveKnowledgeInput, root: string = KNOWLEDGE_ROOT): Promise<KnowledgeSummary> {
  const content = input.content.replace(/\r\n/g, "\n").trim();
  if (!content) {
    throw new KnowledgeError("知识内容为空，未保存。", 400);
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_ENTRY_BYTES) {
    throw new KnowledgeError(`知识内容超过 ${Math.floor(MAX_ENTRY_BYTES / 1024)}KB，未保存。请拆分后再存。`, 413);
  }
  const firstLine = content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() ?? "";
  const title = (input.title?.trim() || firstLine || "未命名").slice(0, MAX_TITLE_CHARS);
  const createdAt = (input.now ?? (() => new Date()))().toISOString();

  const dir = input.pending ? join(root, PENDING_DIR) : root;
  await mkdir(dir, { recursive: true });
  const base = slugifyKnowledgeName(input.preferredName || title) || `entry-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
  const name = await uniqueName(dir, base);
  const path = entryPath(root, name, input.pending);
  await writeFile(path, renderEntryFile({ title, source: input.source, createdAt, content }), { encoding: "utf8", flag: "wx" });
  return { name, title, source: input.source, createdAt, bytes };
}

export async function deleteKnowledge(name: string, root: string = KNOWLEDGE_ROOT): Promise<boolean> {
  if (!isSafeName(name)) {
    return false;
  }
  const path = entryPath(root, name);
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** Move a model proposal into the searchable set (REQ-F-046 ③). */
export async function adoptPending(name: string, root: string = KNOWLEDGE_ROOT): Promise<KnowledgeSummary | null> {
  if (!isSafeName(name)) {
    return null;
  }
  const from = entryPath(root, name, true);
  const entry = await readEntryAt(from, name);
  if (!entry) {
    return null;
  }
  const target = await uniqueName(root, name);
  await rename(from, entryPath(root, target));
  return { ...summarize(entry), name: target };
}

export async function discardPending(name: string, root: string = KNOWLEDGE_ROOT): Promise<boolean> {
  if (!isSafeName(name)) {
    return false;
  }
  try {
    await rm(entryPath(root, name, true));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------- retrieval (pure part)

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/u;

/**
 * CJK runs become character bigrams (a lone character stays a unigram); everything
 * else splits into lower-cased word tokens. No dictionary, no dependency, and good
 * enough that a distinctive phrase finds its note — see EV-2026-09-11-knowledge-base §1.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  let cjkRun = "";
  const flushLatin = () => {
    if (latin.length >= 1) {
      tokens.push(latin);
    }
    latin = "";
  };
  const flushCjk = () => {
    if (cjkRun.length === 1) {
      tokens.push(cjkRun);
    }
    for (let i = 0; i + 1 < cjkRun.length; i += 1) {
      tokens.push(cjkRun.slice(i, i + 2));
    }
    cjkRun = "";
  };
  for (const char of text.normalize("NFKC").toLowerCase()) {
    if (CJK.test(char)) {
      flushLatin();
      cjkRun += char;
    } else if (/[\p{L}\p{N}]/u.test(char)) {
      flushCjk();
      latin += char;
    } else {
      flushLatin();
      flushCjk();
    }
  }
  flushLatin();
  flushCjk();
  return tokens;
}

export type IndexedDoc = { id: string; tokens: string[] };

/** Classic BM25 (k1 = 1.5, b = 0.75). Returns only docs with a positive score, best first. */
export function rankBm25(docs: IndexedDoc[], query: string[], k1 = 1.5, b = 0.75): Array<{ id: string; score: number }> {
  if (docs.length === 0 || query.length === 0) {
    return [];
  }
  const avgLength = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length || 1;
  const frequencies = docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const token of doc.tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    return tf;
  });
  const uniqueQuery = [...new Set(query)];
  const idf = new Map<string, number>();
  for (const term of uniqueQuery) {
    const containing = frequencies.filter((tf) => tf.has(term)).length;
    idf.set(term, Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5)));
  }
  const scored = docs.map((doc, index) => {
    const tf = frequencies[index];
    let score = 0;
    for (const term of uniqueQuery) {
      const f = tf.get(term) ?? 0;
      if (f === 0) {
        continue;
      }
      const norm = f + k1 * (1 - b + (b * doc.tokens.length) / avgLength);
      score += (idf.get(term) ?? 0) * ((f * (k1 + 1)) / norm);
    }
    return { id: doc.id, score };
  });
  return scored.filter((hit) => hit.score > 0).sort((a, b2) => b2.score - a.score || a.id.localeCompare(b2.id));
}

/** A short window around the first query hit, so the model can judge relevance without reading the file. */
export function snippetFor(content: string, query: string[], maxChars = 160): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of [...query].sort((a, b) => b.length - a.length)) {
    const found = lower.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) {
      at = found;
    }
  }
  if (at < 0) {
    return flat.slice(0, maxChars) + (flat.length > maxChars ? "…" : "");
  }
  const start = Math.max(0, at - Math.floor(maxChars / 3));
  const end = Math.min(flat.length, start + maxChars);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

// ---------------------------------------------------------------- retrieval (over the folder)

export type KnowledgeHit = { name: string; title: string; score: number; snippet: string };

type IndexCache = { signature: string; entries: KnowledgeEntry[]; docs: IndexedDoc[] };
const indexCache = new Map<string, IndexCache>();

async function signatureOf(root: string): Promise<string> {
  const files = await listDir(root);
  const stamps = await Promise.all(files.map((file) => stat(join(root, file)).then((s) => `${file}:${s.mtimeMs}:${s.size}`)));
  return stamps.join("|");
}

/** Reads the folder only when something in it changed; a search on an unchanged folder costs no I/O beyond one readdir + stat sweep. */
async function indexFor(root: string): Promise<IndexCache> {
  const signature = await signatureOf(root);
  const cached = indexCache.get(root);
  if (cached && cached.signature === signature) {
    return cached;
  }
  const entries = await listEntries(root);
  const docs = entries.map((entry) => ({ id: entry.name, tokens: tokenize(`${entry.title}\n${entry.content}`) }));
  const next = { signature, entries, docs };
  indexCache.set(root, next);
  return next;
}

export async function searchKnowledge(query: string, limit = 5, root: string = KNOWLEDGE_ROOT): Promise<KnowledgeHit[]> {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return [];
  }
  const index = await indexFor(root);
  const byName = new Map(index.entries.map((entry) => [entry.name, entry]));
  return rankBm25(index.docs, terms)
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map((hit) => {
      const entry = byName.get(hit.id)!;
      return { name: entry.name, title: entry.title, score: hit.score, snippet: snippetFor(entry.content, terms) };
    });
}

/** Token estimate of an entry body, for the tool-result sub-budget (REQ-NF-013 ③). */
export function entryTokens(entry: KnowledgeEntry): number {
  return estimateTokens(entry.content);
}
