import { describe, expect, it, vi } from "vitest";
import { runToolLoop } from "@/lib/agent-loop";
import { ToolRegistry, type ToolContext, type ToolDescriptor } from "@/lib/tools/registry";
import type { ChatDelta, ChatMessage } from "@/lib/types";

/**
 * TEST-092 ⑥ — a call the adapter labelled `truncated` is never executed; the model gets a
 * precise reason and the step row a failed result (REQ-F-051 ③; DEC-032 ①; TASK-089 ④).
 * CR-20260911-display-console-ux.
 */

const context: ToolContext = {
  userId: "u1",
  conversationId: "c1",
  skillCount: 0,
  webEnabled: false,
  searchConfigured: false,
  knowledgeCount: 0,
};

describe("TEST-092 ⑥ 截断的工具调用不执行 (REQ-F-051 ③)", () => {
  it("回喂含字符数的文案、emit 失败 tool_result，工具本身未被调用；notice 透传", async () => {
    const execute = vi.fn(async () => ({ ok: true, content: "should not run", summary: "ran" }));
    const tool: ToolDescriptor = {
      name: "save_insight",
      description: "保存",
      parameters: { type: "object", properties: {} },
      available: () => true,
      execute,
    };
    const registry = new ToolRegistry().register(tool);
    const emitted: ChatDelta[] = [];
    const persisted: Array<ChatMessage & { status: string }> = [];
    const rounds: ChatMessage[][] = [];
    const cut = '{"html": "<div><h1>报告</h1><p>被切断的';

    const result = await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "go" }],
      emit: (delta) => emitted.push(delta),
      persist: (message) => persisted.push(message),
      providerTurn: async function* ({ messages }) {
        rounds.push(messages);
        if (rounds.length === 1) {
          yield { type: "tool_call", callId: "t1", name: "save_insight", argsSummary: cut, truncated: true, argsLength: cut.length };
          return;
        }
        yield { type: "notice", text: "回复因达到模型输出上限而被截断，内容可能不完整。" };
        yield { type: "delta", text: "好的，我分块提交。" };
      },
    });

    expect(execute).not.toHaveBeenCalled();
    const stepCall = emitted.find((event) => event.type === "tool_call") as Extract<ChatDelta, { type: "tool_call" }>;
    expect(stepCall.truncated).toBe(true);
    expect(stepCall.argsLength).toBe(cut.length);
    const stepResult = emitted.find((event) => event.type === "tool_result") as Extract<ChatDelta, { type: "tool_result" }>;
    expect(stepResult.ok).toBe(false);
    expect(stepResult.summary).toContain("截断");

    // The tool message the model sees on the next round names the cut position.
    const fedBack = rounds[1].find((message) => message.role === "tool");
    expect(fedBack?.content).toContain(`第 ${cut.length} 字符`);
    expect(fedBack?.content).toContain("未执行");

    // A plain-text `notice` from the adapter reaches the client untouched.
    expect(emitted.some((event) => event.type === "notice")).toBe(true);
    expect(result.status).toBe("complete");
    expect(result.steps).toBe(1);
  });
});
