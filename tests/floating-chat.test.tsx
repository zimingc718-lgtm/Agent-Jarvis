// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FloatingChat,
  PreStreamError,
  streamChatDeltas,
  type ChatStreamEvent,
  type ChatStreamRequest,
} from "@/components/FloatingChat";

const neverProbe = () => new Promise<boolean>(() => {});
const readyProbe = () => Promise.resolve(true);

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* jsdom always has it, but stay defensive */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FloatingChat", () => {
  it("shows a bottom input by default and expands after sending — no status text", async () => {
    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={readyProbe}
        onStream={async function* () {
          yield { type: "start", conversationId: "c1" };
          yield { type: "delta", text: "hello" };
          yield { type: "done" };
        }}
      />
    );

    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    expect(input).toBeInTheDocument();
    // The button reads 「新对话」 while the input is empty (REQ-F-017).
    expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByText("hello")).toBeInTheDocument();
    // No "Complete" / "Streaming" / "Ready" text anywhere.
    expect(screen.queryByText(/^(Complete|Streaming|Ready|Stopped)$/)).not.toBeInTheDocument();
  });

  it("carries no provider selection and sends no providerId (REQ-F-006 / TEST-011)", async () => {
    const requests: ChatStreamRequest[] = [];
    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={readyProbe}
        onStream={async function* (request) {
          requests.push(request);
          yield { type: "start", conversationId: "c" };
          yield { type: "done" };
        }}
      />
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model provider")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].providerId).toBeUndefined();
    expect(requests[0].model).toBeUndefined();
  });

  it("keeps separate assistant bubbles across turns and reuses the conversation id", async () => {
    const requests: ChatStreamRequest[] = [];
    async function* onStream(request: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
      requests.push(request);
      yield { type: "start", conversationId: "conv-1" };
      yield { type: "delta", text: request.message === "one" ? "first-answer" : "second-answer" };
      yield { type: "done" };
    }

    render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} onStream={onStream} />);
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");

    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("first-answer");

    fireEvent.change(input, { target: { value: "two" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("second-answer");

    expect(screen.getByText("first-answer")).toBeInTheDocument();
    expect(requests[1].conversationId).toBe("conv-1");
  });

  it("Stop aborts, ends the session, and the next message starts a new conversation (TEST-029)", async () => {
    const requests: ChatStreamRequest[] = [];
    let aborted = false;
    async function* onStream(request: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
      requests.push(request);
      request.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      yield { type: "start", conversationId: "conv-A" };
      yield { type: "delta", text: "partial" };
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { type: "delta", text: " more" };
    }

    render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} onStream={onStream} />);
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    const stop = await screen.findByRole("button", { name: "停止" });
    fireEvent.click(stop);

    await waitFor(() => expect(aborted).toBe(true));
    expect(await screen.findByText(/已停止/)).toBeInTheDocument();

    // Session ended: the second turn must not reuse conv-A.
    fireEvent.change(input, { target: { value: "again" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].conversationId).toBeUndefined();
  });

  it("「新对话」clears the transcript and drops the conversation id (TEST-030)", async () => {
    const requests: ChatStreamRequest[] = [];
    async function* onStream(request: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
      requests.push(request);
      yield { type: "start", conversationId: "conv-9" };
      yield { type: "delta", text: "answer-text" };
      yield { type: "done" };
    }

    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={readyProbe}
        initialConversationId="conv-9"
        initialMessages={[
          { id: "m1", role: "user", content: "earlier question", status: "complete" },
          { id: "m2", role: "assistant", content: "earlier answer", status: "complete" },
        ]}
        onStream={onStream}
      />
    );

    expect(screen.getByText("earlier answer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新对话" }));
    expect(screen.queryByText("earlier answer")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("jarvis:chat-session-ended")).toBe("1");

    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "fresh" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].conversationId).toBeUndefined();
  });

  it("does not hydrate a restored conversation once the session was ended (TEST-030)", () => {
    sessionStorage.setItem("jarvis:chat-session-ended", "1");
    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={neverProbe}
        initialConversationId="conv-9"
        initialMessages={[{ id: "m1", role: "assistant", content: "stale answer", status: "complete" }]}
        onStream={async function* () {}}
      />
    );
    expect(screen.queryByText("stale answer")).not.toBeInTheDocument();
  });

  it("shows a request-level error as a red line, keeps the session, adds no bubbles (TEST-028)", async () => {
    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={readyProbe}
        onStream={async function* () {
          throw new PreStreamError("没有可用的模型 Provider。请在「配置」中启用一个并通过连接测试。");
        }}
      />
    );

    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("没有可用的模型 Provider");
    expect(screen.queryByText("hi")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("jarvis:chat-session-ended")).toBeNull();
  });

  it("keeps a mid-stream failure as a flagged bubble, not a red line", async () => {
    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={readyProbe}
        onStream={async function* () {
          yield { type: "start", conversationId: "c" };
          yield { type: "delta", text: "half " };
          yield { type: "error", message: "upstream 500" };
        }}
      />
    );
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByText(/生成失败/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("status light has four states: checking -> ready, then busy while streaming (TEST-027)", async () => {
    let resolveProbe: (v: boolean) => void = () => {};
    const probe = () => new Promise<boolean>((resolve) => (resolveProbe = resolve));

    const { container } = render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={probe}
        onStream={async function* () {
          yield { type: "start", conversationId: "c" };
          await new Promise((r) => setTimeout(r, 30));
          yield { type: "done" };
        }}
      />
    );

    const light = () => container.querySelector(".floating-chat__light")!;
    expect(light().className).toContain("floating-chat__light--checking");

    resolveProbe(true);
    await waitFor(() => expect(light().className).toContain("floating-chat__light--ready"));

    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(light().className).toContain("floating-chat__light--busy"));
    await waitFor(() => expect(light().className).toContain("floating-chat__light--ready"));
  });

  it("light is 'off' when no provider is enabled", () => {
    const { container } = render(<FloatingChat hasEnabledProvider={false} onStream={async function* () {}} />);
    expect(container.querySelector(".floating-chat__light")!.className).toContain("floating-chat__light--off");
  });

  it("streamChatDeltas parses SSE frames and omits provider fields from the body", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ message: "hi", conversationId: "c0" });
      expect(body.providerId).toBeUndefined();
      return new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('event: start\ndata: {"type":"start","conversationId":"c9","messageId":"m"}\n\n'));
            controller.enqueue(enc.encode('event: delta\ndata: {"type":"delta","text":"hi"}\n\n'));
            controller.enqueue(enc.encode('event: done\ndata: {"type":"done","messageId":"m"}\n\n'));
            controller.close();
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const events: ChatStreamEvent[] = [];
    for await (const event of streamChatDeltas({ message: "hi", conversationId: "c0" })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "start", conversationId: "c9" },
      { type: "delta", text: "hi" },
      { type: "done" },
    ]);
  });

  it("streamChatDeltas throws PreStreamError on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 409 }))
    );
    await expect(async () => {
      for await (const _ of streamChatDeltas({ message: "hi" })) {
        void _;
      }
    }).rejects.toBeInstanceOf(PreStreamError);
  });
});
