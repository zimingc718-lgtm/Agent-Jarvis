import { randomUUID } from "node:crypto";
import { repairDanglingToolCalls, runToolLoop } from "./agent-loop";
import { KNOWLEDGE_ROOT, listKnowledge } from "./knowledge";
import { estimateMessagesTokens, estimateTokens, sendProviderStream, type StreamProviderConfig, type ToolSpec } from "./adapters";
import { resolveDisplayView } from "./display";
import { ProviderSecretError, type SourceRecord, type Store } from "./store";
import { makeCompleter, type Completer } from "./skills";
import {
  applySummary,
  assembleContext,
  budgetTokens,
  BUDGET_SHARES,
  buildStablePrefix,
  buildVolatileSuffix,
  contextWindowFor,
  ContextOverflowError,
  planCompaction,
  renderSkillCatalogue,
  SUMMARY_MAX_TOKENS,
  SUMMARY_STATUS,
  type TurnMessage,
} from "./tools/budget";
import { ToolRegistry, type ToolContext } from "./tools/registry";
import { createSkillTools } from "./tools/skill-tools";
import { createDisplayTools } from "./tools/display-tools";
import { createKnowledgeTools } from "./tools/knowledge-tools";
import { createEntityTools } from "./tools/entity-tools";
import { createWebTools, readWebSettings } from "./tools/web-tools";
import type { ChatDelta, ChatMessage, ProviderRuntimeConfig, Source } from "./types";

export const DEFAULT_SYSTEM_PROMPT =
  "You are Agent-Jarvis, a concise assistant running locally on the user's machine. Answer directly and keep prior turns of this conversation in mind.";

/**
 * Statuses that replay as context. `truncated` joins the set because a turn that hit the
 * step ceiling still produced real work the next turn should see (REQ-F-029 ②).
 */
const REPLAYABLE_STATUSES = new Set(["complete", "stopped", "truncated"]);

type ProviderStreamInput = {
  provider: StreamProviderConfig;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  tools?: ToolSpec[];
  includeUsage?: boolean;
};

type RunChatTurnInput = {
  store: Store;
  userId: string;
  providerId?: string;
  message: string;
  conversationId?: string;
  model?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  providerStream?: (input: ProviderStreamInput) => AsyncIterable<ChatDelta>;
  /** Extra tools, used by tests to register a fake capability (REQ-NF-010 ②). */
  extraTools?: ToolRegistry;
  /** Test seam for the compaction summary call (REQ-F-042 ②). */
  summarize?: Completer;
  /** `toolsUsed` lets the caller report on what actually ran this turn (REQ-F-023 ③). */
  onFinal?: (finalText: string, status: string, conversationId: string, toolsUsed: string[]) => ChatDelta[];
};

const encoder = new TextEncoder();

export class ChatServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function formatSse(delta: ChatDelta): string {
  return `event: ${delta.type}\ndata: ${JSON.stringify(delta)}\n\n`;
}

/** Build the toolset for one send. Composition is fixed for the whole turn (DEC-026 ②). */
export function buildRegistry(store: Store, extra?: ToolRegistry): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of createSkillTools(store)) {
    registry.register(tool);
  }
  for (const tool of createDisplayTools(store)) {
    registry.register(tool);
  }
  for (const tool of createWebTools({ store })) {
    registry.register(tool);
  }
  for (const tool of createKnowledgeTools()) {
    registry.register(tool);
  }
  // CR-20260911-home-dashboard: entity tools register unconditionally, like save_knowledge.
  // Making them conditional needs a ToolContext field, and that file is being rewritten
  // by the display-console CR right now; the condition joins in the wiring step.
  for (const tool of createEntityTools()) {
    registry.register(tool);
  }
  if (extra) {
    for (const tool of extra.availableFor({} as ToolContext)) {
      registry.register(tool);
    }
  }
  return registry;
}

/** Which (provider, model) pairs are known to call tools (REQ-F-040 ①). */
function toolSupportFor(provider: ProviderRuntimeConfig, model: string): "yes" | "no" | "unknown" {
  const raw = provider.toolSupport;
  if (!raw) {
    return "unknown";
  }
  const value = raw[model];
  return value === "yes" || value === "no" ? value : "unknown";
}

export async function runChatTurn(input: RunChatTurnInput): Promise<ReadableStream<Uint8Array>> {
  const message = input.message.trim();
  if (!message) {
    throw new ChatServiceError(400, "Message is required.");
  }

  let provider: ProviderRuntimeConfig | null;
  try {
    provider = input.providerId
      ? input.store.getProviderForUser(input.userId, input.providerId)
      : input.store.resolveActiveProvider(input.userId);
  } catch (error) {
    if (error instanceof ProviderSecretError) {
      throw new ChatServiceError(400, "无法读取该 Provider 的凭据，请在模型设置中重新输入 API Key。");
    }
    throw error;
  }
  if (!provider) {
    throw input.providerId
      ? new ChatServiceError(404, "Selected model provider is not connected.")
      : new ChatServiceError(409, "没有可用的模型 Provider。请在「模型」中启用一个并通过连接测试。");
  }

  let conversationId: string;
  if (input.conversationId) {
    const existing = input.store.getConversationForUser(input.userId, input.conversationId);
    if (!existing) {
      throw new ChatServiceError(404, "Conversation not found.");
    }
    conversationId = existing.id;
  } else {
    conversationId = input.store.createConversation(input.userId, titleFromMessage(message)).id;
  }

  const model = input.model?.trim() || provider.defaultModel;
  const skills = input.store.listSkills(input.userId);
  const web = readWebSettings(input.store);
  const support = toolSupportFor(provider, model);
  /**
   * REQ-F-040 ③ as corrected by CR-20260911-tool-availability.
   *
   * `unknown` is the state every provider starts in, and the first version treated it
   * like `no` — so out of the box no tools registered at all and the model could not
   * reach `web_search` however much the user wanted it to. "Not yet probed" is not
   * "does not support"; only the latter was what the user ruled should degrade.
   *
   * So `unknown` now attempts tools. If the provider rejects the `tools` field we fall
   * back once and remember `no` (see `toolRejection` below) — the same shape as the
   * `stream_options` fallback. Priority order is untouched (REQ-F-006 ⑦).
   */
  const toolsUsable = support !== "no";

  const registry = buildRegistry(input.store, input.extraTools);
  // Counted once per send like the skills: the toolset is fixed for the turn (DEC-026 ②).
  const knowledgeCount = (await listKnowledge(KNOWLEDGE_ROOT)).length;
  const toolContext: ToolContext = {
    userId: input.userId,
    conversationId,
    skillCount: skills.length,
    webEnabled: web.enabled,
    searchConfigured: Boolean(web.baseUrl),
    knowledgeCount,
  };

  const window = contextWindowFor({ kind: provider.kind, contextWindow: provider.contextWindow });
  const catalogue = renderSkillCatalogue(
    skills.map((skill) => ({ name: skill.name, description: skill.description })),
    budgetTokens(window, BUDGET_SHARES.skillCatalogue)
  );
  const stablePrefix = buildStablePrefix({
    identity: input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    skillCatalogue: catalogue.text,
    toolCatalogue: toolsUsable ? registry.catalogueFor(toolContext) : "",
  });
  const volatileSuffix = buildVolatileSuffix({ displayState: describeDisplay() });

  const { messages: history, lastRowIdByTurn } = loadHistory(input.store, conversationId);
  input.store.appendMessage({ conversationId, role: "user", content: message, status: "complete" });

  const currentTurn = history.length > 0 ? Math.max(...history.map((entry) => entry.turn)) + 1 : 1;
  const turnMessages: TurnMessage[] = [...history, { role: "user", content: message, turn: currentTurn }];

  // REQ-NF-007 ④ as rewritten: narrow tool results, then compact text history, then —
  // only then — refuse. Compaction runs at most once per send (DEC-030 ⑨).
  let contextMessages = turnMessages;
  let compaction: CompactionOutcome = "not-attempted";
  const preamble: ChatDelta[] = [];
  const plan = planCompaction({ messages: turnMessages, currentTurn, contextWindow: window });
  if (plan.shouldCompact) {
    // The summary row goes right behind the last row it covers — its position is the
    // boundary (DEC-030 ①). Appending it at the end would put the still-verbatim recent
    // turns before it and silently drop them from the next replay.
    const anchorId = lastRowIdByTurn.get(plan.through) ?? null;
    const summary = await summarizeSpan({
      store: input.store,
      conversationId,
      provider,
      model,
      messages: turnMessages,
      through: plan.through,
      anchorId,
      summarize: input.summarize,
    });
    if (summary) {
      contextMessages = applySummary(turnMessages, summary, plan.through);
      compaction = "applied";
      preamble.push({
        type: "compacted",
        summary,
        afterMessageId: anchorId,
        keptTurns: currentTurn - plan.through,
      });
    } else {
      // The model call failed, timed out or came back empty. Compaction exists to save
      // tokens; it must never become a way for a turn to fail (REQ-NF-012 ③), so we
      // simply carry on uncompacted.
      compaction = "failed";
    }
  }

  let assembled: ChatMessage[];
  try {
    assembled = assembleContext({
      stablePrefix,
      volatileSuffix,
      messages: contextMessages,
      currentTurn,
      contextWindow: window,
    }).messages;
  } catch (error) {
    if (error instanceof ContextOverflowError) {
      throw new ChatServiceError(413, describeOverflow(error.message, compaction));
    }
    throw error;
  }
  assembled = repairDanglingToolCalls(assembled);

  const messageId = randomUUID();
  const streamFactory = input.providerStream ?? sendProviderStream;
  const providerConfig = toStreamProviderConfig(provider);

  return createStreamingResponse({
    conversationId,
    messageId,
    signal: input.signal,
    preamble,
    toolsUsable,
    toolsUnavailableReason:
      support === "unknown"
        ? "当前模型尚未探测工具调用能力，本轮按普通对话进行。可在「模型」中点「测试」完成探测。"
        : "当前模型不支持工具调用，本轮按普通对话进行。",
    /**
     * Learn the provider's tool capability from what actually happened, so an unprobed
     * provider converges after one turn instead of re-asking forever
     * (CR-20260911-tool-availability).
     */
    recordToolSupport: (result) => {
      if (support !== "unknown" || !toolsUsable) {
        return;
      }
      input.store.setProviderToolSupport(input.userId, provider.id, model, result);
    },
    run: (emit, persist) =>
      runToolLoop({
        registry,
        toolContext: { ...toolContext, signal: input.signal },
        messages: assembled,
        emit,
        signal: input.signal,
        persist,
        providerTurn: ({ messages, tools }) =>
          streamFactory({
            provider: providerConfig,
            messages,
            model: input.model,
            signal: input.signal,
            tools: toolsUsable ? tools : undefined,
            includeUsage: provider.kind !== "local",
          }),
      }),
    store: input.store,
    estimateFallback: () => estimateMessagesTokens(assembled),
    onFinal: input.onFinal,
  });
}

/**
 * Rebuild conversation messages, tagging each with the user turn it belongs to.
 *
 * When a compaction summary exists, the LAST one is the boundary: everything before it
 * has already been folded in, so only the summary plus what follows is replayed
 * (DEC-030 ①). The original rows stay in the database untouched — compaction only
 * changes what is sent to the model.
 */
function loadHistory(
  store: Store,
  conversationId: string
): { messages: TurnMessage[]; lastRowIdByTurn: Map<number, string> } {
  const all = store.listMessages(conversationId);

  // Summaries are found before the replayable filter, because `summary` is deliberately
  // NOT in REPLAYABLE_STATUSES — that omission is what makes a rollback safe (DEC-030 ②).
  let boundary = -1;
  for (let index = all.length - 1; index >= 0; index -= 1) {
    if (all[index].status === SUMMARY_STATUS) {
      boundary = index;
      break;
    }
  }

  const summaryRow = boundary >= 0 ? all[boundary] : null;
  const scoped = boundary >= 0 ? all.slice(boundary + 1) : all;
  const records = scoped.filter((record) => REPLAYABLE_STATUSES.has(record.status));

  const messages: TurnMessage[] = [];
  // Where each turn ends in the database — the anchor a compaction summary is inserted
  // behind (DEC-030 ①). Turn 0 is the previous summary itself.
  const lastRowIdByTurn = new Map<number, string>();
  let turn = 0;
  if (summaryRow) {
    messages.push({ role: "system", content: summaryRow.content, turn });
    lastRowIdByTurn.set(turn, summaryRow.id);
  }
  for (const record of records) {
    if (record.role === "user") {
      turn += 1;
    }
    lastRowIdByTurn.set(turn, record.id);
    if (record.role === "tool") {
      messages.push({
        role: "tool",
        content: record.content,
        tool_call_id: record.toolCallId ?? undefined,
        turn,
      });
      continue;
    }
    messages.push({
      role: record.role,
      content: record.content,
      ...(record.toolCalls ? { tool_calls: record.toolCalls } : {}),
      turn,
    });
  }
  return { messages, lastRowIdByTurn };
}

type CompactionOutcome = "not-attempted" | "applied" | "failed";

/**
 * REQ-NF-007 ④ (CP-8): the refusal names what was already tried, so the user is not told
 * to open a new conversation as if compaction had never been attempted.
 */
function describeOverflow(base: string, compaction: CompactionOutcome): string {
  if (compaction === "applied") {
    return `已压缩早前对话并收窄工具结果，${base}`;
  }
  if (compaction === "failed") {
    return `压缩早前对话未成功，已按原样收窄工具结果，${base}`;
  }
  return base;
}

const SUMMARY_SYSTEM_PROMPT =
  "你在压缩一段对话历史，供后续轮次作为背景使用。请写一份简洁的中文摘要，必须保留：" +
  "已经做出的决定、明确的约束与偏好、专有名词与标识符（文件名、接口名、编号）、以及尚未完成的事项。" +
  "不要复述寒暄，不要添加原文没有的内容。只输出摘要正文。";

/**
 * Fold `messages` up to `through` into one summary, persist it, and return it
 * (REQ-F-042 ②, REQ-NF-012 ②③④; TASK-078).
 *
 * Uses the same provider and model as the conversation itself (user ruling, 2026-09-11).
 * Returns `null` on any failure — the caller then proceeds uncompacted.
 */
async function summarizeSpan(input: {
  store: Store;
  conversationId: string;
  provider: ProviderRuntimeConfig;
  /** The model this turn resolved to — the summary uses the very same one (CP-2). */
  model: string;
  messages: TurnMessage[];
  through: number;
  /** Database id of the last row the summary covers; the summary is inserted behind it. */
  anchorId: string | null;
  summarize?: Completer;
}): Promise<string | null> {
  const span = input.messages.filter((message) => message.turn <= input.through);
  if (span.length === 0) {
    return null;
  }

  // Incremental (REQ-NF-012 ②): a previous summary arrives as a `system` row inside the
  // span, so folding the span forward re-summarises the summary rather than the whole
  // conversation. Without this, every compaction would re-read everything from turn 1.
  const transcript = span
    .map((message) => {
      const who = message.role === "system" ? "已有摘要" : message.role === "tool" ? "工具结果" : message.role;
      return `[${who}] ${message.content}`;
    })
    .join("\n\n");

  // Same provider AND same model as the conversation (user ruling Q2, 2026-09-11):
  // `makeCompleter` sends `defaultModel`, so a per-turn model override has to be folded
  // in here or the summary would quietly come from a different model.
  const completer = input.summarize ?? makeCompleter({ ...input.provider, defaultModel: input.model });
  let summary: string;
  try {
    summary = await completer(
      [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      { maxTokens: SUMMARY_MAX_TOKENS, timeoutMs: 30_000 }
    );
  } catch {
    return null;
  }

  const text = summary?.trim();
  if (!text) {
    return null;
  }

  const row = {
    conversationId: input.conversationId,
    role: "system" as const,
    content: text,
    status: SUMMARY_STATUS,
  };
  if (input.anchorId) {
    input.store.insertMessageAfter(input.anchorId, row);
  } else {
    input.store.appendMessage(row);
  }
  // REQ-NF-012 ④: the summary call costs tokens, and hiding that would defeat the
  // measurement REQ-NF-007 relies on.
  input.store.addUsage(input.conversationId, {
    inputTokens: estimateTokens(transcript),
    outputTokens: estimateTokens(text),
    estimated: true,
  });
  return text;
}

function describeDisplay(): string | null {
  try {
    const view = resolveDisplayView();
    return view.kind === "insight" ? "正在显示一份洞察报告" : "标题视图";
  } catch {
    return null;
  }
}

function createStreamingResponse(input: {
  conversationId: string;
  messageId: string;
  signal?: AbortSignal;
  /** Events that describe this send's preparation (e.g. `compacted`), sent right after `start`. */
  preamble?: ChatDelta[];
  toolsUsable: boolean;
  /** Called once per turn with what the provider actually demonstrated. */
  recordToolSupport?: (result: "yes" | "no") => void;
  toolsUnavailableReason: string;
  store: Store;
  estimateFallback: () => number;
  run: (
    emit: (delta: ChatDelta) => void,
    persist: (message: ChatMessage & { status: string; sources?: Source[] }) => void
  ) => Promise<{ text: string; status: string; sources: Source[]; toolsUsed: string[]; errorMessage?: string }>;
  onFinal?: (finalText: string, status: string, conversationId: string, toolsUsed: string[]) => ChatDelta[];
}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (delta: ChatDelta) => {
        if (!closed) {
          controller.enqueue(encoder.encode(formatSse(delta)));
        }
      };

      let sawUsage = false;
      let toolsRejected = false;
      const emit = (delta: ChatDelta) => {
        if (delta.type === "usage") {
          sawUsage = true;
          input.store.addUsage(input.conversationId, delta.usage);
          send({ type: "usage", usage: input.store.getUsage(input.conversationId) });
          return;
        }
        if (delta.type === "tools-unavailable") {
          // The adapter dropped `tools` after the provider rejected the field.
          toolsRejected = true;
        }
        send(delta);
      };

      const persist = (message: ChatMessage & { status: string; sources?: Source[] }) => {
        input.store.appendMessage({
          conversationId: input.conversationId,
          role: message.role,
          content: message.content,
          status: message.status,
          toolCalls: message.tool_calls ?? null,
          toolCallId: message.tool_call_id ?? null,
          sources: (message.sources as SourceRecord[] | undefined) ?? null,
        });
      };

      send({ type: "start", conversationId: input.conversationId, messageId: input.messageId });
      for (const delta of input.preamble ?? []) {
        send(delta);
      }
      if (!input.toolsUsable) {
        send({ type: "tools-unavailable", reason: input.toolsUnavailableReason });
      }

      try {
        const result = await input.run(emit, persist);

        // Evidence beats guessing: a tool that actually ran proves support, a rejected
        // `tools` field proves the opposite. Anything else leaves the state unknown so
        // the next turn tries again rather than locking in a wrong answer.
        if (toolsRejected) {
          input.recordToolSupport?.("no");
        } else if (result.toolsUsed.length > 0) {
          input.recordToolSupport?.("yes");
        }

        // REQ-F-039: sources are their own structure, assembled server-side from what the
        // tools actually returned. The prose already streamed and is never rewritten.
        if (result.sources.length > 0) {
          send({ type: "sources", sources: result.sources });
        }

        // REQ-F-037 ④: providers that never report usage still get a number, flagged.
        if (!sawUsage) {
          const usage = {
            inputTokens: input.estimateFallback(),
            outputTokens: estimateTokens(result.text),
            estimated: true,
          };
          input.store.addUsage(input.conversationId, usage);
          send({ type: "usage", usage: input.store.getUsage(input.conversationId) });
        }

        for (const delta of input.onFinal?.(result.text, result.status, input.conversationId, result.toolsUsed) ?? []) {
          send(delta);
        }

        if (result.status === "stopped") {
          send({ type: "stopped" });
        } else if (result.status === "error") {
          send({ type: "error", message: result.errorMessage ?? "Provider stream failed." });
        } else {
          send({ type: "done", messageId: input.messageId });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider stream failed.";
        send({ type: "error", message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });
}

function toStreamProviderConfig(provider: ProviderRuntimeConfig): StreamProviderConfig {
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    secret: provider.secret,
  };
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= 60) {
    return compact;
  }
  return `${compact.slice(0, 57)}...`;
}
