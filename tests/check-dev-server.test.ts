import { describe as report, analyseBuild, analyseCss, describeBuild } from "../scripts/check-dev-server.mjs";
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

/**
 * TEST-058 ④ — 第二起同类事故的回归（DEC-210 ①）。
 *
 * 2026-09-13：dev server 的编译 worker 崩掉后继续供旧构建。样式是编译好的，所以上面那
 * 套检查全绿；只是页面里新写的东西一个都不在，用户看到的是几十个提交之前的界面。
 * 「测试读磁盘、浏览器读服务器」这条裂缝，样式检查只堵了一半。
 */
describe("build stamp (DEC-210 ①)", () => {
  const page = (sha: string) => `<html><head><meta content="${sha}" name="jarvis-build"/></head><body/></html>`;

  it("服务器供的提交与 HEAD 一致 → current", () => {
    const result = analyseBuild(page("a".repeat(40)), "a".repeat(40));
    expect(result.state).toBe("current");
    expect(describeBuild(result)).toMatch(/^PASS/);
  });

  it("服务器比磁盘旧 → stale，且话里直说「你在浏览器里看到的东西早于你的提交」", () => {
    const result = analyseBuild(page("b".repeat(40)), "c".repeat(40));
    expect(result.state).toBe("stale");
    const text = describeBuild(result);
    expect(text).toMatch(/^FAIL/);
    expect(text).toContain("predates");
    expect(text).toContain("npm run dev");
  });

  it("页面根本没有版本戳 → 也是 FAIL：那台服务器比这套机制还老", () => {
    expect(analyseBuild("<html><head/><body/></html>", "d".repeat(40)).state).toBe("absent");
    expect(describeBuild({ state: "absent" })).toMatch(/^FAIL/);
  });

  it("戳是空的（起服务器的地方没有 git）→ SKIP，不假装通过", () => {
    const result = analyseBuild(page(""), "e".repeat(40));
    expect(result.state).toBe("unknown");
    expect(describeBuild(result)).toMatch(/^SKIP/);
  });

  it("属性顺序反过来也读得出——meta 的两个属性谁在前不该影响结论", () => {
    const reversed = `<html><head><meta name="jarvis-build" content="${"f".repeat(40)}"/></head></html>`;
    expect(analyseBuild(reversed, "f".repeat(40)).state).toBe("current");
  });
});
