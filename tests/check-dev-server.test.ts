import { describe as report, analyseCss } from "../scripts/check-dev-server.mjs";
import { describe, expect, it } from "vitest";

/**
 * TEST-058 ② — the accident regression.
 *
 * On 2026-09-10 a dev server started the previous evening served the migrated UI
 * with an empty PostCSS pipeline: `@import "tailwindcss"` was passed through
 * untouched, every utility class resolved to nothing, and the whole interface
 * collapsed into the top-left corner. Every file-reading test stayed green.
 */
describe("check-dev-server (TASK-057)", () => {
  const compiled = `
    :root { --background: 270 33% 99%; --foreground: 264 33% 16%; }
    .fixed { position: fixed; }
    .mx-auto { margin-inline: auto; }
    .bottom-0 { bottom: calc(var(--spacing) * 0); }
  `;

  it("accepts CSS that carries compiled Tailwind output", () => {
    const result = analyseCss(compiled);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(report(result)).toMatch(/^PASS/);
  });

  it("rejects a stylesheet whose Tailwind directives were never processed", () => {
    const result = analyseCss('@import "tailwindcss";\n.home { color: red }\n');
    expect(result.ok).toBe(false);
    expect(result.unprocessed).toBe(true);
    expect(result.missing).toContain("position utility");
    expect(result.missing).toContain("semantic token");
  });

  it("explains the cause and the fix, not just the symptom", () => {
    // A checker that only says "missing .fixed" sends the reader hunting through
    // CSS. The cause is always the same, so it says so.
    const message = report(analyseCss('@import "tailwindcss";'));
    expect(message).toMatch(/^FAIL/);
    expect(message).toContain("postcss.config");
    expect(message).toContain("npm run dev");
  });

  it("rejects hand-written CSS that merely lacks utilities", () => {
    // No raw directives — a server serving a pre-migration stylesheet. Still a
    // failure, but the message must not claim the directives are unprocessed.
    const result = analyseCss(".floating-chat { position: fixed; bottom: 0 }");
    expect(result.ok).toBe(false);
    expect(result.unprocessed).toBe(false);
    expect(report(result)).toContain("no compiled utility classes");
  });
});
