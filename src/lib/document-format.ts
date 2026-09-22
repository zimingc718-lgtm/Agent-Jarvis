import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { estimateTokens } from "./adapters";
import { makeCompleter, readSkillDoc, type Completer } from "./skills";
import type { Store } from "./store";

/**
 * Optional model pass over an extracted document (REQ-F-290, DEC-400/401;
 * CR-20260921-format-skill).
 *
 * The user registers a skill through the ordinary skill intake — its SKILL.md *is* the
 * formatting rule — and names it as the formatter in 「本地文档」 settings. This module
 * feeds markitdown's Markdown to the active provider with that SKILL.md as the
 * instruction, chunk by chunk, and reassembles the result.
 *
 * What it reuses and what it deliberately does not (CR method option D): the skill's
 * registration and SKILL.md content, yes; the per-turn skill *routing* (`routeTurn`
 * matching a user message), no — a document view is one HTTP GET, not a chat turn.
 *
 * Fidelity is the risk the user accepted knowingly (INPUT-2026-09-21-002), so the guard
 * rails are deliberately conservative: a chunk whose output shrinks past
 * `MIN_OUTPUT_RATIO` is kept verbatim with a visible marker, never dropped; an overall
 * failure (no provider, every chunk failed) hands back the unformatted Markdown with
 * `status: "unformatted"` so the page can say so instead of quietly showing old behaviour.
 */

/** Which registered skill formats documents. Value = skill id; unset/empty = no model pass. */
export const SETTING_FORMAT_SKILL = "documents.formatSkill";

/** Cache of formatted Markdown, keyed by content — see `cacheKey`. Same `.data/` convention as `libraryStatePath`. */
export function formatCachePath(): string {
  return process.env.JARVIS_DOCUMENT_FORMAT_CACHE_PATH ?? join(process.cwd(), ".data", "document-format");
}

/** Input tokens per chunk. DeepSeek's single-response output cap is 8K; leave headroom for
 *  Markdown that grows under formatting (headings, list markers) and for the instruction. */
export const CHUNK_INPUT_TOKENS = 5_000;
/** Output cap per chunk request. */
export const CHUNK_MAX_TOKENS = 7_000;
export const CHUNK_TIMEOUT_MS = 90_000;
/** Below this output/input character ratio a chunk is judged to have lost content. */
export const MIN_OUTPUT_RATIO = 0.4;
/** Never send more than this many chunks for one document; beyond it the rest stays verbatim. */
export const MAX_CHUNKS = 40;

export const CHUNK_KEPT_MARKER = "> ⚠️ 本段未经排版（模型输出明显缩水，为避免丢内容保留原文）。";

const FORMAT_INSTRUCTION_TAIL =
  "\n\n---\n以上是排版规则。下面是一份由 PDF/DOCX 自动抽取出来的 Markdown 片段（可能是全文的一部分）。" +
  "请只做排版整理：恢复标题层级、合并被硬换行切碎的段落、修正表格、保留全部原文内容与顺序。" +
  "不要总结、不要删减、不要添加原文没有的内容、不要解释你做了什么。只输出整理后的 Markdown。";

export type FormatStatus = "formatted" | "partial" | "unformatted" | "cached";

export type FormatResult = {
  markdown: string;
  status: FormatStatus;
  /** Human-readable note for the page header; empty when fully formatted. */
  note: string;
  chunks: number;
  keptVerbatim: number;
};

export type FormatterSkill = { id: string; name: string; dirPath: string };

/** The configured formatter skill, or null when unset or when it no longer exists for this user. */
export function resolveFormatterSkill(store: Store, userId: string): { skill: FormatterSkill | null; stale: boolean } {
  const wanted = store.getSetting(SETTING_FORMAT_SKILL)?.trim();
  if (!wanted) {
    return { skill: null, stale: false };
  }
  const record = store.listSkills(userId).find((skill) => skill.id === wanted);
  if (!record) {
    return { skill: null, stale: true };
  }
  return { skill: { id: record.id, name: record.name, dirPath: record.dirPath }, stale: false };
}

export function cacheKey(input: { bytes: Buffer; skillId: string; model: string }): string {
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const skill = input.skillId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  const model = input.model.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
  return `${hash}--${skill}--${model}`;
}

type CacheRow = { markdown: string; status: FormatStatus; note: string; chunks: number; keptVerbatim: number };

async function readCache(dir: string, key: string): Promise<CacheRow | null> {
  try {
    const raw = await readFile(join(dir, `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheRow>;
    if (typeof parsed.markdown !== "string" || !parsed.markdown.trim()) {
      return null;
    }
    return {
      markdown: parsed.markdown,
      status: parsed.status === "partial" ? "partial" : "formatted",
      note: typeof parsed.note === "string" ? parsed.note : "",
      chunks: typeof parsed.chunks === "number" ? parsed.chunks : 0,
      keptVerbatim: typeof parsed.keptVerbatim === "number" ? parsed.keptVerbatim : 0,
    };
  } catch {
    // Missing or corrupt cache = miss. Recomputing costs a model call; serving a broken
    // cache would cost the user's trust.
    return null;
  }
}

async function writeCache(dir: string, key: string, row: CacheRow): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.json`), `${JSON.stringify(row, null, 2)}\n`, "utf8");
}

/**
 * Same algorithm and marker as `tools/budget.ts#truncateToTokens`, kept local on purpose:
 * `src/lib/*` → `src/lib/tools/**` is a frozen, exact allowlist (`scripts/check-module-graph.mjs`,
 * TEST module-graph), and a formatting helper is not a reason to grow it.
 */
function truncateToBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }
  let slice = text.slice(0, Math.max(1, maxTokens * 4));
  while (estimateTokens(slice) > maxTokens && slice.length > 1) {
    slice = slice.slice(0, Math.floor(slice.length * 0.9));
  }
  return `${slice}\n\n[内容超出预算，已截断]`;
}

/**
 * Split on blank lines, packing paragraphs until the token budget is reached. A single
 * oversized paragraph (a huge table) becomes its own chunk, truncated with a visible
 * marker rather than silently cut.
 */
export function chunkMarkdown(markdown: string, budgetTokens = CHUNK_INPUT_TOKENS): string[] {
  const blocks = markdown.split(/\n{2,}/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const block of blocks) {
    const tokens = estimateTokens(block) + 2;
    if (tokens > budgetTokens) {
      if (current.length > 0) {
        chunks.push(current.join("\n\n"));
        current = [];
        currentTokens = 0;
      }
      chunks.push(truncateToBudget(block, budgetTokens));
      continue;
    }
    if (currentTokens + tokens > budgetTokens && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(block);
    currentTokens += tokens;
  }
  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

export type FormatDocumentInput = {
  store: Store;
  userId: string;
  skill: FormatterSkill;
  /** Original file bytes — only used for the cache key. */
  bytes: Buffer;
  /** markitdown's Markdown for the file. */
  markdown: string;
  /** Test seam; defaults to the user's active provider. */
  completer?: Completer;
  /** Test seam; defaults to the active provider's `defaultModel`. */
  model?: string;
  cacheDir?: string;
};

/**
 * Format `markdown` per the skill's SKILL.md. Never throws: every failure mode is folded
 * into `status`/`note` so the route can always render *something* honest.
 */
export async function formatDocument(input: FormatDocumentInput): Promise<FormatResult> {
  const unformatted = (note: string): FormatResult => ({
    markdown: input.markdown,
    status: "unformatted",
    note,
    chunks: 0,
    keptVerbatim: 0,
  });

  let completer = input.completer;
  let model = input.model;
  if (!completer || !model) {
    const provider = input.store.resolveActiveProvider(input.userId);
    if (!provider) {
      return unformatted("本次未经排版：当前没有可用的模型 Provider。");
    }
    completer = completer ?? makeCompleter(provider);
    model = model ?? provider.defaultModel;
  }

  const cacheDir = input.cacheDir ?? formatCachePath();
  const key = cacheKey({ bytes: input.bytes, skillId: input.skill.id, model });
  const cached = await readCache(cacheDir, key);
  if (cached) {
    return { ...cached, status: "cached", note: cached.note };
  }

  const rule = await readSkillDoc(input.skill.dirPath);
  if (!rule) {
    return unformatted(`本次未经排版：排版技能「${input.skill.name}」的 SKILL.md 为空或不可读。`);
  }
  const system = `${rule}${FORMAT_INSTRUCTION_TAIL}`;

  const chunks = chunkMarkdown(input.markdown);
  const sent = chunks.slice(0, MAX_CHUNKS);
  const overflow = chunks.slice(MAX_CHUNKS);

  const out: string[] = [];
  let keptVerbatim = 0;
  let succeeded = 0;
  for (const chunk of sent) {
    let formatted = "";
    try {
      formatted = (await completer([{ role: "system", content: system }, { role: "user", content: chunk }], {
        maxTokens: CHUNK_MAX_TOKENS,
        timeoutMs: CHUNK_TIMEOUT_MS,
      })).trim();
    } catch {
      formatted = "";
    }
    if (!formatted || formatted.length < chunk.length * MIN_OUTPUT_RATIO) {
      out.push(`${CHUNK_KEPT_MARKER}\n\n${chunk}`);
      keptVerbatim += 1;
      continue;
    }
    out.push(formatted);
    succeeded += 1;
  }
  for (const chunk of overflow) {
    out.push(`${CHUNK_KEPT_MARKER}\n\n${chunk}`);
    keptVerbatim += 1;
  }

  if (succeeded === 0) {
    return unformatted("本次未经排版：模型对每一段的输出都不可用，已按原样显示。");
  }

  const status: FormatStatus = keptVerbatim > 0 ? "partial" : "formatted";
  const note =
    keptVerbatim > 0
      ? `已按排版技能「${input.skill.name}」整理，其中 ${keptVerbatim} 段因模型输出缩水而保留原文（页内有标注）。`
      : "";
  const row: CacheRow = { markdown: out.join("\n\n"), status, note, chunks: sent.length, keptVerbatim };
  try {
    await writeCache(cacheDir, key, row);
  } catch {
    // A cache write failure must not fail the view; the next open simply recomputes.
  }
  return row;
}
