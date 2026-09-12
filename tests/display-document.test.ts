import { describe, expect, it } from "vitest";
import { buildInsightDocument, INSIGHT_BASE_STYLE, readDocumentTheme } from "@/lib/display-document";

/**
 * TEST-093 ①②③ — the base-styled, theme-aware document the display screen renders
 * (REQ-F-052 ①②③; DEC-032 ④; TASK-090 ①). CR-20260911-display-console-ux.
 *
 * Pure function, node environment: no DOM needed.
 */
describe("TEST-093 buildInsightDocument (REQ-F-052)", () => {
  it("① 片段被包成带基础样式与 data-theme 的完整文档，片段原样在 body 内", () => {
    const fragment = "<div><h1>AIDC 供电架构</h1><table><tr><td>a</td></tr></table></div>";
    const doc = buildInsightDocument(fragment, "light");
    expect(doc).toMatch(/^<!doctype html><html lang="zh-CN" data-theme="light">/);
    expect(doc).toContain('<style id="jarvis-base">');
    expect(doc).toContain("@layer jarvis-base");
    expect(doc).toContain(".jarvis-insight table");
    expect(doc).toContain(`<body class="jarvis-insight">${fragment}</body>`);
    expect(INSIGHT_BASE_STYLE).toMatch(/\.jarvis-insight th, \.jarvis-insight td \{ border: 1px solid/);
  });

  it("① 深色主题落在 data-theme 上，且样式表内含两套变量", () => {
    const doc = buildInsightDocument("<p>x</p>", "dark");
    expect(doc).toContain('data-theme="dark"');
    expect(INSIGHT_BASE_STYLE).toContain(':root[data-theme="dark"]');
    expect(INSIGHT_BASE_STYLE).toContain("color-scheme: dark");
  });

  it("② 整文档只前置一份样式并打 data-theme，结构保留，body 加命名空间类", () => {
    const full = '<!DOCTYPE html><html lang="en" data-theme="light"><head><title>T</title><style>h1{color:red}</style></head><body class="report"><h1>T</h1></body></html>';
    const doc = buildInsightDocument(full, "dark");
    expect(doc.startsWith("<!DOCTYPE html><html")).toBe(true);
    expect(doc).toContain('<html lang="en" data-theme="dark">');
    // Exactly one on the <html> tag — the other occurrences live inside the base stylesheet.
    expect(doc.match(/<html[^>]*>/)?.[0].match(/data-theme=/g)).toHaveLength(1);
    expect(doc.match(/<style id="jarvis-base">/g)).toHaveLength(1);
    // Base style first, the document's own <style> after it — so the latter wins.
    expect(doc.indexOf('<style id="jarvis-base">')).toBeLessThan(doc.indexOf("<style>h1{color:red}</style>"));
    expect(doc).toContain('<body class="report jarvis-insight">');
    expect(doc).toContain("<title>T</title>");
  });

  it("② 整文档缺 <head> 时补一个只装基础样式的 head", () => {
    const doc = buildInsightDocument("<html><body><p>x</p></body></html>", "light");
    expect(doc).toContain('<html data-theme="light"><head><style id="jarvis-base">');
    expect(doc).toContain('<body class="jarvis-insight"><p>x</p>');
  });

  it("③ 片段自带 <style> 原样保留在基础样式之后", () => {
    const fragment = "<style>.note{background:gold}</style><div class=\"note\">n</div>";
    const doc = buildInsightDocument(fragment, "light");
    expect(doc).toContain(fragment);
    expect(doc.indexOf('<style id="jarvis-base">')).toBeLessThan(doc.indexOf("<style>.note"));
  });

  it("readDocumentTheme 只认 dark，其余为 light", () => {
    expect(readDocumentTheme({ getAttribute: () => "dark" })).toBe("dark");
    expect(readDocumentTheme({ getAttribute: () => "light" })).toBe("light");
    expect(readDocumentTheme({ getAttribute: () => null })).toBe("light");
    expect(readDocumentTheme(null)).toBe("light");
  });
});
