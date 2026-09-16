import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildModuleGraph,
  checkClientServerClosure,
  checkCycles,
  checkLayering,
  extractImports,
  LIB_TO_TOOLS_KNOWN_EXCEPTIONS,
  runChecks,
} from "../scripts/check-module-graph.mjs";

/**
 * scripts/check-module-graph.mjs (dependency-and-hygiene audit, 2026-09-15).
 *
 * The direct trigger: `src/lib/documents.ts` wanted a helper from
 * `src/lib/insight-export.ts`, which itself imported `documents.ts` — a cycle found
 * only by a one-off manual audit, fixed by sinking the shared function into a new leaf
 * module (`src/lib/html-text.ts`). The audit also found that `src/components/**` is
 * currently clean of any path to `node:*` / `store-singleton.ts` / `node:sqlite`, but
 * that nothing enforces it — no file in the repo imports `"server-only"` — so that
 * cleanliness is an accident of discipline, not a guarantee. These tests turn both
 * findings into a standing regression anchor: real-repo assertions below fail the
 * moment either regresses, and the fixtures prove the detector actually discriminates
 * on the two things the audit called out as easy to get backwards — `import type`
 * must count for cycle detection but must NOT count for the client/server closure
 * check, or the closure check is trivially defeated by one `import type`.
 */

/** Write `files` (relative path -> content) under a fresh temp dir, run `check` against
 * its root, and always clean up — even when `check` throws via a failed assertion. */
function withFixture(files: Record<string, string>, check: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "module-graph-fixture-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const abs = join(root, ...relPath.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("module dependency graph — real repository (regression anchor)", () => {
  const result = runChecks(process.cwd());

  it("scans a substantial share of the real src tree", () => {
    // A sanity floor, not a precise count — the point is "the walker actually found
    // the tree", not pinning an exact file count that would rot on every new file.
    expect(result.filesScanned).toBeGreaterThan(50);
  });

  it("src/lib/** (excluding tools/) has no import cycle, including type-only edges", () => {
    if (!result.cycles.ok) {
      console.error(
        "Module graph cycles found:\n" + result.cycles.cycles.map((c) => "  " + c.join(" -> ")).join("\n")
      );
    }
    expect(result.cycles.ok).toBe(true);
  });

  it("has no layering violations (lib -> components/app, or a new lib -> tools edge)", () => {
    if (!result.layering.ok) {
      console.error(
        "Layering violations found:\n" +
          result.layering.violations.map((v) => `  ${v.from} -> ${v.to} (${v.rule})`).join("\n")
      );
    }
    expect(result.layering.ok).toBe(true);
  });

  it("no src/components/** file has a value-import path reaching server-only code", () => {
    if (!result.closure.ok) {
      console.error(
        "Client/server closure violations found:\n" +
          result.closure.violations.map((v) => "  " + v.path.join(" -> ")).join("\n")
      );
    }
    expect(result.closure.ok).toBe(true);
  });

  it("the frozen lib -> tools allowlist matches exactly what the repo uses today", () => {
    // Not "at least covered" — exact, both directions: every edge the allowlist
    // grants actually exists (a stale entry would hide a real revert-the-edge PR from
    // this test), and the layering check above already proves no edge exists outside
    // the allowlist.
    const graph = result.graph;
    const actual = graph.edges
      .filter(
        (e) =>
          e.to && e.from.startsWith("src/lib/") && !e.from.startsWith("src/lib/tools/") && e.to.startsWith("src/lib/tools/")
      )
      .map((e) => `${e.from} -> ${e.to}`);
    const uniqueActual = [...new Set(actual)].sort();
    const uniqueAllowed = [...new Set(LIB_TO_TOOLS_KNOWN_EXCEPTIONS.map((e) => `${e.from} -> ${e.to}`))].sort();
    expect(uniqueActual).toEqual(uniqueAllowed);
  });
});

describe("checkCycles — type-only edges must count", () => {
  it("catches a cycle that only closes through an `import type` edge", () => {
    // A (value) -> B, B (type-only) -> A. A value-edges-only scan would see a DAG;
    // this is exactly the shape of the 2026-09-15 near-miss (library.ts -> documents.ts
    // was the type-only half of that cycle).
    withFixture(
      {
        "src/lib/a.ts": [
          'import { bValue } from "./b";',
          "",
          "export const aValue = bValue + 1;",
          'export type AType = { tag: "a" };',
          "",
        ].join("\n"),
        "src/lib/b.ts": [
          'import type { AType } from "./a";',
          "",
          "export const bValue = 1;",
          "export type BUsesA = AType;",
          "",
        ].join("\n"),
      },
      (root) => {
        const graph = buildModuleGraph(root);
        const result = checkCycles(graph);
        expect(result.ok).toBe(false);
        expect(result.cycles.length).toBeGreaterThan(0);
        const joined = result.cycles.map((c) => c.join(" -> ")).join(" | ");
        expect(joined).toContain("src/lib/a.ts");
        expect(joined).toContain("src/lib/b.ts");
      }
    );
  });

  it("does not flag two files that just both import a common leaf (not a cycle)", () => {
    withFixture(
      {
        "src/lib/leaf.ts": "export const leaf = 1;\n",
        "src/lib/left.ts": 'import { leaf } from "./leaf";\nexport const left = leaf;\n',
        "src/lib/right.ts": 'import { leaf } from "./leaf";\nexport const right = leaf;\n',
      },
      (root) => {
        const result = checkCycles(buildModuleGraph(root));
        expect(result.ok).toBe(true);
        expect(result.cycles).toEqual([]);
      }
    );
  });
});

describe("checkClientServerClosure — type-only edges must be excluded", () => {
  it("does not flag a component that reaches node:fs only through `import type`", () => {
    withFixture(
      {
        // Value-imports node:fs, so `danger.ts` itself is server-only...
        "src/lib/danger.ts": [
          'import { readFileSync } from "node:fs";',
          "",
          "export type Danger = typeof readFileSync;",
          "export const touchFs = readFileSync;",
          "",
        ].join("\n"),
        // ...but this component only takes a *type* from it, which TS erases entirely —
        // no runtime edge, so it must not be flagged. This is the exact bypass the
        // audit warned a naive (non-type-aware) closure scan would be defeated by.
        "src/components/SafeComp.tsx": [
          'import type { Danger } from "../lib/danger";',
          "",
          "export function SafeComp(): null {",
          "  return null;",
          "}",
          "export type UsesDanger = Danger;",
          "",
        ].join("\n"),
      },
      (root) => {
        const result = checkClientServerClosure(buildModuleGraph(root));
        expect(result.ok).toBe(true);
        expect(result.violations).toEqual([]);
      }
    );
  });

  it("catches a component that reaches node:fs through a real value import", () => {
    withFixture(
      {
        "src/lib/danger2.ts": ['import { readFileSync } from "node:fs";', "", "export const leak = readFileSync;", ""].join(
          "\n"
        ),
        "src/components/UnsafeComp.tsx": [
          'import { leak } from "../lib/danger2";',
          "",
          "export function UnsafeComp(): unknown {",
          "  return leak;",
          "}",
          "",
        ].join("\n"),
      },
      (root) => {
        const result = checkClientServerClosure(buildModuleGraph(root));
        expect(result.ok).toBe(false);
        expect(result.violations).toHaveLength(1);
        const [violation] = result.violations;
        expect(violation.component).toBe("src/components/UnsafeComp.tsx");
        expect(violation.path[0]).toBe("src/components/UnsafeComp.tsx");
        expect(violation.path.at(-1)).toBe("node:fs");
      }
    );
  });

  it("discriminates the two cases in the same graph (not just always-pass/always-fail)", () => {
    // Combines the previous two shapes into one fixture so a detector that always
    // returns `ok` (or always flags everything) cannot pass by accident.
    withFixture(
      {
        "src/lib/danger.ts": [
          'import { readFileSync } from "node:fs";',
          "",
          "export type Danger = typeof readFileSync;",
          "export const touchFs = readFileSync;",
          "",
        ].join("\n"),
        "src/components/SafeComp.tsx": [
          'import type { Danger } from "../lib/danger";',
          "",
          "export type UsesDanger = Danger;",
          "",
        ].join("\n"),
        "src/components/UnsafeComp.tsx": [
          'import { touchFs } from "../lib/danger";',
          "",
          "export const leak = touchFs;",
          "",
        ].join("\n"),
      },
      (root) => {
        const result = checkClientServerClosure(buildModuleGraph(root));
        const flagged = result.violations.map((v) => v.component);
        expect(flagged).toContain("src/components/UnsafeComp.tsx");
        expect(flagged).not.toContain("src/components/SafeComp.tsx");
      }
    );
  });

  it("catches a component reaching store-singleton.ts, and via a dynamic import()", () => {
    withFixture(
      {
        "src/lib/store-singleton.ts": "export const singleton = { ready: true };\n",
        "src/components/DynamicComp.tsx": [
          "export async function load() {",
          '  const { singleton } = await import("../lib/store-singleton");',
          "  return singleton;",
          "}",
          "",
        ].join("\n"),
      },
      (root) => {
        const result = checkClientServerClosure(buildModuleGraph(root));
        expect(result.ok).toBe(false);
        expect(result.violations[0].path.at(-1)).toBe("src/lib/store-singleton.ts");
      }
    );
  });
});

describe("checkLayering", () => {
  it("catches a lib module that value-imports a component", () => {
    withFixture(
      {
        "src/components/Comp.tsx": "export function Comp(): null {\n  return null;\n}\n",
        "src/lib/bad.ts": ['import { Comp } from "../components/Comp";', "", "export const useComp = Comp;", ""].join("\n"),
      },
      (root) => {
        const result = checkLayering(buildModuleGraph(root));
        expect(result.ok).toBe(false);
        expect(result.violations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              from: "src/lib/bad.ts",
              to: "src/components/Comp.tsx",
              rule: "lib-must-not-import-components-or-app",
            }),
          ])
        );
      }
    );
  });

  it("catches a new src/lib/* -> src/lib/tools/** edge that is not on the allowlist", () => {
    withFixture(
      {
        "src/lib/tools/sometool.ts": "export const tool = 1;\n",
        "src/lib/newcaller.ts": ['import { tool } from "./tools/sometool";', "", "export const used = tool;", ""].join("\n"),
      },
      (root) => {
        const result = checkLayering(buildModuleGraph(root));
        expect(result.ok).toBe(false);
        expect(result.violations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              from: "src/lib/newcaller.ts",
              to: "src/lib/tools/sometool.ts",
              rule: "new-lib-to-tools-edge",
            }),
          ])
        );
      }
    );
  });

  it("does not flag src/lib/tools/** importing back from src/lib/* (unrestricted)", () => {
    withFixture(
      {
        "src/lib/helper.ts": "export const helper = 1;\n",
        "src/lib/tools/sometool.ts": ['import { helper } from "../helper";', "", "export const tool = helper;", ""].join(
          "\n"
        ),
      },
      (root) => {
        const result = checkLayering(buildModuleGraph(root));
        expect(result.ok).toBe(true);
      }
    );
  });

  it("leaves src/components/** -> src/lib/** unjudged (the closure check's job, not this one)", () => {
    withFixture(
      {
        "src/lib/safe.ts": "export const safe = 1;\n",
        "src/components/Comp.tsx": ['import { safe } from "../lib/safe";', "", "export const used = safe;", ""].join("\n"),
      },
      (root) => {
        const result = checkLayering(buildModuleGraph(root));
        expect(result.ok).toBe(true);
      }
    );
  });
});

describe("extractImports — type-only classification", () => {
  it("treats `import type { X }` and inline `import { type X }` as fully type-only", () => {
    const edges = extractImports('import type { A } from "./a";\nimport { type B } from "./b";\n');
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.typeOnly)).toBe(true);
  });

  it("treats a mixed inline clause as a value edge, since one binding is real", () => {
    const edges = extractImports('import { type A, B } from "./ab";\n');
    expect(edges).toHaveLength(1);
    expect(edges[0].typeOnly).toBe(false);
  });

  it("treats a default import combined with an inline-typed named import as a value edge", () => {
    const edges = extractImports('import Def, { type A } from "./def";\n');
    expect(edges).toHaveLength(1);
    expect(edges[0].typeOnly).toBe(false);
  });

  it("treats a bare side-effect import as a value edge", () => {
    const edges = extractImports('import "./polyfill";\n');
    expect(edges).toHaveLength(1);
    expect(edges[0].typeOnly).toBe(false);
    expect(edges[0].kind).toBe("import-bare");
  });

  it("treats dynamic import() as a value edge", () => {
    const edges = extractImports('async function f() {\n  return import("./lazy");\n}\n');
    expect(edges).toHaveLength(1);
    expect(edges[0].typeOnly).toBe(false);
    expect(edges[0].kind).toBe("import-dynamic");
  });

  it("does not manufacture an edge from an import mentioned inside a comment or a string", () => {
    const edges = extractImports(
      [
        "// import { ghost } from \"./ghost\";",
        "/* also import { ghost2 } from \"./ghost2\"; */",
        'const s = "please import { ghost3 } from \\"./ghost3\\" by hand";',
        'import { real } from "./real";',
        "",
      ].join("\n")
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].specifier).toBe("./real");
  });

  it("classifies `export type { X } from` as type-only (the display.ts -> ui-events.ts shape)", () => {
    const edges = extractImports('export type { DisplayView } from "./ui-events";\n');
    expect(edges).toHaveLength(1);
    expect(edges[0].typeOnly).toBe(true);
    expect(edges[0].kind).toBe("export-from");
  });

  it("classifies a value `export { X } from` as a value edge", () => {
    const edges = extractImports('export { real } from "./real";\n');
    expect(edges).toHaveLength(1);
    expect(edges[0].typeOnly).toBe(false);
  });
});
