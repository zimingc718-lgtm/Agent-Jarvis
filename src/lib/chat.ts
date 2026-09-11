import { randomUUID } from "node:crypto";
import { repairDanglingToolCalls, runToolLoop } from "./agent-loop";
import { estimateMessagesTokens, estimateTokens, sendProviderStream, type StreamProviderConfig, type ToolSpec } from "./adapters";
import { resolveDisplayView } from "./display";
import { ProviderSecretError, type SourceRecord, type Store } from "./store";
import {
  assembleContext,
  budgetTokens,
  BUDGET_SHARES,
  buildStablePrefix,
  buildVolatileSuffix,
  contextWindowFor,
  ContextOverflowError,
  renderSkillCatalogue,
  type TurnMessage,
} from "./tools/budget";
import { ToolRegistry, type ToolContext } from "./tools/registry";
import { createSkillTools } from "./tools/skill-tools";
import { createDisplayTools } from "./tools/display-tools";
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
  onFinal?: (finalText: string, status: string, conversationId: string) => ChatDelta[];
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
  // REQ-F-040 ③: `no` and `unknown` behave alike — running tool-free beats letting the
  // user watch an unexplained failure first. Priority order is untouched (REQ-F-006 ⑦).
  const toolsUsable = support === "yes";

  const registry = buildRegistry(input.store, input.extraTools);
  const toolContext: ToolContext = {
    userId: input.userId,
    conversationId,
    skillCount: skills.length,
    webEnabled: web.enabled,
    searchConfigured: Boolean(web.baseUrl),
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

  const history = loadHistory(input.store, conversationId);
  input.store.appendMessage({ conversationId, role: "user", content: message, status: "complete" });

  const currentTurn = history.length > 0 ? Math.max(...history.map((entry) => entry.turn)) + 1 : 1;
  const turnMessages: TurnMessage[] = [...history, { role: "user", content: message, turn: currentTurn }];

  let assembled: ChatMessage[];
  try {
    assembled = assembleContext({
      stablePrefix,
      volatileSuffix,
      messages: turnMessages,
      currentTurn,
      contextWindow: window,
    }).messages;
  } catch (error) {
    if (error instanceof ContextOverflowError) {
      throw new ChatServiceError(413, error.message);
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
    toolsUsable,
    toolsUnavailableReason:
      support === "unknown"
        ? "当前模型尚未探测工具调用能力，本轮按普通对话进行。可在「模型」中点「测试」完成探测。"
        : "当前模型不支持工具调用，本轮按普通对话进行。",
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

/** Rebuild conversation messages, tagging each with the user turn it belongs to. */
function loadHistory(store: Store, conversationId: string): TurnMessage[] {
  const records = store.listMessages(conversationId).filter((record) => REPLAYABLE_STATUSES.has(record.status));
  const messages: TurnMessage[] = [];
  let turn = 0;
  for (const record of records) {
    if (record.role === "user") {
      turn += 1;
    }
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
  return messages;
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
  toolsUsable: boolean;
  toolsUnavailableReason: string;
  store: Store;
  estimateFallback: () => number;
  run: (
    emit: (delta: ChatDelta) => void,
    persist: (message: ChatMessage & { status: string; sources?: Source[] }) => void
  ) => Promise<{ text: string; status: string; sources: Source[]; errorMessage?: string }>;
  onFinal?: (finalText: string, status: string, conversationId: string) => ChatDelta[];
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
      const emit = (delta: ChatDelta) => {
        if (delta.type === "usage") {
          sawUsage = true;
          input.store.addUsage(input.conversationId, delta.usage);
          send({ type: "usage", usage: input.store.getUsage(input.conversationId) });
          return;
        }
        send(delta);
      };

      const persist = (message: ChatMessage & { status: string; sources?: Source[] }) => {
        input.store.appendMessage({
          conversationId: input.conversationId,
          role: message.role === "system" ? "assistant" : message.role,
          content: message.content,
          status: message.status,
          toolCalls: message.tool_calls ?? null,
          toolCallId: message.tool_call_id ?? null,
          sources: (message.sources as SourceRecord[] | undefined) ?? null,
        });
      };

      send({ type: "start", conversationId: input.conversationId, messageId: input.messageId });
      if (!input.toolsUsable) {
        send({ type: "tools-unavailable", reason: input.toolsUnavailableReason });
      }

      try {
        const result = await input.run(emit, persist);

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

        for (const delta of input.onFinal?.(result.text, result.status, input.conversationId) ?? []) {
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
