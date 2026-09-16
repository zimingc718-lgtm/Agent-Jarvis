#!/usr/bin/env node
/**
 * Agent-Jarvis Module Graph Contract
 * ===================================
 * A zero-dependency, regex-based dependency-graph checker for `src/**\/*.ts(x)`.
 *
 * Why this exists (2026-09-15 incident): `src/lib/documents.ts` wanted a helper from
 * `src/lib/insight-export.ts`, which itself imported `documents.ts` — a cycle, found
 * only by a human running a one-off dependency audit. The fix was to sink the shared
 * function into a new leaf module (`src/lib/html-text.ts`). This script turns that
 * audit into a regression anchor: it re-derives the same import graph from source on
 * every run and fails loudly the moment a new cycle, a layering inversion, or a
 * client-bundle leak of server-only code appears, instead of waiting for the next
 * manual audit to notice.
 *
 * No new runtime dependency is used (this project treats a new dependency as an L3
 * change) — imports are found with hand-written regexes over a lightweight
 * comment/string-aware scanner, not a real parser (no madge / ts-morph / typescript
 * compiler API). That is a deliberate trade: fast and dependency-free, and *not* a
 * substitute for `tsc`. Known blind spots are called out inline where a shortcut is
 * taken (see `maskCommentsAndStrings` and the dynamic-import notes below).
 *
 * Three checks, run together:
 *
 *   1. Cycles       `src/lib/**` (excluding `src/lib/tools/**`, owned by the layering
 *                    check below) must be a DAG. `import type` edges count: the
 *                    2026-09-15 near-miss was exactly a type-only edge
 *                    (`library.ts -> documents.ts`) — invisible at runtime, but still a
 *                    real circular reference at the TS level, and the shape that
 *                    actually bit this repo.
 *   2. Layering     `src/lib/**` (tools included) must never import `src/components/**`
 *                    or `src/app/**`. `src/lib/*` (excluding `src/lib/tools/**`) must
 *                    never import `src/lib/tools/**` except through a fixed, currently
 *                    13-entry allowlist of edges that already exist for a specific
 *                    reason (chat.ts wiring up the tool registry, etc.) — a 14th edge is
 *                    a new architectural decision, not a typo, and must fail until
 *                    someone reviews it and adds it to the list on purpose.
 *   3. Client leak  Nothing under `src/components/**` may have a *value* (non-type)
 *                    import path reaching a `node:*` builtin, `src/lib/store-singleton.ts`,
 *                    or a file that itself value-imports `node:sqlite`. This is the
 *                    repo's stand-in for `import "server-only"`, which nothing here
 *                    uses (2026-09-15 audit: zero hits) — so today this is the *only*
 *                    machine check standing between an innocent-looking new import and
 *                    a broken client bundle.
 *
 * Usage:
 *   node scripts/check-module-graph.mjs
 *
 * Exit codes: 0 = PASS (all three checks clean), 1 = FAIL (see the printed FAIL lines).
 * Output lines start with "OK " / "FAIL " so other tooling can grep for them.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/* ------------------------------------------------------------------ */
/* file discovery                                                      */
/* ------------------------------------------------------------------ */

const SKIP_DIRS = new Set(["node_modules", ".git", ".claude"]);

function isSkippedDir(name) {
  // `.next`, `.next-prod`, `.next-verify`, ... plus the defensive fixed names above.
  return SKIP_DIRS.has(name) || name.startsWith(".next");
}

function toPosix(p) {
  return p.split(sep).join("/");
}

/** Recursively collect `src/**\/*.ts` and `src/**\/*.tsx` under `root`, sorted, as
 * POSIX-style paths relative to `root` (e.g. `"src/lib/chat.ts"`). */
export function listSourceFiles(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isSkippedDir(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))) {
        out.push(toPosix(relative(root, join(dir, entry.name))));
      }
    }
  }
  walk(join(root, "src"));
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* comment/string-aware masking                                        */
/* ------------------------------------------------------------------ */

/**
 * Blank out `//` and `/* *\/` comments (replacing their characters with spaces, keeping
 * newlines so the line-anchored regexes below stay correct) while copying string and
 * template-literal contents through untouched — so a `//` inside `"http://x"` is never
 * mistaken for a comment start, and an `import ...` line written inside a comment never
 * turns into a phantom edge.
 *
 * Known limitation: a template literal is read as "run to the next unescaped backtick",
 * so a nested backtick inside a `${...}` interpolation (rare, and never used around an
 * import specifier in this codebase) can desync the scanner for the remainder of the
 * file. This is a regex-based tool, not a parser — see the file header.
 */
export function maskCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      out += source.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else if (two === "/*") {
      let j = i + 2;
      while (j < n && source.slice(j, j + 2) !== "*/") j++;
      j = Math.min(j + 2, n);
      out += source.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* import/export extraction                                            */
/* ------------------------------------------------------------------ */

const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s+["']([^"']+)["']\s*;?/gm;
const IMPORT_FROM_RE = /^[ \t]*import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']\s*;?/gm;
const EXPORT_FROM_RE =
  /^[ \t]*export\s+(type\s+)?(\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[\s\S]*?\})\s*from\s*["']([^"']+)["']\s*;?/gm;
// Dynamic import() is always treated as a value edge. TS also allows `import("x").T` in
// a *type* position (`type Foo = import("./x").Bar`); this codebase does not use that
// form anywhere (checked 2026-09-15), so it is not special-cased here — a project that
// starts using it would need this regex to also inspect the surrounding context.
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** True when every entry in a `{ ... }` clause body is individually `type`-prefixed. */
function allEntriesTypeOnly(braceInner) {
  const inner = braceInner.trim();
  if (!inner) return false; // `{}` still evaluates the module — side-effecting, not type-only
  const entries = inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) return false;
  return entries.every((entry) => /^type\s+/.test(entry));
}

/** Is a (non-`import type`) `import <clause> from "x"` clause fully type-only? */
function importClauseIsTypeOnly(clause) {
  const trimmed = clause.trim();
  const braceMatch = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braceMatch) return false; // a default and/or namespace binding is present -> a value
  return allEntriesTypeOnly(braceMatch[1]);
}

/** Is a (non-`export type`) `export <clause> from "x"` clause fully type-only? */
function exportClauseIsTypeOnly(clause) {
  const trimmed = clause.trim();
  if (trimmed.startsWith("*")) return false; // `export * [as NS] from` always re-exports values
  const braceMatch = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braceMatch) return false;
  return allEntriesTypeOnly(braceMatch[1]);
}

/**
 * Extract every import-like edge from one file's source. Returns raw specifiers,
 * unresolved — `resolveSpecifier` turns them into project-relative paths.
 *
 * Recognises: static `import ... from "x"` / bare `import "x"`; named `import type
 * { X }` and inline `import { type X }` (classified as type-only only when *every*
 * named entry is `type`-prefixed and there is no default/namespace binding — a mixed
 * `import { type X, Y } from "x"` is a value edge because `Y` is real); dynamic
 * `import(...)`; and `export ... from "x"` re-exports (same type-only nuance) — not
 * asked for verbatim in the task list, but a real edge with real cycle risk, and used
 * once in this codebase (`src/lib/display.ts` re-exports a type from `ui-events.ts`),
 * so leaving it unscanned would silently drop a real dependency from the graph.
 */
export function extractImports(source) {
  const masked = maskCommentsAndStrings(source);
  const edges = [];

  for (const m of masked.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    edges.push({ specifier: m[1], typeOnly: false, kind: "import-bare" });
  }

  for (const m of masked.matchAll(IMPORT_FROM_RE)) {
    const [, leadingType, clause, specifier] = m;
    const typeOnly = Boolean(leadingType) || importClauseIsTypeOnly(clause);
    edges.push({ specifier, typeOnly, kind: "import" });
  }

  for (const m of masked.matchAll(EXPORT_FROM_RE)) {
    const [, leadingType, clause, specifier] = m;
    const typeOnly = Boolean(leadingType) || exportClauseIsTypeOnly(clause);
    edges.push({ specifier, typeOnly, kind: "export-from" });
  }

  for (const m of masked.matchAll(DYNAMIC_IMPORT_RE)) {
    edges.push({ specifier: m[1], typeOnly: false, kind: "import-dynamic" });
  }

  return edges;
}

/* ------------------------------------------------------------------ */
/* specifier resolution                                                */
/* ------------------------------------------------------------------ */

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * Resolve `@/`-aliased and relative specifiers to a project-relative POSIX path.
 * Bare specifiers (npm packages, `node:*` builtins) resolve to `null` — kept as
 * external targets by the caller (the client/server closure check needs to see them)
 * rather than dropped.
 */
export function resolveSpecifier(specifier, fromRelPath, root) {
  let base;
  if (specifier.startsWith("@/")) {
    base = join(root, "src", specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = join(root, dirname(fromRelPath), specifier);
  } else {
    return null;
  }
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return toPosix(relative(root, candidate));
      } catch {
        /* lost a race with a concurrent writer touching the tree — treat as unresolved */
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* graph construction                                                  */
/* ------------------------------------------------------------------ */

/**
 * @typedef {{from:string, specifier:string, to:(string|null), typeOnly:boolean, kind:string}} ModuleEdge
 * @typedef {{root:string, files:string[], edges:ModuleEdge[]}} ModuleGraph
 */

/** Build the whole-repo import graph once; every check below reuses it. */
export function buildModuleGraph(root) {
  const files = listSourceFiles(root);
  const edges = [];
  for (const relPath of files) {
    const abs = join(root, ...relPath.split("/"));
    let source;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const raw of extractImports(source)) {
      const to = resolveSpecifier(raw.specifier, relPath, root);
      edges.push({ from: relPath, specifier: raw.specifier, to, typeOnly: raw.typeOnly, kind: raw.kind });
    }
  }
  return { root, files, edges };
}

/* ------------------------------------------------------------------ */
/* check 1: cycles in src/lib/** (excluding tools/)                    */
/* ------------------------------------------------------------------ */

function isLibNonTools(relPath) {
  return relPath.startsWith("src/lib/") && !relPath.startsWith("src/lib/tools/");
}

/** Tarjan's SCC algorithm over an explicit node list + adjacency (a Set per node). */
function tarjanSCC(nodes, adjacency) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  }

  for (const v of nodes) {
    if (!indices.has(v)) strongconnect(v);
  }
  return sccs;
}

/** Shortest cycle (BFS) that stays inside one strongly-connected component. */
function shortestCycleInScc(component, adjacency) {
  const start = component[0];
  if (component.length === 1) return [start, start]; // self-loop

  const compSet = new Set(component);
  const prev = new Map([[start, null]]);
  const queue = [start];
  let closingNode = null;
  while (queue.length && closingNode === null) {
    const u = queue.shift();
    for (const v of adjacency.get(u) ?? []) {
      if (!compSet.has(v)) continue;
      if (v === start) {
        closingNode = u;
        break;
      }
      if (!prev.has(v)) {
        prev.set(v, u);
        queue.push(v);
      }
    }
  }
  if (closingNode === null) return [...component, start]; // defensive fallback, should not happen

  const path = [closingNode];
  for (let cur = closingNode; prev.get(cur) !== null; ) {
    cur = prev.get(cur);
    path.push(cur);
  }
  path.reverse();
  path.push(start);
  return path;
}

/**
 * `src/lib/**` (excluding `src/lib/tools/**`, which the layering check owns) must be a
 * DAG. `import type` / `export type` edges are included on purpose — TS-level circular
 * references are exactly what caused the 2026-09-15 `library.ts -> documents.ts`
 * near-miss, and a value-edges-only scan would have missed it.
 */
export function checkCycles(graph) {
  const nodes = graph.files.filter(isLibNonTools);
  const nodeSet = new Set(nodes);
  const adjacency = new Map(nodes.map((n) => [n, new Set()]));
  for (const e of graph.edges) {
    if (e.to && nodeSet.has(e.from) && nodeSet.has(e.to)) {
      adjacency.get(e.from).add(e.to);
    }
  }
  const sccs = tarjanSCC(nodes, adjacency);
  const nonTrivial = sccs.filter((c) => c.length > 1 || adjacency.get(c[0])?.has(c[0]));
  const cycles = nonTrivial.map((c) => shortestCycleInScc(c, adjacency));
  return { ok: cycles.length === 0, cycles };
}

/* ------------------------------------------------------------------ */
/* check 2: layering                                                   */
/* ------------------------------------------------------------------ */

function isLib(relPath) {
  return relPath.startsWith("src/lib/");
}
function isLibTools(relPath) {
  return relPath.startsWith("src/lib/tools/");
}
function isComponentsOrApp(relPath) {
  return relPath.startsWith("src/components/") || relPath.startsWith("src/app/");
}

/**
 * The 13 `src/lib/*` -> `src/lib/tools/**` edges that exist today for a specific,
 * reviewed reason: `chat.ts` wiring up the tool registry (8 modules), `agent-loop.ts`
 * sharing the registry/budget types, `sources.ts` reusing the URL guard + readable-text
 * extraction, and `wake.ts` truncating by budget. Frozen on purpose — a 14th edge is a
 * new architectural decision, not a typo, and must fail here until someone reviews it
 * and adds it to this list explicitly. The reverse direction, `src/lib/tools/**`
 * importing `src/lib/*`, is unrestricted — that is the intended, normal direction.
 */
export const LIB_TO_TOOLS_KNOWN_EXCEPTIONS = [
  { from: "src/lib/agent-loop.ts", to: "src/lib/tools/budget.ts" },
  { from: "src/lib/agent-loop.ts", to: "src/lib/tools/registry.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/budget.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/registry.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/skill-tools.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/display-tools.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/knowledge-tools.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/document-tools.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/entity-tools.ts" },
  { from: "src/lib/chat.ts", to: "src/lib/tools/web-tools.ts" },
  { from: "src/lib/sources.ts", to: "src/lib/tools/web-tools.ts" },
  { from: "src/lib/sources.ts", to: "src/lib/tools/url-guard.ts" },
  { from: "src/lib/wake.ts", to: "src/lib/tools/budget.ts" },
];

// A plain, printable separator — not a literal NUL byte. A NUL-separated key
// built the same way is exactly what src/lib/sweep.ts uses for a real runtime composite
// key, but *typed as a raw control byte* it also makes git misclassify the file as
// binary (`git ls-files --eol` reports `-text`), which breaks `git diff` and every
// grep-based tool on it — precisely the failure mode this repo's own dependency audit
// documents (2026-09-15). "::" cannot appear in a POSIX relative path, so it is just as
// collision-free and has none of that cost.
function knownExceptionKey(from, to) {
  return `${from}::${to}`;
}
const KNOWN_EXCEPTION_SET = new Set(LIB_TO_TOOLS_KNOWN_EXCEPTIONS.map((e) => knownExceptionKey(e.from, e.to)));

/**
 * `src/lib/**` (tools included) must never import `src/components/**` or `src/app/**`.
 * `src/lib/*` (excluding `src/lib/tools/**`) must never import `src/lib/tools/**` except
 * through the frozen allowlist above. `src/components/** -> src/lib/**` is deliberately
 * not judged here — that is the client/server closure check's job, which replaces a
 * hand-maintained "which lib files are client-safe" list with a real reachability
 * computation instead of duplicating it as a second, driftable rule.
 */
export function checkLayering(graph) {
  const violations = [];
  for (const e of graph.edges) {
    if (!e.to) continue;
    if (isLib(e.from) && isComponentsOrApp(e.to)) {
      violations.push({ from: e.from, to: e.to, rule: "lib-must-not-import-components-or-app" });
    } else if (isLib(e.from) && !isLibTools(e.from) && isLibTools(e.to)) {
      if (!KNOWN_EXCEPTION_SET.has(knownExceptionKey(e.from, e.to))) {
        violations.push({ from: e.from, to: e.to, rule: "new-lib-to-tools-edge" });
      }
    }
  }
  const seen = new Set();
  const deduped = violations.filter((v) => {
    const key = `${v.rule}::${v.from}::${v.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ok: deduped.length === 0, violations: deduped };
}

/* ------------------------------------------------------------------ */
/* check 3: client/server closure                                      */
/* ------------------------------------------------------------------ */

/**
 * From every `src/components/**` file, BFS along *value* edges only (type-only edges
 * excluded — otherwise a single `import type` would blind this check entirely, which
 * defeats its purpose) and fail if the closure reaches: any `node:*` builtin,
 * `src/lib/store-singleton.ts`, or any file that itself value-imports `node:sqlite`
 * (redundant with the `node:*` rule today since `node:sqlite` already starts with
 * `node:`, but kept as an explicit, independent target so the check still catches it
 * even if a future file re-exports a sqlite handle without the literal specifier
 * appearing on the path). Dynamic `import()` is followed (never type-only here).
 *
 * This is the repo's stand-in for `import "server-only"`, which nothing here uses.
 */
export function checkClientServerClosure(graph) {
  const byFrom = new Map();
  for (const e of graph.edges) {
    if (e.typeOnly) continue;
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from).push(e);
  }

  const sqliteImporters = new Set(
    graph.edges.filter((e) => !e.typeOnly && e.to === null && e.specifier === "node:sqlite").map((e) => e.from)
  );

  function dangerLabel(edge) {
    if (edge.to === null) return /^node:/.test(edge.specifier) ? edge.specifier : null;
    if (edge.to === "src/lib/store-singleton.ts") return edge.to;
    if (sqliteImporters.has(edge.to)) return `${edge.to} (imports node:sqlite)`;
    return null;
  }

  const violations = [];
  for (const start of graph.files.filter((f) => f.startsWith("src/components/"))) {
    const prev = new Map([[start, null]]);
    const queue = [start];
    let found = null;
    while (queue.length && !found) {
      const cur = queue.shift();
      for (const edge of byFrom.get(cur) ?? []) {
        const label = dangerLabel(edge);
        if (label) {
          found = { via: cur, label };
          break;
        }
        if (edge.to && !prev.has(edge.to)) {
          prev.set(edge.to, cur);
          queue.push(edge.to);
        }
      }
    }
    if (found) {
      const chain = [found.via];
      for (let cur = found.via; prev.get(cur) !== null; ) {
        cur = prev.get(cur);
        chain.unshift(cur);
      }
      chain.push(found.label);
      violations.push({ component: start, path: chain });
    }
  }
  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ */
/* orchestration + CLI                                                 */
/* ------------------------------------------------------------------ */

export function runChecks(root) {
  const graph = buildModuleGraph(root);
  return {
    graph,
    filesScanned: graph.files.length,
    cycles: checkCycles(graph),
    layering: checkLayering(graph),
    closure: checkClientServerClosure(graph),
  };
}

/** Turn a `runChecks()` result into the `OK ` / `FAIL ` lines the CLI prints. */
export function formatReport(result) {
  const lines = [];
  for (const cycle of result.cycles.cycles) {
    lines.push(`FAIL MODULE_GRAPH_CYCLE ${cycle.join(" -> ")}`);
  }
  for (const v of result.layering.violations) {
    lines.push(`FAIL MODULE_GRAPH_LAYERING ${v.from} -> ${v.to} (${v.rule})`);
  }
  for (const v of result.closure.violations) {
    lines.push(`FAIL MODULE_GRAPH_CLIENT_LEAK ${v.path.join(" -> ")}`);
  }
  const ok = result.cycles.ok && result.layering.ok && result.closure.ok;
  if (ok) {
    lines.push(
      `OK MODULE_GRAPH_PASS ${result.filesScanned} files scanned, ` +
        `${result.cycles.cycles.length} cycle(s), ` +
        `${result.layering.violations.length} layering violation(s), ` +
        `${result.closure.violations.length} client/server violation(s)`
    );
  }
  return { lines, ok };
}

async function main() {
  const result = runChecks(process.cwd());
  const { lines, ok } = formatReport(result);
  for (const line of lines) {
    console.log(line);
  }
  return ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith("check-module-graph.mjs"));
if (invokedDirectly) {
  // Set the code and let the loop drain rather than `process.exit()` — see
  // scripts/check-dev-server.mjs for why (it trips a libuv assertion on Windows).
  process.exitCode = await main();
}
