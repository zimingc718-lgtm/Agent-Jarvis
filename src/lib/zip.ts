import { inflateRawSync } from "node:zlib";

/**
 * A bounded, zero-dependency ZIP reader (CR-20260910-skill-intake, DEC-018).
 *
 * Deliberately a **pure function**: it never touches the file system, the network
 * or the store, so the whole untrusted-input surface can be covered by adversarial
 * unit tests (REQ-NF-005 ④, TEST-043).
 *
 * Two rejection semantics, kept apart on purpose:
 *   - throw `ZipError`  → reject the WHOLE archive (nothing may be written)
 *   - `skipped[]`       → drop just that entry (legitimate but unsupported)
 */

/** Whole-archive rejection. The route handler turns this into a 400. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export type ZipEntry = { path: string; content: Buffer };

export type ZipSkip = { path: string; reason: "unsupported-zip-method" };

export type ZipLimits = {
  /** The archive itself. */
  maxArchiveBytes: number;
  maxEntries: number;
  /** One entry, uncompressed. */
  maxEntryBytes: number;
  /** All entries together, uncompressed. */
  maxTotalBytes: number;
  /** Total uncompressed ÷ archive bytes. A sanity bound on top of maxTotalBytes. */
  maxRatio: number;
};

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 20 * 1024 * 1024,
  maxEntries: 2000,
  maxEntryBytes: 5 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  // Deflate reaches 1000:1 on repetitive text, so a tight ratio would reject
  // perfectly ordinary skill folders. `maxTotalBytes` is the real memory bound;
  // this only catches pathological archives (P3 refinement, see the CR).
  maxRatio: 2000,
};

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_MIN = 22;
const CD_FIXED = 46;
const LFH_FIXED = 30;
/** A zip comment is at most 64 KiB, so the EOCD cannot be further back than this. */
const EOCD_SEARCH_MAX = EOCD_MIN + 0xffff;
const ZIP64_SENTINEL = 0xffffffff;

export function readZipEntries(
  buffer: Buffer,
  limits: Partial<ZipLimits> = {}
): { entries: ZipEntry[]; skipped: ZipSkip[] } {
  const bounds = { ...DEFAULT_ZIP_LIMITS, ...limits };

  if (buffer.length > bounds.maxArchiveBytes) {
    throw new ZipError(`压缩包超过 ${mib(bounds.maxArchiveBytes)} 上限。`);
  }
  if (buffer.length < EOCD_MIN) {
    throw new ZipError("不是有效的 zip 压缩包（文件过小）。");
  }

  const eocd = findEocd(buffer);
  const totalEntries = readU16(buffer, eocd + 10);
  const cdSize = readU32(buffer, eocd + 12);
  const cdOffset = readU32(buffer, eocd + 16);

  if (cdOffset === ZIP64_SENTINEL || cdSize === ZIP64_SENTINEL || totalEntries === 0xffff) {
    throw new ZipError("不支持 zip64 格式的压缩包。");
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new ZipError("zip 中央目录越界，压缩包可能已损坏。");
  }
  if (totalEntries > bounds.maxEntries) {
    throw new ZipError(`压缩包条目数超过 ${bounds.maxEntries} 上限。`);
  }

  const entries: ZipEntry[] = [];
  const skipped: ZipSkip[] = [];
  let total = 0;
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (readU32(buffer, cursor) !== CD_SIG) {
      throw new ZipError("zip 中央目录记录损坏。");
    }
    const flags = readU16(buffer, cursor + 8);
    const method = readU16(buffer, cursor + 10);
    const compSize = readU32(buffer, cursor + 20);
    const uncompSize = readU32(buffer, cursor + 24);
    const nameLen = readU16(buffer, cursor + 28);
    const extraLen = readU16(buffer, cursor + 30);
    const commentLen = readU16(buffer, cursor + 32);
    const localOffset = readU32(buffer, cursor + 42);
    const name = slice(buffer, cursor + CD_FIXED, nameLen).toString("utf8");
    cursor += CD_FIXED + nameLen + extraLen + commentLen;

    // Encrypted archives yield nothing usable — reject the whole thing.
    if (flags & 0x1) {
      throw new ZipError("不支持加密的 zip 压缩包。");
    }
    if (compSize === ZIP64_SENTINEL || uncompSize === ZIP64_SENTINEL || localOffset === ZIP64_SENTINEL) {
      throw new ZipError("不支持 zip64 格式的压缩包。");
    }

    // Directory entries carry no content and must not count towards maxEntries.
    if (name.endsWith("/")) {
      continue;
    }

    const badPath = rejectPath(name);
    if (badPath) {
      throw new ZipError(`压缩包内路径不安全（${badPath}）：${name}`);
    }

    if (method !== 0 && method !== 8) {
      skipped.push({ path: name, reason: "unsupported-zip-method" });
      continue;
    }
    if (uncompSize > bounds.maxEntryBytes) {
      throw new ZipError(`压缩包内单个文件超过 ${mib(bounds.maxEntryBytes)} 上限：${name}`);
    }
    total += uncompSize;
    if (total > bounds.maxTotalBytes) {
      throw new ZipError(`压缩包解压后总大小超过 ${mib(bounds.maxTotalBytes)} 上限。`);
    }
    if (entries.length + 1 > bounds.maxEntries) {
      throw new ZipError(`压缩包条目数超过 ${bounds.maxEntries} 上限。`);
    }

    entries.push({ path: name, content: readEntryData(buffer, localOffset, method, compSize, uncompSize, name) });
  }

  if (total > buffer.length * bounds.maxRatio) {
    throw new ZipError(`压缩包解压比超过 ${bounds.maxRatio}:1 上限。`);
  }

  return { entries, skipped };
}

/**
 * DEC-018 ⑧: when every entry sits under a single top-level directory, that directory
 * is the skill name and the prefix is stripped; otherwise the archive's base name is used.
 */
export function deriveFolderName(
  entries: ZipEntry[],
  archiveFileName: string
): { folderName: string; entries: ZipEntry[] } {
  const tops = new Set<string>();
  for (const entry of entries) {
    const [head, ...rest] = entry.path.split("/");
    if (rest.length === 0) {
      tops.add("");
      break;
    }
    tops.add(head);
  }

  const fallback = archiveFileName.replace(/\.zip$/i, "").trim() || "skill";
  if (tops.size !== 1 || tops.has("")) {
    return { folderName: fallback, entries };
  }

  const [top] = [...tops];
  return {
    folderName: top,
    entries: entries.map((entry) => ({ ...entry, path: entry.path.slice(top.length + 1) })),
  };
}

function readEntryData(
  buffer: Buffer,
  localOffset: number,
  method: number,
  compSize: number,
  uncompSize: number,
  name: string
): Buffer {
  if (readU32(buffer, localOffset) !== LFH_SIG) {
    throw new ZipError(`zip 本地文件头损坏：${name}`);
  }
  // The local header's name/extra lengths may differ from the central directory's.
  const nameLen = readU16(buffer, localOffset + 26);
  const extraLen = readU16(buffer, localOffset + 28);
  const data = slice(buffer, localOffset + LFH_FIXED + nameLen + extraLen, compSize);

  if (method === 0) {
    return data;
  }
  let inflated: Buffer;
  try {
    inflated = inflateRawSync(data, { maxOutputLength: uncompSize + 1 });
  } catch {
    throw new ZipError(`zip 条目解压失败：${name}`);
  }
  if (inflated.length > uncompSize) {
    throw new ZipError(`zip 条目解压后大于声明大小：${name}`);
  }
  return inflated;
}

/** Which unsafe-path rule the entry name breaks, or null when it is fine. */
function rejectPath(name: string): string | null {
  if (name.includes("\\")) {
    return "反斜杠分隔符";
  }
  if (/^[a-zA-Z]:/.test(name)) {
    return "盘符前缀";
  }
  if (name.startsWith("/")) {
    return "绝对路径";
  }
  if (name.split("/").includes("..")) {
    return "上级目录引用";
  }
  return null;
}

function findEocd(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - EOCD_SEARCH_MAX);
  for (let i = buffer.length - EOCD_MIN; i >= earliest; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      return i;
    }
  }
  throw new ZipError("不是有效的 zip 压缩包（找不到目录结尾记录）。");
}

function readU16(buffer: Buffer, offset: number): number {
  ensure(buffer, offset, 2);
  return buffer.readUInt16LE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
  ensure(buffer, offset, 4);
  return buffer.readUInt32LE(offset);
}

function slice(buffer: Buffer, offset: number, length: number): Buffer {
  ensure(buffer, offset, length);
  return buffer.subarray(offset, offset + length);
}

/** Every read is bounds-checked — offset arithmetic is where hand-written parsers go wrong. */
function ensure(buffer: Buffer, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new ZipError("zip 数据越界，压缩包可能已截断。");
  }
}

function mib(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
