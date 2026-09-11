import { describe, expect, it } from "vitest";
import {
  applyRetentionWindow,
  assembleContext,
  BUDGET_SHARES,
  buildStablePrefix,
  buildVolatileSuffix,
  contextWindowFor,
  ContextOverflowError,
  DEFAULT_CONTEXT_WINDOW,
  renderSkillCatalogue,
  truncateToTokens,
  type TurnMessage,
} from "@/lib/tools/budget";

/**
 * TEST-068 — context budget, prefix stability, retention window
 * (REQ-NF-007, REQ-NF-008, REQ-F-041, REQ-F-004; TASK-066).
 */

function userTurn(turn: number, content: string): TurnMessage {
  return { role: "user", content, turn };
}

function toolResult(turn: number, id: string, content: string): TurnMessage {
  return { role: "tool", content, tool_call_id: id, turn };
}

describe("稳定前缀 (REQ-NF-008)", () => {
  it("① 同会话两轮的稳定前缀逐字一致", () => {
    const build = () =>
      buildStablePrefix({
        identity: "You are Agent-Jarvis.",
        skillCatalogue: "已注册技能：\n- reporter：写报告",
        toolCatalogue: "可用工具：\n- read_skill：读取技能",
      });
    expect(build()).toBe(build());
  });

  it("② 当前时间不出现在稳定前缀里", () => {
    // The single most expensive mistake in OpenClaw's published token accounting:
    // a clock in the prompt head invalidates the cached prefix every single turn.
    const prefix = buildStablePrefix({
      identity: "You are Agent-Jarvis.",
      skillCatalogue: "",
      toolCatalogue: "",
    });
    expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prefix).not.toMatch(/GMT|UTC|T\d{2}:\d{2}/);
    // Volatile facts live after it instead.
    expect(buildVolatileSuffix({ displayState: "标题视图" })).toContain("标题视图");
  });
});

describe("技能名录预算 (REQ-F-030 ③)", () => {
  it("超预算时只列前 N 条并提示用 search_skills", () => {
    const skills = Array.from({ length: 50 }, (_, index) => ({
      name: `skill-${index}`,
      description: "描述".repeat(10),
    }));
    const rendered = renderSkillCatalogue(skills, 60);
    expect(rendered.listed).toBeLessThan(skills.length);
    expect(rendered.omitted).toBeGreaterThan(0);
    expect(rendered.text).toContain("search_skills");
  });

  it("空技能列表产出空名录（不占前缀）", () => {
    expect(renderSkillCatalogue([], 1000).text).toBe("");
  });
});

describe("保留窗口 (REQ-F-041)", () => {
  it("③ 第 N 轮之前的工具结果被替换为标记，且保留 tool_call_id", () => {
    const messages: TurnMessage[] = [
      userTurn(1, "q1"),
      toolResult(1, "t1", "很长的搜索结果 A"),
      userTurn(2, "q2"),
      toolResult(2, "t2", "很长的搜索结果 B"),
      userTurn(3, "q3"),
      toolResult(3, "t3", "很长的搜索结果 C"),
    ];

    const windowed = applyRetentionWindow(messages, 3, 2);
    const tools = windowed.filter((message) => message.role === "tool");

    expect(tools[0].content).toBe("[结果已省略]");
    // The pairing must stay legal even when the body is dropped.
    expect(tools[0].tool_call_id).toBe("t1");
    expect(tools[1].content).toContain("搜索结果 B");
    expect(tools[2].content).toContain("搜索结果 C");
  });

  it("用户与助手文本不受保留窗口影响（完整压缩属 B 期）", () => {
    const messages: TurnMessage[] = [userTurn(1, "old question"), userTurn(3, "new question")];
    const windowed = applyRetentionWindow(messages, 3, 2);
    expect(windowed.map((message) => message.content)).toEqual(["old question", "new question"]);
  });
});

describe("上下文组装与预算 (REQ-NF-007 / REQ-F-004)", () => {
  it("⑦ 窗口取 context_window，为空时按 kind 兜底", () => {
    expect(contextWindowFor({ kind: "local", contextWindow: 32_000 })).toBe(32_000);
    expect(contextWindowFor({ kind: "local", contextWindow: null })).toBe(DEFAULT_CONTEXT_WINDOW.local);
    expect(contextWindowFor({ kind: "openai", contextWindow: 0 })).toBe(DEFAULT_CONTEXT_WINDOW.openai);
  });

  it("④ 单条工具结果超子预算即截断并留可见标记", () => {
    const budget = Math.floor(8_000 * BUDGET_SHARES.singleToolResult);
    const { text, truncated } = truncateToTokens("A".repeat(budget * 20), budget);
    expect(truncated).toBe(true);
    expect(text).toContain("已截断");
  });

  it("正常情况下原样组装，system 段在最前", () => {
    const { messages } = assembleContext({
      stablePrefix: "prefix",
      volatileSuffix: "suffix",
      messages: [userTurn(1, "hi")],
      currentTurn: 1,
      contextWindow: 8_000,
    });
    expect(messages[0]).toEqual({ role: "system", content: "prefix" });
    expect(messages[1]).toEqual({ role: "system", content: "suffix" });
    expect(messages.at(-1)).toEqual({ role: "user", content: "hi" });
  });

  it("⑥ 超限先按保留窗口收窄", () => {
    const long = "结果".repeat(3_000);
    const messages: TurnMessage[] = [
      userTurn(1, "q1"),
      toolResult(1, "t1", long),
      userTurn(2, "q2"),
      toolResult(2, "t2", long),
      userTurn(3, "q3"),
    ];
    const { messages: assembled } = assembleContext({
      stablePrefix: "prefix",
      volatileSuffix: "",
      messages,
      currentTurn: 3,
      contextWindow: 8_000,
    });
    expect(assembled.some((message) => message.content === "[结果已省略]")).toBe(true);
  });

  it("⑥ 收窄后仍超限则报错，不无限压缩", () => {
    // Compression costs tokens of its own and cannot be guaranteed to terminate, so the
    // overflow surfaces as a request-level error instead of a silent loop.
    const huge = "字".repeat(200_000);
    expect(() =>
      assembleContext({
        stablePrefix: "prefix",
        volatileSuffix: "",
        messages: [userTurn(1, huge)],
        currentTurn: 1,
        contextWindow: 8_000,
      })
    ).toThrow(ContextOverflowError);
  });
});
