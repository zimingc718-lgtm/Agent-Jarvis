import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * TEST-581 — no Chinese literal outside the dictionary (REQ-F-340 ④, DEC-460 ③;
 * CR-20260928-ui-strings-i18n). Every string the browser shows lives in `src/lib/i18n.ts`
 * and reaches a component through `useT()` / `t()`. This walks the TypeScript syntax tree
 * of the browser-facing sources — string literals, template literals and JSX text; comments
 * are not nodes and are ignored — and fails on any CJK character it finds, with the exact
 * `file:line` so the fix is obvious.
 *
 * Scope is the user's ruling ②: `src/components` and the pages under `src/app` (not the API
 * routes, whose messages are server text and a candidate for the next step).
 */
const ROOT = join(__dirname, "..");
const SCAN_ROOTS = [join(ROOT, "src", "components"), join(ROOT, "src", "app")];
const EXCLUDED_DIRS = [join(ROOT, "src", "app", "api")];
const CJK = /[㐀-鿿豈-﫿]/;
/**
 * Not copy: data keys the components must spell exactly as the server does. The one entry is
 * `KnowledgeDashboard`'s `GENERAL_ENTITY`, mirrored from `knowledge-tools.ts` and pinned to it by
 * `tests/knowledge-dashboard.test.tsx`. Anything added here needs the same kind of reason.
 */
const ALLOWED_LITERALS = new Set(["__通用__"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (EXCLUDED_DIRS.some((excluded) => full === excluded || full.startsWith(excluded + "\\") || full.startsWith(excluded + "/"))) {
      continue;
    }
    if (statSync(full).isDirectory()) {
      sources(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function chineseLiterals(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    let literal: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      literal = node.text;
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      literal = node.text;
    }
    if (literal !== null && CJK.test(literal) && !ALLOWED_LITERALS.has(literal)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      hits.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${line + 1}  ${literal.trim().slice(0, 60)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("TEST-581 界面源码不得出现未走字典的中文", () => {
  const files = SCAN_ROOTS.flatMap((dir) => sources(dir));

  it("① 扫描范围覆盖组件与页面，且不是空集", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("FloatingChat.tsx"))).toBe(true);
    expect(files.some((f) => f.replace(/\\/g, "/").endsWith("src/app/page.tsx"))).toBe(true);
    expect(files.some((f) => f.replace(/\\/g, "/").includes("/src/app/api/"))).toBe(false);
  });

  it("② 字符串、模板与 JSX 文本里没有中文——有就把它放进 src/lib/i18n.ts 并经 useT()/t() 引用", () => {
    const hits = files.flatMap(chineseLiterals);
    expect(hits, `未走字典的中文字面量：\n${hits.join("\n")}`).toEqual([]);
  });
});
