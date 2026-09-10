import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-skills-route-"));
process.env.JARVIS_DB_PATH = join(dir, "s.sqlite");
process.env.JARVIS_SKILLS_PATH = join(dir, "skills");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const skillsRoute = await import("@/app/api/skills/route");
const { SKILLS_ROOT, resolveSkillForTurn } = await import("@/lib/skills");
const { getStore } = await import("@/lib/store-singleton");

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function upload(folderName: string, files: Array<[string, string]>): Request {
  const form = new FormData();
  form.set("folderName", folderName);
  for (const [path, content] of files) {
    form.append("file", new File([content], path, { type: "text/plain" }));
  }
  return new Request("http://test/api/skills", { method: "POST", body: form });
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(SKILLS_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("POST /api/skills (TASK-033)", () => {
  beforeEach(() => rmSync(SKILLS_ROOT, { recursive: true, force: true }));

  it("401s an unauthenticated caller", async () => {
    as(null);
    expect((await skillsRoute.POST(upload("x", [["a.md", "a"]]))).status).toBe(401);
  });

  it("registers a folder, stores it raw, and lists it via GET (no LLM available → fallback name)", async () => {
    as("owner@example.com");
    const created = await skillsRoute.POST(upload("Report Skill", [["SKILL-notes.md", "how to report"], ["data/x.json", "{}"]]));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.docGenerated).toBe(false);
    expect(body.name).toBe("report-skill");

    const [registered] = getStore().listSkills("owner@example.com");
    expect(readdirSync(registered.dirPath)).toEqual(expect.arrayContaining(["SKILL.md", "SKILL-notes.md", "data"]));

    as("owner@example.com");
    const listed = await (await skillsRoute.GET()).json();
    expect(listed.skills.map((s: { name: string }) => s.name)).toContain("report-skill");
  });

  it("409s a folder whose slug already exists", async () => {
    as("owner@example.com");
    await skillsRoute.POST(upload("dup skill", [["a.md", "a"]]));
    const again = await skillsRoute.POST(upload("Dup Skill", [["a.md", "a"]]));
    expect(again.status).toBe(409);
  });

  it("400s a folder with no readable text files (binary content is skipped)", async () => {
    as("owner@example.com");
    const form = new FormData();
    form.set("folderName", "binary-only");
    form.append("file", new File([new Uint8Array([1, 2, 0, 3, 0, 9])], "photo.png"));
    const res = await skillsRoute.POST(new Request("http://test/api/skills", { method: "POST", body: form }));
    expect(res.status).toBe(400);
  });

  it("ignores a file whose path tries to escape the folder", async () => {
    as("owner@example.com");
    const res = await skillsRoute.POST(upload("safe", [["../evil.md", "x"], ["ok.md", "ok"]]));
    // the ".." entry is dropped by the route; only ok.md remains, so registration still succeeds
    expect(res.status).toBe(201);
    const registered = getStore().listSkills("owner@example.com").at(-1)!;
    expect(readdirSync(registered.dirPath)).toEqual(expect.arrayContaining(["SKILL.md", "ok.md"]));
    expect(readdirSync(registered.dirPath)).not.toContain("evil.md");
  });
});
// CR-20260910-skill-intake — TEST-045: zip intake, widened allowlist, excluded receipt.

type MakeEntry = { name: string; data?: Buffer; method?: number };

function makeZip(entries: MakeEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = entry.data ?? Buffer.alloc(0);
    const method = entry.method ?? 0;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(entry.name, "utf8");
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(stored.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lfh, nameBuf, stored);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nameBuf);
    offset += lfh.length + nameBuf.length + stored.length;
  }
  const localPart = Buffer.concat(locals);
  const cdPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, cdPart, eocd]);
}

function uploadArchive(zip: Buffer, fileName: string): Request {
  const form = new FormData();
  form.set("archive", new File([new Uint8Array(zip)], fileName, { type: "application/zip" }), fileName);
  return new Request("http://test/api/skills", { method: "POST", body: form });
}

describe("POST /api/skills — zip 与回执 (TEST-045)", () => {
  beforeEach(() => rmSync(SKILLS_ROOT, { recursive: true, force: true }));

  it("① registers a zip and widened-allowlist files enter the injected content", async () => {
    as("owner@example.com");
    const zip = makeZip([
      { name: "widened/notes.mdx", data: Buffer.from("mdx body", "utf8") },
      { name: "widened/conf.toml", data: Buffer.from("k = 1", "utf8"), method: 8 },
      { name: "widened/run.sh", data: Buffer.from("echo hi", "utf8") },
      { name: "widened/rows.jsonl", data: Buffer.from('{"a":1}', "utf8") },
      { name: "widened/doc.xml", data: Buffer.from("<a/>", "utf8") },
    ]);
    const created = await skillsRoute.POST(uploadArchive(zip, "widened.zip"));
    expect(created.status).toBe(201);
    // deriveFolderName stripped the single top-level directory.
    expect((await created.json()).name).toBe("widened");

    const registered = getStore().listSkills("owner@example.com").at(-1)!;
    const injected = await resolveSkillForTurn(registered.dirPath);
    for (const name of ["notes.mdx", "conf.toml", "run.sh", "rows.jsonl", "doc.xml"]) {
      expect(injected).toContain(`=== ${name} ===`);
    }
  });

  it("② lists every excluded file with its reason (four kinds)", async () => {
    as("owner@example.com");
    const zip = makeZip([
      { name: "mix/ok.md", data: Buffer.from("fine", "utf8") },
      { name: "mix/logo.png", data: Buffer.from([1, 2, 0, 3]) },
      { name: "mix/huge.txt", data: Buffer.alloc(600 * 1024, 0x61) },
      { name: "mix/code.rs", data: Buffer.from("fn main() {}", "utf8") },
      { name: "mix/weird.bin", data: Buffer.from("pretend bzip2", "utf8"), method: 12 },
    ]);
    const created = await skillsRoute.POST(uploadArchive(zip, "mix.zip"));
    expect(created.status).toBe(201);
    const body = await created.json();
    const byPath = Object.fromEntries(body.excluded.map((e: { path: string; reason: string }) => [e.path, e.reason]));

    expect(byPath["mix/weird.bin"]).toBe("unsupported-zip-method");
    expect(byPath["logo.png"]).toBe("binary");
    expect(byPath["huge.txt"]).toBe("too-large");
    // `not-injected` is different: the file IS stored, it just never enters the context.
    expect(byPath["code.rs"]).toBe("not-injected");
    const registered = getStore().listSkills("owner@example.com").at(-1)!;
    expect(readdirSync(registered.dirPath)).toContain("code.rs");
    expect(readdirSync(registered.dirPath)).not.toContain("logo.png");
  });

  it("③ a rejected archive leaves no files behind (REQ-NF-005 ②: no partial write)", async () => {
    as("owner@example.com");
    const evil = makeZip([{ name: "../escape.md", data: Buffer.from("x", "utf8") }]);
    const rejected = await skillsRoute.POST(uploadArchive(evil, "evil.zip"));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).message).toMatch(/上级目录引用/);
    expect(existsSync(SKILLS_ROOT) ? readdirSync(SKILLS_ROOT) : []).toEqual([]);
  });

  it("④ zip and folder uploads of the same content register the same way", async () => {
    as("owner@example.com");
    const viaZip = await skillsRoute.POST(
      uploadArchive(makeZip([{ name: "twin-a/readme.md", data: Buffer.from("same", "utf8") }]), "ignored.zip")
    );
    const viaFolder = await skillsRoute.POST(upload("twin-b", [["readme.md", "same"]]));
    expect(viaZip.status).toBe(201);
    expect(viaFolder.status).toBe(201);

    const [zipSkill, folderSkill] = getStore().listSkills("owner@example.com").slice(-2);
    expect(readdirSync(zipSkill.dirPath).sort()).toEqual(readdirSync(folderSkill.dirPath).sort());
  });
});
