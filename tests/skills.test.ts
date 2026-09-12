import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// TEST-034 (routeTurn) and TEST-036 (captureSkillHtml) are SUPERSEDED by
// CR-20260910-agent-tooling: the routing call is gone (DEC-016) and HTML capture became
// the `save_insight` tool. Their replacements are TEST-069 and TEST-070.
import {
  generateSkillDoc,
  registerSkill,
  resolveSkillForTurn,
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

  // CR-20260911-skill-doc-preserved — a folder that documents itself is taken at its word.
  it("① 文件夹自带可解析的 SKILL.md 时，原样采用，且根本不调模型", async () => {
    const authored: UploadedFile[] = [
      { path: "SKILL.md", content: `---
name: 证据规范
description: 什么算证据。
---

# 证据规范

值 + 链接 + 原文定位。` },
      { path: "notes.md", content: "旁注" },
    ];
    const completer = vi.fn(async () => "模型不该被调用");
    const doc = await generateSkillDoc(authored, completer, "fallback-slug");
    expect(doc).toMatchObject({ name: "证据规范", description: "什么算证据。", docGenerated: true });
    expect(doc.body).toContain("值 + 链接 + 原文定位");
    expect(completer).not.toHaveBeenCalled();
  });

  it("② 没有 Provider 时同样原样采用——这正是原来会把作者写的说明覆盖成占位符的那条路", async () => {
    const authored: UploadedFile[] = [
      { path: "./SKILL.md", content: `---
name: 知识条目规范
description: 什么该入库。
---

正文在此。` },
    ];
    const doc = await generateSkillDoc(authored, null, "fallback-slug");
    expect(doc).toMatchObject({ name: "知识条目规范", description: "什么该入库。", docGenerated: true });
  });

  it("③ SKILL.md 没有前置块就不算「已写好」，仍走生成", async () => {
    const halfDone: UploadedFile[] = [{ path: "SKILL.md", content: "# 随手记的标题（没有前置块）" }];
    const doc = await generateSkillDoc(halfDone, null, "my-folder");
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


describe("registerSkill 保留作者写好的 SKILL.md（CR-20260911-skill-doc-preserved）", () => {
  let dir: string;
  let store: Store;
  let skillsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-keep-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    skillsRoot = join(dir, "skills");
    mkdirSync(skillsRoot, { recursive: true });
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("④ 没有 Provider 也不会把正文冲掉，登记名与描述取自作者的前置块", async () => {
    const body = `# 证据规范

值 + 链接 + 原文定位，三者缺一不成立。`;
    const result = await registerSkill({
      store,
      userId: "u1",
      folderName: "证据规范",
      files: [{ path: "SKILL.md", content: `---
name: 证据规范
description: 什么算证据。
---

${body}` }],
      complete: null,
      skillsRoot,
    });
    expect(result).toMatchObject({ name: "证据规范", description: "什么算证据。", docGenerated: true });

    const written = readFileSync(join(skillsRoot, "证据规范", "SKILL.md"), "utf8");
    expect(written).toContain("值 + 链接 + 原文定位，三者缺一不成立。");
    expect(written).not.toContain("（未生成描述，请补充本技能的说明）");
    // And the injected text still carries the instructions, not a stub.
    expect(await resolveSkillForTurn(join(skillsRoot, "证据规范"))).toContain("三者缺一不成立");
  });
});

describe("slugifySkillName", () => {
  it("keeps unicode letters and collapses separators", () => {
    expect(slugifySkillName("Stock Insight!!")).toBe("stock-insight");
    expect(slugifySkillName("股票 分析")).toBe("股票-分析");
  });
});
