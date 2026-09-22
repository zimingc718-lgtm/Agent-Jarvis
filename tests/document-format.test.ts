import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type Store } from "@/lib/store";
import {
  CHUNK_KEPT_MARKER,
  cacheKey,
  chunkMarkdown,
  formatDocument,
  resolveFormatterSkill,
  SETTING_FORMAT_SKILL,
  type FormatterSkill,
} from "@/lib/document-format";

/**
 * TEST-520 — `src/lib/document-format.ts`（REQ-F-290；DEC-400/401；CR-20260921-format-skill）。
 *
 * The completer is injected — no provider, no network. The module's own logic is what is
 * under test: chunking, the shrink guard, the all-failed fallback, the cache, and skill
 * resolution. Whether the *model* formats well is a real-entry question (CR 验收条件 ④).
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-doc-format-"));
const cacheDir = join(dir, "cache");
const skillDir = join(dir, "skill");
let store: Store;

const skill: FormatterSkill = { id: "skill-1", name: "排版", dirPath: skillDir };
const bytes = Buffer.from("%PDF-1.4 fake bytes");

function completerReturning(fn: (chunk: string) => string) {
  return vi.fn(async (messages: Array<{ role: string; content: string }>) => fn(messages[messages.length - 1]!.content));
}

beforeEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: 排版\ndescription: d\n---\n\n把标题恢复成 # 层级。", "utf8");
  store?.close?.();
  store = createStore(join(dir, `s-${Date.now()}-${Math.random()}.sqlite`), "0123456789abcdef0123456789abcdef");
});

afterAll(() => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("chunkMarkdown", () => {
  it("① 按空行分段打包，不超过预算；超大单段自己成块并可见截断", () => {
    const small = Array.from({ length: 6 }, (_, i) => `段落 ${i} ` + "字".repeat(300)).join("\n\n");
    const chunks = chunkMarkdown(small, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n").replace(/\s+/g, "")).toBe(small.replace(/\s+/g, ""));

    const huge = "表".repeat(20_000);
    const [only] = chunkMarkdown(huge, 500);
    expect(only).toContain("截断");
  });
});

describe("formatDocument", () => {
  it("② 正常路径：逐块交给 completer，拼回全文，status=formatted，并落盘缓存", async () => {
    const completer = completerReturning((chunk) => `# 已排版\n\n${chunk}`);
    const markdown = "第一段\n\n第二段";
    const result = await formatDocument({ store, userId: "u1", skill, bytes, markdown, completer, model: "m", cacheDir });
    expect(result.status).toBe("formatted");
    expect(result.markdown).toContain("已排版");
    expect(result.markdown).toContain("第二段");
    expect(result.note).toBe("");
    expect(completer).toHaveBeenCalledTimes(1);
    expect(readdirSync(cacheDir)).toHaveLength(1);
  });

  it("③ 缩水兜底：某块输出低于输入的 40% 时保留该块原文并加标注，status=partial，note 点明段数", async () => {
    // 两段各约 4,000 token（CJK 按 1.5 字/token 估算），刚好各占一个 5,000 token 的分块，
    // 这样第一块被判缩水、第二块正常，才能得到 partial 而不是整体 unformatted。
    const long = "这是一段很长的原文，" + "内容".repeat(3_000);
    const other = "另一段".repeat(2_000);
    const completer = completerReturning((chunk) => (chunk.startsWith("这是一段很长") ? "太短" : `OK ${chunk}`));
    const result = await formatDocument({
      store,
      userId: "u1",
      skill,
      bytes,
      markdown: `${long}\n\n${other}`,
      completer,
      model: "m",
      cacheDir,
    });
    expect(completer).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("partial");
    expect(result.keptVerbatim).toBeGreaterThanOrEqual(1);
    expect(result.markdown).toContain(CHUNK_KEPT_MARKER);
    expect(result.markdown).toContain(long);
    expect(result.note).toContain("保留原文");
  });

  it("④ 全部失败（completer 抛错）：退回原文，status=unformatted，且不写缓存", async () => {
    const completer = vi.fn(async () => {
      throw new Error("provider down");
    });
    const result = await formatDocument({ store, userId: "u1", skill, bytes, markdown: "原文", completer, model: "m", cacheDir });
    expect(result.status).toBe("unformatted");
    expect(result.markdown).toBe("原文");
    expect(result.note).toContain("未经排版");
    // 没有任何成功的块就不该落缓存——连目录都不该被创建出来。
    expect(existsSync(cacheDir)).toBe(false);
  });

  it("⑤ 缓存命中：同一字节+技能+模型第二次不再调用 completer，status=cached", async () => {
    const completer = completerReturning((chunk) => `# X\n\n${chunk}`);
    await formatDocument({ store, userId: "u1", skill, bytes, markdown: "原文", completer, model: "m", cacheDir });
    const second = await formatDocument({ store, userId: "u1", skill, bytes, markdown: "原文", completer, model: "m", cacheDir });
    expect(second.status).toBe("cached");
    expect(completer).toHaveBeenCalledTimes(1);
  });

  it("⑥ 缓存键随字节/技能 id/模型任一变化而变化", () => {
    const base = cacheKey({ bytes, skillId: "s", model: "m" });
    expect(cacheKey({ bytes: Buffer.from("other"), skillId: "s", model: "m" })).not.toBe(base);
    expect(cacheKey({ bytes, skillId: "s2", model: "m" })).not.toBe(base);
    expect(cacheKey({ bytes, skillId: "s", model: "m2" })).not.toBe(base);
    expect(cacheKey({ bytes, skillId: "s", model: "m" })).toBe(base);
  });

  it("⑦ 没有可用 Provider 且未注入 completer：退回原文并说明原因，不抛错", async () => {
    const result = await formatDocument({ store, userId: "nobody", skill, bytes, markdown: "原文", cacheDir });
    expect(result.status).toBe("unformatted");
    expect(result.note).toContain("Provider");
  });

  it("⑧ SKILL.md 为空：退回原文并点名技能", async () => {
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: 排版\n---\n", "utf8");
    const completer = completerReturning((chunk) => chunk);
    const result = await formatDocument({ store, userId: "u1", skill, bytes, markdown: "原文", completer, model: "m", cacheDir });
    expect(result.status).toBe("unformatted");
    expect(result.note).toContain("排版");
    expect(completer).not.toHaveBeenCalled();
  });
});

describe("resolveFormatterSkill", () => {
  it("⑨ 未设置 → null 且非 stale；指向已注册技能 → 返回它；指向不存在的 id → null 且 stale", () => {
    expect(resolveFormatterSkill(store, "u1")).toEqual({ skill: null, stale: false });

    const record = store.insertSkill("u1", { name: "排版", description: "d", dirPath: skillDir });
    store.setSetting(SETTING_FORMAT_SKILL, record.id);
    const found = resolveFormatterSkill(store, "u1");
    expect(found.stale).toBe(false);
    expect(found.skill?.id).toBe(record.id);
    expect(found.skill?.dirPath).toBe(skillDir);

    store.setSetting(SETTING_FORMAT_SKILL, "gone");
    expect(resolveFormatterSkill(store, "u1")).toEqual({ skill: null, stale: true });
  });
});
