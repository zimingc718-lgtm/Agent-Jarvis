// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingChat, streamChatDeltas, type ChatStreamEvent, type ChatStreamRequest } from "@/components/FloatingChat";

const connected = [
  { id: "local", name: "Local", defaultModel: "llama", connected: true },
  { id: "openai", name: "OpenAI", defaultModel: "gpt-5", connected: true },
];

describe("FloatingChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a bottom input by default and expands after sending", async () => {
    render(
      <FloatingChat
        providers={[connected[0]]}
        onStream={async function* () {
          yield { type: "start", conversationId: "c1" };
          yield { type: "delta", text: "hello" };
          yield { type: "done" };
        }}
      />
    );

    expect(screen.getByPlaceholderText("Ask Agent-Jarvis")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Ask Agent-Jarvis"), { target: { value: "hi" } });
    fireEvent.submit(screen.getByPlaceholderText("Ask Agent-Jarvis").closest("form")!);

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(await screen.findByText("Complete")).toBeInTheDocument();
  });

  it("keeps separate assistant bubbles across turns and reuses the conversation id", async () => {
    const requests: ChatStreamRequest[] = [];
    async function* onStream(request: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
      requests.push(request);
      yield { type: "start", conversationId: "conv-1" };
      yield { type: "delta", text: request.message === "one" ? "first-answer" : "second-answer" };
      yield { type: "done" };
    }

    render(<FloatingChat providers={[connected[0]]} onStream={onStream} />);
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");

    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("first-answer");

    fireEvent.change(input, { target: { value: "two" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("second-answer");

    // First answer is still its own bubble, not overwritten or appended to.
    expect(screen.getByText("first-answer")).toBeInTheDocument();
    expect(requests[1].conversationId).toBe("conv-1");
  });

  it("renders a provider switcher when more than one provider is connected and sends the selection", async () => {
    const requests: ChatStreamRequest[] = [];
    render(
      <FloatingChat
        providers={connected}
        onStream={async function* (request) {
          requests.push(request);
          yield { type: "start", conversationId: "c" };
          yield { type: "done" };
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("Model provider"), { target: { value: "openai" } });
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ providerId: "openai", model: "gpt-5" });
  });

  it("aborts the in-flight request when Stop is pressed", async () => {
    let aborted = false;
    async function* onStream(request: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
      request.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      yield { type: "start", conversationId: "c" };
      yield { type: "delta", text: "partial" };
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { type: "delta", text: " more" };
    }

    render(<FloatingChat providers={[connected[0]]} onStream={onStream} />);
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    const stop = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stop);

    await waitFor(() => expect(aborted).toBe(true));
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("hydrates from a restored conversation", () => {
    render(
      <FloatingChat
        providers={[connected[0]]}
        initialConversationId="conv-9"
        initialMessages={[
          { id: "m1", role: "user", content: "earlier question", status: "complete" },
          { id: "m2", role: "assistant", content: "earlier answer", status: "complete" },
        ]}
        onStream={async function* () {}}
      />
    );

    expect(screen.getByText("earlier question")).toBeInTheDocument();
    expect(screen.getByText("earlier answer")).toBeInTheDocument();
    expect(screen.getByText("Restored")).toBeInTheDocument();
  });

  it("shows a model setup action when no provider is connected", () => {
    render(<FloatingChat providers={[]} onStream={async function* () {}} />);
    expect(screen.getByText("No model connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open model settings" })).toHaveAttribute("href", "/settings/models");
  });

  it("streamChatDeltas parses SSE frames into structured events", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ message: "hi", providerId: "local", conversationId: "c0" });
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
    for await (const event of streamChatDeltas({ message: "hi", providerId: "local", conversationId: "c0" })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "start", conversationId: "c9" },
      { type: "delta", text: "hi" },
      { type: "done" },
    ]);
  });
});
