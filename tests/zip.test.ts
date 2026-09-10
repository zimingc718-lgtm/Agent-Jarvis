import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { deriveFolderName, readZipEntries, ZipError } from "@/lib/zip";

// CR-20260910-skill-intake / TEST-043 — adversarial coverage of the hand-written
// ZIP reader. Archives are assembled byte by byte so every field (compression
// method, general-purpose flags, declared sizes, entry names) can be controlled.

type MakeEntry = {
  name: string;
  data?: Buffer;
  method?: number;
  flags?: number;
  uncompSizeOverride?: number;
};

function makeZip(entries: MakeEntry[], opts: { entryCountOverride?: number } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = entry.data ?? Buffer.alloc(0);
    const method = entry.method ?? 0;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(entry.name, "utf8");
    const flags = entry.flags ?? 0;
    const uncompSize = entry.uncompSizeOverride ?? raw.length;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(stored.length, 18);
    lfh.writeUInt32LE(uncompSize, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lfh, nameBuf, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nameBuf);

    offset += lfh.length + nameBuf.length + stored.length;
  }

  const localPart = Buffer.concat(locals);
  const cdPart = Buffer.concat(centrals);
  const count = opts.entryCountOverride ?? entries.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, cdPart, eocd]);
}

const text = (value: string) => Buffer.from(value, "utf8");

describe("readZipEntries — 正向", () => {
  it("① reads a stored (method 0) entry verbatim", () => {
    const { entries } = readZipEntries(makeZip([{ name: "a.md", data: text("hello") }]));
    expect(entries).toEqual([{ path: "a.md", content: text("hello") }]);
  });

  it("② inflates a deflated (method 8) entry", () => {
    const body = "repeat ".repeat(200);
    const { entries } = readZipEntries(makeZip([{ name: "b.md", data: text(body), method: 8 }]));
    expect(entries[0].content.toString("utf8")).toBe(body);
  });

  it("③ keeps nested paths", () => {
    const { entries } = readZipEntries(makeZip([{ name: "skill/docs/c.md", data: text("x") }]));
    expect(entries[0].path).toBe("skill/docs/c.md");
  });

  it("④ skips directory entries and does not count them towards maxEntries", () => {
    const zip = makeZip([{ name: "skill/" }, { name: "skill/a.md", data: text("x") }]);
    const { entries } = readZipEntries(zip, { maxEntries: 2 });
    expect(entries.map((e) => e.path)).toEqual(["skill/a.md"]);
  });

  it("⑤ does not misfire on a legitimately high compression ratio", () => {
    // 200 KB of one repeated character deflates to a few hundred bytes — an ordinary
    // skill file, not a bomb. A tight ratio cap would reject it (P3 refinement).
    const big = text("A".repeat(200_000));
    const { entries } = readZipEntries(makeZip([{ name: "big.txt", data: big, method: 8 }]));
    expect(entries[0].content.length).toBe(200_000);
  });

  it("⑥ deriveFolderName strips a single top-level directory, else uses the archive name", () => {
    const nested = [
      { path: "reporter/SKILL-notes.md", content: text("x") },
      { path: "reporter/data/a.json", content: text("{}") },
    ];
    expect(deriveFolderName(nested, "whatever.zip")).toEqual({
      folderName: "reporter",
      entries: [
        { path: "SKILL-notes.md", content: text("x") },
        { path: "data/a.json", content: text("{}") },
      ],
    });

    const flat = [{ path: "a.md", content: text("x") }];
    expect(deriveFolderName(flat, "My Skill.zip").folderName).toBe("My Skill");

    const multi = [
      { path: "one/a.md", content: text("x") },
      { path: "two/b.md", content: text("y") },
    ];
    expect(deriveFolderName(multi, "pack.zip").folderName).toBe("pack");
  });
});

describe("readZipEntries — 整体拒绝（REQ-NF-005）", () => {
  const rejects = (zip: Buffer, limits?: Parameters<typeof readZipEntries>[1]) =>
    expect(() => readZipEntries(zip, limits)).toThrow(ZipError);

  it("⑦ rejects a `..` path segment (zip slip)", () => {
    rejects(makeZip([{ name: "../escape.md", data: text("x") }]));
    rejects(makeZip([{ name: "skill/../../escape.md", data: text("x") }]));
  });

  it("⑧ rejects an absolute path", () => {
    rejects(makeZip([{ name: "/etc/passwd", data: text("x") }]));
  });

  it("⑨ rejects a drive-letter prefix", () => {
    rejects(makeZip([{ name: "C:/windows/x.md", data: text("x") }]));
  });

  it("⑩ rejects backslash separators", () => {
    rejects(makeZip([{ name: "skill\\a.md", data: text("x") }]));
  });

  it("⑪ rejects an encrypted archive (general-purpose bit 0)", () => {
    rejects(makeZip([{ name: "a.md", data: text("x"), flags: 0x1 }]));
  });

  it("⑫ rejects more entries than maxEntries", () => {
    rejects(makeZip([{ name: "a.md", data: text("x") }, { name: "b.md", data: text("y") }]), { maxEntries: 1 });
  });

  it("⑬ rejects a single entry over maxEntryBytes", () => {
    rejects(makeZip([{ name: "a.md", data: text("x".repeat(100)) }]), { maxEntryBytes: 10 });
  });

  it("⑭ rejects a total over maxTotalBytes", () => {
    const zip = makeZip([
      { name: "a.md", data: text("x".repeat(60)) },
      { name: "b.md", data: text("y".repeat(60)) },
    ]);
    rejects(zip, { maxEntryBytes: 100, maxTotalBytes: 100 });
  });

  it("⑮ rejects a compression ratio over maxRatio", () => {
    const zip = makeZip([{ name: "a.md", data: text("A".repeat(50_000)), method: 8 }]);
    rejects(zip, { maxRatio: 1 });
  });

  it("⑯ rejects an archive over maxArchiveBytes", () => {
    rejects(makeZip([{ name: "a.md", data: text("x") }]), { maxArchiveBytes: 10 });
  });

  it("⑰ rejects a missing EOCD, a truncated archive and a zip64 sentinel", () => {
    rejects(Buffer.from("not a zip at all, definitely not"));

    const zip = makeZip([{ name: "a.md", data: text("hello world") }]);
    rejects(zip.subarray(0, zip.length - 10)); // EOCD chopped off
    rejects(zip.subarray(zip.length - 22)); // EOCD only, central directory gone

    rejects(makeZip([{ name: "a.md", data: text("x"), uncompSizeOverride: 0xffffffff }]));
  });
});

describe("readZipEntries — 逐条排除", () => {
  it("⑱ skips an unsupported compression method without rejecting the archive", () => {
    const zip = makeZip([
      { name: "ok.md", data: text("fine") },
      { name: "weird.md", data: text("bzip2 pretend"), method: 12 },
    ]);
    const { entries, skipped } = readZipEntries(zip);
    expect(entries.map((e) => e.path)).toEqual(["ok.md"]);
    expect(skipped).toEqual([{ path: "weird.md", reason: "unsupported-zip-method" }]);
  });
});

describe("MOD-ZIP purity (CP-10)", () => {
  it("does not touch the file system or the store", () => {
    const source = readFileSync("src/lib/zip.ts", "utf8");
    expect(source).not.toMatch(/node:fs/);
    expect(source).not.toMatch(/from "\.\/store/);
  });
});
