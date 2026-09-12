import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildInsightDocument, INSIGHT_WIDTH_RATIO } from "@/lib/display-document";

/**
 * TEST-220 — the report and the console occupy two fixed lanes (REQ-F-160; DEC-140;
 * TASK-220). CR-20260912-reading-lane.
 *
 * The ruling this implements: 「报告不用跟着位移」. So the report's position must not depend on
 * whether the console is open — which is achieved geometrically, by giving the console a
 * constant horizontal footprint, rather than by any timing or animation trick.
 *
 * Geometry itself is asserted at the real entry (EV §4: three viewports, coordinates before
 * and after toggling the console). What is pinned here is the source-level contract that
 * makes that geometry possible, because it is the part that silently rots.
 */

const globalsCss = readFileSync("src/app/globals.css", "utf8");
const floatingChat = readFileSync("src/components/FloatingChat.tsx", "utf8");
const displayScreen = readFileSync("src/components/DisplayScreen.tsx", "utf8");

describe("TEST-220 ① 车道宽度只有一个定义 (REQ-F-160 ②)", () => {
  it("变量在 globals.css 定义，控制台与洞察面都引用它而不是各写一个数", () => {
    expect(globalsCss).toMatch(/--jarvis-console-lane:\s*[\d.]+rem;/);
    expect(globalsCss).toMatch(/--jarvis-lane-gap:\s*[\d.]+rem;/);
    // Both sides must reference the variable. Two hardcoded numbers would drift, and the
    // symptom — the report covered again, or a wasted strip of screen — is easy to miss.
    expect(floatingChat).toContain("var(--jarvis-console-lane)");
    expect(displayScreen).toContain("var(--jarvis-console-lane)");
  });

  it("洞察面预留的宽度由同一个变量算出，不是写死的像素值", () => {
    expect(displayScreen).toMatch(/lg:pr-\[calc\(var\(--jarvis-console-lane\)/);
  });
});

describe("TEST-220 ② 控制台窄屏居中、宽屏停靠 (REQ-F-160 ①)", () => {
  it("两半都在：丢了居中毁窄屏，丢了停靠会把控制台压回报告上", () => {
    const line = floatingChat.split("\n").find((l) => l.includes("floating-chat fixed"));
    expect(line, "找不到控制台的类名字符串").toBeTruthy();
    expect(line).toContain("mx-auto");
    expect(line).toContain("lg:mx-0");
    expect(line).toContain("lg:ml-auto");
    expect(line).toContain("lg:max-w-[var(--jarvis-console-lane)]");
  });

  it("类名必须是一整条字符串——注释插进 cn() 会让 UI 契约取不到它", () => {
    // This is not style policing. The extractor reads the utilities around the class name,
    // so a comment between them hides the classes entirely: RF-07/RF-09 went red that way
    // once, then RF-02/LB-01/LB-02 went red the same way in the very next change.
    const idx = floatingChat.indexOf("floating-chat fixed");
    const line = floatingChat.slice(floatingChat.lastIndexOf("\n", idx) + 1, floatingChat.indexOf("\n", idx));
    expect(line.trimStart().startsWith('"')).toBe(true);
    expect(line.trimEnd().endsWith('",')).toBe(true);
  });
});

describe("TEST-220 ③ iframe 内的让宽断点跟着车道调整 (REQ-F-160 ③)", () => {
  it("断点降到 720px——它按 iframe 宽度求值，而车道只有 960px", () => {
    const doc = buildInsightDocument("<h1>报告</h1>", "light");
    expect(doc).toMatch(/@media \(max-width: 720px\)[\s\S]*width:\s*100%/);
    // The old 1024px value fired permanently once the iframe became a lane, and the column
    // filled all 960px of it — measured, not hypothesised (EV §4).
    expect(doc).not.toMatch(/@media \(max-width: 1024px\)/);
  });

  it("比例本身不变：车道内仍按 68% 居中", () => {
    const doc = buildInsightDocument("<h1>报告</h1>", "light");
    expect(INSIGHT_WIDTH_RATIO).toBe(0.68);
    expect(doc).toMatch(/width:\s*68%/);
    expect(doc).toMatch(/margin-left:\s*auto/);
  });
});
