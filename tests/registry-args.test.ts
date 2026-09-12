import { describe, expect, it } from "vitest";
import { describeArgsProblem, parseToolArguments } from "@/lib/tools/registry";

/**
 * TEST-092 ①②⑧ — argument parsing that explains itself (REQ-F-050 ④⑤; DEC-032 ②;
 * TASK-089 ①). CR-20260911-display-console-ux.
 *
 * Both failure shapes below are replayed from the real conversation in
 * EV-2026-09-11-display-console-ux §1.1: a wrapper key that hid a valid 63-byte call,
 * and a JSON string cut mid-argument by the output cap.
 */
describe("TEST-092 参数解析与诊断 (REQ-F-050 ④⑤)", () => {
  it("① 单键包装 {\"arguments\":{...}} 被解开", () => {
    const raw = JSON.stringify({ arguments: { html: "<h1>AIDC 产业洞察（测试）</h1><p>保存链路检测。</p>" } });
    expect(parseToolArguments(raw)).toEqual({ html: "<h1>AIDC 产业洞察（测试）</h1><p>保存链路检测。</p>" });
    expect(parseToolArguments(JSON.stringify({ parameters: { insightId: "x" } }))).toEqual({ insightId: "x" });
    expect(parseToolArguments(JSON.stringify({ input: { html: "<p>a</p>" } }))).toEqual({ html: "<p>a</p>" });
  });

  it("① 不是包装的单键对象原样返回；多键对象原样返回", () => {
    expect(parseToolArguments(JSON.stringify({ html: "<p>a</p>" }))).toEqual({ html: "<p>a</p>" });
    expect(parseToolArguments(JSON.stringify({ arguments: "not an object" }))).toEqual({ arguments: "not an object" });
    expect(parseToolArguments(JSON.stringify({ arguments: { html: "<p>a</p>" }, extra: 1 }))).toEqual({
      arguments: { html: "<p>a</p>" },
      extra: 1,
    });
  });

  it("② 缺字段时文案列出缺少的键与收到的键", () => {
    const raw = JSON.stringify({ content: "<p>a</p>", title: "t" });
    const problem = describeArgsProblem(raw, parseToolArguments(raw), ["html"]);
    expect(problem).toContain("缺少参数 html");
    expect(problem).toContain("content");
    expect(problem).toContain("title");
  });

  it("② JSON 被截断时文案说明疑似截断并给出长度与末尾", () => {
    const raw = '{"html": "<div><table><tr><td>2023 Q4</td><td>46,485';
    const problem = describeArgsProblem(raw, parseToolArguments(raw), ["html"]);
    expect(problem).toContain("不是合法 JSON");
    expect(problem).toContain(String(raw.length));
    expect(problem).toContain("截断");
  });

  it("参数齐全时返回 null", () => {
    const raw = JSON.stringify({ html: "<p>a</p>" });
    expect(describeArgsProblem(raw, parseToolArguments(raw), ["html"])).toBeNull();
  });
});
