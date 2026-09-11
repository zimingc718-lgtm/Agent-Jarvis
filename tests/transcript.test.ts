import { describe, expect, it } from "vitest";
import { buildTranscript } from "@/lib/transcript";
import type { MessageRecord } from "@/lib/store";

/**
 * TEST-076 ④ — rebuilding the visible transcript after a refresh (REQ-F-035 ④).
 *
 * The user ruled that the step stream comes back on reload, so a tool round has to
 * reassemble into the same step rows it showed live — not into raw `tool` bubbles that
 * were never on screen in the first place.
 */

function record(overrides: Partial<MessageRecord> & Pick<MessageRecord, "id" | "role" | "content">): MessageRecord {
  return {
    status: "complete",
    createdAt: "2026-09-10T00:00:00.000Z",
    toolCalls: null,
    toolCallId: null,
    seq: 0,
    sources: null,
    ...overrides,
  };
}

describe("buildTranscript (REQ-F-035 ④)", () => {
  it("把 assistant.tool_calls + tool 行还原为步骤行", () => {
    const rows = buildTranscript([
      record({ id: "m1", role: "user", content: "查一下" }),
      record({
        id: "m2",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", type: "function", function: { name: "web_search", arguments: '{"query":"x"}' } }],
      }),
      record({ id: "m3", role: "tool", content: "搜索结果", toolCallId: "t1", seq: 1 }),
      record({ id: "m4", role: "assistant", content: "答案", seq: 2 }),
    ]);

    expect(rows.map((row) => row.role)).toEqual(["user", "step", "assistant"]);
    const step = rows[1];
    expect(step.toolName).toBe("web_search");
    expect(step.argsSummary).toBe('{"query":"x"}');
    expect(step.stepState).toBe("ok");
    expect(step.content).toBe("搜索结果");
    // The raw `tool` row must not also appear as a bubble.
    expect(rows.some((row) => row.id === "m3")).toBe(false);
  });

  it("失败的工具结果还原为 failed 状态", () => {
    const rows = buildTranscript([
      record({
        id: "m1",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", type: "function", function: { name: "read_url", arguments: "{}" } }],
      }),
      record({ id: "m2", role: "tool", content: "地址被拒绝", toolCallId: "t1", status: "error", seq: 1 }),
    ]);
    expect(rows[0].stepState).toBe("failed");
  });

  it("没有结果的 tool_call 显示为 failed 而不是一直转圈", () => {
    // A stopped or ceiling-truncated turn leaves calls with no result row; showing them
    // as still running would be a lie the user can never resolve.
    const rows = buildTranscript([
      record({
        id: "m1",
        role: "assistant",
        content: "",
        status: "truncated",
        toolCalls: [{ id: "t9", type: "function", function: { name: "web_search", arguments: "{}" } }],
      }),
    ]);
    expect(rows[0].stepState).toBe("failed");
  });

  it("纯文本会话（无新列的老行）按原样还原", () => {
    const rows = buildTranscript([
      record({ id: "m1", role: "user", content: "hi" }),
      record({ id: "m2", role: "assistant", content: "hello" }),
    ]);
    expect(rows).toEqual([
      { id: "m1", role: "user", content: "hi", status: "complete" },
      { id: "m2", role: "assistant", content: "hello", status: "complete" },
    ]);
  });

  it("助手行的来源列表被保留", () => {
    const rows = buildTranscript([
      record({
        id: "m1",
        role: "assistant",
        content: "答案",
        sources: [{ url: "https://example.com", title: "Example" }],
      }),
    ]);
    expect(rows[0].sources).toEqual([{ url: "https://example.com", title: "Example" }]);
  });

  it("带文本又带 tool_calls 的 assistant 行：文本气泡在前，步骤行在后", () => {
    const rows = buildTranscript([
      record({
        id: "m1",
        role: "assistant",
        content: "先想一下",
        toolCalls: [{ id: "t1", type: "function", function: { name: "echo", arguments: "{}" } }],
      }),
      record({ id: "m2", role: "tool", content: "ok", toolCallId: "t1", seq: 1 }),
    ]);
    expect(rows.map((row) => row.role)).toEqual(["assistant", "step"]);
    expect(rows[0].content).toBe("先想一下");
  });
});
