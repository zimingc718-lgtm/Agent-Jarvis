import type { ChatDelta, ChatMessage, ProviderKind, ProviderTestResult } from "./types";

type CompatibleChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
  }>;
};

export type StreamProviderConfig = {
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  secret: string | null;
};

type SendProviderStreamInput = {
  provider: StreamProviderConfig;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  /** Upstream request timeout. Defaults to 60s. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export function normalizeOpenAICompatibleChunk(chunk: CompatibleChunk): ChatDelta | null {
  const text = chunk.choices?.[0]?.delta?.content;
  if (typeof text === "string" && text.length > 0) {
    return { type: "delta", text };
  }
  return null;
}

/**
 * Streams a chat completion from any OpenAI-compatible endpoint.
 * OpenAI, DeepSeek and local runtimes all speak `POST {baseUrl}/chat/completions` with SSE
 * `choices[].delta.content` chunks, so there is a single code path.
 */
export async function* sendProviderStream(input: SendProviderStreamInput): AsyncIterable<ChatDelta> {
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = input.provider.baseUrl.replace(/\/$/, "");
  const model = input.model?.trim() || input.provider.defaultModel;
  const url = `${baseUrl}/chat/completions`;
  const headers = new Headers({ "content-type": "application/json" });
  if (input.provider.secret) {
    headers.set("authorization", `Bearer ${input.provider.secret}`);
  }

  const timeout = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const abortedByUser = () => Boolean(input.signal?.aborted);

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, stream: true, messages: input.messages }),
      signal,
    });
  } catch (error) {
    if (abortedByUser()) {
      yield { type: "stopped" };
      return;
    }
    if (isTimeout(error, timeout)) {
      yield { type: "error", message: "Provider request timed out." };
      return;
    }
    yield { type: "error", message: `Could not reach provider: ${errorText(error)}.` };
    return;
  }

  if (!response.ok) {
    yield { type: "error", message: await describeHttpError(response) };
    return;
  }
  if (!response.body) {
    yield { type: "error", message: "Provider response did not include a stream." };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const reader = response.body.getReader();
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (abortedByUser()) {
        yield { type: "stopped" };
        return;
      }
      if (isTimeout(error, timeout)) {
        yield { type: "error", message: "Provider stream timed out." };
        return;
      }
      yield { type: "error", message: `Provider stream interrupted: ${errorText(error)}.` };
      return;
    }

    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const payload of takeSsePayloads(buffer)) {
      if (payload === "[DONE]") {
        continue;
      }
      const parsed = safeJsonParse(payload);
      if (!parsed) {
        continue;
      }
      const delta = normalizeOpenAICompatibleChunk(parsed);
      if (delta) {
        yield delta;
      }
    }
    buffer = keepTrailingPartialEvent(buffer);
  }
}

/** Lightweight connectivity probe used by the provider settings "Test connection" action. */
export async function testProviderConnection(
  config: { baseUrl: string; secret: string | null },
  fetcher: typeof fetch = fetch
): Promise<ProviderTestResult> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/models`;
  const headers = new Headers();
  if (config.secret) {
    headers.set("authorization", `Bearer ${config.secret}`);
  }

  const timeout = AbortSignal.timeout(10_000);
  try {
    const response = await fetcher(url, { headers, signal: timeout });
    if (response.ok) {
      return { ok: true, message: "Connection OK." };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "Authentication failed — check the API key." };
    }
    if (response.status === 404) {
      return { ok: false, message: "Reached the host but /models was not found — check the base URL." };
    }
    return { ok: false, message: `Provider responded ${response.status}.` };
  } catch (error) {
    if (isTimeout(error, timeout)) {
      return { ok: false, message: "Connection timed out." };
    }
    return { ok: false, message: `Could not reach provider: ${errorText(error)}.` };
  }
}

function takeSsePayloads(buffer: string): string[] {
  return buffer
    .split(/\n\n/)
    .slice(0, -1)
    .flatMap((event) =>
      event
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
    );
}

function keepTrailingPartialEvent(buffer: string): string {
  const parts = buffer.split(/\n\n/);
  return parts.at(-1) ?? "";
}

function safeJsonParse(value: string): CompatibleChunk | null {
  try {
    return JSON.parse(value) as CompatibleChunk;
  } catch {
    return null;
  }
}

function isTimeout(error: unknown, timeout: AbortSignal): boolean {
  return timeout.aborted || (error instanceof Error && error.name === "TimeoutError");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "network error";
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = await response.text();
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    detail = parsed.error?.message ?? parsed.message ?? body;
  } catch {
    /* non-JSON or empty body */
  }
  detail = detail.replace(/\s+/g, " ").trim().slice(0, 200);
  return `Provider request failed (${response.status})${detail ? `: ${detail}` : ""}.`;
}
