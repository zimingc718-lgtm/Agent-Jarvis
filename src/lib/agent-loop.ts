import type { ToolSpec } from "./adapters";
import type { ChatDelta, ChatMessage, Source, ToolCall } from "./types";
import { normalizeArgs, parseToolArguments, summarizeArgs, type ToolContext, type ToolRegistry } from "./tools/registry";

/**
 * The tool loop (DEC-022, REQ-F-029, TASK-065).
 *
 * One send now spans several provider calls: ask, run whatever tools came back, feed the
 * results in, ask again. Everything that bounds it lives here — the step ceiling, the
 * repeat-failure short circuit, and abort propagation into running tools.
 *
 * A failing tool is **not** a failing turn: its error text goes back as that tool's result
 * so the model can retry or change approach (REQ-F-029 ③). Only the ceiling stops the loop.
 */

/** REQ-F-029 ①. Each `tool_call` counts one step. */
export const MAX_TOOL_STEPS = 100;
/** REQ-F-029 ④. Same tool, same normalised arguments, twice in a row. */
export const REPEAT_FAILURE_LIMIT = 2;
/** How long a single tool may run before it is abandoned (P2 value). */
export const TOOL_TIMEOUT_MS = 15_000;

export type ProviderTurn = (input: {
  messages: ChatMessage[];
  tools: ToolSpec[];
}) => AsyncIterable<ChatDelta>;

export type ToolLoopInput = {
  registry: ToolRegistry;
  toolContext: ToolContext;
  /**
   * The budgeted tool set for this turn (CR-20260912-tool-budget). Omitted means "no
   * budget applied" and every available tool is sent — the shape tests use.
   */
  toolSpecs?: ToolSpec[];
  /** Conversation messages, already assembled and budgeted by `budget.ts`. */
  messages: ChatMessage[];
  providerTurn: ProviderTurn;
  /** Emit an SSE delta to the client. */
  emit: (delta: ChatDelta) => void;
  signal?: AbortSignal;
  /** Persist one message row as the loop produces it (DEC-024 ②). */
  persist: (message: ChatMessage & { status: string; sources?: Source[] }) => void;
};

export type ToolLoopResult = {
  /** Assistant prose accumulated across every step. */
  text: string;
  status: "complete" | "stopped" | "error" | "truncated";
  steps: number;
  /** URLs the tools actually surfaced — the allow-list for citations (REQ-F-039 ②). */
  sources: Source[];
  /** Tool names invoked during THIS turn, in call order. Lets callers report on what ran. */
  toolsUsed: string[];
  errorMessage?: string;
};

function raceWithTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  // Already aborted before we got here — a tool that aborts synchronously would
  // otherwise never fire the listener and the race would hang until the timeout.
  if (signal?.aborted) {
    return Promise.reject(new Error("aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`工具执行超过 ${ms / 1000}s 超时`)), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise
      .then((value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

export async function runToolLoop(input: ToolLoopInput): Promise<ToolLoopResult> {
  const conversation = [...input.messages];
  const specs = input.toolSpecs ?? input.registry.specsFor(input.toolContext);
  const sources: Source[] = [];
  const seenSourceUrls = new Set<string>();
  const failureStreak = new Map<string, number>();
  const toolsUsed: string[] = [];

  let text = "";
  let steps = 0;

  while (true) {
    if (input.signal?.aborted) {
      return { text, status: "stopped", steps, sources, toolsUsed };
    }

    let stepText = "";
    const pendingCalls: ToolCall[] = [];
    let failed: string | null = null;
    let stopped = false;

    for await (const delta of input.providerTurn({ messages: conversation, tools: specs })) {
      if (input.signal?.aborted) {
        stopped = true;
        break;
      }
      if (delta.type === "delta") {
        stepText += delta.text;
        text += delta.text;
        input.emit(delta);
        continue;
      }
      if (delta.type === "tool_call") {
        pendingCalls.push({
          id: delta.callId,
          type: "function",
          function: { name: delta.name, arguments: delta.argsSummary },
        });
        continue;
      }
      if (delta.type === "usage") {
        input.emit(delta);
        continue;
      }
      if (delta.type === "stopped") {
        stopped = true;
        break;
      }
      if (delta.type === "error") {
        failed = delta.message;
        break;
      }
    }

    if (stopped) {
      if (stepText) {
        input.persist({ role: "assistant", content: stepText, status: "stopped" });
      }
      return { text, status: "stopped", steps, sources, toolsUsed };
    }
    if (failed) {
      if (stepText) {
        input.persist({ role: "assistant", content: stepText, status: "error" });
      }
      return { text, status: "error", steps, sources, toolsUsed, errorMessage: failed };
    }

    // No tools requested: the model answered, the loop is done.
    if (pendingCalls.length === 0) {
      input.persist({ role: "assistant", content: stepText, status: "complete", sources });
      return { text, status: "complete", steps, sources, toolsUsed };
    }

    // Ceiling check happens BEFORE executing, so we never run an 11th tool and then
    // discard it. Partial work is kept (REQ-F-029 ②).
    if (steps + pendingCalls.length > MAX_TOOL_STEPS) {
      input.persist({ role: "assistant", content: stepText, status: "truncated", sources });
      input.emit({ type: "truncated", steps });
      return { text, status: "truncated", steps, sources, toolsUsed };
    }

    conversation.push({ role: "assistant", content: stepText, tool_calls: pendingCalls });
    input.persist({ role: "assistant", content: stepText, status: "complete", tool_calls: pendingCalls });

    const results = await Promise.all(
      pendingCalls.map(async (call) => {
        steps += 1;
        toolsUsed.push(call.function.name);
        const args = parseToolArguments(call.function.arguments);
        const key = `${call.function.name}:${normalizeArgs(args)}`;
        input.emit({
          type: "tool_call",
          callId: call.id,
          name: call.function.name,
          argsSummary: summarizeArgs(call.function.arguments),
        });

        if ((failureStreak.get(key) ?? 0) >= REPEAT_FAILURE_LIMIT) {
          const content = `同一调用已连续失败 ${REPEAT_FAILURE_LIMIT} 次，本轮不再重试。请换一种做法。`;
          input.emit({ type: "tool_result", callId: call.id, ok: false, summary: "重复失败，已拒绝" });
          return { call, content, ok: false };
        }

        const tool = input.registry.get(call.function.name);
        if (!tool) {
          const content = `没有名为 ${call.function.name} 的工具。`;
          input.emit({ type: "tool_result", callId: call.id, ok: false, summary: "未知工具" });
          return { call, content, ok: false };
        }

        try {
          const result = await raceWithTimeout(
            tool.execute(args, { ...input.toolContext, signal: input.signal }),
            TOOL_TIMEOUT_MS,
            input.signal
          );
          failureStreak.set(key, result.ok ? 0 : (failureStreak.get(key) ?? 0) + 1);
          for (const source of result.sources ?? []) {
            if (!seenSourceUrls.has(source.url)) {
              seenSourceUrls.add(source.url);
              sources.push(source);
            }
          }
          input.emit({ type: "tool_result", callId: call.id, ok: result.ok, summary: result.summary });
          for (const event of result.events ?? []) {
            input.emit(event);
          }
          return { call, content: result.content, ok: result.ok };
        } catch (error) {
          failureStreak.set(key, (failureStreak.get(key) ?? 0) + 1);
          const message = error instanceof Error ? error.message : "未知错误";
          const aborted = message === "aborted";
          input.emit({
            type: "tool_result",
            callId: call.id,
            ok: false,
            summary: aborted ? "已中止" : `失败：${message}`,
          });
          return { call, content: aborted ? "[已中止]" : `工具执行失败：${message}`, ok: false };
        }
      })
    );

    for (const result of results) {
      const message: ChatMessage = {
        role: "tool",
        content: result.content,
        tool_call_id: result.call.id,
      };
      conversation.push(message);
      input.persist({ ...message, status: result.ok ? "complete" : "error" });
    }

    if (input.signal?.aborted) {
      return { text, status: "stopped", steps, sources, toolsUsed };
    }
  }
}

/**
 * Repairs a replayed history so it is a legal OpenAI sequence (DEC-024 ④).
 *
 * A turn that was stopped or hit the ceiling can leave an assistant row carrying
 * `tool_calls` whose `tool` rows never got written. Sending that verbatim is a protocol
 * error at the provider, so every unanswered call gets a synthetic "aborted" result.
 */
export function repairDanglingToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const repaired: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    repaired.push(message);
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      continue;
    }

    // Copy the real tool rows first, then append synthetics for the calls that never
    // came back — the provider expects results in the order the calls were made.
    const answered = new Set<string>();
    let scan = index + 1;
    for (; scan < messages.length; scan += 1) {
      const next = messages[scan];
      if (next.role !== "tool") {
        break;
      }
      repaired.push(next);
      if (next.tool_call_id) {
        answered.add(next.tool_call_id);
      }
    }
    index = scan - 1;

    for (const call of message.tool_calls) {
      if (!answered.has(call.id)) {
        repaired.push({ role: "tool", content: "[已中止]", tool_call_id: call.id });
      }
    }
  }
  return repaired;
}
