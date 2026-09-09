import { randomUUID } from "node:crypto";
import { sendProviderStream, type StreamProviderConfig } from "./adapters";
import { ProviderSecretError, type Store } from "./store";
import type { ChatDelta, ChatMessage, ProviderRuntimeConfig } from "./types";

export const DEFAULT_SYSTEM_PROMPT =
  "You are Agent-Jarvis, a concise assistant running locally on the user's machine. Answer directly and keep prior turns of this conversation in mind.";

/** Assistant turns older than this are still replayed as context; anything not finished cleanly is skipped. */
const REPLAYABLE_STATUSES = new Set(["complete", "stopped"]);

type ProviderStreamInput = {
  provider: StreamProviderConfig;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
};

type RunChatTurnInput = {
  store: Store;
  userId: string;
  /**
   * Optional override (CR-20260909). When omitted, the turn uses the highest-priority
   * connected provider via `store.resolveActiveProvider`.
   */
  providerId?: string;
  message: string;
  /** Continue an existing conversation; when omitted a new one is created. */
  conversationId?: string;
  model?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  providerStream?: (input: ProviderStreamInput) => AsyncIterable<ChatDelta>;
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
      throw new ChatServiceError(
        400,
        "无法读取该 Provider 的凭据，请在模型设置中重新输入 API Key。"
      );
    }
    throw error;
  }
  if (!provider) {
    throw input.providerId
      ? new ChatServiceError(404, "Selected model provider is not connected.")
      : new ChatServiceError(409, "没有可用的模型 Provider。请在「配置」中启用一个并通过连接测试。");
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

  const history: ChatMessage[] = input.store
    .listMessages(conversationId)
    .filter((record) => REPLAYABLE_STATUSES.has(record.status))
    .map((record) => ({ role: record.role, content: record.content }));

  input.store.addMessage(conversationId, "user", message, "complete");

  const systemPrompt = input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const chatMessages: ChatMessage[] = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...history,
    { role: "user" as const, content: message },
  ];

  const messageId = randomUUID();
  const streamFactory = input.providerStream ?? sendProviderStream;
  const providerStream = streamFactory({
    provider: toStreamProviderConfig(provider),
    messages: chatMessages,
    model: input.model,
    signal: input.signal,
  });

  return createStreamingResponse({
    conversationId,
    messageId,
    signal: input.signal,
    providerStream,
    onComplete: (content, status) => input.store.addMessage(conversationId, "assistant", content, status),
  });
}

function createStreamingResponse(input: {
  conversationId: string;
  messageId: string;
  signal?: AbortSignal;
  providerStream: AsyncIterable<ChatDelta>;
  onComplete(content: string, status: "complete" | "stopped" | "error"): void;
}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      let persisted = false;

      const persistOnce = (status: "complete" | "stopped" | "error", content = assistantText) => {
        if (!persisted) {
          input.onComplete(content, status);
          persisted = true;
        }
      };
      const send = (delta: ChatDelta) => controller.enqueue(encoder.encode(formatSse(delta)));

      send({ type: "start", conversationId: input.conversationId, messageId: input.messageId });

      try {
        for await (const delta of input.providerStream) {
          if (input.signal?.aborted) {
            persistOnce("stopped");
            send({ type: "stopped" });
            controller.close();
            return;
          }

          if (delta.type === "delta") {
            assistantText += delta.text;
            send(delta);
            continue;
          }
          if (delta.type === "stopped") {
            persistOnce("stopped");
            send({ type: "stopped" });
            controller.close();
            return;
          }
          if (delta.type === "error") {
            // The error text goes to the client transiently; the persisted row keeps only whatever
            // partial answer arrived, marked as errored, so it never re-enters the model context.
            persistOnce("error");
            send(delta);
            controller.close();
            return;
          }
        }

        if (input.signal?.aborted) {
          persistOnce("stopped");
          send({ type: "stopped" });
        } else {
          persistOnce("complete");
          send({ type: "done", messageId: input.messageId });
        }
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider stream failed.";
        persistOnce("error");
        send({ type: "error", message });
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
