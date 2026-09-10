import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSkillHtml,
  generateSkillDoc,
  registerSkill,
  resolveSkillForTurn,
  routeTurn,
  slugifySkillName,
  type Completer,
  type UploadedFile,
} from "@/lib/skills";
import { createStore, SkillNameConflictError, type Store } from "@/lib/store";

const encryptionKey = "0123456789abcdef0123456789abcdef";

/** A completer that always answers with the given text (or throws). */
function fixedCompleter(answer: string | (() => never)): Completer {
  return async () => (typeof answer === "function" ? answer() : answer);
}

describe("routeTurn (DEC-016)", () => {
  const skills = [
    { id: "s1", name: "stock-insight", description: "分析一只股票" },
    { id: "s2", name: "翻译", description: "翻译文本" },
  ];

  it("returns the named skill when the model picks a registered one", async () => {
    const route = await routeTurn("看看这只股票", skills, fixedCompleter('{"skill":"stock-insight","display":null}'));
    expect(route).toEqual({ skill: "stock-insight", display: null });
  });

  it("returns null skill when the model picks none", async () => {
    const route = await routeTurn("你好", skills, fixedCompleter('{"skill":null,"display":null}'));
    expect(route.skill).toBeNull();
  });

  it("reads the display:home intent independent of any skill", async () => {
    const route = await routeTurn("回到首页", skills, fixedCompleter('{"skill":null,"display":"home"}'));
    expect(route).toEqual({ skill: null, display: "home" });
  });

  it("fail-open: no completer → { skill: null, display: null }", async () => {
    expect(await routeTurn("anything", skills, null)).toEqual({ skill: null, display: null });
  });

  it("fail-open: a thrown completer (timeout/network) → { skill: null, display: null } and does not throw", async () => {
    const route = await routeTurn(
      "x",
      skills,
      fixedCompleter(() => {
        throw new Error("TimeoutError");
      })
    );
    expect(route).toEqual({ skill: null, display: null });
  });

  it("fail-open: non-JSON output → { skill: null, display: null }", async () => {
    expect(await routeTurn("x", skills, fixedCompleter("I think you want the stock skill!"))).toEqual({
      skill: null,
      display: null,
    });
  });

  it("fail-open: an unregistered skill name is discarded", async () => {
    const route = await routeTurn("x", skills, fixedCompleter('{"skill":"made-up","display":null}'));
    expect(route.skill).toBeNull();
  });

  it("sends a non-streaming, history-free request with a small max_tokens", async () => {
    const complete = vi.fn<Completer>(async () => '{"skill":null,"display":null}');
    await routeTurn("hello", skills, complete);
    const [messages, opts] = complete.mock.calls[0];
    expect(opts).toEqual({ maxTokens: 64, timeoutMs: 10_000 });
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages.some((m) => m.role === "assistant")).toBe(false);
  });
});

describe("resolveSkillForTurn (REQ-F-022)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-skill-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("includes SKILL.md body + allowlisted text files and excludes non-allowlisted ones", async () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n\nDo the thing.");
    writeFileSync(join(dir, "notes.txt"), "keep me");
    writeFileSync(join(dir, "data.json"), '{"a":1}');
    writeFileSync(join(dir, "logo.png"), "binary-ish");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "more.md"), "nested note");

    const assembled = await resolveSkillForTurn(dir);
    expect(assembled).toContain("Do the thing.");
    expect(assembled).toContain("=== notes.txt ===");
    expect(assembled).toContain("keep me");
    expect(assembled).toContain("=== data.json ===");
    expect(assembled).toContain("=== sub/more.md ===");
    expect(assembled).not.toContain("logo.png");
  });

  it("truncates past 32KB and marks it", async () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n");
    writeFileSync(join(dir, "big.txt"), "A".repeat(40 * 1024));
    const assembled = await resolveSkillForTurn(dir);
    expect(Buffer.byteLength(assembled, "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(assembled).toContain("已截断");
  });
});

describe("generateSkillDoc (REQ-F-020 ②④)", () => {
  const files: UploadedFile[] = [{ path: "readme.md", content: "This skill summarises text." }];

  it("parses frontmatter from the model output", async () => {
    const doc = await generateSkillDoc(
      files,
      fixedCompleter("---\nname: Summariser\ndescription: Summarises text.\n---\n\nUse it to summarise."),
      "fallback-slug"
    );
    expect(doc).toMatchObject({ name: "Summariser", description: "Summarises text.", docGenerated: true });
  });

  it("falls back to the folder name when the output has no frontmatter", async () => {
    const doc = await generateSkillDoc(files, fixedCompleter("here is a skill, roughly"), "my-folder");
    expect(doc).toMatchObject({ name: "my-folder", description: "（未生成描述）", docGenerated: false });
  });

  it("falls back when there is no completer", async () => {
    const doc = await generateSkillDoc(files, null, "my-folder");
    expect(doc).toMatchObject({ name: "my-folder", docGenerated: false });
  });
});

describe("registerSkill (CP-9)", () => {
  let dir: string;
  let store: Store;
  let skillsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-reg-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    skillsRoot = join(dir, "skills");
    mkdirSync(skillsRoot, { recursive: true });
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const files: UploadedFile[] = [{ path: "readme.md", content: "hello" }];
  const doc = fixedCompleter("---\nname: Reader\ndescription: reads\n---\n\nbody");

  it("stores the folder, generates SKILL.md and registers the skill", async () => {
    const user = store.upsertUser({ email: "u@example.com", name: "U" });
    const result = await registerSkill({ store, userId: user.id, folderName: "Reader Skill", files, skillsRoot, complete: doc });
    expect(result).toMatchObject({ name: "Reader", description: "reads", docGenerated: true });

    const [registered] = store.listSkills(user.id);
    expect(registered.name).toBe("Reader");
    expect(readFileSync(join(registered.dirPath, "readme.md"), "utf8")).toBe("hello");
    expect(readFileSync(join(registered.dirPath, "SKILL.md"), "utf8")).toContain("name: Reader");
  });

  it("rejects a folder-name slug that already exists with a conflict error", async () => {
    const user = store.upsertUser({ email: "u@example.com", name: "U" });
    await registerSkill({ store, userId: user.id, folderName: "dup", files, skillsRoot, complete: doc });
    await expect(
      registerSkill({ store, userId: user.id, folderName: "dup", files, skillsRoot, complete: doc })
    ).rejects.toBeInstanceOf(SkillNameConflictError);
  });

  it("refuses a file whose path escapes the skill directory", async () => {
    const user = store.upsertUser({ email: "u@example.com", name: "U" });
    await expect(
      registerSkill({
        store,
        userId: user.id,
        folderName: "evil",
        files: [{ path: "../escape.txt", content: "x" }],
        skillsRoot,
        complete: doc,
      })
    ).rejects.toThrow(/outside the skill directory/);
  });
});

describe("captureSkillHtml (REQ-F-023)", () => {
  it("takes the last closed ```html block", () => {
    const text = "first\n```html\n<p>one</p>\n```\nmid\n```html\n<p>two</p>\n```\nend";
    expect(captureSkillHtml(text)).toEqual({ html: "<p>two</p>" });
  });

  it("reports 'none' when there is no html fence", () => {
    expect(captureSkillHtml("just prose")).toEqual({ missing: "none" });
  });

  it("reports 'incomplete' when an html fence opened but never closed", () => {
    expect(captureSkillHtml("intro\n```html\n<p>unfinished")).toEqual({ missing: "incomplete" });
  });
});

describe("slugifySkillName", () => {
  it("keeps unicode letters and collapses separators", () => {
    expect(slugifySkillName("Stock Insight!!")).toBe("stock-insight");
    expect(slugifySkillName("股票 分析")).toBe("股票-分析");
  });
});
