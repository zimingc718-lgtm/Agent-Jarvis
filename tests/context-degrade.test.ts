import { describe, expect, it } from "vitest";
import {
  assembleContext,
  budgetTokens,
  BUDGET_SHARES,
  ContextOverflowError,
  OMITTED_RESULT,
  TOOL_RESULT_RETENTION_TURNS,
  type TurnMessage,
} from "@/lib/tools/budget";

/**
 * TEST-190 — an over-budget turn tightens instead of refusing (REQ-F-130; DEC-110; TASK-190).
 * CR-20260912-context-degrade.
 *
 * The failure this closes, measured on the user's own database: a research turn read three
 * PDFs, whose tool rows came to 328,849 characters. `applyRetentionWindow` keeps the last two
 * turns verbatim and compaction keeps the last three — and the large reads were in exactly
 * those turns, so nothing could shrink them. `assembleContext` threw, and the reply was
 * 「请开启新对话」: the conversation died at the point where it had just done the work.
 *
 * Root cause is that the shares do not compose. One tool result may take
 * `singleToolResult` (0.15 of the window) while the whole input may take `totalInput` (0.6),
 * so four full-sized results are already the entire allowance.
 */

const WINDOW = 128_000;
const LIMIT = budgetTokens(WINDOW, BUDGET_SHARES.totalInput);

/** Latin text, because `estimateTokens` counts CJK far more heavily. */
function bulk(tokens: number): string {
  return "power delivery architecture and thermal design considerations. ".repeat(Math.ceil(tokens / 12));
}

function turnRows(turn: number, results: number, tokensEach: number): TurnMessage[] {
  const rows: TurnMessage[] = [{ role: "user", content: `第 ${turn} 轮提问`, turn }];
  for (let i = 0; i < results; i += 1) {
    rows.push({ role: "tool", tool_call_id: `t${turn}-${i}`, content: bulk(tokensEach), turn } as TurnMessage);
  }
  return rows;
}

const base = { stablePrefix: "你是 Agent-Jarvis。", volatileSuffix: "当前展示屏：首页", contextWindow: WINDOW };

describe("TEST-190 超预算时收紧而不是拒绝 (REQ-F-130)", () => {
  it("① 份额本身不相容——这是本次故障的算术根源", () => {
    const perResult = budgetTokens(WINDOW, BUDGET_SHARES.singleToolResult);
    expect(perResult * 4).toBeGreaterThanOrEqual(LIMIT);
    // Four results at the declared per-result ceiling already exhaust the declared input
    // budget. Any turn that reads four documents therefore cannot fit by construction.
  });

  it("② 装得下时一字不动，也不报告降级", () => {
    const messages = [...turnRows(1, 1, 500), ...turnRows(2, 1, 500)];
    const result = assembleContext({ ...base, messages, currentTurn: 2 });
    expect(result.degraded).toBeNull();
    expect(result.estimatedTokens).toBeLessThanOrEqual(LIMIT);
    expect(result.messages.filter((m) => m.content === OMITTED_RESULT)).toHaveLength(0);
  });

  it("③ 最近几轮塞了三份大报告 → 收紧后仍能发出去，不再抛错", () => {
    // The shape of the real conversation: three ~35k-token reads in the retained turns.
    const messages = [...turnRows(1, 1, 35_000), ...turnRows(2, 2, 35_000)];
    const result = assembleContext({ ...base, messages, currentTurn: 2 });
    expect(result.estimatedTokens).toBeLessThanOrEqual(LIMIT);
    expect(result.degraded).not.toBeNull();
    expect(result.degraded!.affected).toBeGreaterThan(0);
    // The turn survives — that is the whole point.
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("④ 先削正文再放弃轮次——能留住内容就不整条丢掉", () => {
    const messages = [...turnRows(1, 1, 30_000), ...turnRows(2, 1, 30_000)];
    const result = assembleContext({ ...base, messages, currentTurn: 2 });
    expect(result.degraded).not.toBeNull();
    // At this size a per-result cap is enough, so both turns keep some verbatim text.
    expect(result.degraded!.retainedTurns).toBe(TOOL_RESULT_RETENTION_TURNS);
    expect(result.degraded!.perResultTokens).toBeGreaterThan(0);
    const omitted = result.messages.filter((m) => m.content === OMITTED_RESULT).length;
    expect(omitted).toBe(0);
  });

  it("⑤ 收紧后 tool_call_id 仍在——丢行会让 assistant/tool 配对变成非法序列", () => {
    const messages = [...turnRows(1, 2, 40_000), ...turnRows(2, 2, 40_000)];
    const result = assembleContext({ ...base, messages, currentTurn: 2 });
    const toolRows = result.messages.filter((m) => m.role === "tool");
    expect(toolRows.length).toBe(4);
    for (const row of toolRows) {
      expect((row as { tool_call_id?: string }).tool_call_id).toBeTruthy();
    }
  });

  it("⑥ 用户与助手的文字永远不被削", () => {
    const messages: TurnMessage[] = [
      { role: "user", content: "这句话必须原样保留，它是我的问题", turn: 1 },
      { role: "assistant", content: "这句回答也必须原样保留", turn: 1 },
      ...turnRows(2, 3, 40_000),
    ];
    const result = assembleContext({ ...base, messages, currentTurn: 2 });
    expect(result.messages.map((m) => m.content)).toContain("这句话必须原样保留，它是我的问题");
    expect(result.messages.map((m) => m.content)).toContain("这句回答也必须原样保留");
  });

  it("⑦ 只有对话自身的文字就超预算时才报错，且文案说明是文字太长而非工具结果", () => {
    const messages: TurnMessage[] = [{ role: "user", content: bulk(200_000), turn: 1 }];
    let thrown: unknown;
    try {
      assembleContext({ ...base, messages, currentTurn: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ContextOverflowError);
    expect((thrown as Error).message).toContain("即使省略全部工具结果");
    expect((thrown as Error).message).toContain("对话本身的文字已经太长");
  });

  it("⑧ 最后一档是省略全部工具正文——宁可让模型失明，也不让这一轮死掉", () => {
    // Many results, each already small enough that per-result caps cannot help.
    const messages = Array.from({ length: 40 }, (_, i) =>
      ({ role: "tool", tool_call_id: `t${i}`, content: bulk(3_000), turn: 2 }) as TurnMessage
    );
    const result = assembleContext({ ...base, messages: [{ role: "user", content: "问", turn: 2 }, ...messages], currentTurn: 2 });
    expect(result.estimatedTokens).toBeLessThanOrEqual(LIMIT);
    expect(result.degraded!.retainedTurns).toBe(0);
    expect(result.messages.filter((m) => m.content === OMITTED_RESULT).length).toBe(40);
  });
});
