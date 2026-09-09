"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/lib/markdown";

type FloatingProvider = {
  id: string;
  name: string;
  defaultModel: string;
  connected: boolean;
};

export type FloatingMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: string;
};

export type ChatStreamEvent =
  | { type: "start"; conversationId: string }
  | { type: "delta"; text: string }
  | { type: "stopped" }
  | { type: "error"; message: string }
  | { type: "done" };

export type ChatStreamRequest = {
  message: string;
  providerId: string;
  model?: string;
  conversationId?: string;
  signal?: AbortSignal;
};

type FloatingChatProps = {
  providers: FloatingProvider[];
  initialConversationId?: string | null;
  initialMessages?: FloatingMessage[];
  onStream?: (request: ChatStreamRequest) => AsyncIterable<ChatStreamEvent>;
};

export async function* streamChatDeltas(request: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: request.message,
      providerId: request.providerId,
      model: request.model,
      conversationId: request.conversationId,
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Chat request failed.");
  }
  if (!response.body) {
    throw new Error("No response body returned.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const payload = event
        .split(/\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!payload) {
        continue;
      }
      const parsed = safeJsonParse(payload);
      if (!parsed || typeof parsed.type !== "string") {
        continue;
      }
      if (parsed.type === "start" && typeof parsed.conversationId === "string") {
        yield { type: "start", conversationId: parsed.conversationId };
      } else if (parsed.type === "delta" && typeof parsed.text === "string") {
        yield { type: "delta", text: parsed.text };
      } else if (parsed.type === "stopped") {
        yield { type: "stopped" };
      } else if (parsed.type === "error" && typeof parsed.message === "string") {
        yield { type: "error", message: parsed.message };
      } else if (parsed.type === "done") {
        yield { type: "done" };
      }
    }
  }
}

export function FloatingChat({
  providers,
  initialConversationId = null,
  initialMessages = [],
  onStream = streamChatDeltas,
}: FloatingChatProps) {
  const availableProviders = useMemo(() => providers.filter((provider) => provider.connected), [providers]);

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(availableProviders[0]?.id ?? null);
  const selectedProvider =
    availableProviders.find((provider) => provider.id === selectedProviderId) ?? availableProviders[0] ?? null;

  const [model, setModel] = useState<string>(selectedProvider?.defaultModel ?? "");
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(initialMessages.length > 0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState(initialMessages.length > 0 ? "Restored" : "Ready");
  const [messages, setMessages] = useState<FloatingMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);

  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Keep the model field in sync when the user switches provider.
  useEffect(() => {
    if (selectedProvider) {
      setModel(selectedProvider.defaultModel);
    }
  }, [selectedProvider?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = transcriptRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages]);

  const selectedLabel = selectedProvider ? `${selectedProvider.name} / ${model || selectedProvider.defaultModel}` : "No model connected";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || !selectedProvider || isStreaming) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const assistantId = crypto.randomUUID();

    setExpanded(true);
    setInput("");
    setIsStreaming(true);
    setStatus("Streaming");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: message },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      for await (const chunk of onStream({
        message,
        providerId: selectedProvider.id,
        model: model.trim() || undefined,
        conversationId: conversationId ?? undefined,
        signal: controller.signal,
      })) {
        if (chunk.type === "start") {
          setConversationId(chunk.conversationId);
        } else if (chunk.type === "delta") {
          setMessages((current) =>
            current.map((item) => (item.id === assistantId ? { ...item, content: `${item.content}${chunk.text}` } : item))
          );
        } else if (chunk.type === "stopped") {
          setStatus("Stopped");
          break;
        } else if (chunk.type === "error") {
          setStatus(chunk.message);
          break;
        } else if (chunk.type === "done") {
          setStatus("Complete");
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setStatus("Stopped");
      } else {
        setStatus(error instanceof Error ? error.message : "Chat failed");
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStatus("Stopped");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <section className={`floating-chat ${expanded ? "floating-chat--expanded" : ""}`} aria-label="Agent-Jarvis chat">
      <div className="floating-chat__status">
        <span className="floating-chat__light" aria-hidden="true" />
        {availableProviders.length > 1 ? (
          <select
            className="floating-chat__chip"
            aria-label="Model provider"
            value={selectedProvider?.id ?? ""}
            onChange={(event) => setSelectedProviderId(event.target.value)}
          >
            {availableProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} / {provider.defaultModel}
              </option>
            ))}
          </select>
        ) : (
          <span className="floating-chat__chip">{selectedLabel}</span>
        )}
        <span className="floating-chat__state">{status}</span>
      </div>

      {expanded ? (
        <div className="floating-chat__messages" ref={transcriptRef} aria-live="polite">
          {messages.map((message) => (
            <article className={`floating-chat__message floating-chat__message--${message.role}`} key={message.id}>
              {message.role === "assistant" ? (
                message.content ? (
                  <Markdown text={message.content} />
                ) : (
                  "..."
                )
              ) : (
                message.content
              )}
              {message.status === "error" ? <span className="floating-chat__flag"> (generation failed)</span> : null}
              {message.status === "stopped" ? <span className="floating-chat__flag"> (stopped)</span> : null}
            </article>
          ))}
        </div>
      ) : null}

      {selectedProvider ? (
        <form className="floating-chat__form" ref={formRef} onSubmit={handleSubmit}>
          {expanded ? (
            <input
              className="floating-chat__model"
              aria-label="Model"
              value={model}
              placeholder={selectedProvider.defaultModel}
              onChange={(event) => setModel(event.target.value)}
            />
          ) : null}
          <textarea
            aria-label="Message"
            placeholder="Ask Agent-Jarvis"
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {isStreaming ? (
            <button type="button" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button type="submit">Send</button>
          )}
        </form>
      ) : (
        <a className="floating-chat__settings" href="/settings/models">
          Open model settings
        </a>
      )}
    </section>
  );
}

function safeJsonParse(value: string): { type?: unknown; text?: unknown; message?: unknown; conversationId?: unknown } | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
