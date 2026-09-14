import { describe, expect, it } from "vitest";
import { sendProviderStream, type StreamProviderConfig } from "@/lib/adapters";
import type { ChatDelta } from "@/lib/types";

function sseResponse(lines: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${line}\n\n`));
        }
        controller.close();
      },
    }),
    init
  );
}

async function collect(
  provider: StreamProviderConfig,
  fetcher: typeof fetch,
  extra?: { signal?: AbortSignal; messages?: { role: "system" | "user" | "assistant"; content: string }[] }
): Promise<ChatDelta[]> {
  const deltas: ChatDelta[] = [];
  for await (const delta of sendProviderStream({
    provider,
    messages: extra?.messages ?? [{ role: "user", content: "hello" }],
    fetcher,
    signal: extra?.signal,
  })) {
    deltas.push(delta);
  }
  return deltas;
}

const local: StreamProviderConfig = {
  kind: "local",
  baseUrl: "http://127.0.0.1:11434/v1",
  defaultModel: "llama",
  secret: null,
};

describe("sendProviderStream", () => {
  it("calls every provider kind through the OpenAI-compatible chat completions endpoint", async () => {
    for (const provider of [
      { kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5", secret: "sk-openai" },
      { kind: "deepseek", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", secret: "sk-deepseek" },
      local,
    ] as StreamProviderConfig[]) {
      const requests: Request[] = [];
      const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
      }) as typeof fetch;

      const deltas = await collect(provider, fetcher);
      expect(requests[0].url).toBe(`${provider.baseUrl}/chat/completions`);
      expect(requests[0].headers.get("authorization")).toBe(provider.secret ? `Bearer ${provider.secret}` : null);
      expect(await requests[0].json()).toMatchObject({ model: provider.defaultModel, stream: true });
      expect(deltas).toEqual([{ type: "delta", text: "ok" }]);
    }
  });

  it("forwards the full message list including the system prompt", async () => {
    let sent: unknown;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return sseResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}']);
    }) as typeof fetch;

    await collect(local, fetcher, {
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hello" },
      ],
    });
    expect(sent).toMatchObject({ messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hello" }] });
  });

  it("normalizes an HTTP error into a readable error delta with the provider message", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 })) as typeof fetch;
    const deltas = await collect(local, fetcher);
    expect(deltas).toEqual([{ type: "error", message: "Provider request failed (401): invalid api key." }]);
  });

  it("emits stopped when the caller aborts the request", async () => {
    const controller = new AbortController();
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      (init?.signal as AbortSignal)?.throwIfAborted?.();
      throw err;
    }) as typeof fetch;

    const deltas = await collect(local, fetcher, { signal: controller.signal });
    expect(deltas).toEqual([{ type: "stopped" }]);
  });
});

/**
 * TEST-370 — 沉默看门狗（DEC-290，REQ-NF-061）。
 *
 * 2026-09-14 实测逼出来的：让模型连续写一份长讲义，13,499 个字正在往外流，第 60 秒整条
 * 被掐断报「timed out」。旧写法 `AbortSignal.timeout` 量的是总时长，于是「一直在产出」
 * 和「一个字都不出」被同一把尺子量——而这个产品做的就是长回答。
 */
describe("沉默看门狗 (DEC-290)", () => {
  /**
   * 桩要**接住中止信号**——真 `fetch` 会把 abort 传给 body 流，桩不接就等于把被测的
   * 那条路绕开了。测试 ② 第一版正是这么写的：看门狗明明开了火，桩照样把数据吐完。
   */
  function sse(lines: string[], gapMs: number, signal?: AbortSignal | null): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          let aborted = false;
          signal?.addEventListener("abort", () => {
            aborted = true;
            controller.error(new DOMException("aborted", "AbortError"));
          });
          for (const line of lines) {
            await new Promise((resolve) => setTimeout(resolve, gapMs));
            if (aborted) {
              return;
            }
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  }

  const chunk = (text: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

  it("① 一直在产出的流要活过 idle 时长——总时长不该是判据", async () => {
    // 六块，每块间隔 40ms（合计 240ms）> idle 100ms？不：单块间隔 40ms < 100ms，所以不该超时。
    // 旧实现按总时长算，240ms 会被 100ms 的表掐断；新实现每块续命，应当完整读完。
    const fetcher = (async () => sse([chunk("一"), chunk("二"), chunk("三"), chunk("四"), chunk("五"), chunk("六"), "data: [DONE]\n\n"], 40)) as unknown as typeof fetch;
    const out: string[] = [];
    for await (const delta of sendProviderStream({
      provider: { kind: "local", baseUrl: "http://127.0.0.1:1/v1", secret: null, defaultModel: "m" },
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      fetcher,
    })) {
      if (delta.type === "delta") out.push(delta.text);
      if (delta.type === "error") out.push(`ERR:${delta.message}`);
    }
    expect(out.join("")).toBe("一二三四五六");
  });

  it("② 真停住了才超时，而且话里说的是「没动静」不是「跑太久」", async () => {
    const fetcher = (async (_url: string, init?: RequestInit) =>
      sse([chunk("开头"), chunk("再也没有了")], 200, init?.signal)) as unknown as typeof fetch;
    const out: string[] = [];
    for await (const delta of sendProviderStream({
      provider: { kind: "local", baseUrl: "http://127.0.0.1:1/v1", secret: null, defaultModel: "m" },
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 60,
      fetcher,
    })) {
      if (delta.type === "delta") out.push(delta.text);
      if (delta.type === "error") out.push(`ERR:${delta.message}`);
    }
    const joined = out.join("|");
    expect(joined).toContain("ERR:");
    expect(joined).toContain("went quiet");
  });
});
