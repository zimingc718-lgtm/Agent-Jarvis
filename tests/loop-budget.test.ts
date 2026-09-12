import { describe, expect, it, vi } from "vitest";
import { runToolLoop } from "@/lib/agent-loop";
import { fitToolLoopContext, narrowToolResults } from "@/lib/tools/budget";
import { ToolRegistry, type ToolContext, type ToolDescriptor } from "@/lib/tools/registry";
import type { ChatDelta, ChatMessage } from "@/lib/types";

/**
 * TEST-161 — the tool loop bounds its own growth (REQ-F-101 ③④⑤; DEC-080 ②; TASK-160 ②).
 * CR-20260912-sandbox-and-budget.
 *
 * The gap this closes: `assembleContext` runs once, before the loop. Everything the loop
 * appends afterwards was never measured again. With the step ceiling at 10 that was bounded
 * by accident; at 100 it is not, and ten page reads can pass the whole input budget inside
 * one request — surfacing as a provider 400 mid-loop rather than as anything the user can act on.
 */

const context: ToolContext = {
  userId: "u1",
  conversationId: "c1",
  skillCount: 0,
  webEnabled: false,
  searchConfigured: false,
  knowledgeCount: 0,
  contextWindow: 8_192,
};

/** A tool result of roughly `tokens` estimated size. */
function bulk(tokens: number): string {
  return "正文内容。".repeat(Math.ceil(tokens / 2));
}

function toolRow(id: string, content: string): ChatMessage {
  return { role: "tool", tool_call_id: id, content } as ChatMessage;
}

describe("TEST-161 循环内上下文预算 (REQ-F-101)", () => {
  it("③ 未超预算时原样送出，不做任何收窄", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "前缀" },
      { role: "user", content: "问题" },
      toolRow("a", "短结果一"),
      toolRow("b", "短结果二"),
    ];
    const fit = fitToolLoopContext(messages, 128_000);
    expect(fit.fits).toBe(true);
    if (fit.fits) {
      expect(fit.narrowed).toBe(false);
      expect(fit.messages).toBe(messages);
    }
  });

  it("③ 收窄只在有压力时发生——这与跨轮保留窗口是相反的取舍，刻意如此", () => {
    // Six results that together pass the 8,192-window budget (0.6 share ≈ 4,915 tokens).
    const messages: ChatMessage[] = [
      { role: "user", content: "把这几页读完再汇总" },
      ...["a", "b", "c", "d", "e", "f"].map((id) => toolRow(id, bulk(1_200))),
    ];
    const fit = fitToolLoopContext(messages, 8_192);
    expect(fit.fits).toBe(true);
    if (fit.fits) {
      expect(fit.narrowed).toBe(true);
      const kept = fit.messages.filter((m) => m.role === "tool" && m.content !== "[结果已省略]");
      // Narrowing stops at the first depth that fits, so some results survive verbatim.
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(6);
      // The user's own message is never touched.
      expect(fit.messages[0]?.content).toBe("把这几页读完再汇总");
    }
  });

  it("④ tool_call_id 在收窄后保留——丢行会让 assistant/tool 配对变成非法序列", () => {
    const messages: ChatMessage[] = [toolRow("call-1", "旧"), toolRow("call-2", "新")];
    const narrowed = narrowToolResults(messages, 1);
    expect(narrowed).toHaveLength(2);
    expect(narrowed[0]).toMatchObject({ role: "tool", tool_call_id: "call-1", content: "[结果已省略]" });
    expect(narrowed[1]).toMatchObject({ role: "tool", tool_call_id: "call-2", content: "新" });
  });

  it("⑤ 收窄到最紧仍放不下 → 报告放不下，附估算值与限额", () => {
    const messages: ChatMessage[] = [{ role: "user", content: bulk(20_000) }];
    const fit = fitToolLoopContext(messages, 8_192);
    expect(fit.fits).toBe(false);
    if (!fit.fits) {
      expect(fit.estimatedTokens).toBeGreaterThan(fit.limit);
    }
  });

  it("⑤ 循环层：放不下时停在 truncated，已完成的部分保留，并且不再调 Provider", async () => {
    const execute = vi.fn(async () => ({ ok: true, content: "x", summary: "x" }));
    const tool: ToolDescriptor = {
      name: "read_url",
      description: "读",
      parameters: { type: "object", properties: {} },
      available: () => true,
      execute,
    };
    const providerTurn = vi.fn(async function* (): AsyncGenerator<ChatDelta> {
      yield { type: "delta", text: "不该被调用" };
    });
    const emitted: ChatDelta[] = [];
    const persisted: Array<ChatMessage & { status: string }> = [];

    const result = await runToolLoop({
      registry: new ToolRegistry().register(tool),
      toolContext: context,
      // Already over budget before the first call, which is the state a long loop reaches.
      messages: [{ role: "user", content: bulk(20_000) }],
      contextWindow: 8_192,
      providerTurn,
      emit: (delta) => emitted.push(delta),
      persist: (message) => persisted.push(message),
    });

    expect(result.status).toBe("truncated");
    // The point of checking BEFORE the call: no request is sent that we know will fail.
    expect(providerTurn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    // REQ-F-023「不静默」: the user is told why, not left with a silent stop.
    const notice = emitted.find((d) => d.type === "notice");
    expect(notice).toBeTruthy();
    expect(persisted.some((m) => m.status === "truncated")).toBe(true);
  });

  it("③ 不传 contextWindow 时行为不变——桩驱动的既有用例不受影响", async () => {
    const providerTurn = vi.fn(async function* (): AsyncGenerator<ChatDelta> {
      yield { type: "delta", text: "答复" };
    });
    const result = await runToolLoop({
      registry: new ToolRegistry(),
      toolContext: context,
      messages: [{ role: "user", content: bulk(20_000) }],
      providerTurn,
      emit: () => {},
      persist: () => {},
    });
    expect(result.status).toBe("complete");
    expect(providerTurn).toHaveBeenCalledTimes(1);
  });
});
