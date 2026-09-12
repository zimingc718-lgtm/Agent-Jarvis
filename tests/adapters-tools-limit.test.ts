import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  outputLimitField,
  sendProviderStream,
  shouldRetryWithoutOutputLimit,
  type StreamProviderConfig,
} from "@/lib/adapters";
import type { ChatDelta } from "@/lib/types";

/**
 * TEST-091 — output ceiling and truncation visibility (REQ-F-051 ①②③④; DEC-032 ①;
 * TASK-088). CR-20260911-display-console-ux.
 *
 * The failure this guards: nine save_insight calls in a row were cut mid-argument by
 * DeepSeek's default output cap and reached the tool as "HTML 不完整" with no hint of
 * why (EV-2026-09-11-display-console-ux §1.1).
 */

const local: StreamProviderConfig = { kind: "local", baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "llama", secret: null };
const deepseek: StreamProviderConfig = { kind: "deepseek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", secret: "k" };
const openai: StreamProviderConfig = { kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o", secret: "k" };

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

const messages = [{ role: "user" as const, content: "hi" }];

describe("TEST-091 输出上限与截断可见 (REQ-F-051)", () => {
  it("① 请求体按 kind 携带输出上限字段与默认值", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse([{ choices: [{ delta: { content: "ok" } }] }]);
    });
    await collect(sendProviderStream({ provider: openai, messages, fetcher: fetcher as unknown as typeof fetch }));
    await collect(sendProviderStream({ provider: deepseek, messages, fetcher: fetcher as unknown as typeof fetch }));
    await collect(sendProviderStream({ provider: local, messages, fetcher: fetcher as unknown as typeof fetch }));

    expect(bodies[0].max_completion_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS.openai);
    expect(bodies[0].max_tokens).toBeUndefined();
    expect(bodies[1].max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS.deepseek);
    expect(bodies[2].max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS.local);
    expect(outputLimitField("openai")).toBe("max_completion_tokens");
    expect(outputLimitField("deepseek")).toBe("max_tokens");
  });

  it("② finish_reason=length 且参数未闭合 → tool_call 带 truncated 与 argsLength", async () => {
    const cut = '{"html": "<div><h1>报告</h1><table><tr><td>2023 Q4</td><td>46,485';
    const fetcher = vi.fn(async () =>
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "save_insight", arguments: cut.slice(0, 20) } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: cut.slice(20) } }] } }] },
        { choices: [{ delta: {}, finish_reason: "length" }] },
      ])
    );
    const events = await collect(sendProviderStream({ provider: deepseek, messages, fetcher: fetcher as unknown as typeof fetch }));
    const call = events.find((event) => event.type === "tool_call");
    expect(call).toMatchObject({ type: "tool_call", name: "save_insight", truncated: true, argsLength: cut.length });
    // No "notice" for a tool turn — the loop turns the label into a tool result instead.
    expect(events.some((event) => event.type === "notice")).toBe(false);
  });

  it("⑤ 未被截断的调用不带 truncated（即使收到 length 但 JSON 完整也不误标）", async () => {
    const fetcher = vi.fn(async () =>
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "show_home", arguments: "{}" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ])
    );
    const events = await collect(sendProviderStream({ provider: local, messages, fetcher: fetcher as unknown as typeof fetch }));
    const call = events.find((event) => event.type === "tool_call") as Extract<ChatDelta, { type: "tool_call" }>;
    expect(call.truncated).toBeUndefined();

    const capped = vi.fn(async () =>
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "show_home", arguments: "{}" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "length" }] },
      ])
    );
    const events2 = await collect(sendProviderStream({ provider: local, messages, fetcher: capped as unknown as typeof fetch }));
    const call2 = events2.find((event) => event.type === "tool_call") as Extract<ChatDelta, { type: "tool_call" }>;
    expect(call2.truncated).toBeUndefined();
  });

  it("③ 无工具调用而 finish_reason=length → 一条 notice", async () => {
    const fetcher = vi.fn(async () =>
      sse([
        { choices: [{ delta: { content: "第一段…" } }] },
        { choices: [{ delta: { content: "第二段" }, finish_reason: "length" }] },
      ])
    );
    const events = await collect(sendProviderStream({ provider: deepseek, messages, fetcher: fetcher as unknown as typeof fetch }));
    const notice = events.filter((event) => event.type === "notice");
    expect(notice).toHaveLength(1);
    expect((notice[0] as { text: string }).text).toMatch(/输出上限/);
    // Text deltas still arrive in order before the notice.
    expect(events.filter((event) => event.type === "delta").map((event) => (event as { text: string }).text)).toEqual(["第一段…", "第二段"]);
  });

  it("④ 4xx 指向该字段 → 重试一次不带它，且回复送达", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if ("max_completion_tokens" in body) {
        return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_completion_tokens'" } }), { status: 400 });
      }
      return sse([{ choices: [{ delta: { content: "ok" } }] }]);
    });
    const events = await collect(sendProviderStream({ provider: openai, messages, fetcher: fetcher as unknown as typeof fetch }));
    expect(bodies).toHaveLength(2);
    expect("max_completion_tokens" in bodies[1]).toBe(false);
    expect(events.some((event) => event.type === "delta")).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("shouldRetryWithoutOutputLimit 只认该字段相关的 4xx", () => {
    expect(shouldRetryWithoutOutputLimit(400, "unknown field max_tokens")).toBe(true);
    expect(shouldRetryWithoutOutputLimit(422, "max_completion_tokens is not supported")).toBe(true);
    expect(shouldRetryWithoutOutputLimit(400, "invalid api key")).toBe(false);
    expect(shouldRetryWithoutOutputLimit(500, "max_tokens")).toBe(false);
  });
});
