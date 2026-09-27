import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TEST-560 — the architecture document keeps up with the code
 * (CR-20260927-architecture-doc, DEC-440; INPUT-2026-09-27-001「当新功能或者新重构变化后，更新这个架构图」).
 *
 * `docs/ARCHITECTURE.md` is the source of the architecture diagram. Every module, top-level
 * component, API route, SQLite table and runtime dependency in the repository must be named
 * in it; a CR that adds one without touching the document goes red here. The check is
 * deliberately literal — it proves the name appears, not that the layer or arrow is right.
 * That part is the reviewer's, and the maintenance rule in the document says so.
 */

const ROOT = process.cwd();
const doc = readFileSync(join(ROOT, "docs", "ARCHITECTURE.md"), "utf8");

function filesIn(dir: string, ext: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
    .map((entry) => entry.name)
    .sort();
}

/** `/api/skills/proposals/[id]` for `src/app/api/skills/proposals/[id]/route.ts`. */
function apiRoutes(dir = "src/app/api", found: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      apiRoutes(rel, found);
    } else if (entry.name === "route.ts") {
      found.push(`/${dir.replace(/^src\/app\//, "")}`);
    }
  }
  return found.sort();
}

function missingFromDoc(items: string[]): string[] {
  return items.filter((item) => !doc.includes(item));
}

describe("docs/ARCHITECTURE.md 与源码清单一致（TEST-560）", () => {
  it("① src/lib 与 src/lib/tools 的每个模块都出现在架构图里", () => {
    const modules = [...filesIn("src/lib", ".ts"), ...filesIn("src/lib/tools", ".ts")];
    expect(modules.length).toBeGreaterThan(20);
    expect(missingFromDoc(modules)).toEqual([]);
  });

  it("② src/components 的每个顶层组件都出现在架构图里", () => {
    const components = filesIn("src/components", ".tsx").map((name) => name.replace(/\.tsx$/, ""));
    expect(components.length).toBeGreaterThan(10);
    expect(missingFromDoc(components)).toEqual([]);
  });

  it("③ 每条 API 路由都出现在架构图里", () => {
    const routes = apiRoutes();
    expect(routes.length).toBeGreaterThan(20);
    expect(missingFromDoc(routes)).toEqual([]);
  });

  it("④ 每张 SQLite 表都出现在架构图里", () => {
    const sql =
      readFileSync(join(ROOT, "src", "lib", "store.ts"), "utf8") + readFileSync(join(ROOT, "src", "lib", "migrations.ts"), "utf8");
    const tables = [...new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((match) => match[1]))];
    expect(tables.length).toBeGreaterThan(5);
    expect(missingFromDoc(tables)).toEqual([]);
  });

  it("⑤ 每个运行依赖（npm dependencies 与 requirements.txt）都出现在架构图里", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    const npm = Object.keys(pkg.dependencies ?? {});
    const python = readFileSync(join(ROOT, "requirements.txt"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\[.*$/, "").replace(/[=<>~!].*$/, ""))
      .filter(Boolean);
    expect(npm.length).toBeGreaterThan(3);
    expect(python.length).toBeGreaterThan(0);
    expect(missingFromDoc([...npm, ...python])).toEqual([]);
  });

  it("⑥ 文首写明日期与所依据的 main 提交，维护规则一节存在", () => {
    expect(doc).toMatch(/截至 \d{4}-\d{2}-\d{2}/);
    expect(doc).toMatch(/main `[0-9a-f]{7,}`/);
    expect(doc).toContain("## 6. 维护规则");
    expect(doc).toContain("tests/architecture-doc.test.ts");
  });
});
