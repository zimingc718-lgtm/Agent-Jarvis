import { describe, expect, it, vi } from "vitest";
import {
  estimateTokens,
  sendProviderStream,
  shouldRetryWithoutUsage,
  ToolCallAccumulator,
  type StreamProviderConfig,
} from "@/lib/adapters";
import type { ChatDelta } from "@/lib/types";

/**
 * TEST-063 / TEST-064 — tool wire protocol and usage accounting
 * (DEC-024 ①, DEC-028; TASK-061/062).
 */

const provider: StreamProviderConfig = {
  kind: "local",
  baseUrl: "http://127.0.0.1:11434/v1",
  defaultModel: "llama",
  secret: null,
};

function sse(chunks: unknown[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    })
  );
}

async function collect(stream: AsyncIterable<ChatDelta>): Promise<ChatDelta[]> {
  const out: ChatDelta[] = [];
  for await (const delta of stream) {
    out.push(delta);
  }
  return out;
}

describe("ToolCallAccumulator (DEC-024 ①)", () => {
  it("② 跨多个 chunk 累积 id / name / arguments", () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: "call_1", function: { name: "web_" } }]);
    acc.push([{ index: 0, function: { name: "search" } }]);
    acc.push([{ index: 0, function: { arguments: '{"que' } }]);
    acc.push([{ index: 0, function: { arguments: 'ry":"x"}' } }]);

    expect(acc.toToolCalls()).toEqual([
      { id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"x"}' } },
    ]);
  });

  it("② 另一种分片粒度（整块到达）得到同样结果", () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: "call_1", function: { name: "web_search", arguments: '{"query":"x"}' } }]);
    expect(acc.toToolCalls()[0].function.name).toBe("web_search");
  });

  it("④ 同轮多个调用按 index 各自累积，不串线", () => {
    const acc = new ToolCallAccumulator();
    acc.push([
      { index: 0, id: "a", function: { name: "read_" } },
      { index: 1, id: "b", function: { name: "web_" } },
    ]);
    acc.push([
      { index: 1, function: { name: "search" } },
      { index: 0, function: { name: "skill" } },
    ]);

    expect(acc.toToolCalls().map((call) => call.function.name)).toEqual(["read_skill", "web_search"]);
  });

  it("③ 不依赖 finish_reason —— 缺该字段也能收束", async () => {
    const fetcher = vi.fn(async () =>
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "echo", arguments: "{}" } }] } }] },
      ])
    );
    const events = await collect(
      sendProviderStream({ provider, messages: [{ role: "user", content: "hi" }], fetcher: fetcher as unknown as typeof fetch })
    );
    expect(events).toContainEqual({ type: "tool_call", callId: "t1", name: "echo", argsSummary: "{}" });
  });

  it("名字为空的条目不产出（无法调用）", () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: "x" }]);
    expect(acc.toToolCalls()).toEqual([]);
  });
});

describe("请求体 (TASK-061 ①)", () => {
  it("① 有工具时请求体带 tools，无工具时不带", async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return sse([{ choices: [{ delta: { content: "ok" } }] }]);
    });

    await collect(
      sendProviderStream({
        provider,
        messages: [{ role: "user", content: "hi" }],
        fetcher: fetcher as unknown as typeof fetch,
        tools: [
          { type: "function", function: { name: "echo", description: "d", parameters: { type: "object" } } },
        ],
      })
    );
    await collect(
      sendProviderStream({ provider, messages: [{ role: "user", content: "hi" }], fetcher: fetcher as unknown as typeof fetch })
    );

    expect(bodies[0]).toContain('"tools"');
    expect(bodies[1]).not.toContain('"tools"');
  });

  it("⑤ tool 消息带 tool_call_id 正确序列化", async () => {
    let body = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return sse([{ choices: [{ delta: { content: "ok" } }] }]);
    });
    await collect(
      sendProviderStream({
        provider,
        messages: [{ role: "tool", content: "result", tool_call_id: "t1" }],
        fetcher: fetcher as unknown as typeof fetch,
      })
    );
    expect(JSON.parse(body).messages[0]).toEqual({ role: "tool", content: "result", tool_call_id: "t1" });
  });
});

describe("usage 与兼容回退 (DEC-028)", () => {
  it("① 末 chunk 的 choices 为空数组不被当成异常，usage 被解析出来", async () => {
    const fetcher = vi.fn(async () =>
      sse([
        { choices: [{ delta: { content: "hi" } }] },
        // This is exactly the shape `include_usage` produces, and treating it as a
        // malformed chunk is the trap DEC-028 names.
        { choices: [], usage: { prompt_tokens: 11, completion_tokens: 22 } },
      ])
    );
    const events = await collect(
      sendProviderStream({
        provider,
        messages: [{ role: "user", content: "hi" }],
        fetcher: fetcher as unknown as typeof fetch,
        includeUsage: true,
      })
    );
    expect(events).toContainEqual({
      type: "usage",
      usage: { inputTokens: 11, outputTokens: 22, estimated: false },
    });
  });

  it("③ 4xx 指向 stream_options 时自动重试一次不带该参数", async () => {
    const bodies: string[] = [];
    let call = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ error: { message: "unknown field stream_options" } }), { status: 400 });
      }
      return sse([{ choices: [{ delta: { content: "recovered" } }] }]);
    });

    const events = await collect(
      sendProviderStream({
        provider,
        messages: [{ role: "user", content: "hi" }],
        fetcher: fetcher as unknown as typeof fetch,
        includeUsage: true,
      })
    );

    expect(bodies[0]).toContain("stream_options");
    expect(bodies[1]).not.toContain("stream_options");
    // REQ-F-012 must keep working: the reply still arrives.
    expect(events).toContainEqual({ type: "delta", text: "recovered" });
  });

  it("③ 与该参数无关的 4xx 不触发重试", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    const events = await collect(
      sendProviderStream({
        provider,
        messages: [{ role: "user", content: "hi" }],
        fetcher: fetcher as unknown as typeof fetch,
        includeUsage: true,
      })
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(events[0].type).toBe("error");
  });

  it("shouldRetryWithoutUsage 只认该参数相关的 4xx", () => {
    expect(shouldRetryWithoutUsage(400, "unknown field stream_options")).toBe(true);
    expect(shouldRetryWithoutUsage(400, "include_usage not supported")).toBe(true);
    expect(shouldRetryWithoutUsage(400, "bad request")).toBe(false);
    expect(shouldRetryWithoutUsage(500, "stream_options")).toBe(false);
  });

  it("⑤ 本地估算对中英文混排在合理区间", () => {
    // Rough by construction — it exists so REQ-NF-007 still has a measurement on
    // providers that never report usage, and it is always surfaced as an estimate.
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
    const chinese = estimateTokens("这是一段中文文本内容");
    expect(chinese).toBeGreaterThanOrEqual(6);
    expect(chinese).toBeLessThanOrEqual(20);
  });
});
