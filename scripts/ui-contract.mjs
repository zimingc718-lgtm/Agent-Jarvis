#!/usr/bin/env node
/**
 * Agent-Jarvis UI Contract
 * =========================
 * An executable UI specification. Every rule below is derived from an
 * industry reference (WCAG 2.2 AA success criteria, Apple HIG, Material 3,
 * MDN / web.dev guidance) and, where relevant, a project requirement in
 * `project/01_specification/产品需求说明书.md` / `project/02_solution/架构设计说明书.md`.
 *
 * The goal: turn "科幻控制台风格、细线边框、状态灯、模型芯片、不溢出" and the
 * unwritten baseline of "a competent, accessible UI" into checks a machine runs.
 *
 * Tiers
 * -----
 *   static (default)  Parses src/app/globals.css + component sources. Zero deps, fast.
 *   live  (--live)    Drives the running app with Playwright: real contrast, reflow
 *                     at 320px, focus order, target sizes, reduced-motion, landmarks,
 *                     and a full axe-core audit when axe-core is installed.
 *
 * Usage
 * -----
 *   node scripts/ui-contract.mjs                     # static checks, human report
 *   node scripts/ui-contract.mjs --json              # machine-readable result
 *   node scripts/ui-contract.mjs --doc               # emit the spec as Markdown
 *   node scripts/ui-contract.mjs --strict            # warnings fail the run
 *   node scripts/ui-contract.mjs --live --url http://127.0.0.1:3330
 *
 * Exit code: 0 when no rule FAILs (and, with --strict, no rule WARNs).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ */
/* result helpers                                                      */
/* ------------------------------------------------------------------ */

const PASS = (detail = "") => ({ status: "pass", detail });
const FAIL = (detail) => ({ status: "fail", detail });
const WARN = (detail) => ({ status: "warn", detail });
const SKIP = (detail) => ({ status: "skip", detail });

/* ------------------------------------------------------------------ */
/* tiny CSS reader (flat rules + one level of @media)                  */
/* ------------------------------------------------------------------ */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseRules(css) {
  const rules = [];
  let i = 0;
  let selStart = 0;
  const n = css.length;
  while (i < n) {
    if (css[i] === "{") {
      const selector = css.slice(selStart, i).trim();
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      const inner = css.slice(i + 1, j - 1);
      const tidy = selector.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ");
      if (tidy.startsWith("@media")) {
        rules.push({ type: "media", query: tidy.replace(/^@media\s*/, "").trim(), children: parseRules(inner) });
      } else if (tidy.startsWith("@")) {
        rules.push({ type: "at", selector: tidy, body: inner });
      } else {
        rules.push({ type: "rule", selector: tidy, body: inner });
      }
      i = j;
      selStart = j;
    } else {
      i++;
    }
  }
  return rules;
}

function flatten(rules, media = null) {
  const out = [];
  for (const r of rules) {
    if (r.type === "rule") out.push({ ...r, media });
    else if (r.type === "media") out.push(...flatten(r.children, r.query));
  }
  return out;
}

function selectorParts(selector) {
  return selector.split(",").map((s) => s.trim());
}

function matchSelector(selector, needle) {
  const parts = selectorParts(selector);
  if (needle instanceof RegExp) return parts.some((p) => needle.test(p));
  return parts.includes(needle);
}

function decl(body, prop) {
  if (!body) return null;
  const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? m[1].trim() : null;
}

function allValues(flatRules, prop) {
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`, "gi");
  const values = [];
  for (const r of flatRules) {
    let m;
    while ((m = re.exec(r.body))) values.push({ value: m[1].trim(), selector: r.selector, media: r.media });
  }
  return values;
}

/* ------------------------------------------------------------------ */
/* colour math (WCAG relative luminance / contrast ratio)              */
/* ------------------------------------------------------------------ */

function parseColor(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
      a: 1,
    };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,/]/).map((p) => p.trim());
    return {
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
      a: parts[3] === undefined ? 1 : Number(parts[3]),
    };
  }
  return null;
}

function over(fg, bg) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(c1, c2) {
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* ------------------------------------------------------------------ */
/* length helpers                                                      */
/* ------------------------------------------------------------------ */

function toPx(value) {
  if (value == null) return NaN;
  const m = String(value).trim().match(/^(-?\d+(?:\.\d+)?)(px|rem|em)?$/);
  if (!m) return NaN;
  const num = parseFloat(m[1]);
  if (m[2] === "rem" || m[2] === "em") return num * 16;
  return num;
}

function lengthTokens(value) {
  return String(value).match(/-?\d+(?:\.\d+)?(?:px|rem|em)/g) ?? [];
}

/* ------------------------------------------------------------------ */
/* context                                                             */
/* ------------------------------------------------------------------ */

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function buildContext() {
  const cssRaw = read("src/app/globals.css") ?? "";
  const css = stripComments(cssRaw);
  const tree = parseRules(css);
  const flat = flatten(tree);

  // Theme-aware: bare :root (and :root[data-theme="light"]) is the light palette;
  // :root[data-theme="dark"] and :root under `@media (prefers-color-scheme: dark)`
  // contribute the dark overrides.
  const tokens = {};
  const darkOverrides = {};
  for (const r of flat) {
    const parts = r.selector.split(",").map((p) => p.trim());
    if (!parts.some((p) => p.startsWith(":root"))) continue;
    const isDark =
      /\[data-theme=["']?dark["']?\]/.test(r.selector) ||
      (r.media && /prefers-color-scheme\s*:\s*dark/.test(r.media));
    const target = isDark ? darkOverrides : tokens;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) target[m[1]] = m[2].trim();
  }
  const darkTokens = { ...tokens, ...darkOverrides };
  const hasDarkTheme = Object.keys(darkOverrides).length > 0;

  function resolveIn(map, expr, depth = 0) {
    if (!expr || depth > 5) return expr;
    const m = String(expr).trim().match(/^var\((--[\w-]+)\)$/);
    if (m) return resolveIn(map, map[m[1]], depth + 1);
    return expr;
  }
  const resolve = (expr, depth = 0) => resolveIn(tokens, expr, depth);

  function colorIn(map, expr, baseExpr) {
    const c = parseColor(resolveIn(map, expr));
    if (!c) return null;
    if (c.a != null && c.a < 1 && baseExpr) {
      const base = parseColor(resolveIn(map, baseExpr));
      if (base) return over(c, base);
    }
    return c;
  }
  const color = (expr, baseExpr) => colorIn(tokens, expr, baseExpr);

  /** Run a contrast check for every declared theme; fail if any theme misses `min`. */
  function contrastAcrossThemes(fgExpr, bgExpr, min) {
    const themes = [["light", tokens]];
    if (hasDarkTheme) themes.push(["dark", darkTokens]);
    const results = [];
    for (const [name, map] of themes) {
      const fg = colorIn(map, fgExpr, bgExpr);
      const bg = colorIn(map, bgExpr);
      if (!fg || !bg) {
        results.push({ name, ratio: null });
        continue;
      }
      results.push({ name, ratio: contrastRatio(fg, bg) });
    }
    return results;
  }

  const files = {
    "globals.css": cssRaw,
    "layout.tsx": read("src/app/layout.tsx"),
    "page.tsx": read("src/app/page.tsx"),
    "settings/models/page.tsx": read("src/app/settings/models/page.tsx"),
    "FloatingChat.tsx": read("src/components/FloatingChat.tsx"),
    "ModelSettings.tsx": read("src/components/ModelSettings.tsx"),
    "SettingsDialog.tsx": read("src/components/SettingsDialog.tsx"),
    "AccountDialog.tsx": read("src/components/AccountDialog.tsx"),
    "ThemeToggle.tsx": read("src/components/ThemeToggle.tsx"),
    "markdown.tsx": read("src/lib/markdown.tsx"),
  };

  return {
    cssRaw,
    css,
    flat,
    tokens,
    darkTokens,
    hasDarkTheme,
    resolve,
    color,
    contrastAcrossThemes,
    files,
    rule: (sel) => flat.find((r) => !r.media && matchSelector(r.selector, sel)) ?? null,
    ruleIn: (mediaQuery, sel) =>
      flat.find((r) => r.media && r.media.includes(mediaQuery) && matchSelector(r.selector, sel)) ?? null,
    rules: (sel) => flat.filter((r) => matchSelector(r.selector, sel)),
    values: (prop) => allValues(flat, prop),
    components: () => Object.entries(files).filter(([, v]) => v && v.includes("className")),
  };
}

/* ================================================================== */
/* THE CONTRACT                                                        */
/* ================================================================== */

/** @type {{group:string, rules: any[]}[]} */
const CONTRACT = [
  {
    group: "Design system & tokens",
    rules: [
      {
        id: "DS-01",
        ref: "Design tokens (MDN custom properties, Material 3 tokens)",
        req: "REQ-F-014",
        title: "Colours come from :root custom properties, not scattered literals",
        guidance: "Define the palette once as `--*` tokens; reference them everywhere so the console theme stays coherent.",
        check(ctx) {
          const tokenCount = Object.keys(ctx.tokens).filter((t) => /color|bg|panel|line|accent|text|muted|surface|border/.test(t)).length;
          if (tokenCount < 4) return FAIL(`only ${tokenCount} colour tokens on :root — palette is not tokenised`);
          const literals = ctx.flat
            .filter((r) => !r.selector.split(",").some((p) => p.trim().startsWith(":root")))
            .flatMap((r) => r.body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []);
          const uniq = [...new Set(literals)];
          if (uniq.length > 8) return WARN(`${uniq.length} raw colour literals outside :root (e.g. ${uniq.slice(0, 3).join(", ")}) — consider tokenising`);
          return PASS(`${tokenCount} tokens, ${uniq.length} incidental literals`);
        },
      },
      {
        id: "DS-02",
        ref: "web.dev: consistent spacing scale",
        title: "Spacing values follow a 4px / 0.25rem scale",
        guidance: "Snap padding / margin / gap to one scale so rhythm stays consistent across components.",
        check(ctx) {
          const offscale = [];
          for (const prop of ["padding", "margin", "gap", "padding-bottom", "padding-top", "padding-left", "padding-right"]) {
            for (const { value, selector } of ctx.values(prop)) {
              for (const tok of lengthTokens(value)) {
                const px = toPx(tok);
                if (Number.isNaN(px) || px === 0) continue;
                if (Math.round(px) % 4 !== 0) offscale.push(`${selector} { ${prop}: ${tok} }`);
              }
            }
          }
          if (offscale.length > 3) return WARN(`${offscale.length} off-scale spacing values, e.g. ${offscale.slice(0, 3).join("; ")}`);
          return PASS(offscale.length ? `${offscale.length} minor off-scale values` : "all spacing on a 4px scale");
        },
      },
      {
        id: "DS-03",
        ref: "MDN color-scheme",
        req: "REQ-F-014",
        title: "color-scheme is declared so the UA matches the theme",
        guidance: "`color-scheme` makes form controls, scrollbars and the UA render for the active theme (light default, dark opt-in).",
        check(ctx) {
          const root = ctx.rule(":root");
          const v = root && decl(root.body, "color-scheme");
          if (!/light|dark/.test(v ?? "")) return FAIL("no `color-scheme` on :root");
          if (ctx.hasDarkTheme) return PASS(`color-scheme: ${v}; dark palette present`);
          return PASS(`color-scheme: ${v}`);
        },
      },
      {
        id: "DS-04",
        ref: "Visual consistency",
        req: "REQ-F-014",
        title: "Borders use one thin-line idiom (细线边框)",
        guidance: "Keep every structural border 1px (or a shared token); no chunky 3px+ frames — a calm console reads through hairlines, not heavy frames.",
        check(ctx) {
          const thick = [];
          let thin = 0;
          for (const r of ctx.flat) {
            for (const m of r.body.matchAll(/border(?:-(?:top|right|bottom|left))?\s*:\s*([^;]+)/gi)) {
              const px = (m[1].match(/(\d+(?:\.\d+)?)px/) || [])[1];
              if (px == null) continue;
              if (Number(px) >= 3) thick.push(`${r.selector} (${px}px)`);
              else if (Number(px) <= 1.5) thin++;
            }
          }
          if (thick.length) return FAIL(`thick borders break the hairline idiom: ${thick.join(", ")}`);
          if (thin < 3) return WARN("fewer than 3 hairline borders found — is the console frame styled?");
          return PASS(`${thin} hairline borders, 0 thick`);
        },
      },
    ],
  },

  {
    group: "Typography & readability",
    rules: [
      {
        id: "TY-01",
        ref: "WCAG 1.4.4 Resize Text; web.dev: 16px minimum body text",
        title: "No text is set below 12px; body text is ~16px",
        guidance: "Small fixed type fails older eyes and zoom. Keep body ≈ 1rem, never define a font-size below 0.75rem.",
        check(ctx) {
          const tiny = [];
          for (const { value, selector } of ctx.values("font-size")) {
            const px = toPx(value);
            if (!Number.isNaN(px) && px < 12) tiny.push(`${selector} (${value})`);
          }
          if (tiny.length) return FAIL(`font-size below 12px: ${tiny.join(", ")}`);
          const body = ctx.rule("body");
          const bodyFs = body && decl(body.body, "font-size");
          if (bodyFs && toPx(bodyFs) < 15) return WARN(`body font-size ${bodyFs} < 15px`);
          return PASS("no sub-12px text");
        },
      },
      {
        id: "TY-02",
        ref: "WCAG 1.4.12 Text Spacing",
        title: "Body line-height is at least 1.4 (target 1.5)",
        guidance: "Generous leading is the cheapest readability win; 1.5 is the WCAG text-spacing baseline.",
        check(ctx) {
          const body = ctx.rule("body");
          const lh = body && decl(body.body, "line-height");
          if (!lh) return WARN("body sets no line-height — UA default (~1.2) is below the 1.5 guidance");
          const n = parseFloat(lh);
          if (!Number.isNaN(n) && n < 1.4) return FAIL(`body line-height ${lh} < 1.4`);
          return PASS(`line-height: ${lh}`);
        },
      },
      {
        id: "TY-03",
        ref: "web.dev / Butterick: 45–75 character measure",
        title: "Long-form text columns are width-constrained",
        guidance: "Unbounded line length hurts reading. Content regions should cap around 60–75ch (~700–980px).",
        check(ctx) {
          const widths = ctx.values("max-width").filter((v) => /px|ch|rem/.test(v.value));
          if (!widths.length) return WARN("no max-width on any content container — text can run edge to edge on wide screens");
          const tooWide = widths.filter((v) => toPx(v.value) > 1100);
          if (tooWide.length === widths.length) return WARN(`content max-width(s) all > 1100px: ${tooWide.map((v) => v.value).join(", ")}`);
          return PASS(`constrained: ${widths.map((v) => `${v.selector}=${v.value}`).join(", ")}`);
        },
      },
      {
        id: "TY-04",
        ref: "MDN font-family fallbacks",
        title: "Every font stack ends in a generic family",
        guidance: "Always terminate a font stack with sans-serif / serif / monospace so text renders if the named face is missing.",
        check(ctx) {
          const bad = ctx
            .values("font-family")
            .filter(
              (v) =>
                !/\b(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-monospace)\s*$/.test(v.value) &&
                !/^\s*(inherit|initial|unset|revert)\s*$/.test(v.value)
            );
          if (bad.length) return FAIL(`font stack without generic fallback: ${bad.map((v) => v.selector).join(", ")}`);
          return PASS(ctx.values("font-family").length ? "all stacks have a generic fallback" : "inherits UA font");
        },
      },
    ],
  },

  {
    group: "Colour & contrast (WCAG 1.4.3 / 1.4.11)",
    rules: [
      {
        id: "CC-01",
        ref: "WCAG 1.4.3 Contrast (Minimum) — 4.5:1 body text",
        req: "REQ-F-014",
        title: "Primary text on the background clears 4.5:1 in every theme",
        guidance: "The main --text / --bg pair must reach AA for normal text — checked for the light and (if present) dark palette.",
        check(ctx) {
          const results = ctx.contrastAcrossThemes("var(--text)", "var(--bg)", 4.5);
          const bad = results.filter((r) => r.ratio !== null && r.ratio < 4.5);
          const unresolved = results.filter((r) => r.ratio === null);
          if (unresolved.length === results.length) return SKIP("cannot resolve --text / --bg");
          if (bad.length) return FAIL(bad.map((r) => `${r.name} --text/--bg ${r.ratio.toFixed(2)}:1 (<4.5)`).join("; "));
          return PASS(results.filter((r) => r.ratio).map((r) => `${r.name} ${r.ratio.toFixed(2)}:1`).join(", "));
        },
      },
      {
        id: "CC-02",
        ref: "WCAG 1.4.3 — 4.5:1 (3:1 if large-only)",
        title: "Muted / secondary text on surfaces clears 4.5:1 in every theme",
        guidance: "--muted is used for status and metadata; hold it to AA on --surface (fallback --bg) in each theme.",
        check(ctx) {
          const surface = ctx.color("var(--surface)") ? "var(--surface)" : "var(--bg)";
          const results = ctx.contrastAcrossThemes("var(--muted)", surface, 4.5);
          const bad = results.filter((r) => r.ratio !== null && r.ratio < 3);
          const warn = results.filter((r) => r.ratio !== null && r.ratio >= 3 && r.ratio < 4.5);
          if (results.every((r) => r.ratio === null)) return SKIP("cannot resolve --muted / surface");
          if (bad.length) return FAIL(bad.map((r) => `${r.name} --muted ${r.ratio.toFixed(2)}:1 (<3)`).join("; "));
          if (warn.length) return WARN(warn.map((r) => `${r.name} --muted ${r.ratio.toFixed(2)}:1 — large text only`).join("; "));
          return PASS(results.filter((r) => r.ratio).map((r) => `${r.name} ${r.ratio.toFixed(2)}:1`).join(", "));
        },
      },
      {
        id: "CC-03",
        ref: "WCAG 1.4.11 Non-text Contrast — 3:1 for control boundaries",
        req: "REQ-F-014",
        title: "Interactive element borders clear 3:1 against their background in every theme",
        guidance: "If the hairline border is the only thing marking an input or button, it must reach 3:1 — hard on both a near-white and a near-black ground, so both are checked.",
        check(ctx) {
          const results = ctx.contrastAcrossThemes("var(--line)", "var(--bg)", 3);
          const bad = results.filter((r) => r.ratio !== null && r.ratio < 3);
          if (results.every((r) => r.ratio === null)) return SKIP("cannot resolve --line / --bg");
          if (bad.length) {
            return FAIL(
              bad.map((r) => `${r.name} --line/--bg ${r.ratio.toFixed(2)}:1 (<3) — controls relying on this border are hard to perceive`).join("; ")
            );
          }
          return PASS(results.filter((r) => r.ratio).map((r) => `${r.name} ${r.ratio.toFixed(2)}:1`).join(", "));
        },
      },
      {
        id: "CC-04",
        ref: "WCAG 1.4.1 Use of Color",
        req: "REQ-F-018",
        title: "State is never signalled by the status light colour alone",
        guidance:
          "REQ-F-018 removes the visible status text, so the 状态灯 must pair with a non-colour cue: a visually-hidden role=status label naming the state, or an aria-label on the light.",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          const hasLight = /floating-chat__light/.test(src);
          if (!hasLight) return PASS("no colour-only indicator found");
          const srLabel = /floating-chat__sr[\s\S]*role=["']status["']|role=["']status["'][\s\S]*floating-chat__sr/.test(src);
          const ariaLabel = /floating-chat__light[^>]*aria-label=/.test(src);
          const namesStates = /LIGHT_LABEL|检测|就绪|生成|未连接|没有可用/.test(src);
          if ((srLabel || ariaLabel) && namesStates) return PASS("light + non-colour state label");
          return FAIL("status light present but state is not exposed as text for AT");
        },
      },
    ],
  },

  {
    group: "Keyboard & focus (WCAG 2.1.1 / 2.4.7)",
    rules: [
      {
        id: "FK-01",
        ref: "WCAG 2.4.7 Focus Visible",
        title: "outline is never removed without a replacement",
        guidance: "`outline: none` / `outline: 0` blinds keyboard users unless a :focus / :focus-visible style takes over.",
        check(ctx) {
          const kills = ctx.flat.filter((r) => /outline\s*:\s*(none|0)\b/i.test(r.body));
          const replacements = ctx.flat.filter((r) => /:focus(-visible)?/.test(r.selector) && /(outline|box-shadow|border|background)/.test(r.body));
          if (kills.length && !replacements.length) return FAIL(`${kills.map((r) => r.selector).join(", ")} remove the outline with no :focus replacement`);
          return PASS(kills.length ? "outline removed but replaced" : "outline not suppressed");
        },
      },
      {
        id: "FK-02",
        ref: "APCA / Material / HIG: design your own focus ring",
        title: "A custom, high-contrast focus style is defined",
        guidance: "Relying on the UA default ring is inconsistent across browsers and often low-contrast on dark UIs. Define `:focus-visible`.",
        check(ctx) {
          const fv = ctx.flat.filter((r) => /:focus-visible/.test(r.selector));
          const f = ctx.flat.filter((r) => /:focus\b/.test(r.selector));
          if (fv.length) return PASS(`${fv.length} :focus-visible rule(s)`);
          if (f.length) return WARN(`${f.length} :focus rule(s) but no :focus-visible — mouse clicks will also show the ring`);
          return WARN("no focus styling at all — keyboard users see only the browser default ring");
        },
      },
      {
        id: "FK-03",
        ref: "WCAG 4.1.2 Name, Role, Value; MDN: use the platform",
        title: "Interactive controls are real elements, not click-handled divs",
        guidance: "Buttons/links must be <button>/<a> so they are focusable, announce a role, and fire on Enter/Space.",
        check(ctx) {
          const offenders = [];
          for (const [name, src] of Object.entries(ctx.files)) {
            if (!src) continue;
            for (const m of src.matchAll(/<(\w+)([^>]*?)\bonClick=/g)) {
              const tag = m[1];
              if (!/^(button|a|Link|summary)$/i.test(tag) && !/role=["'](button|link|tab|menuitem)["']/.test(m[2])) {
                offenders.push(`${name}:<${tag} onClick>`);
              }
            }
          }
          return offenders.length ? FAIL(`non-semantic click targets: ${offenders.join(", ")}`) : PASS("all click targets are semantic elements");
        },
      },
    ],
  },

  {
    group: "Target size (WCAG 2.5.8 / HIG 44pt / Material 48dp)",
    rules: [
      {
        id: "TS-01",
        ref: "WCAG 2.2 SC 2.5.8 (24px min); Apple HIG 44pt; Material 48dp",
        title: "Buttons and inputs are padded to a comfortable hit area",
        guidance: "Approximate rendered height from padding: keep controls ≥ 24px (AA minimum), aim for ≥ 44px.",
        check(ctx) {
          const notes = [];
          for (const sel of ["button", "a", "input", "select", "textarea"]) {
            const r = ctx.rule(sel) || ctx.rule(new RegExp(`(^|\\s)${sel}$`));
            if (!r) continue;
            const pad = decl(r.body, "padding");
            if (!pad) continue;
            const parts = lengthTokens(pad).map(toPx);
            const vert = parts[0] ?? 0;
            const approx = vert * 2 + 18; // padding-block*2 + ~1 line
            if (approx < 24) notes.push(FAIL(`${r.selector} ≈ ${approx.toFixed(0)}px tall (< 24px)`));
            else if (approx < 40) notes.push(WARN(`${r.selector} ≈ ${approx.toFixed(0)}px tall (< 44px target)`));
          }
          const fail = notes.find((n) => n.status === "fail");
          if (fail) return fail;
          const warn = notes.find((n) => n.status === "warn");
          if (warn) return warn;
          return PASS("controls padded to a usable size");
        },
      },
      {
        id: "TS-02",
        ref: "WCAG 2.5.8 exception: decorative / inline",
        req: "REQ-F-014",
        title: "The status light is decorative, not an undersized control",
        guidance: "A ~10px dot is fine only if it is not interactive and is aria-hidden.",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          const m = src.match(/floating-chat__light[^>]*/);
          if (!m) return SKIP("status light not found");
          if (/onClick|role=/.test(m[0])) return FAIL("status light is interactive but tiny");
          return /aria-hidden/.test(m[0]) ? PASS("decorative + aria-hidden") : WARN("status light not marked aria-hidden");
        },
      },
    ],
  },

  {
    group: "Motion (WCAG 2.3.3 / prefers-reduced-motion)",
    rules: [
      {
        id: "MO-01",
        ref: "WCAG 2.3.3 Animation from Interactions; MDN prefers-reduced-motion",
        title: "Animation is gated behind prefers-reduced-motion",
        guidance: "Any transition/animation/keyframes must be neutralised inside `@media (prefers-reduced-motion: reduce)`.",
        check(ctx) {
          const animated = ctx.flat.filter((r) => /(^|[;{\s])(transition|animation)\s*:/.test(r.body) && !/\b0s\b/.test(r.body));
          const keyframes = /@keyframes/.test(ctx.css);
          const guard = /prefers-reduced-motion\s*:\s*reduce/.test(ctx.css);
          if ((animated.length || keyframes) && !guard) {
            return FAIL(`${animated.length + (keyframes ? 1 : 0)} animated rule(s) with no reduced-motion guard`);
          }
          return PASS(animated.length || keyframes ? "animations guarded" : "no animation to guard");
        },
      },
    ],
  },

  {
    group: "Responsive & reflow (WCAG 1.4.10 / 1.4.4)",
    rules: [
      {
        id: "RF-01",
        ref: "WCAG 1.4.4 / 1.4.10; MDN viewport meta",
        title: "Viewport is zoomable (no user-scalable=no / maximum-scale)",
        guidance: "Never disable pinch-zoom. Next injects a good default; a viewport export must not lock scale.",
        check(ctx) {
          const srcs = [ctx.files["layout.tsx"], ctx.files["page.tsx"], ctx.files["settings/models/page.tsx"]].filter(Boolean).join("\n");
          if (/user-scalable\s*[:=]\s*(no|0)|userScalable\s*:\s*false/.test(srcs)) return FAIL("viewport disables user scaling");
          if (/maximum-scale\s*[:=]\s*1|maximumScale\s*:\s*1\b/.test(srcs)) return FAIL("viewport caps maximum-scale at 1");
          return PASS("zoom not restricted");
        },
      },
      {
        id: "RF-02",
        ref: "WCAG 1.4.10 Reflow (content usable at 320 CSS px)",
        req: "REQ-F-014",
        title: "Full-bleed / fixed elements are clamped to the viewport",
        guidance: "A fixed bar must use min(px, 100vw - margin) or max-width so it never forces horizontal scroll.",
        check(ctx) {
          const fc = ctx.rule(".floating-chat");
          const w = fc && decl(fc.body, "width");
          const mw = fc && decl(fc.body, "max-width");
          const ok = (w && /100vw|100%/.test(w) && /min\(|calc\(/.test(w)) || (mw && /100vw|100%/.test(mw));
          return ok ? PASS(`width: ${w ?? mw}`) : FAIL(`.floating-chat width (${w ?? "unset"}) is not viewport-clamped`);
        },
      },
      {
        id: "RF-03",
        ref: "web.dev: the flexbox min-width:0 overflow trap",
        title: "Flex/grid children that hold text can shrink",
        guidance: "Inputs and message columns need `min-width: 0` (or `overflow-wrap`) or a long token blows out the layout.",
        check(ctx) {
          const inputRule = ctx.rules(/input|select|textarea/).find((r) => /min-width\s*:\s*0/.test(r.body));
          if (inputRule) return PASS(`${inputRule.selector} sets min-width: 0`);
          return WARN("no `min-width: 0` on form fields — a long unbroken value can overflow a flex row");
        },
      },
      {
        id: "RF-04",
        ref: "MDN: mobile-first breakpoints",
        req: "REQ-F-014",
        title: "A mobile breakpoint exists (≤ 768px)",
        guidance: "The console layout must adapt for narrow screens, not just shrink.",
        check(ctx) {
          const mq = ctx.css.match(/@media\s*\([^)]*max-width\s*:\s*(\d+)px/g);
          if (!mq) return FAIL("no max-width media query");
          const widths = [...ctx.css.matchAll(/max-width\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
          return widths.some((w) => w <= 768) ? PASS(`breakpoint(s): ${[...new Set(widths)].join(", ")}px`) : WARN(`only wide breakpoints: ${widths.join(", ")}px`);
        },
      },
      {
        id: "RF-05",
        ref: "WCAG 2.4.11 Focus Not Obscured; layout best practice",
        req: "REQ-F-002",
        title: "Page content clears the fixed bottom console",
        guidance: "The page scroll container needs padding-bottom ≥ the console height so nothing hides behind it — on mobile too.",
        check(ctx) {
          const candidates = [".home", ".shell", "main"];
          const selector = candidates.find((sel) => {
            const r = ctx.rule(sel);
            return r && decl(r.body, "padding-bottom");
          });
          if (!selector) return FAIL(`no page container (${candidates.join(", ")}) sets padding-bottom for the fixed bar`);

          const pb = decl(ctx.rule(selector).body, "padding-bottom");
          if (toPx(pb) < 96) return FAIL(`${selector} padding-bottom is ${pb} (< 6rem clearance for the fixed bar)`);
          const mobile = ctx.ruleIn("max-width", selector);
          const mpb = mobile && decl(mobile.body, "padding-bottom");
          if (mobile && (!mpb || toPx(mpb) < 96)) {
            return WARN(`mobile ${selector} padding-bottom is ${mpb ?? "unset"} — content may hide behind the console`);
          }
          return PASS(`${selector} padding-bottom: ${pb}`);
        },
      },
      {
        id: "RF-06",
        ref: "MDN overflow-wrap / word-break",
        req: "REQ-F-014",
        title: "Model output wraps long tokens instead of overflowing",
        guidance: "LLM replies contain URLs and code — message bubbles need `overflow-wrap: anywhere` (or `break-word`).",
        check(ctx) {
          const msg = ctx.rule(".floating-chat__message");
          const v = msg && (decl(msg.body, "overflow-wrap") || decl(msg.body, "word-break"));
          return /anywhere|break-word|break-all/.test(v ?? "") ? PASS(v) : FAIL(".floating-chat__message does not wrap long words");
        },
      },
      {
        id: "RF-07",
        ref: "web.dev: scrollable regions",
        req: "REQ-F-003",
        title: "The transcript scrolls within a bounded height",
        guidance: "The expanded panel must cap its height and scroll internally, not push the page.",
        check(ctx) {
          const list = ctx.rule(".floating-chat__messages");
          if (!list) return SKIP(".floating-chat__messages not found");
          const overflow = decl(list.body, "overflow") || decl(list.body, "overflow-y");
          if (!/auto|scroll/.test(overflow ?? "")) return FAIL("transcript has no overflow scroll");

          // The height may be capped on the list itself, or inherited from a capped
          // expanded panel when the transcript is a flex child of it.
          const ownCap = decl(list.body, "max-height");
          const expanded = ctx.rule(/\.floating-chat--expanded|\.floating-chat\.is-expanded/);
          const parentCap = expanded && decl(expanded.body, "max-height");
          if (ownCap) return PASS(`overflow: ${overflow}, max-height: ${ownCap}`);
          if (parentCap && /\bflex\s*:\s*1/.test(list.body)) {
            return PASS(`overflow: ${overflow}, bounded by the expanded panel (max-height: ${parentCap})`);
          }
          return WARN("transcript scrolls but nothing caps its height");
        },
      },
      {
        id: "RF-08",
        ref: "Apple HIG: safe area / env() insets",
        title: "The fixed bottom bar respects the mobile safe area",
        guidance: "On notched phones, add `env(safe-area-inset-bottom)` to the bottom offset so the bar isn't under the home indicator.",
        check(ctx) {
          const fc = ctx.rule(".floating-chat");
          const bottom = fc && decl(fc.body, "bottom");
          return /safe-area-inset/.test(bottom ?? "") || /viewport-fit=cover/.test(ctx.files["layout.tsx"] ?? "")
            ? PASS("safe-area handled")
            : WARN("bottom offset ignores env(safe-area-inset-bottom) — bar may collide with the iOS home indicator");
        },
      },
      {
        id: "RF-09",
        ref: "DEC-005; NN/g: keep the primary surface visible",
        req: "REQ-F-003",
        title: "The expanded console never takes over the screen",
        guidance:
          "The composer expands into a bottom panel, not a full-screen chat. Cap the expanded height at 50vh (CR-20260909, was 65vh) so the page behind stays visible and the product does not read as a chat clone.",
        check(ctx) {
          const expanded = ctx.rule(/\.floating-chat--expanded|\.floating-chat\.is-expanded/);
          if (!expanded) return SKIP("no expanded-state rule");
          const maxH = decl(expanded.body, "max-height");
          if (!maxH) return FAIL("expanded console has no max-height — it can grow to full screen");
          const vh = maxH.match(/^(\d+(?:\.\d+)?)vh$/);
          if (!vh) return PASS(`max-height: ${maxH}`);
          return Number(vh[1]) <= 55
            ? PASS(`max-height: ${maxH}`)
            : FAIL(`expanded console max-height ${maxH} exceeds the 50vh cap (CR-20260909)`);
        },
      },
    ],
  },

  {
    group: "Semantics & landmarks (WCAG 1.3.1 / 2.4.1 / 4.1.2 / 4.1.3)",
    rules: [
      {
        id: "SE-01",
        ref: "WCAG 3.1.1 Language of Page",
        title: "<html> declares a lang",
        guidance: "Screen readers pick pronunciation from `<html lang>`.",
        check(ctx) {
          const src = ctx.files["layout.tsx"] ?? "";
          return /<html[^>]*\blang=/.test(src) ? PASS() : FAIL("<html> has no lang attribute");
        },
      },
      {
        id: "SE-02",
        ref: "WCAG 1.3.1; ARIA landmarks",
        title: "Each screen renders exactly one <main>",
        guidance: "One main landmark per view; secondary UI (the chat) is a labelled complementary region.",
        check(ctx) {
          for (const name of ["page.tsx", "settings/models/page.tsx", "ModelSettings.tsx"]) {
            const src = ctx.files[name];
            if (!src) continue;
            const count = (src.match(/<main\b/g) ?? []).length;
            if (count > 1) return FAIL(`${name} renders ${count} <main> elements`);
          }
          const hasMain = /<main\b/.test(ctx.files["page.tsx"] ?? "") || /<main\b/.test(ctx.files["ModelSettings.tsx"] ?? "");
          return hasMain ? PASS("single main landmark per screen") : WARN("no <main> landmark found");
        },
      },
      {
        id: "SE-03",
        ref: "WCAG 2.4.6 Headings; one-h1 convention",
        title: "Each screen has one and only one <h1>",
        guidance: "The floating chat must not introduce a second h1; it uses aria-label instead.",
        check(ctx) {
          const chat = ctx.files["FloatingChat.tsx"] ?? "";
          if (/<h1\b/.test(chat)) return FAIL("FloatingChat renders an <h1> — it should be a labelled region");
          const page = (ctx.files["page.tsx"]?.match(/<h1\b/g) ?? []).length;
          const settings = (ctx.files["ModelSettings.tsx"]?.match(/<h1\b/g) ?? []).length;
          if (page > 1 || settings > 1) return FAIL(`multiple <h1> (home=${page}, settings=${settings})`);
          return PASS("one h1 per screen; chat uses aria-label");
        },
      },
      {
        id: "SE-04",
        ref: "WCAG 4.1.3 Status Messages",
        req: "REQ-F-004",
        title: "Streamed output lives in an ARIA live region",
        guidance: "The transcript needs `aria-live` so assistive tech announces the reply; prefer announcing on completion over every token.",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          if (!/aria-live=/.test(src)) return FAIL("no aria-live region around the streamed reply");
          if (/aria-live=["']assertive["']/.test(src)) return WARN("aria-live=assertive interrupts the user on every chunk — use polite");
          return PASS("aria-live present");
        },
      },
      {
        id: "SE-05",
        ref: "WCAG 1.3.1 / 3.3.2 / 4.1.2 — labelled controls",
        req: "REQ-F-007",
        title: "Every input & select has an accessible name",
        guidance: "Each field is wrapped in <label> or carries aria-label; no naked inputs.",
        check(ctx) {
          const offenders = [];
          for (const name of ["FloatingChat.tsx", "ModelSettings.tsx", "SettingsDialog.tsx", "AccountDialog.tsx", "ThemeToggle.tsx"]) {
            const src = ctx.files[name];
            if (!src) continue;
            // strip <label>…</label> then look for remaining inputs without aria-label
            const outside = src.replace(/<label[\s\S]*?<\/label>/g, "");
            for (const m of outside.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
              if (!/aria-label|aria-labelledby|id=/.test(m[2])) offenders.push(`${name}:<${m[1]}>`);
            }
          }
          return offenders.length ? FAIL(`unlabelled field(s): ${offenders.join(", ")}`) : PASS("all fields labelled");
        },
      },
      {
        id: "SE-06",
        ref: "WCAG 4.1.3 Status Messages",
        req: "REQ-F-005",
        title: "Connection / generation status uses role=status",
        guidance: "Saving…, Provider saved, Stopped, error text — put them in a `role=\"status\"` / aria-live node, not a bare span.",
        check(ctx) {
          const settingsOk = /role=["']status["']/.test(ctx.files["ModelSettings.tsx"] ?? "");
          const chatOk = /role=["']status["']|aria-live=/.test(ctx.files["FloatingChat.tsx"] ?? "");
          if (settingsOk && chatOk) return PASS();
          const missing = [!settingsOk && "ModelSettings", !chatOk && "FloatingChat"].filter(Boolean).join(", ");
          return WARN(`status text not in a live region: ${missing}`);
        },
      },
      {
        id: "SE-07",
        ref: "WCAG 1.1.1 Non-text Content",
        title: "Decorative glyphs are hidden from assistive tech",
        guidance: "The status light and any icon-only flourish carry aria-hidden.",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          const m = src.match(/<span[^>]*floating-chat__light[^>]*>/);
          if (!m) return SKIP("status light not found");
          return /aria-hidden/.test(m[0]) ? PASS() : FAIL("status light not aria-hidden");
        },
      },
    ],
  },

  {
    group: "Forms, feedback & states",
    rules: [
      {
        id: "FF-01",
        ref: "Material / NN/g: prevent double submit",
        req: "REQ-F-005",
        title: "Primary actions are guarded while a request is in flight",
        guidance: "Disable or swap the submit control during send/save so it can't fire twice.",
        check(ctx) {
          const chat = ctx.files["FloatingChat.tsx"] ?? "";
          const settings = ctx.files["ModelSettings.tsx"] ?? "";
          const chatOk = /isStreaming\s*\?/.test(chat) || /disabled=\{[^}]*isStreaming/.test(chat);
          const settingsOk = /disabled=\{[^}]*(busy|saving|pending|submitting)/i.test(settings) || /aria-busy/.test(settings);
          if (chatOk && settingsOk) return PASS();
          if (chatOk) return WARN("FloatingChat guards submit; ModelSettings save button is not disabled while saving");
          return FAIL("submit controls are not guarded against re-entry");
        },
      },
      {
        id: "FF-02",
        ref: "OWASP / MDN: sensitive inputs",
        req: "REQ-F-009",
        title: "Secret / API-key fields use type=password",
        guidance: "Never render an API key in a plain text input.",
        check(ctx) {
          const src = ctx.files["ModelSettings.tsx"] ?? "";
          const blocks = src.split(/<input\b/).slice(1);
          const secret = blocks.find((b) => /name=["'](secret|apiKey|api_key|token)["']/i.test(b.slice(0, 400)) || /secret|api[\s-]?key/i.test(b.slice(0, 200)));
          if (!secret) return SKIP("no secret field found");
          return /type=["']password["']/.test(secret.slice(0, 400)) ? PASS() : FAIL("secret field is not type=password");
        },
      },
      {
        id: "FF-03",
        ref: "NN/g: empty states",
        req: "REQ-F-006",
        title: "Empty states are designed, not blank",
        guidance: "No provider → tell the user and link to settings. No conversations → say so.",
        check(ctx) {
          const chat = ctx.files["FloatingChat.tsx"] ?? "";
          const settings = ctx.files["ModelSettings.tsx"] ?? "";
          // CR-20260909: no provider is surfaced by the「off」light + the request-level
          // red line on send (「没有可用的模型 Provider」), not an in-console settings link.
          const chatEmpty = /floating-chat__error|floating-chat__light--off|没有可用|LIGHT_LABEL/.test(chat);
          const settingsEmpty = /No .*(provider|model).*(yet|saved)/i.test(settings);
          if (chatEmpty && settingsEmpty) return PASS();
          return WARN(`missing empty-state copy: ${[!chatEmpty && "chat", !settingsEmpty && "settings"].filter(Boolean).join(", ")}`);
        },
      },
      {
        id: "FF-04",
        ref: "WCAG 3.3.1 Error Identification",
        req: "REQ-F-004",
        title: "Errors surface in the UI, not just the console",
        guidance: "Network/provider failures must render user-visible text, not only console.error.",
        check(ctx) {
          const chat = ctx.files["FloatingChat.tsx"] ?? "";
          const showsError = /setStatus\([^)]*error/i.test(chat) || /catch[\s\S]{0,120}set(Status|Error|Messages)/.test(chat);
          return showsError ? PASS() : WARN("no visible error handling path found in FloatingChat");
        },
      },
    ],
  },

  {
    group: "Layout behaviour (架构 DEC-005)",
    rules: [
      {
        id: "LB-01",
        ref: "DEC-005; REQ-F-002",
        req: "REQ-F-002",
        title: "The console is pinned with position: fixed at the bottom",
        guidance: "全局底部悬浮：position fixed, anchored near bottom, above page content.",
        check(ctx) {
          const fc = ctx.rule(".floating-chat");
          if (!fc) return FAIL(".floating-chat rule missing");
          const pos = decl(fc.body, "position");
          // Take the first literal length in the offset, so calc(1.25rem + env(safe-area…)) still reads as 20px.
          const bottomRaw = decl(fc.body, "bottom") ?? "";
          const bottom = toPx(lengthTokens(bottomRaw)[0] ?? bottomRaw);
          const z = parseInt(decl(fc.body, "z-index") ?? "", 10);
          if (pos !== "fixed") return FAIL(`position is ${pos ?? "unset"} (want fixed)`);
          if (!(bottom <= 64)) return WARN(`bottom offset ${decl(fc.body, "bottom")} is large for a "docked" bar`);
          if (!(z >= 1)) return WARN("no z-index — the console may fall behind page content");
          return PASS(`position: fixed; bottom: ${decl(fc.body, "bottom")}; z-index: ${z}`);
        },
      },
      {
        id: "LB-02",
        ref: "REQ-F-002",
        req: "REQ-F-002",
        title: "The console is horizontally centred",
        guidance: "left:50% + translateX(-50%), or symmetric left/right.",
        check(ctx) {
          const fc = ctx.rule(".floating-chat");
          if (!fc) return SKIP("no .floating-chat");
          const left = decl(fc.body, "left");
          const transform = decl(fc.body, "transform");
          const right = decl(fc.body, "right");
          if (left === "50%" && /translateX\(\s*-50%\s*\)/.test(transform ?? "")) return PASS("left:50% + translateX(-50%)");
          if (left && right && left === right) return PASS(`symmetric left/right: ${left}`);
          if (/margin(-inline)?\s*:\s*(auto|0 auto)/.test(fc.body)) return PASS("centred via auto margins");
          return WARN("centring method unclear");
        },
      },
      {
        id: "LB-03",
        ref: "REQ-F-003 (CR-20260909-collapsible-panel)",
        req: "REQ-F-003",
        title: "Sending expands the bar into a panel",
        guidance:
          "An --expanded modifier grows the height. Since CR-20260909-collapsible-panel the expanded state is derived (showTranscript = hasTranscript && !userCollapsed); the panel is collapsed with no transcript and shows once a message exists.",
        check(ctx) {
          const rule = ctx.rule(/\.floating-chat--expanded|\.floating-chat\.is-expanded/);
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          // Legacy explicit toggle OR the derived model.
          const derives = /showTranscript\s*=\s*hasTranscript\s*&&\s*!\s*userCollapsed/.test(src);
          const drivesClass = /floating-chat--expanded[^`"']*\$\{?\s*(showTranscript|expanded)/.test(src) ||
            /(showTranscript|expanded)\s*\?\s*["'`]floating-chat--expanded/.test(src);
          const toggles = /setExpanded\(true\)/.test(src) || (derives && drivesClass);
          // With the derived model "collapsed by default" == hasTranscript starts false
          // (messages initialised to [] or from a restored conversation only).
          const startsCollapsed =
            derives ||
            /^\s*false\s*$/.test(src.match(/expanded[^;]*useState\(([^)]*)\)/)?.[1] ?? "") ||
            /messages[^;]*useState[^;]*restored\s*\?\s*initialMessages\s*:\s*\[\]/.test(src);
          if (!rule) return FAIL("no .floating-chat--expanded style");
          if (!toggles) return FAIL("sending does not drive the expanded panel (no setExpanded(true) and no derived showTranscript)");
          if (!startsCollapsed) return WARN("panel may not start collapsed");
          const grows = decl(rule.body, "min-height") || decl(rule.body, "height");
          return grows ? PASS(`expands to ${grows}${derives ? " (derived)" : ""}`) : WARN("--expanded exists but does not change height");
        },
      },
      {
        id: "LB-04",
        ref: "REQ-F-002",
        req: "REQ-F-002",
        title: "The collapsed bar shows the message input by default",
        guidance: "Placeholder text present, input visible before any interaction.",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          return /placeholder=["'][^"']+["']/.test(src) && /<(input|textarea)\b/.test(src)
            ? PASS()
            : FAIL("no default text input with a placeholder in the console");
        },
      },
      {
        id: "LB-05",
        ref: "REQ-F-006 (CR-20260909)",
        req: "REQ-F-006",
        title: "The floating console carries no provider/model selection",
        guidance:
          "CR-20260909 moved provider choice to 「配置」 (priority list). The console must not render a <select>, model chip, or editable model field — it sends no provider parameter.",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          const offenders = [];
          if (/<select\b/.test(src)) offenders.push("<select>");
          if (/floating-chat__chip|floating-chat__model|floating-chat__state/.test(src)) offenders.push("chip/model/state node");
          if (/setSelectedProviderId|selectedProvider\b/.test(src)) offenders.push("provider-selection state");
          // A providerId may still be threaded through as an optional override, but only guarded.
          if (/providerId:\s*request\.providerId\s*[,}]/.test(src) && !/request\.providerId\s*\?/.test(src)) {
            offenders.push("unconditional providerId in request body");
          }
          return offenders.length ? FAIL(`console still has provider selection: ${offenders.join(", ")}`) : PASS("no in-console provider selection");
        },
      },
      {
        id: "LB-07",
        ref: "REQ-F-019 (CR-20260909-collapsible-panel)",
        req: "REQ-F-019",
        title: "The transcript has a collapse/expand control",
        guidance:
          "A real <button> with aria-expanded that toggles userCollapsed, rendered only when a transcript exists; no height transition on the expanded panel (v1).",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          const hasButton = /floating-chat__toggle/.test(src) && /<button[^>]*floating-chat__toggle/.test(src);
          const hasAria = /floating-chat__toggle[\s\S]{0,200}aria-expanded=/.test(src);
          const gated = /hasTranscript\s*\?\s*[\s\S]{0,120}floating-chat__toggle/.test(src);
          const expandedRule = ctx.rule(/\.floating-chat--expanded/);
          const noTween = !expandedRule || !/transition[^;]*(max-height|min-height|height)/.test(expandedRule.body);
          if (!hasButton) return FAIL("no .floating-chat__toggle <button>");
          if (!hasAria) return FAIL("collapse control missing aria-expanded");
          if (!gated) return WARN("collapse control may render without a transcript");
          if (!noTween) return FAIL("expanded panel animates its height — v1 is an instant toggle (DEC-013)");
          return PASS("collapse control: <button> + aria-expanded, transcript-gated, no height animation");
        },
      },
      {
        id: "LB-06",
        ref: "REQ-F-018 (CR-20260909)",
        req: "REQ-F-018",
        title: "The status light has four distinguishable states",
        guidance:
          "checking / off / ready / busy must each map to a distinct class and CSS rule, and the light stays decorative (state is also exposed as text for AT).",
        check(ctx) {
          const src = ctx.files["FloatingChat.tsx"] ?? "";
          const states = ["checking", "off", "ready", "busy"];
          const inJsx = states.every((s) => new RegExp(`floating-chat__light--${s}|["']${s}["']`).test(src));
          const inCss = states.every((s) => new RegExp(`\\.floating-chat__light--${s}\\b`).test(ctx.css));
          if (!inJsx) return FAIL("FloatingChat does not render all four light states");
          if (!inCss) return FAIL("globals.css does not style all four .floating-chat__light--* states");
          return PASS("four light states rendered and styled");
        },
      },
    ],
  },

  {
    group: "Session continuity",
    rules: [
      {
        id: "SC-01",
        ref: "REQ-F-013",
        req: "REQ-F-013",
        title: "Recent conversation is restored into the UI",
        guidance: "The recent-conversations endpoint exists — the console must actually load history on mount.",
        check(ctx) {
          const src = `${ctx.files["FloatingChat.tsx"] ?? ""}\n${ctx.files["page.tsx"] ?? ""}`;
          const wired = /conversations\/recent|initialMessages|initialConversation|useEffect\([^)]*load/i.test(src);
          return wired ? PASS("history is loaded into the client") : WARN("`/api/conversations/recent` is never read by the UI — refresh loses the transcript (REQ-F-013 gap)");
        },
      },
    ],
  },
];

/* ================================================================== */
/* runner                                                              */
/* ================================================================== */

function runStatic() {
  const ctx = buildContext();
  const results = [];
  for (const section of CONTRACT) {
    for (const rule of section.rules) {
      let outcome;
      try {
        outcome = rule.check(ctx) ?? SKIP("check returned nothing");
      } catch (err) {
        outcome = FAIL(`check threw: ${err.message}`);
      }
      results.push({
        group: section.group,
        id: rule.id,
        ref: rule.ref,
        req: rule.req ?? null,
        title: rule.title,
        guidance: rule.guidance,
        ...outcome,
      });
    }
  }
  return results;
}

/* ================================================================== */
/* live tier (Playwright)                                              */
/* ================================================================== */

async function runLive(url) {
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    return [{ group: "live", id: "LV-00", title: "Playwright available", status: "skip", detail: "@playwright/test not installed" }];
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    return [{ group: "live", id: "LV-00", title: "Browser launch", status: "skip", detail: err.message + " — run `npx playwright install chromium`" }];
  }

  const results = [];
  const push = (id, title, outcome, ref) => results.push({ group: "live", id, title, ref, ...outcome });
  const viewports = [
    { name: "narrow", width: 320, height: 640 },
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 },
  ];
  const paths = ["/", "/settings/models"];

  try {
    // ---- reflow: no horizontal scrollbar at any width ----
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      for (const path of paths) {
        const page = await ctx.newPage();
        let navOk = true;
        try {
          await page.goto(url + path, { waitUntil: "networkidle", timeout: 15000 });
        } catch (err) {
          navOk = false;
          push(`LV-REFLOW-${vp.name}${path}`, `Reflow @${vp.width}px ${path}`, SKIP(`navigation failed: ${err.message}`), "WCAG 1.4.10");
        }
        if (navOk) {
          const m = await page.evaluate(() => ({
            sw: document.documentElement.scrollWidth,
            cw: document.documentElement.clientWidth,
          }));
          const overflow = m.sw - m.cw;
          push(
            `LV-REFLOW-${vp.name}${path}`,
            `No horizontal scroll @${vp.width}px on ${path}`,
            overflow > 1 ? FAIL(`scrollWidth exceeds viewport by ${overflow}px`) : PASS(),
            "WCAG 1.4.10 Reflow"
          );
        }
        await page.close();
      }
      await ctx.close();
    }

    // ---- everything else on the home screen at desktop ----
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    let homeOk = true;
    try {
      await page.goto(url + "/", { waitUntil: "networkidle", timeout: 15000 });
    } catch (err) {
      homeOk = false;
      push("LV-HOME", "Home screen reachable", SKIP(err.message), "");
    }

    if (homeOk) {
      // viewport meta
      const meta = await page.getAttribute('meta[name="viewport"]', "content").catch(() => null);
      push(
        "LV-VIEWPORT",
        "Viewport meta allows zoom",
        !meta
          ? WARN("no viewport meta found")
          : /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\b|\.0)/.test(meta)
            ? FAIL(`viewport locks zoom: "${meta}"`)
            : PASS(`"${meta}"`),
        "WCAG 1.4.4"
      );

      // landmarks
      const landmarks = await page.evaluate(() => ({
        main: document.querySelectorAll("main").length,
        h1: document.querySelectorAll("h1").length,
        header: document.querySelectorAll("header").length,
      }));
      push(
        "LV-LANDMARKS",
        "One main / one h1 / a header",
        landmarks.main === 1 && landmarks.h1 === 1
          ? PASS(JSON.stringify(landmarks))
          : WARN(`main=${landmarks.main}, h1=${landmarks.h1}, header=${landmarks.header}`),
        "WCAG 1.3.1 / 2.4.6"
      );

      // floating console geometry + dark body + status light
      const fc = await page.evaluate(() => {
        const el = document.querySelector(".floating-chat");
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const light = document.querySelector(".floating-chat__light");
        return {
          position: cs.position,
          bottomGap: window.innerHeight - r.bottom,
          centerDelta: Math.abs(r.left + r.width / 2 - window.innerWidth / 2),
          width: r.width,
          vw: window.innerWidth,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          bodyBgImage: getComputedStyle(document.body).backgroundImage,
          bodyColor: getComputedStyle(document.body).color,
          lightPresent: Boolean(light),
        };
      });
      if (!fc) {
        push("LV-CONSOLE", "Floating console rendered", SKIP("`.floating-chat` not in DOM — is the session authed? (set JARVIS_TEST_USER_ID on the server)"), "REQ-F-002");
      } else {
        push(
          "LV-CONSOLE-POS",
          "Console is fixed, docked and centred",
          fc.position === "fixed" && fc.bottomGap >= -1 && fc.bottomGap < 120 && fc.centerDelta <= 2
            ? PASS(`bottomGap=${fc.bottomGap.toFixed(0)}px centerDelta=${fc.centerDelta.toFixed(1)}px`)
            : FAIL(`position=${fc.position} bottomGap=${fc.bottomGap.toFixed(0)}px centerDelta=${fc.centerDelta.toFixed(1)}px`),
          "REQ-F-002 / DEC-005"
        );
        push(
          "LV-CONSOLE-WIDTH",
          "Console never exceeds the viewport",
          fc.width <= fc.vw ? PASS(`${fc.width.toFixed(0)}/${fc.vw}px`) : FAIL(`console ${fc.width.toFixed(0)}px wider than viewport ${fc.vw}px`),
          "WCAG 1.4.10"
        );
        const bg = parseColor(fc.bodyBg);
        const fg = parseColor(fc.bodyColor);
        const painted = (bg && bg.a > 0) || /gradient|url\(/.test(fc.bodyBgImage ?? "");
        const readable = bg && fg && bg.a > 0 ? contrastRatio(fg, bg) : null;
        push(
          "LV-SURFACE",
          "Body paints an explicit surface that its text reads against",
          !painted
            ? WARN(`body background is ${fc.bodyBg} with no image — the page borrows the host background`)
            : readable !== null && readable < 4.5
              ? FAIL(`body text on body background is ${readable.toFixed(2)}:1 (need 4.5:1)`)
              : PASS(readable !== null ? `${fc.bodyBg}, ${readable.toFixed(2)}:1` : fc.bodyBg),
          "REQ-F-014 / WCAG 1.4.3"
        );
        push(
          "LV-LIGHT",
          "Status light renders",
          fc.lightPresent ? PASS() : WARN("`.floating-chat__light` did not render"),
          "REQ-F-014"
        );
      }

      // computed text contrast on visible text nodes (re-usable across themes)
      const contrastProbe = () => {
        function lum([r, g, b]) {
          const a = [r, g, b].map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
        }
        function ratio(c1, c2) {
          const l1 = lum(c1);
          const l2 = lum(c2);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        }
        function rgb(str) {
          const m = str.match(/[\d.]+/g);
          return m ? m.slice(0, 3).map(Number) : null;
        }
        function rgba(str) {
          const m = str.match(/[\d.]+/g);
          if (!m) return null;
          const n = m.map(Number);
          return { r: n[0], g: n[1], b: n[2], a: n[3] === undefined ? 1 : n[3] };
        }
        // Opaque base behind transparent/gradient layers: the real painted body
        // background when it has one, otherwise white (works for either theme).
        const bodyBase = rgba(getComputedStyle(document.body).backgroundColor);
        const PAGE = bodyBase && bodyBase.a > 0 ? { r: bodyBase.r, g: bodyBase.g, b: bodyBase.b } : { r: 255, g: 255, b: 255 };
        function bgOf(el) {
          const layers = [];
          let n = el;
          while (n && n !== document.documentElement) {
            const cs = getComputedStyle(n);
            const c = rgba(cs.backgroundColor);
            if (c && c.a > 0) layers.push(c);
            if (cs.backgroundImage && cs.backgroundImage !== "none") {
              layers.push({ ...PAGE, a: 1 }); // can't sample a gradient — treat as the dark page base
              break;
            }
            if (c && c.a >= 1) break;
            n = n.parentElement;
          }
          let cur = { ...PAGE };
          if (layers.length && layers[layers.length - 1].a >= 1) cur = layers.pop();
          for (let i = layers.length - 1; i >= 0; i--) {
            const f = layers[i];
            cur = {
              r: f.r * f.a + cur.r * (1 - f.a),
              g: f.g * f.a + cur.g * (1 - f.a),
              b: f.b * f.a + cur.b * (1 - f.a),
            };
          }
          return [cur.r, cur.g, cur.b];
        }
        const out = [];
        const seen = new Set();
        document.querySelectorAll("body *").forEach((el) => {
          const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
          if (!text || text.length < 2) return;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return;
          const fg = rgb(cs.color);
          if (!fg) return;
          const size = parseFloat(cs.fontSize);
          const bold = Number(cs.fontWeight) >= 700;
          const large = size >= 24 || (size >= 18.66 && bold);
          const need = large ? 3 : 4.5;
          const r = ratio(fg, bgOf(el));
          const key = cs.color + "|" + text.slice(0, 20);
          if (seen.has(key)) return;
          seen.add(key);
          if (r < need) out.push({ text: text.slice(0, 40), ratio: Math.round(r * 100) / 100, need });
        });
        return out;
      };
      const describeContrast = (report) =>
        report.length === 0
          ? PASS()
          : FAIL(`${report.length} low-contrast text run(s): ` + report.slice(0, 4).map((c) => `"${c.text}" ${c.ratio}:1<${c.need}`).join("; "));

      push("LV-CONTRAST", "All rendered text meets WCAG AA contrast (light)", describeContrast(await page.evaluate(contrastProbe)), "WCAG 1.4.3");

      // Same page forced into the dark theme the appearance toggle sets.
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      push(
        "LV-CONTRAST-DARK",
        "All rendered text meets WCAG AA contrast (dark theme)",
        describeContrast(await page.evaluate(contrastProbe)),
        "WCAG 1.4.3"
      );
      const darkOverflow = await page.evaluate(() => {
        document.documentElement.setAttribute("data-theme", "dark");
        const d = document.documentElement;
        return { sw: d.scrollWidth, cw: d.clientWidth };
      });
      push(
        "LV-REFLOW-dark",
        "No horizontal scroll in the dark theme",
        darkOverflow.sw - darkOverflow.cw > 1 ? FAIL(`scrollWidth exceeds viewport by ${darkOverflow.sw - darkOverflow.cw}px`) : PASS(),
        "WCAG 1.4.10"
      );
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

      // focus visibility across interactive elements
      const focusReport = await page.evaluate(() => {
        const els = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        const bad = [];
        let checked = 0;
        for (const el of els) {
          // Only judge controls that are actually reachable right now. Anything
          // inside a closed <dialog>, hidden, or disabled cannot take focus, and
          // its computed style never changes — that is not a focus-ring defect.
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          const before = getComputedStyle(el);
          const beforeSnap = before.outline + "|" + before.boxShadow + "|" + before.borderColor + "|" + before.backgroundColor;
          el.focus();
          if (document.activeElement !== el) continue;
          checked++;

          const after = getComputedStyle(el);
          const afterSnap = after.outline + "|" + after.boxShadow + "|" + after.borderColor + "|" + after.backgroundColor;
          const uaRing = after.outlineStyle !== "none" && parseFloat(after.outlineWidth) > 0;
          if (!uaRing && beforeSnap === afterSnap) {
            bad.push((el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 24));
          }
          el.blur();
        }
        return { total: checked, bad };
      });
      push(
        "LV-FOCUS",
        "Every interactive element shows a focus indicator",
        focusReport.bad.length === 0
          ? PASS(`${focusReport.total} controls checked`)
          : FAIL(`no visible focus on: ${focusReport.bad.join(", ")}`),
        "WCAG 2.4.7"
      );

      // rendered target sizes
      const targets = await page.evaluate(() => {
        const els = [...document.querySelectorAll('a[href], button, input, select, [role="button"]')];
        const small = [];
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const min = Math.min(r.width, r.height);
          if (min < 24) small.push({ label: (el.textContent || el.tagName).trim().slice(0, 20), size: `${r.width.toFixed(0)}x${r.height.toFixed(0)}` });
        }
        return small;
      });
      push(
        "LV-TARGET",
        "Controls render at ≥ 24x24 CSS px",
        targets.length === 0 ? PASS() : FAIL(`undersized: ${targets.map((t) => `${t.label} ${t.size}`).join(", ")}`),
        "WCAG 2.5.8"
      );

      // reduced motion honoured
      const rmCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const rmPage = await rmCtx.newPage();
      try {
        await rmPage.goto(url + "/", { waitUntil: "networkidle", timeout: 15000 });
        const moving = await rmPage.evaluate(() => {
          const bad = [];
          document.querySelectorAll("body *").forEach((el) => {
            const cs = getComputedStyle(el);
            const dur = parseFloat(cs.transitionDuration) + parseFloat(cs.animationDuration);
            if (dur > 0.01) bad.push(el.className || el.tagName);
          });
          return bad.slice(0, 5);
        });
        push(
          "LV-REDUCED-MOTION",
          "prefers-reduced-motion neutralises animation",
          moving.length === 0 ? PASS() : WARN(`still animating under reduce: ${moving.join(", ")}`),
          "WCAG 2.3.3"
        );
      } catch (err) {
        push("LV-REDUCED-MOTION", "prefers-reduced-motion", SKIP(err.message), "WCAG 2.3.3");
      }
      await rmCtx.close();

      // full axe-core audit if the library is resolvable
      let axePath = null;
      try {
        axePath = fileURLToPath(await import.meta.resolve("axe-core/axe.min.js"));
      } catch {
        try {
          axePath = fileURLToPath(await import.meta.resolve("axe-core"));
        } catch {
          /* not installed */
        }
      }
      if (axePath) {
        await page.addScriptTag({ path: axePath });
        const axe = await page.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const res = await window.axe.run(document, { resultTypes: ["violations"] });
          return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length }));
        });
        const serious = axe.filter((v) => v.impact === "serious" || v.impact === "critical");
        push(
          "LV-AXE",
          "axe-core: no serious/critical violations",
          serious.length === 0
            ? PASS(axe.length ? `${axe.length} minor/moderate issue(s)` : "clean")
            : FAIL(serious.map((v) => `${v.id}(${v.impact}, ${v.n})`).join(", ")),
          "axe-core / WCAG 2.2 AA"
        );
      } else {
        push("LV-AXE", "axe-core audit", SKIP("install `axe-core` (npm i -D axe-core) to enable the full audit"), "axe-core");
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  return results;
}

/* ================================================================== */
/* reporting                                                           */
/* ================================================================== */

const ICON = { pass: "\x1b[32mPASS\x1b[0m", fail: "\x1b[31mFAIL\x1b[0m", warn: "\x1b[33mWARN\x1b[0m", skip: "\x1b[90mSKIP\x1b[0m" };

function report(results, { strict }) {
  let group = "";
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      process.stdout.write(`\n  \x1b[1m${group}\x1b[0m\n`);
    }
    const tag = r.req ? ` \x1b[36m${r.req}\x1b[0m` : "";
    process.stdout.write(`  ${ICON[r.status]}  ${r.id.padEnd(10)} ${r.title}${tag}\n`);
    if (r.detail && r.status !== "pass") process.stdout.write(`        \x1b[90m└ ${r.detail}\x1b[0m\n`);
  }
  const c = (s) => results.filter((r) => r.status === s).length;
  const summary = `\n  ${c("pass")} passed · ${c("fail")} failed · ${c("warn")} warnings · ${c("skip")} skipped\n`;
  process.stdout.write(summary);
  const failed = c("fail") > 0 || (strict && c("warn") > 0);
  return failed ? 1 : 0;
}

function emitDoc() {
  const lines = ["# Agent-Jarvis UI Contract", "", "Auto-generated from `scripts/ui-contract.mjs`. Each rule is machine-checked.", ""];
  for (const section of CONTRACT) {
    lines.push(`## ${section.group}`, "", "| ID | Rule | Reference | Requirement | Guidance |", "|---|---|---|---|---|");
    for (const rule of section.rules) {
      lines.push(`| ${rule.id} | ${rule.title} | ${rule.ref} | ${rule.req ?? "—"} | ${rule.guidance.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  process.stdout.write(lines.join("\n") + "\n");
}

/* ================================================================== */
/* CLI                                                                 */
/* ================================================================== */

async function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f, d) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };

  if (has("--help") || has("-h")) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, "") + "\n");
    return;
  }
  if (has("--doc")) {
    emitDoc();
    return;
  }

  const strict = has("--strict");
  let results = runStatic();

  if (has("--live")) {
    const url = val("--url", process.env.JARVIS_UI_URL || "http://127.0.0.1:3330");
    process.stderr.write(`\n  running live checks against ${url} ...\n`);
    results = results.concat(await runLive(url));
  }

  if (has("--json")) {
    const c = (s) => results.filter((r) => r.status === s).length;
    process.stdout.write(
      JSON.stringify(
        {
          tool: "ui-contract",
          generatedAt: new Date().toISOString(),
          mode: has("--live") ? "static+live" : "static",
          summary: { pass: c("pass"), fail: c("fail"), warn: c("warn"), skip: c("skip") },
          results,
        },
        null,
        2
      ) + "\n"
    );
    process.exitCode = c("fail") > 0 || (strict && c("warn") > 0) ? 1 : 0;
    return;
  }

  process.stdout.write("\n  Agent-Jarvis UI Contract  (WCAG 2.2 AA · Apple HIG · Material 3 · REQ-F-002/003/006/014)\n");
  process.exitCode = report(results, { strict });
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`ui-contract crashed: ${err.stack}\n`);
    process.exit(2);
  });
}

export { CONTRACT, runStatic, runLive, buildContext };
