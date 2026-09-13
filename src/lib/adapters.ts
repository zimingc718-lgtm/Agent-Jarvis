import type { ChatDelta, ChatMessage, ProviderKind, ProviderTestResult, ToolCall } from "./types";

/** One `tool_calls` entry as it arrives on the wire — every field may be partial. */
type ToolCallChunk = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type CompatibleChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: ToolCallChunk[];
    };
    /** `"length"` means the provider stopped at its output cap (REQ-F-051 ②). */
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Output ceiling sent on every call, per provider kind (DEC-032 ①, REQ-F-051 ①).
 *
 * Without it DeepSeek defaults to ~4K output tokens and silently cut an 18 KB HTML
 * report nine times in a row (EV-2026-09-11-display-console-ux §1.1). The values are the
 * documented maxima; a provider that rejects the field gets one retry without it
 * (`shouldRetryWithoutOutputLimit`). Deliberately no per-provider column — that would be
 * a schema change for a number that has not yet needed overriding.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS: Record<ProviderKind, number> = {
  openai: 4096,
  deepseek: 8192,
  local: 4096,
};

/** OpenAI deprecated `max_tokens` in favour of `max_completion_tokens`; the others still use the old name. */
export function outputLimitField(kind: ProviderKind): "max_tokens" | "max_completion_tokens" {
  return kind === "openai" ? "max_completion_tokens" : "max_tokens";
}

/** A 4xx that names the output-limit field: retry once without it (same shape as `stream_options`). */
export function shouldRetryWithoutOutputLimit(status: number, body: string): boolean {
  return status >= 400 && status < 500 && /max_tokens|max_completion_tokens/i.test(body);
}

function parsesAsJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export type StreamProviderConfig = {
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  secret: string | null;
};

/** A tool as the provider needs to see it (OpenAI `tools` array entry). */
export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type SendProviderStreamInput = {
  provider: StreamProviderConfig;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  /** Upstream request timeout. Defaults to 60s. */
  timeoutMs?: number;
  /** Tool definitions for this call. Omitted entirely when the toolset is empty. */
  tools?: ToolSpec[];
  /**
   * Ask for token usage on the final chunk (REQ-F-037 ③). Providers that do not know
   * the parameter can reject the request, so the caller passes `false` for those and
   * `sendProviderStream` also retries once without it — see `shouldRetryWithoutUsage`.
   */
  includeUsage?: boolean;
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
 * Accumulates streamed `tool_calls` fragments (DEC-024 ①).
 *
 * `id`, `function.name` and `function.arguments` each arrive across an arbitrary number
 * of chunks, and a turn can open several calls at once — `index` is the only stable
 * identity. Deliberately **not** keyed off `finish_reason`: DeepSeek and local runtimes
 * disagree on when (and whether) they send it.
 */
export class ToolCallAccumulator {
  private readonly byIndex = new Map<number, { id: string; name: string; args: string }>();

  push(chunks: ToolCallChunk[] | undefined): void {
    for (const chunk of chunks ?? []) {
      const index = chunk.index ?? 0;
      const entry = this.byIndex.get(index) ?? { id: "", name: "", args: "" };
      if (chunk.id) {
        entry.id = chunk.id;
      }
      if (chunk.function?.name) {
        entry.name += chunk.function.name;
      }
      if (typeof chunk.function?.arguments === "string") {
        entry.args += chunk.function.arguments;
      }
      this.byIndex.set(index, entry);
    }
  }

  get size(): number {
    return this.byIndex.size;
  }

  /** Completed calls in `index` order. Entries without a name are dropped as unusable. */
  toToolCalls(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, entry]) => entry.name.length > 0)
      .map(([index, entry]) => ({
        id: entry.id || `call_${index}`,
        type: "function" as const,
        function: { name: entry.name, arguments: entry.args || "{}" },
      }));
  }
}

/**
 * A 4xx that names `stream_options` means the provider predates the parameter rather
 * than that the request was wrong — worth one retry without it (REQ-F-037 ③, REQ-F-012).
 */
export function shouldRetryWithoutUsage(status: number, body: string): boolean {
  return status >= 400 && status < 500 && /stream_options|include_usage/i.test(body);
}

/**
 * Same idea for the `tools` field (CR-20260911-tool-availability). A provider that has
 * never been probed is asked optimistically; one that answers "I don't know this field"
 * gets one retry without it, and the caller records `no` so the next turn skips straight
 * to plain chat. Keeps an unprobed provider usable without making a broken one loop.
 */
export function shouldRetryWithoutTools(status: number, body: string): boolean {
  return status >= 400 && status < 500 && /\btools?\b|tool_choice|function[_ ]call/i.test(body);
}

/**
 * Local token estimate for providers that never report usage (REQ-F-037 ④).
 * CJK runs about 1.5 characters per token, Latin script about 4; the split keeps mixed
 * text from skewing badly in either direction. Always surfaced as `estimated`.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x3000 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff)) {
      cjk += 1;
    }
  }
  const latin = [...text].length - cjk;
  return Math.ceil(cjk / 1.5 + latin / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message.content ?? "") + 4, 0);
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

  const limitField = outputLimitField(input.provider.kind);
  const buildBody = (includeUsage: boolean, withTools: boolean, withLimit: boolean) =>
    JSON.stringify({
      model,
      stream: true,
      messages: input.messages,
      ...(withTools && input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
      ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
      ...(withLimit ? { [limitField]: DEFAULT_MAX_OUTPUT_TOKENS[input.provider.kind] } : {}),
    });

  let wantUsage = input.includeUsage ?? false;
  let wantTools = true;
  let wantLimit = true;
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers, body: buildBody(wantUsage, wantTools, wantLimit), signal });
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

  // Retry once when the provider rejected an optional field specifically. Usage and
  // tools are both nice-to-haves; a working reply is not (REQ-F-012 must keep passing).
  if (!response.ok && (wantUsage || wantLimit || (wantTools && input.tools?.length))) {
    const body = await response.clone().text();
    const dropUsage = wantUsage && shouldRetryWithoutUsage(response.status, body);
    const dropTools = wantTools && Boolean(input.tools?.length) && shouldRetryWithoutTools(response.status, body);
    const dropLimit = wantLimit && shouldRetryWithoutOutputLimit(response.status, body);
    if (dropUsage || dropTools || dropLimit) {
      wantUsage = wantUsage && !dropUsage;
      wantTools = wantTools && !dropTools;
      wantLimit = wantLimit && !dropLimit;
      if (dropTools) {
        // Tell the caller so it can record `no` and stop asking on later turns.
        yield { type: "tools-unavailable", reason: "当前模型不支持工具调用，本轮按普通对话进行。" };
      }
      try {
        response = await fetcher(url, { method: "POST", headers, body: buildBody(wantUsage, wantTools, wantLimit), signal });
      } catch (error) {
        yield { type: "error", message: `Could not reach provider: ${errorText(error)}.` };
        return;
      }
    }
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
  const accumulator = new ToolCallAccumulator();
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let sawText = false;
  // REQ-F-051 ②: the provider hit its output cap. Still not used to *close* tool calls
  // (DEC-024 ①) — only to label what arrived as cut short.
  let lengthCapped = false;
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
      // The `include_usage` final chunk carries `usage` with an EMPTY `choices` array.
      // Treating that as a malformed chunk is the trap DEC-028 calls out.
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
        completionTokens = parsed.usage.completion_tokens ?? completionTokens;
      }
      accumulator.push(parsed.choices?.[0]?.delta?.tool_calls);
      if (parsed.choices?.[0]?.finish_reason === "length") {
        lengthCapped = true;
      }
      const delta = normalizeOpenAICompatibleChunk(parsed);
      if (delta) {
        sawText = true;
        yield delta;
      }
    }
    buffer = keepTrailingPartialEvent(buffer);
  }

  if (promptTokens !== null || completionTokens !== null) {
    yield {
      type: "usage",
      usage: { inputTokens: promptTokens ?? 0, outputTokens: completionTokens ?? 0, estimated: false },
    };
  }
  if (accumulator.size > 0) {
    for (const call of accumulator.toToolCalls()) {
      // A call whose JSON no longer closes after a `length` stop was cut mid-argument.
      // Label it rather than dropping it: the loop turns the label into a precise tool
      // result, which is what lets the model shorten or split instead of retrying blind.
      const truncated = lengthCapped && !parsesAsJson(call.function.arguments);
      yield {
        type: "tool_call",
        callId: call.id,
        name: call.function.name,
        argsSummary: call.function.arguments,
        ...(truncated ? { truncated: true, argsLength: call.function.arguments.length } : {}),
      };
    }
  } else if (lengthCapped && sawText) {
    // REQ-F-051 ④ + REQ-NF-060 ②: a plain reply that hit the cap is reported as a typed
    // signal. The loop continues the answer on its own and only tells the user when it
    // stops doing so — 「可以让我继续」 was asking the user to pay for a whole extra turn.
    yield { type: "length_capped" };
  }
}

/**
 * Does this (provider, model) actually call tools? (DEC-029, REQ-F-040 ②)
 *
 * `testProviderConnection` hits `GET /models`, which says nothing about tool support, and
 * plenty of local OpenAI-compatible servers accept a `tools` array with a 200 and quietly
 * ignore it. The only honest probe is a real completion that should force a call.
 */
export async function probeToolSupport(
  config: { baseUrl: string; secret: string | null },
  model: string,
  fetcher: typeof fetch = fetch
): Promise<"yes" | "no"> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = new Headers({ "content-type": "application/json" });
  if (config.secret) {
    headers.set("authorization", `Bearer ${config.secret}`);
  }
  const probe: ToolSpec = {
    type: "function",
    function: {
      name: "jarvis_probe",
      description: "Return the literal string ok.",
      parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    },
  };

  const timeout = AbortSignal.timeout(15_000);
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers,
      signal: timeout,
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 32,
        tools: [probe],
        tool_choice: "auto",
        messages: [{ role: "user", content: "Call jarvis_probe with value 'ok'." }],
      }),
    });
    if (!response.ok) {
      return "no";
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { tool_calls?: unknown[] } }>;
    };
    const calls = body.choices?.[0]?.message?.tool_calls;
    return Array.isArray(calls) && calls.length > 0 ? "yes" : "no";
  } catch {
    return "no";
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
