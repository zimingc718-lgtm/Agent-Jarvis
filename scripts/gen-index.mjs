#!/usr/bin/env node
/**
 * scripts/gen-index.mjs
 *
 * Generates `docs/INDEX.md`: 需求↔测试↔文件 / 测试入口一览 / 模块↔目录。Parses the three
 * governed spec docs and package.json — nothing here is hand-maintained except the small
 * MODULE_PATH_OVERRIDES seed table (module → real path corrections that cannot be
 * auto-extracted; see its comment).
 *
 * Usage:
 *   node scripts/gen-index.mjs            # writes docs/INDEX.md
 *   node scripts/gen-index.mjs --stdout   # prints to stdout instead (used by
 *                                         # `python tools/governance.py check-index`,
 *                                         # which diffs this against the committed file)
 *
 * This file is the *source*. docs/INDEX.md is *generated* — do not hand-edit the output;
 * edit this script and run `npm run docs:index`.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_REL = "docs/INDEX.md";

// ---------------------------------------------------------------------------
// generic markdown helpers — mirror tools/governance.py's _section()/_table_rows()
// ---------------------------------------------------------------------------

function readText(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Body of the first `##`-level section whose heading LINE is exactly `## <heading>`, up
 * to the next `^##` heading (or end of file). Anchored on the full line, not a substring
 * match — these heading strings also occur as ordinary prose elsewhere in the spec docs
 * (CLAUDE.md 四: 用脚本插入章节时，锚点必须锚在行首).
 */
function section(text, heading) {
  const re = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m");
  const m = re.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = /^##\s/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * Split one markdown table row into cells on UNESCAPED `|` only. The split itself is
 * copied verbatim from tools/governance.py's `_table_rows()` (`re.split(r"(?<!\\)\|",
 * ...)`): the spec docs carry escaped pipes inside code spans (e.g. `` `review
 * r1\|r2\|r3\|r4` `` in TASK-032 of 模块任务开发说明书.md, and similar in 测试说明书.md),
 * and a bare split shreds every column after them.
 *
 * One step is added on top, not present in governance.py: backtick code spans are
 * masked out before splitting and restored after, using a plain marker built only from
 * the section sign and digits (no backslash-escape syntax at all — a ``-style
 * placeholder was tried first and corrupted this very file with real NUL bytes, because
 * the escape got decoded a layer earlier than intended). 产品需求说明书.md's REQ-F-021
 * carries `` `{skill: <name|null>}` `` — a bare, *unescaped* `|` inside a code span,
 * which the `\|` convention alone doesn't protect against (found by running this
 * generator: REQ-F-021's row split into the wrong number of columns and its 名称 column
 * came out as the tail of its 验收标准 text). Masking every backtick span first means
 * neither an escaped nor an unescaped pipe inside one is ever seen by the splitter,
 * without changing how `\|` outside a code span is handled.
 */
function tableCells(line) {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const spans = [];
  const masked = body.replace(/`[^`]*`/g, (span) => {
    spans.push(span);
    return `§${spans.length - 1}§`;
  });
  return masked
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"))
    .map((cell) => cell.replace(/§(\d+)§/g, (_, i) => spans[Number(i)]));
}

/** Data rows of the first markdown table in a section body (drops header + separator rows). */
function tableRows(sectionText) {
  const rows = sectionText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map(tableCells);
  return rows.slice(2).filter((row) => row.some((cell) => cell !== ""));
}

function escapeCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// ---------------------------------------------------------------------------
// filesystem helpers
// ---------------------------------------------------------------------------

function walkFiles(relDir) {
  const out = [];
  const abs = path.join(ROOT, relDir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(rel));
    else out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. REQ table — project/01_specification/产品需求说明书.md
// ---------------------------------------------------------------------------
// Columns: | ID | 名称 | 优先级 | 描述 | 验收标准 | 状态 |
// REQ = every `| REQ-... |` row in the 功能需求 / 非功能需求 sections only — the
// `## 变更响应 · CR-*` sections that follow are design discussion, not the registry
// (mirrors how §2 below only reads the 测试矩阵 section, not its CR-response echoes).

// Verified against the current 产品需求说明书.md (`node -e` scan of every REQ row's 状态
// column for 4+-letter ALL-CAPS words): APPROVED, DEFERRED, REVIEWING, SUPERSEDED are
// the values actually in use. REJECTED/PROPOSED/DRAFT are kept as forward cover for
// standard workflow states this doc doesn't currently use but plausibly could.
const STATUS_KEYWORDS_RE = /(APPROVED|DEFERRED|REVIEWING|SUPERSEDED|REJECTED|PROPOSED|DRAFT)/;

function loadRequirements() {
  const specText = readText("project/01_specification/产品需求说明书.md");
  const reqs = [];
  const seen = new Set();
  for (const heading of ["功能需求", "非功能需求"]) {
    const body = section(specText, heading);
    for (const row of tableRows(body)) {
      const id = row[0];
      if (!/^REQ-[A-Z]+-\d+$/.test(id)) continue;
      if (seen.has(id)) continue; // duplicate id — keep first occurrence, same as a human skim would
      seen.add(id);
      const statusRaw = row[5] ?? "";
      // "首个命中" = the keyword occurring EARLIEST IN THE TEXT, not earliest in some
      // fixed preference list — REQ-F-021's 状态 column reads "**SUPERSEDED**（由
      // REQ-F-030 取代...原状态 APPROVED（...））": SUPERSEDED is the live status and
      // comes first in the text, APPROVED is a historical aside mentioned later. A
      // `.find()` over a keyword array checks list order, not text position, and got
      // this one backwards on the first pass.
      const statusMatch = STATUS_KEYWORDS_RE.exec(statusRaw);
      reqs.push({
        id,
        name: row[1] ?? "",
        // An unrecognised status is a real gap in STATUS_KEYWORDS_RE, not something to
        // paper over with a silent truncation — surface it as visibly unresolved.
        status: statusMatch ? statusMatch[1] : (statusRaw ? `?未识别（原文：${statusRaw.slice(0, 24)}…）` : "?"),
      });
    }
  }
  if (reqs.length === 0) {
    throw new Error("loadRequirements: 0 REQ rows found — heading anchor probably drifted, check 产品需求说明书.md's 功能需求/非功能需求 headings");
  }
  return reqs;
}

// ---------------------------------------------------------------------------
// 2. TEST matrix — project/04_tests/测试说明书.md
// ---------------------------------------------------------------------------
// Columns: | 测试 ID | 类型 | 覆盖需求 | 覆盖模块/任务 | 断言目标 | 命令 | 必选 |
// Only the `## 测试矩阵` section — CR-response sections repeat some TEST ids in a
// smaller 3-column "作废/反转" shape that is design discussion, not the registry.

function loadTestMatrix() {
  const testText = readText("project/04_tests/测试说明书.md");
  const body = section(testText, "测试矩阵");
  const tests = [];
  for (const row of tableRows(body)) {
    const id = row[0];
    if (!/^TEST-\d+$/.test(id)) continue;
    const reqIds = [...(row[2] ?? "").matchAll(/REQ-[A-Z]+-\d+/g)].map((m) => m[0]);
    tests.push({
      id,
      type: row[1] ?? "",
      reqIds,
      commandCell: row[5] ?? "",
    });
  }
  if (tests.length === 0) {
    throw new Error("loadTestMatrix: 0 TEST rows found — heading anchor probably drifted, check 测试说明书.md's 测试矩阵 heading");
  }
  return tests;
}

function testNum(id) {
  return parseInt(id.slice("TEST-".length), 10);
}

// ---------------------------------------------------------------------------
// 3. Command → file resolution (§5.2 of the audit) — shared by §1 and §2 below.
// ---------------------------------------------------------------------------

const TAG_E2E = "<e2e>";
const TAG_SMOKE = "<smoke>";
const TAG_UI_CONTRACT = "<ui-contract>";
const TAG_GOVERNANCE = "<governance>";
const TAG_TYPECHECK = "<typecheck>";
const TAG_CHECK_DEV_SERVER = "<check-dev-server>";
const TAG_CONFIG_CHECK = "<config:check>";
const TAG_BUILD_LOCAL = "<build:local>";
const TAG_BUILD_VERIFY = "<build:verify>";
const TAG_MANUAL = "<人工>";
const TAG_ALL_VITEST = "<all-vitest>";

// `node scripts/<basename>` → fixed entry tag.
const SCRIPT_BASENAME_TAGS = {
  "run-e2e.mjs": TAG_E2E,
  "smoke.mjs": TAG_SMOKE,
  "ui-contract.mjs": TAG_UI_CONTRACT,
  "check-dev-server.mjs": TAG_CHECK_DEV_SERVER,
  "check-config.mjs": TAG_CONFIG_CHECK,
};

// Scripts whose package.json VALUE is not parseable shell (inline `node -e "..."` that
// wraps `next build`) — tag by script NAME instead of trying to parse the value.
const SCRIPT_NAME_TAGS = {
  "build:local": TAG_BUILD_LOCAL,
  "build:verify": TAG_BUILD_VERIFY,
};

function stripTestsPrefix(word) {
  return word.replace(/^tests\//, "");
}

function matchTestFiles(word, testFiles) {
  const needle = stripTestsPrefix(word);
  return testFiles.filter((f) => path.posix.basename(f).includes(needle));
}

/**
 * Expand one `&&`-joined shell command into resolved vitest files / entry tags.
 * Mutates `entries` (a Set) and `problems` (an array) rather than returning them, so
 * `npm run <script>` can recurse into the script's own value and keep accumulating into
 * the same two collections. `depth` caps that recursion (§5.2: 深度上限 4).
 */
function expandChain(command, scripts, testFiles, depth, entries, problems) {
  const segments = command.split("&&").map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) expandSegment(seg, scripts, testFiles, depth, entries, problems);
}

function expandSegment(seg, scripts, testFiles, depth, entries, problems) {
  let m;

  if ((m = /^npm\s+run\s+([\w.:-]+)$/.exec(seg))) {
    const name = m[1];
    if (SCRIPT_NAME_TAGS[name]) {
      entries.add(SCRIPT_NAME_TAGS[name]);
      return;
    }
    if (!(name in scripts)) {
      problems.push(`MISSING script: ${name}`);
      return;
    }
    if (depth >= 4) {
      problems.push(`RECURSION_LIMIT: ${name}`);
      return;
    }
    expandChain(scripts[name], scripts, testFiles, depth + 1, entries, problems);
    return;
  }

  // Bare `npm test` / `vitest run` / `vitest` (no filter args) — the whole suite.
  // `test:watch` is just `"vitest"` (watch mode, no `run`, no path args).
  if (/^(?:npm\s+test|vitest(?:\s+run)?)$/.test(seg)) {
    entries.add(TAG_ALL_VITEST);
    return;
  }

  if ((m = /^npm\s+test\s+--\s+(.+)$/.exec(seg))) {
    for (const word of m[1].trim().split(/\s+/)) {
      const hits = matchTestFiles(word, testFiles);
      if (hits.length === 0) problems.push(`no match: ${word}`);
      hits.forEach((h) => entries.add(h));
    }
    return;
  }

  // `npx vitest run <paths...>` / `vitest run <paths...>` — resolved the same way as
  // `npm test -- <word>` (substring match against basenames after stripping a leading
  // `tests/`): vitest treats a positional path as a substring filter too, so
  // `vitest run tests/display.test.ts` still picks up `settings-on-display.test.tsx`
  // (whose basename starts with `display.test.ts` up to the final `x`). Verified against
  // this repo's own `test:display` script and TEST-039's documented resolution.
  if ((m = /^(?:npx\s+)?vitest\s+run\s+(.+)$/.exec(seg))) {
    for (const word of m[1].trim().split(/\s+/)) {
      const hits = matchTestFiles(word, testFiles);
      if (hits.length === 0) problems.push(`no match: ${word}`);
      hits.forEach((h) => entries.add(h));
    }
    return;
  }

  if ((m = /^node\s+scripts\/([\w.-]+\.mjs)\b/.exec(seg))) {
    entries.add(SCRIPT_BASENAME_TAGS[m[1]] ?? `<script:${m[1]}>`);
    return;
  }

  if (/^python3?\b/.test(seg)) {
    entries.add(TAG_GOVERNANCE);
    return;
  }

  if (/^tsc\b/.test(seg)) {
    entries.add(TAG_TYPECHECK);
    return;
  }

  problems.push(`UNRECOGNIZED_SEGMENT: ${seg}`);
}

function resolveCommand(rawCommand, scripts, testFiles) {
  const entries = new Set();
  const problems = [];
  expandChain(rawCommand, scripts, testFiles, 0, entries, problems);
  return { entries: [...entries], problems };
}

/**
 * Resolve a 测试说明书.md 「命令」table cell. The cell is markdown: a backtick-wrapped
 * shell command, sometimes followed by prose outside the backticks (`（需真实服务）`),
 * or — for TEST-022 — prose *around* backtick spans that isn't a command at all
 * (`人工执行；结果写入 \`test-results.json\`（...）`). Take the first backtick span; if it
 * doesn't start with a recognised command keyword, the whole cell is manual (§5.2:
 * 其余...标 `<人工>`).
 */
function resolveMatrixCell(rawCell, scripts, testFiles) {
  const spanMatch = /`([^`]+)`/.exec(rawCell);
  const candidate = (spanMatch ? spanMatch[1] : rawCell).trim();
  if (!/^(?:npm|npx|node|python3?|tsc)\b/.test(candidate)) {
    return { entries: [TAG_MANUAL], problems: [], manual: rawCell.trim() };
  }
  const { entries, problems } = resolveCommand(candidate, scripts, testFiles);
  return { entries, problems, manual: null };
}

function renderEntry(e) {
  if (e.startsWith("<") && e.endsWith(">")) return e.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `\`${path.posix.basename(e)}\``;
}

function renderResolution({ entries, problems, manual }) {
  const parts = [];
  if (manual !== null) parts.push(`&lt;人工&gt;（原文：${escapeCell(manual)}）`);
  else parts.push(...[...entries].sort().map(renderEntry));
  parts.push(...problems.map((p) => `⚠${escapeCell(p)}`));
  return parts.length ? parts.join(", ") : "（空）";
}

// ---------------------------------------------------------------------------
// §1 — 需求 ↔ 测试 ↔ 文件
// ---------------------------------------------------------------------------

function buildReqTestFileSection(reqs, tests, scripts, testFiles) {
  const reqToTestIds = new Map(reqs.map((r) => [r.id, []]));
  const danglingReqRefs = new Set();
  for (const t of tests) {
    for (const reqId of t.reqIds) {
      if (reqToTestIds.has(reqId)) reqToTestIds.get(reqId).push(t.id);
      else danglingReqRefs.add(reqId);
    }
  }

  const testResolutionCache = new Map();
  function resolvedFor(testId) {
    if (testResolutionCache.has(testId)) return testResolutionCache.get(testId);
    const test = tests.find((t) => t.id === testId);
    const resolution = resolveMatrixCell(test.commandCell, scripts, testFiles);
    testResolutionCache.set(testId, resolution);
    return resolution;
  }

  const lines = [];
  lines.push("## 一、需求 ↔ 测试 ↔ 文件");
  lines.push("");
  lines.push(
    "口径：REQ 取自 `产品需求说明书.md` 的「功能需求」「非功能需求」两节表格（不含 `## 变更响应 · CR-*` 节的重复提及）；" +
      "REQ → TEST 取自 `测试说明书.md` 「测试矩阵」节「覆盖需求」列的反查；TEST → 文件按该行「命令」列展开：" +
      "`npm run <script>` 递归查 `package.json`（深度上限 4），`npm test -- <词>` / `vitest run <路径>` 按子串匹配 " +
      "`tests/**/*.test.ts(x)` 的文件名（vitest 本身按子串过滤，多命中不是解析 bug），非 vitest 入口标 `<tag>`。" +
      "解析不到的用 ⚠ 标出并保留原始问题文字——这不是本生成器的疏漏，是被索引文档自身的缺口，必须能被看见。",
  );
  lines.push("");
  lines.push(`共 ${reqs.length} 条 REQ。`);
  lines.push("");
  lines.push("| REQ | 名称 | 状态 | 覆盖 TEST → 解析到的文件/入口 |");
  lines.push("|---|---|---|---|");
  for (const req of reqs) {
    const testIds = [...new Set(reqToTestIds.get(req.id))].sort((a, b) => testNum(a) - testNum(b));
    const cell =
      testIds.length === 0
        ? "（无 TEST 覆盖，见 §1.1）"
        : testIds.map((id) => `**${id}** → ${renderResolution(resolvedFor(id))}`).join("<br>");
    lines.push(`| ${req.id} | ${escapeCell(req.name)} | ${req.status} | ${cell} |`);
  }
  lines.push("");

  lines.push("### 1.1 没有任何 TEST 覆盖的 REQ");
  lines.push("");
  const uncovered = reqs.filter((r) => reqToTestIds.get(r.id).length === 0);
  if (uncovered.length === 0) {
    lines.push(`没有。${reqs.length} 条 REQ 全部在「测试矩阵」的「覆盖需求」列里至少出现过一次。`);
  } else {
    lines.push(`共 ${uncovered.length} 条：`);
    lines.push("");
    lines.push("| REQ | 名称 | 状态 |");
    lines.push("|---|---|---|");
    for (const r of uncovered) lines.push(`| ${r.id} | ${escapeCell(r.name)} | ${r.status} |`);
  }
  lines.push("");

  lines.push("### 1.2 「覆盖需求」列引用了、但需求说明书未定义的 REQ 编号");
  lines.push("");
  if (danglingReqRefs.size === 0) {
    lines.push("没有悬空引用。");
  } else {
    lines.push([...danglingReqRefs].sort().map((id) => `\`${id}\``).join(", "));
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// §2 — 测试入口一览（package.json scripts）
// ---------------------------------------------------------------------------

function isTestOrGateScript(name) {
  if (name === "verify:all") return true;
  if (name === "check:dev-server") return true;
  if (name === "config:check") return true;
  if (/^test(?::|$)/.test(name)) return true;
  if (/^governance:/.test(name)) return true;
  return false;
}

// §5.4 layer classification, structural — NOT `grep -i playwright` (a false positive:
// tests/knowledge.test.ts has the Chinese prose "Playwright 只跑一个 worker" as *test
// data*, not as an import). Priority matters: jsdom/testing-library first, then route
// import, then "no local imports at all" (subprocess-driven), else unit.
function importSpecRe() {
  return /(?:from\s+|import\s*\(\s*|vi\.mock\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
}

function resolveImportPath(spec, fromFileRelPath) {
  let base;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    const fromDir = path.posix.dirname(fromFileRelPath.replace(/\\/g, "/"));
    base = path.posix.normalize(path.posix.join(fromDir, spec));
  } else return null;

  for (const suffix of ["", ".ts", ".tsx", ".mjs", ".js", "/route.ts", "/index.ts"]) {
    const candidate = base + suffix;
    if (existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return null;
}

function extractLocalImports(text, fromFileRelPath) {
  const out = new Set();
  let m;
  const re = importSpecRe();
  while ((m = re.exec(text))) {
    const spec = m[1];
    if (!(spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("../"))) continue;
    const resolved = resolveImportPath(spec, fromFileRelPath);
    if (resolved) out.add(resolved);
  }
  return [...out];
}

const layerCache = new Map();
function classifyFileLayer(relPath) {
  if (layerCache.has(relPath)) return layerCache.get(relPath);
  const text = readText(relPath);
  let layer;
  if (/@vitest-environment\s+jsdom/.test(text) || /@testing-library\//.test(text)) {
    layer = "组件";
  } else {
    const imports = extractLocalImports(text, relPath);
    if (imports.some((p) => /^src\/app\/api\/.*\/route\.ts$/.test(p))) layer = "路由";
    // e.g. tests/visual.test.ts imports scripts/ui-contract.mjs and asserts against it —
    // it isn't testing application code, so "单元" would undersell what it's for.
    else if (imports.some((p) => /^scripts\//.test(p))) layer = "契约/脚本";
    else if (imports.length === 0) layer = "脚本子进程";
    else layer = "单元";
  }
  layerCache.set(relPath, layer);
  return layer;
}

const TAG_LAYER_LABELS = {
  [TAG_E2E]: "e2e",
  [TAG_SMOKE]: "冒烟（真实 Next.js）",
  [TAG_UI_CONTRACT]: "契约（UI 静态规则）",
  [TAG_GOVERNANCE]: "治理（Python）",
  [TAG_TYPECHECK]: "类型",
  [TAG_CHECK_DEV_SERVER]: "运维探针",
  [TAG_CONFIG_CHECK]: "配置预检",
  [TAG_BUILD_LOCAL]: "构建",
  [TAG_BUILD_VERIFY]: "构建",
  [TAG_MANUAL]: "人工",
  [TAG_ALL_VITEST]: "单元 + 路由 + 组件（全量 vitest，不含 e2e）",
};

function layerFor(entry) {
  if (entry.startsWith("<") && entry.endsWith(">")) return TAG_LAYER_LABELS[entry] ?? "脚本";
  return classifyFileLayer(entry);
}

function buildTestEntrySection(scripts, testFiles) {
  const lines = [];
  lines.push("## 二、测试入口一览");
  lines.push("");
  lines.push(
    "`package.json` 里跑测试/门禁的 script，各自的实际命令、展开后落到的文件/入口，以及按结构性判据推出的层。" +
      "**层的判据是结构，不是关键词**：e2e = 落在 `tests/e2e/*.spec.ts` 或调用 `scripts/run-e2e.mjs`（不是 `grep -i playwright`——" +
      "`tests/knowledge.test.ts` 正文里出现过「Playwright 只跑一个 worker」这句测试数据描述，关键词匹配会把它误判成 e2e）；" +
      "组件 = 文件头 `@vitest-environment jsdom` 或 import 了 `@testing-library/*`；路由 = import 了一个 `src/app/api/**/route.ts`；" +
      "其余落到「脚本子进程」（无本地 import，靠 `execFileSync` 拉子进程）或「单元」。一个 script 可能跨层，按并集列出。",
  );
  lines.push("");
  lines.push("| script | 实际命令 | 层 | 解析到的文件/入口 |");
  lines.push("|---|---|---|---|");
  for (const [name, value] of Object.entries(scripts)) {
    if (!isTestOrGateScript(name)) continue;
    const { entries, problems } = resolveCommand(value, scripts, testFiles);
    const layers = [...new Set(entries.map(layerFor))].sort();
    const resolvedCell = renderResolution({ entries, problems, manual: null });
    lines.push(`| \`${name}\` | \`${escapeCell(value)}\` | ${layers.join(" + ") || "（无法判定）"} | ${resolvedCell} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// §3 — 模块 → 目录（半自动）
// ---------------------------------------------------------------------------
// project/03_modules/模块任务开发说明书.md 的「模块任务总览」表:
//   | 任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试 |
//
// "对应目录/文件" cannot be fully automated (the audit's own §5.3 finding): spec prose
// goes stale (renamed/deleted files still named in old TASK text) or names a *suite*,
// not a path (`tools/display.ts` reads like a path but isn't one — the real files are
// `src/lib/tools/*-tools.ts`). MODULE_PATH_OVERRIDES is the human-maintained correction
// table; keep it seeded with *traceable, verified* cases, not guesses.
const MODULE_PATH_OVERRIDES = {
  // TASK-135 removes `src/app/dashboard/page.tsx`; no remaining row in the overview
  // table names the real homepage/layout, so auto-extraction can't recover them.
  "MOD-CHAT-UI": ["src/app/page.tsx", "src/app/layout.tsx", "src/lib/ui-events.ts"],
  // TASK-032/160/161/etc. refer to the tool suites as `tools/display.ts` /
  // `tools/skills.ts` / `tools/web.ts` — those read as paths but are suite *names*; the
  // real files live under `src/lib/tools/*-tools.ts`.
  "MOD-TOOLS": [
    "src/lib/tools/display-tools.ts",
    "src/lib/tools/skill-tools.ts",
    "src/lib/tools/web-tools.ts",
  ],
};

function loadModuleTasks() {
  const modText = readText("project/03_modules/模块任务开发说明书.md");
  const body = section(modText, "模块任务总览");
  const tasks = [];
  for (const row of tableRows(body)) {
    const id = row[0];
    if (!/^TASK-\d+$/.test(id)) continue;
    const moduleRaw = row[1] ?? "";
    tasks.push({
      id,
      moduleRaw,
      moduleIds: [...moduleRaw.matchAll(/MOD-[A-Z-]+/g)].map((m) => m[0]),
      description: row[2] ?? "",
    });
  }
  if (tasks.length === 0) {
    throw new Error("loadModuleTasks: 0 TASK rows found — heading anchor probably drifted, check 模块任务开发说明书.md's 模块任务总览 heading");
  }
  return tasks;
}

// A path candidate must be preceded by a backtick/space/paren (or string start) — the
// four allowed prefixes double as the delimiter that keeps this from matching arbitrary
// prose; existsSync() below is what actually separates a real path from a stale one.
function extractPathCandidates(text) {
  const re = /(?:^|[`\s(（])((?:src|scripts|tools|tests)\/[A-Za-z0-9_./[\]-]+)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(text))) {
    // Trailing punctuation isn't part of the path; neither is a trailing "/" (TASK-044
    // writes `src/components/ui/*` — the character class stops before the glob `*`,
    // leaving a trailing slash that would otherwise dedup separately from TASK-048's
    // `src/components/ui`, even though both name the same directory).
    const candidate = m[1].replace(/[)）,，。；;:：]+$/, "").replace(/\/$/, "");
    if (candidate) out.add(candidate);
  }
  return [...out];
}

function buildModuleDirectorySection(tasks) {
  const byModule = new Map(); // MOD-id -> { candidates: Set, taskIds: Set }
  const unclassified = []; // tasks whose 模块 column has no MOD-* token at all

  function bucket(modId) {
    if (!byModule.has(modId)) byModule.set(modId, { candidates: new Set(), taskIds: new Set() });
    return byModule.get(modId);
  }

  for (const t of tasks) {
    if (t.moduleIds.length === 0) {
      unclassified.push(t);
      continue;
    }
    const candidates = extractPathCandidates(t.description).filter((p) => existsSync(path.join(ROOT, p)));
    for (const modId of t.moduleIds) {
      const b = bucket(modId);
      b.taskIds.add(t.id);
      candidates.forEach((c) => b.candidates.add(c));
    }
  }
  for (const modId of Object.keys(MODULE_PATH_OVERRIDES)) bucket(modId); // include override-only modules

  const lines = [];
  lines.push("## 三、模块 → 目录（半自动）");
  lines.push("");
  lines.push(
    "`模块任务开发说明书.md`「模块任务总览」表按「模块」列（`MOD-[A-Z-]+`，逗号/斜杠均可分隔）分组，" +
      "取该模块名下每条 TASK 的「任务」描述文本里形如 `src/…`、`scripts/…`、`tools/…`、`tests/…` 的路径片段，" +
      "过滤掉仓库里已不存在的路径（改名/删除后的陈旧引用）——这一列是**脚本候选**，是自动抽取的，不等于最终归属。" +
      "「人工映射表」是本脚本里维护的 `MODULE_PATH_OVERRIDES`，处理脚本抽不出来的情况" +
      "（改名后旧路径已不在正文任何一处、或正文写的是工具套件名而非真实路径）。两列分开列，" +
      "哪些是自动抽的、哪些是人工订正的一眼可辨；人工映射表里的路径同样过 `existsSync`，一旦目标又不存在会标 ⚠STALE。",
  );
  lines.push("");
  lines.push("| 模块 | 脚本候选（自动抽取，已过滤不存在路径） | 人工映射表（MODULE_PATH_OVERRIDES） | 关联 TASK |");
  lines.push("|---|---|---|---|");
  for (const modId of [...byModule.keys()].sort()) {
    const b = byModule.get(modId);
    const auto = [...b.candidates].sort();
    const overrides = (MODULE_PATH_OVERRIDES[modId] ?? []).map((p) =>
      existsSync(path.join(ROOT, p)) ? p : `${p} ⚠STALE`,
    );
    const taskIds = [...b.taskIds].sort((a, c) => parseInt(a.slice(5), 10) - parseInt(c.slice(5), 10));
    const autoCell = auto.length ? auto.map((p) => `\`${p}\``).join("<br>") : "（无）";
    const overrideCell = overrides.length ? overrides.map((p) => `\`${p}\``).join("<br>") : "（无）";
    const taskCell = taskIds.length ? taskIds.join(", ") : "（无，仅人工映射表）";
    lines.push(`| ${modId} | ${autoCell} | ${overrideCell} | ${taskCell} |`);
  }
  lines.push("");

  lines.push("### 3.1 「模块」列不是 `MOD-*` 记法的 TASK（未计入上表）");
  lines.push("");
  if (unclassified.length === 0) {
    lines.push("没有。");
  } else {
    lines.push("| TASK | 模块列原文 |");
    lines.push("|---|---|");
    for (const t of unclassified) lines.push(`| ${t.id} | ${escapeCell(t.moduleRaw)} |`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// header + assembly
// ---------------------------------------------------------------------------

function inputFreshness() {
  const inputs = [
    "project/01_specification/产品需求说明书.md",
    "project/04_tests/测试说明书.md",
    "project/03_modules/模块任务开发说明书.md",
    "package.json",
  ];
  const maxMs = Math.max(...inputs.map((p) => statSync(path.join(ROOT, p)).mtimeMs));
  return new Date(maxMs).toISOString();
}

function buildDocument() {
  const scripts = JSON.parse(readText("package.json")).scripts ?? {};
  const testFiles = walkFiles("tests").filter((f) => /\.test\.tsx?$/.test(f)).sort();
  if (testFiles.length === 0) {
    throw new Error("buildDocument: 0 files under tests/**/*.test.ts(x) — is this being run from the repo root?");
  }

  const reqs = loadRequirements();
  const tests = loadTestMatrix();
  const tasks = loadModuleTasks();

  const parts = [];
  parts.push("# 测试与需求索引");
  parts.push("");
  parts.push(
    "本文件由 `node scripts/gen-index.mjs` 生成（`npm run docs:index`）。**请勿手工编辑** — 改动请改生成器后重新生成。",
  );
  parts.push("");
  parts.push(
    "`python tools/governance.py check-index` 重跑生成器（`node scripts/gen-index.mjs --stdout`）并与本文件逐字节比对；" +
      "不一致就说明某本说明书或 `package.json` 改了，但本文件没有跟着重新生成——按提示跑 `npm run docs:index` 后提交。",
  );
  parts.push("");
  parts.push("| | |");
  parts.push("|---|---|");
  parts.push("| 生成命令 | `npm run docs:index` |");
  parts.push(
    `| 依据的输入文件最后修改时间 | ${inputFreshness()}（产品需求说明书.md / 测试说明书.md / 模块任务开发说明书.md / package.json 四者 mtime 的最大值） |`,
  );
  parts.push(`| 规模 | REQ ${reqs.length} 条 · TEST ${tests.length} 条（主矩阵） · TASK ${tasks.length} 条 · tests/**/*.test.ts(x) ${testFiles.length} 个 |`);
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(buildReqTestFileSection(reqs, tests, scripts, testFiles));
  parts.push("---");
  parts.push("");
  parts.push(buildTestEntrySection(scripts, testFiles));
  parts.push("---");
  parts.push("");
  parts.push(buildModuleDirectorySection(tasks));

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function main() {
  const toStdout = process.argv.includes("--stdout");
  const content = buildDocument();
  if (toStdout) {
    process.stdout.write(content);
  } else {
    const outAbs = path.join(ROOT, OUT_REL);
    mkdirSync(path.dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, content);
    process.stderr.write(`Wrote ${OUT_REL} (${Buffer.byteLength(content, "utf8")} bytes)\n`);
  }
}

main();
