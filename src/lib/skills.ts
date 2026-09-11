import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { SkillNameConflictError, type Store } from "./store";
import type { ChatMessage, ProviderRuntimeConfig } from "./types";

/** Where registered skill folders live on disk (CR-20260909-skills). Overridable for tests. */
export const SKILLS_ROOT = process.env.JARVIS_SKILLS_PATH ?? join(process.cwd(), ".data", "skills");

/**
 * Text file extensions a skill folder may contribute to the injected context
 * (REQ-F-020 ⑤). Widened from 11 to 16 by CR-20260910-skill-intake — files
 * outside this list are still stored verbatim, they just do not enter the
 * per-turn context, and the registration receipt now says so.
 */
export const SKILL_TEXT_EXTENSIONS = [
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".jsonl",
  ".csv",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".html",
  ".sh",
];

/** Total bytes of skill content injected into a single turn (REQ-F-022 ②). */
export const MAX_INJECTION_BYTES = 32 * 1024;
const TRUNCATION_NOTICE = "\n\n[技能内容超过 32KB，已截断]";

export type SkillSummary = { id: string; name: string; description: string };

/** A file collected from a dropped skill folder: a folder-relative path plus its text content. */
export type UploadedFile = { path: string; content: string };

/**
 * One non-streaming chat completion (DEC-016). Returns the assistant text.
 * A `null` completer means "no usable provider" — routing/generation then fail open.
 */
export type Completer = (
  messages: ChatMessage[],
  opts: { maxTokens: number; timeoutMs: number }
) => Promise<string>;


const GENERATE_SYSTEM =
  "You are given the raw contents of a skill folder. Write a SKILL.md that captures how to use this skill. " +
  "Reply with ONLY this exact shape:\n---\nname: <short skill name>\ndescription: <one sentence, what the skill does>\n---\n\n<instructions in Markdown>";

const GENERATE_CORPUS_LIMIT = 12_000;

/**
 * Build a completer around a resolved provider (CR-20260909-skills). Non-streaming,
 * small, no conversation history — an independent minimal call per DEC-016.
 */
export function makeCompleter(provider: ProviderRuntimeConfig, fetcher: typeof fetch = fetch): Completer {
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  return async (messages, opts) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (provider.secret) {
      headers.set("authorization", `Bearer ${provider.secret}`);
    }
    const response = await fetcher(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.defaultModel,
        stream: false,
        max_tokens: opts.maxTokens,
        messages,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Completion request failed (${response.status}).`);
    }
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  };
}

/**
 * Assemble the additional system segment for a turn that hit a skill (REQ-F-022):
 * SKILL.md body + every allowlisted text file in the folder, capped at 32KB.
 */
export async function resolveSkillForTurn(dirPath: string): Promise<string> {
  const parts: string[] = [];
  const skillMd = await readTextFile(join(dirPath, "SKILL.md"));
  if (skillMd != null) {
    parts.push(stripFrontmatter(skillMd).trim());
  }
  for (const relPath of await listSkillTextFiles(dirPath)) {
    const content = await readTextFile(join(dirPath, relPath));
    if (content != null) {
      parts.push(`\n\n=== ${relPath} ===\n${content}`);
    }
  }
  let assembled = parts.join("");
  if (Buffer.byteLength(assembled, "utf8") > MAX_INJECTION_BYTES) {
    assembled = truncateToBytes(assembled, MAX_INJECTION_BYTES - Buffer.byteLength(TRUNCATION_NOTICE, "utf8")) + TRUNCATION_NOTICE;
  }
  return assembled;
}

export type GeneratedSkillDoc = {
  name: string;
  description: string;
  body: string;
  /** false when the model output could not be parsed into frontmatter — the folder name is used. */
  docGenerated: boolean;
};

/**
 * Ask the model to write a SKILL.md for the dropped folder (REQ-F-020 ②④).
 * Any failure falls back to the folder name + "（未生成描述）".
 */
export async function generateSkillDoc(
  files: UploadedFile[],
  complete: Completer | null,
  fallbackName: string
): Promise<GeneratedSkillDoc> {
  const fallback: GeneratedSkillDoc = {
    name: fallbackName,
    description: "（未生成描述）",
    body: "",
    docGenerated: false,
  };
  if (!complete) {
    return fallback;
  }
  try {
    const corpus = files
      .filter((file) => isSkillTextPath(file.path))
      .map((file) => `=== ${file.path} ===\n${file.content}`)
      .join("\n\n")
      .slice(0, GENERATE_CORPUS_LIMIT);
    const raw = await complete(
      [
        { role: "system", content: GENERATE_SYSTEM },
        { role: "user", content: corpus || "(the folder has no readable text files)" },
      ],
      { maxTokens: 800, timeoutMs: 30_000 }
    );
    const frontmatter = parseFrontmatter(raw);
    if (!frontmatter?.name) {
      return { ...fallback, body: raw.trim() };
    }
    return {
      name: frontmatter.name,
      description: frontmatter.description || "（未生成描述）",
      body: frontmatter.body.trim(),
      docGenerated: true,
    };
  } catch {
    return fallback;
  }
}

export type RegisterSkillInput = {
  store: Store;
  userId: string;
  /** The dropped folder's own name (used for the slug and as the fallback skill name). */
  folderName: string;
  files: UploadedFile[];
  /** Absolute path of the skills root, e.g. `<cwd>/.data/skills`. */
  skillsRoot: string;
  complete: Completer | null;
};

export type RegisterSkillResult = {
  id: string;
  name: string;
  description: string;
  docGenerated: boolean;
};

/**
 * Store the folder raw, generate its SKILL.md, and register it (REQ-F-020, CP-9 三子任务).
 * Rejects a folder-name slug that already exists (409) and any file whose resolved path
 * escapes the skill directory (path-traversal guard).
 */
export async function registerSkill(input: RegisterSkillInput): Promise<RegisterSkillResult> {
  const slug = slugifySkillName(input.folderName);
  if (!slug) {
    throw new SkillNameConflictError(input.folderName);
  }
  await mkdir(input.skillsRoot, { recursive: true });
  const dir = resolve(input.skillsRoot, slug);
  try {
    await mkdir(dir, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SkillNameConflictError(slug);
    }
    throw error;
  }

  for (const file of input.files) {
    const target = resolve(dir, file.path);
    if (target !== dir && !target.startsWith(dir + sep)) {
      throw new Error(`Refusing to write outside the skill directory: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }

  const doc = await generateSkillDoc(input.files, input.complete, slug);
  await writeFile(join(dir, "SKILL.md"), buildSkillMd(doc), "utf8");

  const record = input.store.insertSkill(input.userId, {
    name: doc.name,
    description: doc.description,
    dirPath: dir,
  });
  return { id: record.id, name: record.name, description: record.description, docGenerated: doc.docGenerated };
}

export function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
}

export function isSkillTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  return SKILL_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function buildSkillMd(doc: GeneratedSkillDoc): string {
  const head = `---\nname: ${doc.name}\ndescription: ${doc.description}\n---\n`;
  if (doc.docGenerated) {
    return `${head}\n${doc.body}\n`;
  }
  const raw = doc.body ? `\n<!-- SKILL.md 自动生成失败，以下为模型原始返回 -->\n${doc.body}\n` : "\n（未生成描述，请补充本技能的说明）\n";
  return `${head}${raw}`;
}

function parseFrontmatter(text: string): { name: string; description: string; body: string } | null {
  const match = text.match(/^\s*(?:```[a-z]*\s*)?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/i);
  if (!match) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (kv) {
      fields[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  if (!fields.name) {
    return null;
  }
  return { name: fields.name, description: fields.description ?? "", body: match[2].replace(/```$/, "").trim() };
}

function stripFrontmatter(text: string): string {
  const match = text.match(/^\s*---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/);
  return match ? match[1] : text;
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function listSkillTextFiles(rootDir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const rel = relative(rootDir, abs).split(sep).join("/");
        if (rel.toLowerCase() !== "skill.md" && isSkillTextPath(rel)) {
          found.push(rel);
        }
      }
    }
  }

  await walk(rootDir);
  return found.sort();
}

function truncateToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}
