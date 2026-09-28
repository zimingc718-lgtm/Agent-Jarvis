import { inflateRawSync } from "node:zlib";
import { type Coded, withCode, zhMessage } from "./coded-error";
import type { Vars } from "./i18n-core";
import type { ServerMessageKey } from "./i18n-server";

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

  /** Same Chinese `message` as before, plus the dictionary code a route uses to word it in the interface language (DEC-470 ③). */
  static coded(code: ServerMessageKey, params?: Vars): ZipError & Coded {
    return withCode(new ZipError(zhMessage(code, params)), code, params);
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
    throw ZipError.coded("zip.archiveTooLarge", { limit: mib(bounds.maxArchiveBytes) });
  }
  if (buffer.length < EOCD_MIN) {
    throw ZipError.coded("zip.tooSmall");
  }

  const eocd = findEocd(buffer);
  const totalEntries = readU16(buffer, eocd + 10);
  const cdSize = readU32(buffer, eocd + 12);
  const cdOffset = readU32(buffer, eocd + 16);

  if (cdOffset === ZIP64_SENTINEL || cdSize === ZIP64_SENTINEL || totalEntries === 0xffff) {
    throw ZipError.coded("zip.zip64");
  }
  if (cdOffset + cdSize > buffer.length) {
    throw ZipError.coded("zip.centralDirOutOfRange");
  }
  if (totalEntries > bounds.maxEntries) {
    throw ZipError.coded("zip.tooManyEntries", { max: bounds.maxEntries });
  }

  const entries: ZipEntry[] = [];
  const skipped: ZipSkip[] = [];
  let total = 0;
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (readU32(buffer, cursor) !== CD_SIG) {
      throw ZipError.coded("zip.centralDirCorrupt");
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
      throw ZipError.coded("zip.encrypted");
    }
    if (compSize === ZIP64_SENTINEL || uncompSize === ZIP64_SENTINEL || localOffset === ZIP64_SENTINEL) {
      throw ZipError.coded("zip.zip64");
    }

    // Directory entries carry no content and must not count towards maxEntries.
    if (name.endsWith("/")) {
      continue;
    }

    const badPath = rejectPath(name);
    if (badPath) {
      throw ZipError.coded(badPath, { name });
    }

    if (method !== 0 && method !== 8) {
      skipped.push({ path: name, reason: "unsupported-zip-method" });
      continue;
    }
    if (uncompSize > bounds.maxEntryBytes) {
      throw ZipError.coded("zip.entryTooLarge", { limit: mib(bounds.maxEntryBytes), name });
    }
    total += uncompSize;
    if (total > bounds.maxTotalBytes) {
      throw ZipError.coded("zip.totalTooLarge", { limit: mib(bounds.maxTotalBytes) });
    }
    if (entries.length + 1 > bounds.maxEntries) {
      throw ZipError.coded("zip.tooManyEntries", { max: bounds.maxEntries });
    }

    entries.push({ path: name, content: readEntryData(buffer, localOffset, method, compSize, uncompSize, name) });
  }

  if (total > buffer.length * bounds.maxRatio) {
    throw ZipError.coded("zip.ratioTooHigh", { ratio: bounds.maxRatio });
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
    throw ZipError.coded("zip.localHeaderCorrupt", { name });
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
    throw ZipError.coded("zip.inflateFailed", { name });
  }
  if (inflated.length > uncompSize) {
    throw ZipError.coded("zip.inflateOversize", { name });
  }
  return inflated;
}

/** Which unsafe-path rule the entry name breaks, or null when it is fine. */
function rejectPath(name: string): ServerMessageKey | null {
  if (name.includes("\\")) {
    return "zip.unsafeBackslash";
  }
  if (/^[a-zA-Z]:/.test(name)) {
    return "zip.unsafeDrive";
  }
  if (name.startsWith("/")) {
    return "zip.unsafeAbsolute";
  }
  if (name.split("/").includes("..")) {
    return "zip.unsafeParent";
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
  throw ZipError.coded("zip.noEocd");
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
    throw ZipError.coded("zip.dataOutOfRange");
  }
}

function mib(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
