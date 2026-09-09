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
