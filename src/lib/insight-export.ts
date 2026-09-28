import { isAbsolute, relative, resolve, sep } from "node:path";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { DocumentPathError, parseRoots, type DocumentRoot } from "@/lib/documents";
import { htmlToMarkdown, inlineToMarkdown } from "@/lib/html-text";

/**
 * 洞察归档：HTML 是唯一作者产物，Markdown 由它派生（REQ-F-190 ①，DEC-230）。
 *
 * 用户 2026-09-13 的原话是「两个都要，而且支持保存到系统的本地文档库」。两个都要不等于
 * 两次创作：让模型再写一份 Markdown，会多花一遍 token，还会得到两份迟早对不上的正文。
 * 派生物就该是派生出来的。
 *
 * 写盘是本项目第一处**往用户磁盘里写东西**的能力，所以边界比读严得多：
 *   - 目标目录必须由用户显式配置，且必须落在已配置的文档根**之内**——写入面不超出用户
 *     已经授权的那片地方；
 *   - `realpath` 先解析再判包含，与 REQ-NF-050 ① 同一条纪律：先解析、后比较，`..` 与
 *     符号链接才走不出去；
 *   - **永不覆盖**：同名就换一个名字，不是悄悄盖掉用户的文件。
 */

/** 归档目录的设置键。值是绝对路径；必须落在某个已配置文档根之内。 */
export const SETTING_ARCHIVE_DIR = "documents.archive";

/** 单份归档的正文上限。洞察正文本身有 512KB 上限（REQ-F-050 ②），这里留出 front-matter 的余量。 */
export const MAX_ARCHIVE_BYTES = 1024 * 1024;

/** 同名文件最多试到 `-99`，再多就是调用方在循环里写同一个名字。 */
const MAX_NAME_ATTEMPTS = 99;

export type ArchiveFormat = "md" | "html";

export type ArchiveTarget = { dir: string; root: DocumentRoot };

export type ArchiveResult = {
  /** `<label>/<相对路径>`，与 `DocumentMeta.id` 同形，能直接喂给 read_document。 */
  id: string;
  absPath: string;
  bytes: number;
  format: ArchiveFormat;
};

export function titleOf(html: string, fallback: string): string {
  const heading = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
  const raw = heading ? inlineToMarkdown(heading[1] ?? "") : inlineToMarkdown(html).split("\n").find((line) => line.trim()) ?? "";
  const title = raw.replace(/\s+/g, " ").trim();
  return title ? title.slice(0, 80) : fallback;
}

/** 文件名里不能出现的字符，外加把空白压成短横。Windows 的保留字符是这里的下限。 */
export function slugify(title: string, fallback: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

export function frontMatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/**
 * 归档目录：用户配置的绝对路径，且必须落在某个已配置的文档根之内。
 *
 * 「之内」是有意的，不是偷懒：读的范围是用户圈定的那些目录，写的范围不该比读更大。
 * 未配置时抛出的是一句能照着做的话，不是「未配置」三个字（REQ-F-180 ③ 的同一条纪律）。
 */
export async function resolveArchiveDir(rawSetting: string | null | undefined, rootsRaw: string | null | undefined): Promise<ArchiveTarget> {
  const roots = parseRoots(rootsRaw);
  if (roots.length === 0) {
    throw DocumentPathError.coded("archive.noRoots");
  }
  const configured = (rawSetting ?? "").trim();
  if (!configured) {
    const names = roots.map((root) => root.label).join("、");
    throw DocumentPathError.coded("archive.notSet", { names });
  }
  if (!isAbsolute(configured)) {
    throw DocumentPathError.coded("archive.notAbsolute");
  }

  let dirReal: string;
  try {
    dirReal = await realpath(configured);
  } catch {
    // 目录可以还不存在：第一次归档时建出来，但父目录必须已经在根内。
    const parent = resolve(configured, "..");
    try {
      await realpath(parent);
    } catch {
      throw DocumentPathError.coded("archive.parentMissing");
    }
    dirReal = resolve(await realpath(parent), configured.slice(parent.length).replace(/^[\\/]+/, ""));
  }

  for (const root of roots) {
    let rootReal: string;
    try {
      rootReal = await realpath(root.path);
    } catch {
      continue;
    }
    const rel = relative(rootReal, dirReal);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      return { dir: dirReal, root };
    }
  }
  throw DocumentPathError.coded("archive.outsideRoots");
}

/** 找一个还没被占用的文件名。**永不覆盖**：同名就加序号。 */
export async function freePath(dir: string, base: string, format: ArchiveFormat): Promise<string> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const name = attempt === 1 ? `${base}.${format}` : `${base}-${attempt}.${format}`;
    const candidate = resolve(dir, name);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
  throw DocumentPathError.coded("archive.tooManySameName", { max: MAX_NAME_ATTEMPTS, base });
}

export type ArchiveInput = {
  insightId: string;
  conversationId: string;
  html: string;
  createdAt: string;
  format: ArchiveFormat;
  archiveSetting: string | null | undefined;
  rootsSetting: string | null | undefined;
  now?: () => Date;
};

/**
 * 把一份洞察写进归档目录，返回它在文档库里的 id。
 *
 * 写下去的是**派生自同一份 HTML** 的两种形态之一，正文不重写第二遍。
 */
export async function archiveInsight(input: ArchiveInput): Promise<ArchiveResult> {
  const target = await resolveArchiveDir(input.archiveSetting, input.rootsSetting);
  const title = titleOf(input.html, `洞察 ${input.insightId}`);
  const stamp = (input.now?.() ?? new Date()).toISOString();

  const body =
    input.format === "html"
      ? input.html
      : frontMatter({
          title,
          insight_id: input.insightId,
          conversation_id: input.conversationId,
          created_at: input.createdAt,
          archived_at: stamp,
          source: `jarvis://insight/${input.insightId}`,
        }) + htmlToMarkdown(input.html) + "\n";

  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_ARCHIVE_BYTES) {
    throw DocumentPathError.coded("archive.tooLarge", { kb: Math.round(bytes / 1024), max: MAX_ARCHIVE_BYTES / 1024 });
  }

  await mkdir(target.dir, { recursive: true });
  const base = slugify(`${stamp.slice(0, 10)}-${title}`, `insight-${input.insightId}`);
  const absPath = await freePath(target.dir, base, input.format);
  await writeFile(absPath, body, "utf8");

  let rootReal: string;
  try {
    rootReal = await realpath(target.root.path);
  } catch {
    rootReal = target.root.path;
  }
  const rel = relative(rootReal, absPath).split(sep).join("/");
  return { id: `${target.root.label}/${rel}`, absPath, bytes, format: input.format };
}
