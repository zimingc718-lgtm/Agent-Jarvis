/**
 * The document the display screen actually renders (REQ-F-052, DEC-032 ④; TASK-090).
 *
 * `save_insight` stores whatever the model produced — usually a bare `<div>` fragment
 * with no stylesheet, because a model trimming for length drops the template first
 * (EV-2026-09-11-display-console-ux §1.3). Rendered raw, that is unstyled black-on-white
 * text with borderless tables: what the user called「没有渲染」. This wraps the fragment in
 * a full document with a base stylesheet that follows the app theme.
 *
 * Two rules keep it a fallback rather than an override:
 *   - every selector lives under `.jarvis-insight` inside `@layer jarvis-base`, so any
 *     `<style>` the insight carries wins on specificity and layer order alike;
 *   - a complete document (`<html` / `<!doctype`) keeps its structure; only the base
 *     `<style>` and `data-theme` are added.
 *
 * Pure function, no DOM — testable under node, and the component stays thin.
 */

export type InsightTheme = "light" | "dark";

/** HSL triplets copied from `globals.css` (DEC-019 baseline). The iframe is its own document and cannot read the host's custom properties. */
const THEME_VARS: Record<InsightTheme, string> = {
  light: `--bg:270 33% 99%;--fg:264 33% 16%;--muted:264 22% 94%;--muted-fg:264 15% 40%;--border:264 18% 87%;--primary:262 83% 45%;--card:0 0% 100%;--code:265 37% 95%;`,
  dark: `--bg:264 31% 9%;--fg:264 20% 96%;--muted:264 18% 18%;--muted-fg:264 15% 72%;--border:264 22% 24%;--primary:263 76% 68%;--card:264 27% 13%;--code:264 22% 19%;`,
};

export const INSIGHT_BASE_STYLE = `@layer jarvis-base {
  :root { ${THEME_VARS.light} color-scheme: light; }
  :root[data-theme="dark"] { ${THEME_VARS.dark} color-scheme: dark; }
  html, body { margin: 0; background: hsl(var(--bg)); color: hsl(var(--fg)); }
  .jarvis-insight {
    box-sizing: border-box; padding: 2rem 1.5rem 4rem;
    font: 16px/1.7 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, sans-serif;
    overflow-wrap: anywhere;
  }
  .jarvis-insight h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 1rem; font-weight: 650; letter-spacing: -0.01em; }
  .jarvis-insight h2 { font-size: 1.4rem; line-height: 1.3; margin: 2.25rem 0 0.75rem; padding-bottom: 0.35rem; border-bottom: 1px solid hsl(var(--border)); font-weight: 600; }
  .jarvis-insight h3 { font-size: 1.12rem; margin: 1.6rem 0 0.5rem; font-weight: 600; }
  .jarvis-insight h4, .jarvis-insight h5, .jarvis-insight h6 { font-size: 1rem; margin: 1.2rem 0 0.4rem; font-weight: 600; }
  .jarvis-insight p { margin: 0 0 0.9rem; }
  .jarvis-insight ul, .jarvis-insight ol { margin: 0 0 1rem; padding-left: 1.5rem; }
  .jarvis-insight li { margin: 0.25rem 0; }
  .jarvis-insight li > ul, .jarvis-insight li > ol { margin-bottom: 0; }
  .jarvis-insight a { color: hsl(var(--primary)); text-decoration: underline; text-underline-offset: 3px; }
  .jarvis-insight strong, .jarvis-insight b { font-weight: 600; }
  .jarvis-insight em { color: hsl(var(--muted-fg)); }
  .jarvis-insight blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid hsl(var(--primary)); background: hsl(var(--muted)); color: hsl(var(--muted-fg)); }
  .jarvis-insight hr { border: 0; border-top: 1px solid hsl(var(--border)); margin: 2rem 0; }
  .jarvis-insight code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 0.9em; background: hsl(var(--code)); padding: 0.1em 0.35em; border-radius: 4px; }
  .jarvis-insight pre { background: hsl(var(--code)); padding: 0.9rem 1rem; border-radius: 8px; overflow-x: auto; margin: 0 0 1rem; }
  .jarvis-insight pre code { background: none; padding: 0; }
  .jarvis-insight img, .jarvis-insight svg, .jarvis-insight video { max-width: 100%; height: auto; }
  .jarvis-insight .table-wrap, .jarvis-insight figure { margin: 0 0 1rem; max-width: 100%; overflow-x: auto; }
  .jarvis-insight table { border-collapse: collapse; width: 100%; margin: 0 0 1.25rem; font-size: 0.94em; }
  .jarvis-insight th, .jarvis-insight td { border: 1px solid hsl(var(--border)); padding: 0.45rem 0.65rem; text-align: left; vertical-align: top; }
  .jarvis-insight th { background: hsl(var(--muted)); font-weight: 600; }
  .jarvis-insight tbody tr:nth-child(even) td { background: hsl(var(--card)); }
  .jarvis-insight caption { caption-side: bottom; color: hsl(var(--muted-fg)); font-size: 0.85em; padding: 0.4rem 0; }
  .jarvis-insight .note, .jarvis-insight .callout, .jarvis-insight aside { padding: 0.75rem 1rem; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--muted)); margin: 0 0 1rem; }
  .jarvis-insight small { color: hsl(var(--muted-fg)); }
  @media (max-width: 640px) { .jarvis-insight { padding: 1.25rem 1rem 3rem; font-size: 15px; } .jarvis-insight h1 { font-size: 1.5rem; } }
}`;

/** Share of the viewport the report column occupies (REQ-F-090 ①). */
export const INSIGHT_WIDTH_RATIO = 0.68;

/**
 * The outer frame: how wide the report is and where it sits. Deliberately **not** in
 * `@layer jarvis-base`, and deliberately injected *after* the document's own `<style>`.
 *
 * Why it cannot live with the rest: a report that brings its own stylesheet almost always
 * declares `body { margin: 0 }`, and unlayered rules beat layered ones no matter the
 * specificity — so the layered `margin: 0 auto` lost while the layered `max-width`
 * survived, which pinned a 1152px column to the left edge of a 1440px screen. That is
 * exactly the misalignment this fixes (EV-2026-09-11-chat-latency §4).
 *
 * `body.jarvis-insight` (0,1,1) also outranks a document's own `body` (0,0,1), so the
 * frame holds without `!important` — the document keeps control of everything inside it.
 */
const INSIGHT_FRAME_STYLE = `
  body.jarvis-insight {
    box-sizing: border-box;
    width: ${(INSIGHT_WIDTH_RATIO * 100).toFixed(0)}%;
    max-width: ${(INSIGHT_WIDTH_RATIO * 100).toFixed(0)}%;
    margin-left: auto;
    margin-right: auto;
  }
  /*
    The width below which the column gives up and takes the whole surface.

    This media query is evaluated against the IFRAME, not the window. It was 1024px back
    when the iframe was the full viewport; once REQ-F-160 gave the report its own lane the
    iframe became 960px on a 1440px screen, so the rule fired permanently and the column
    filled the lane edge to edge — 960px of prose, far past comfortable reading width.
    720px keeps the proportion on any real lane and still hands the whole width to a
    genuinely narrow one.
  */
  @media (max-width: 720px) {
    body.jarvis-insight { width: 100%; max-width: 100%; }
  }`;

function baseStyleTag(): string {
  return `<style id="jarvis-base">${INSIGHT_BASE_STYLE}</style>`;
}

function frameStyleTag(): string {
  return `<style id="jarvis-frame">${INSIGHT_FRAME_STYLE}</style>`;
}

function isCompleteDocument(html: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(html);
}

/**
 * Wrap (or lightly augment) insight HTML for `<iframe srcDoc>`.
 *
 * - Fragment → `<html data-theme><head>…base style…frame style…</head><body class="jarvis-insight">fragment</body></html>`.
 * - Complete document → the base style goes at the *start* of `<head>` (created if absent)
 *   so the document's own rules win, the frame style goes at the *end* so the column width
 *   and centering hold, `data-theme` is set on `<html>`, and `jarvis-insight` is added to
 *   `<body>`.
 */
export function buildInsightDocument(html: string, theme: InsightTheme = "light"): string {
  const themeAttr = ` data-theme="${theme}"`;
  const style = baseStyleTag();
  const frame = frameStyleTag();

  if (!isCompleteDocument(html)) {
    return `<!doctype html><html lang="zh-CN"${themeAttr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${style}${frame}</head><body class="jarvis-insight">${html}</body></html>`;
  }

  let out = html;
  // <html …> gets data-theme (replacing an existing value so theme changes take effect).
  out = out.replace(/<html\b([^>]*)>/i, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\sdata-theme="[^"]*"/i, "");
    return `<html${cleaned}${themeAttr}>`;
  });
  // Base style first in <head>, so the document's own <style> comes later and wins.
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b([^>]*)>/i, (match) => `${match}${style}`);
  } else {
    out = out.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${style}</head>`);
  }
  // Frame style LAST in <head>: it must outrank the document's own `body` rule, which is
  // unlayered and would otherwise cancel the centering.
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${frame}</head>`);
  } else {
    out = out.replace(/<body\b[^>]*>/i, (match) => `${frame}${match}`);
  }
  // Namespace the body so the fallback selectors apply.
  if (/<body\b[^>]*>/i.test(out)) {
    out = out.replace(/<body\b([^>]*)>/i, (_match, attrs: string) => {
      if (/\bclass="/i.test(attrs)) {
        return `<body${attrs.replace(/class="([^"]*)"/i, 'class="$1 jarvis-insight"')}>`;
      }
      return `<body${attrs} class="jarvis-insight">`;
    });
  }
  return out;
}

/** Read the host theme the way `ThemeToggle` writes it; light when unset (DEC-019). */
export function readDocumentTheme(root: { getAttribute(name: string): string | null } | null | undefined): InsightTheme {
  return root?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
