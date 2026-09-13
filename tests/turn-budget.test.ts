import { describe, expect, it } from "vitest";
import {
  BUDGET_SHARES,
  budgetTokens,
  fitToolLoopContext,
  narrowToolResults,
  OMITTED_RESULT,
  turnCostCeiling,
  overTurnCeiling,
} from "@/lib/tools/budget";
import type { ChatMessage } from "@/lib/types";

/**
 * TEST-250 — 单轮累计成本护栏与续写（CR-20260912-turn-budget-continue）。
 *
 * 注意本 CR 的根因在实施前被更正过：单次请求的预算由 `fitToolLoopContext`（DEC-080）守着，
 * 从来没有失守；1,028,825 是**会话累计值**——`MAX_TOOL_STEPS = 100` 允许一轮内上百次
 * provider 调用，`addUsage` 逐次累加，而没有任何一处在看这一轮的总账。
 * 所以这里测的是「累计上限」与「收窄时不丢信息」，不是「单次请求收窄」。
 */

const toolMessage = (id: string, content: string): ChatMessage => ({
  role: "tool",
  content,
  tool_call_id: id,
});

describe("收窄时占位不丢信息", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "两相浸没还是冷板？" },
    toolMessage("c1", "x".repeat(400)),
    toolMessage("c2", "y".repeat(400)),
    toolMessage("c3", "z".repeat(400)),
  ];

  it("被裁的结果带上该次调用的 summary 原值，而不是裸标记", () => {
    const summaries = new Map([
      ["c1", "已读 EUR-Lex 2024/573：两相浸没传热流体豁免 13.5 年"],
      ["c2", "已读 ECHA SEAC 意见稿"],
    ]);
    const narrowed = narrowToolResults(messages, 1, summaries);

    expect(narrowed[1]?.content).toContain("已读 EUR-Lex 2024/573：两相浸没传热流体豁免 13.5 年");
    expect(narrowed[2]?.content).toContain("已读 ECHA SEAC 意见稿");
    // 最后一条仍是原文。
    expect(narrowed[3]?.content).toBe("z".repeat(400));
  });

  it("没有 summary 时退回原来的裸标记，不编造内容", () => {
    const narrowed = narrowToolResults(messages, 1, new Map());
    expect(narrowed[1]?.content).toBe(OMITTED_RESULT);
  });

  it("占位仍然显著短于原文——保留信息不能把收窄的收益吃掉", () => {
    const summaries = new Map([["c1", "已读 EUR-Lex 2024/573：两相浸没传热流体豁免 13.5 年"]]);
    const narrowed = narrowToolResults(messages, 1, summaries);
    expect((narrowed[1]?.content ?? "").length).toBeLessThan(400 / 2);
  });

  it("fitToolLoopContext 把 summary 一路带到收窄结果里", () => {
    const many: ChatMessage[] = [
      { role: "user", content: "q" },
      ...Array.from({ length: 30 }, (_, i) => toolMessage(`c${i}`, "x".repeat(4000))),
    ];
    const summaries = new Map(Array.from({ length: 30 }, (_, i) => [`c${i}`, `第 ${i} 次调用的要点`]));
    const fit = fitToolLoopContext(many, 8_000, summaries);

    expect(fit.fits).toBe(true);
    if (!fit.fits) return;
    expect(fit.narrowed).toBe(true);
    expect(fit.messages.some((m) => (m.content ?? "").includes("第 0 次调用的要点"))).toBe(true);
  });
});

describe("本轮累计成本上限", () => {
  it("上限按上下文窗口算比例，不是写死的绝对值", () => {
    expect(turnCostCeiling(128_000)).toBeGreaterThan(turnCostCeiling(8_000));
    // 与单次请求的预算挂钩：一轮允许若干次满预算的调用，而不是无限次。
    expect(turnCostCeiling(128_000)).toBeGreaterThan(budgetTokens(128_000, BUDGET_SHARES.totalInput));
  });

  it("累计未达上限时不拦", () => {
    expect(overTurnCeiling({ inputTokens: 10_000, outputTokens: 1_000 }, 128_000)).toBe(false);
  });

  it("累计达到上限即判定触阈——这正是实测那轮缺的那道闸", () => {
    // 实测：38 次调用累计 1,028,825 input + 35,261 output。
    expect(overTurnCeiling({ inputTokens: 1_028_825, outputTokens: 35_261 }, 128_000)).toBe(true);
  });

  it("小窗口模型的上限相应更低", () => {
    expect(overTurnCeiling({ inputTokens: 200_000, outputTokens: 0 }, 8_000)).toBe(true);
  });
});
