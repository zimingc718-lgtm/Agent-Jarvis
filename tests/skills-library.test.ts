import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_INJECTION_BYTES, resolveSkillForTurn, slugifySkillName } from "@/lib/skills";

/**
 * TEST-128 — the skill library that ships with the repo
 * (CR-20260911-knowledge-skills).
 *
 * What a machine can check about a skill is narrow but worth having: that each folder is
 * actually installable, that its text fits the per-turn injection budget, and that the
 * repo folder stays inert — no runtime code may read it, because runtime skills live in
 * `.data/skills` and are registered through the existing drop-a-folder entry.
 *
 * Whether the model actually follows these documents is a real-entry matter and is
 * registered as such in the CR.
 */

const LIBRARY = join(process.cwd(), "skills");
const EXPECTED = ["知识条目规范", "证据规范", "竞品跟踪", "并网规则跟踪", "客户技术准入解读", "报告生成"];

function folders(): string[] {
  return readdirSync(LIBRARY).filter((entry) => statSync(join(LIBRARY, entry)).isDirectory());
}

describe("skills library", () => {
  it("① 六本技能齐备，纪律类两本在列", () => {
    expect(folders().sort()).toEqual([...EXPECTED].sort());
  });

  it("② 每本都有 SKILL.md，且带可被登记解析的 name / description 前置块", () => {
    for (const folder of folders()) {
      const raw = readFileSync(join(LIBRARY, folder, "SKILL.md"), "utf8");
      const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
      expect(match, `${folder} 缺少前置块`).not.toBeNull();
      const head = match![1];
      expect(head, `${folder} 缺少 name`).toMatch(/^name:\s*\S+/m);
      expect(head, `${folder} 缺少 description`).toMatch(/^description:\s*\S+/m);
      // The description is what the picker shows; a placeholder there is worse than none.
      expect(head).not.toContain("（未生成描述）");
    }
  });

  it("③ 文件夹名能 slug 化后原样保留，拖进去不会变成空名", () => {
    for (const folder of folders()) {
      expect(slugifySkillName(folder), `${folder} slug 为空`).not.toBe("");
    }
  });

  it("④ 每本注入后都在单轮 32KB 预算之内，且不触发截断", async () => {
    for (const folder of folders()) {
      const text = await resolveSkillForTurn(join(LIBRARY, folder));
      expect(text.length, `${folder} 注入为空`).toBeGreaterThan(0);
      expect(Buffer.byteLength(text, "utf8"), `${folder} 超出注入预算`).toBeLessThan(MAX_INJECTION_BYTES);
      expect(text).not.toContain("已截断");
    }
  });

  it("⑤ 仓库里的 skills/ 不被任何运行代码读取——运行时技能在 .data/skills", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx|mjs|js)$/.test(entry)) {
          continue;
        }
        const source = readFileSync(path, "utf8");
        // A literal path into the repo library; SKILLS_ROOT (.data/skills) is the only
        // location runtime code may resolve.
        if (/["'`](\.\/)?skills\/(?!\*)/.test(source) || source.includes('join(process.cwd(), "skills")')) {
          offenders.push(path);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
