// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyDrop,
  describeExcluded,
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
    localStorage.clear();
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
          yield { type: "start", conversationId: "c1", messageId: "m" };
          yield { type: "delta", text: "hello" };
          yield { type: "done", messageId: "m" };
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
          yield { type: "start", conversationId: "c", messageId: "m" };
          yield { type: "done", messageId: "m" };
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
      yield { type: "start", conversationId: "conv-1", messageId: "m" };
      yield { type: "delta", text: request.message === "one" ? "first-answer" : "second-answer" };
      yield { type: "done", messageId: "m" };
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
      yield { type: "start", conversationId: "conv-A", messageId: "m" };
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
      yield { type: "start", conversationId: "conv-9", messageId: "m" };
      yield { type: "delta", text: "answer-text" };
      yield { type: "done", messageId: "m" };
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
          throw new PreStreamError("没有可用的模型 Provider。请在「模型」中启用一个并通过连接测试。");
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
          yield { type: "start", conversationId: "c", messageId: "m" };
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
          yield { type: "start", conversationId: "c", messageId: "m" };
          await new Promise((r) => setTimeout(r, 30));
          yield { type: "done", messageId: "m" };
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

  it("light is 'off' when the probe reports nothing connected", async () => {
    const { container } = render(
      <FloatingChat hasEnabledProvider={false} probeProviders={() => Promise.resolve(false)} onStream={async function* () {}} />
    );
    const light = () => container.querySelector(".floating-chat__light")!;
    expect(light().className).toContain("floating-chat__light--off");
    await waitFor(() => expect(light().className).toContain("floating-chat__light--off"));
  });

  it("re-probes when providers change (jarvis:providers-changed)", async () => {
    let connected = false;
    const { container } = render(
      <FloatingChat
        hasEnabledProvider={false}
        probeProviders={() => Promise.resolve(connected)}
        onStream={async function* () {}}
      />
    );
    const light = () => container.querySelector(".floating-chat__light")!;
    await waitFor(() => expect(light().className).toContain("floating-chat__light--off"));

    connected = true;
    window.dispatchEvent(new Event("jarvis:providers-changed"));
    await waitFor(() => expect(light().className).toContain("floating-chat__light--ready"));
  });

  // CR-20260909-collapsible-panel — REQ-F-019 / TEST-031
  describe("collapse panel", () => {
    async function* answer(): AsyncIterable<ChatStreamEvent> {
      yield { type: "start", conversationId: "conv-c", messageId: "m" };
      yield { type: "delta", text: "the answer" };
      yield { type: "done", messageId: "m" };
    }

    it("shows the collapse control only once a transcript exists (TEST-031 ①)", async () => {
      render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} onStream={answer} />);
      expect(screen.queryByRole("button", { name: /收起对话|展开对话/ })).not.toBeInTheDocument();

      const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
      fireEvent.change(input, { target: { value: "q" } });
      fireEvent.submit(input.closest("form")!);
      await screen.findByText("the answer");
      expect(screen.getByRole("button", { name: "收起对话" })).toBeInTheDocument();
    });

    it("collapsing hides the transcript but keeps the conversation (TEST-031 ②③)", async () => {
      const requests: ChatStreamRequest[] = [];
      async function* onStream(r: ChatStreamRequest) {
        requests.push(r);
        yield { type: "start", conversationId: "conv-keep", messageId: "m" } as ChatStreamEvent;
        yield { type: "delta", text: "kept answer" } as ChatStreamEvent;
        yield { type: "done" } as ChatStreamEvent;
      }
      const { container } = render(
        <FloatingChat hasEnabledProvider probeProviders={readyProbe} onStream={onStream} />
      );
      const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
      fireEvent.change(input, { target: { value: "one" } });
      fireEvent.submit(input.closest("form")!);
      await screen.findByText("kept answer");

      fireEvent.click(screen.getByRole("button", { name: "收起对话" }));
      expect(container.querySelector(".floating-chat__messages")).toBeNull();
      expect(screen.queryByText("kept answer")).not.toBeInTheDocument();
      expect(sessionStorage.getItem("jarvis:chat-session-ended")).toBeNull();
      expect(localStorage.getItem("jarvis:chat-collapsed")).toBe("1");

      // Expand restores the same messages.
      fireEvent.click(screen.getByRole("button", { name: "展开对话" }));
      expect(screen.getByText("kept answer")).toBeInTheDocument();

      // Collapse again, then send: reuses conv-keep (session never ended).
      fireEvent.click(screen.getByRole("button", { name: "收起对话" }));
      fireEvent.change(input, { target: { value: "two" } });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1].conversationId).toBe("conv-keep");
    });

    it("stays collapsed while streaming, then pulses 'done' and settles (TEST-031 ④)", async () => {
      vi.useFakeTimers();
      try {
        let release: () => void = () => {};
        async function* slow(): AsyncIterable<ChatStreamEvent> {
          yield { type: "start", conversationId: "c", messageId: "m" };
          yield { type: "delta", text: "partial" };
          await new Promise<void>((r) => (release = r));
          yield { type: "done", messageId: "m" };
        }
        const { container } = render(
          <FloatingChat hasEnabledProvider probeProviders={readyProbe} onStream={slow} />
        );
        const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
        fireEvent.change(input, { target: { value: "q" } });
        fireEvent.submit(input.closest("form")!);
        await vi.waitFor(() => expect(screen.getByText("partial")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "收起对话" }));
        const light = () => container.querySelector(".floating-chat__light")!;
        expect(light().className).toContain("floating-chat__light--busy");
        expect(container.querySelector(".floating-chat__messages")).toBeNull();

        release();
        await vi.waitFor(() => expect(light().className).toContain("floating-chat__light--done"));
        vi.advanceTimersByTime(1300);
        await vi.waitFor(() => expect(light().className).toContain("floating-chat__light--ready"));
      } finally {
        vi.useRealTimers();
      }
    });

    it("sending while collapsed auto-expands and clears the stored preference (TEST-031 ⑤)", async () => {
      localStorage.setItem("jarvis:chat-collapsed", "1");
      const { container } = render(
        <FloatingChat
          hasEnabledProvider
          probeProviders={readyProbe}
          initialConversationId="conv-r"
          initialMessages={[{ id: "m1", role: "assistant", content: "old", status: "complete" }]}
          onStream={answer}
        />
      );
      // Restored but collapsed -> transcript hidden.
      expect(container.querySelector(".floating-chat__messages")).toBeNull();

      const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
      fireEvent.change(input, { target: { value: "hi" } });
      fireEvent.submit(input.closest("form")!);
      await screen.findByText("the answer");
      expect(container.querySelector(".floating-chat__messages")).not.toBeNull();
      expect(localStorage.getItem("jarvis:chat-collapsed")).toBeNull();
    });

    it("honours the stored collapse preference across a remount, with no empty middle state (TEST-031 ⑥⑦)", async () => {
      const { unmount, container } = render(
        <FloatingChat hasEnabledProvider probeProviders={readyProbe} onStream={answer} />
      );
      const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
      fireEvent.change(input, { target: { value: "q" } });
      fireEvent.submit(input.closest("form")!);
      await screen.findByText("the answer");
      fireEvent.click(screen.getByRole("button", { name: "收起对话" }));
      expect(localStorage.getItem("jarvis:chat-collapsed")).toBe("1");
      unmount();

      // Remount with a restored conversation: preference = collapsed -> transcript hidden.
      const remount = render(
        <FloatingChat
          hasEnabledProvider
          probeProviders={readyProbe}
          initialConversationId="conv-c"
          initialMessages={[{ id: "m1", role: "assistant", content: "the answer", status: "complete" }]}
          onStream={answer}
        />
      );
      expect(remount.container.querySelector(".floating-chat__messages")).toBeNull();
      expect(screen.getByRole("button", { name: "展开对话" })).toBeInTheDocument();
      remount.unmount();

      // Preference = collapsed but NO transcript -> control hidden, just the input bar.
      localStorage.setItem("jarvis:chat-collapsed", "1");
      const bare = render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} onStream={answer} />);
      expect(bare.container.querySelector(".floating-chat__messages")).toBeNull();
      expect(screen.queryByRole("button", { name: /收起对话|展开对话/ })).not.toBeInTheDocument();
      void container;
    });
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
    // CP-40: the parser passes the server's `ChatDelta` through verbatim instead of
    // re-shaping each type against a local allow-list — the old allow-list silently
    // dropped any event the client had not been taught about.
    expect(events).toEqual([
      { type: "start", conversationId: "c9", messageId: "m" },
      { type: "delta", text: "hi" },
      { type: "done", messageId: "m" },
    ]);
  });

  it("CP-40: 服务端新增的事件类型无需改白名单即可透传", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              controller.enqueue(
                enc.encode('event: tool_call\ndata: {"type":"tool_call","callId":"c1","name":"web_search","argsSummary":"{}"}\n\n')
              );
              controller.close();
            },
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const events: ChatStreamEvent[] = [];
    for await (const event of streamChatDeltas({ message: "hi" })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "tool_call", callId: "c1", name: "web_search", argsSummary: "{}" }]);
    vi.unstubAllGlobals();
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
  // CR-20260910-skill-intake — TEST-044: skill intake has three entry points and
  // every outcome, including refusal, is visible.
  describe("skill intake (TEST-044)", () => {
    function dataTransferWith(items: Array<{ dir?: string; file?: File }>): DataTransfer {
      return {
        types: ["Files"],
        items: items.map((item) => ({
          kind: "file",
          webkitGetAsEntry: () => (item.dir ? { isDirectory: true, isFile: false, name: item.dir } : null),
          getAsFile: () => item.file ?? null,
        })),
      } as unknown as DataTransfer;
    }

    it("① a drop that is neither a folder nor a zip is refused OUT LOUD, and the browser default is stopped", async () => {
      render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} />);
      const panel = screen.getByLabelText("Agent-Jarvis chat");

      const dataTransfer = dataTransferWith([{ file: new File(["x"], "notes.pdf") }]);
      // fireEvent reports whether preventDefault was called: it returns false when it was.
      const notPrevented = fireEvent.drop(panel, { dataTransfer });
      expect(notPrevented).toBe(false); // ← the P6 root cause: the browser used to take over

      await waitFor(() =>
        expect(screen.getByText(/只能接收技能文件夹或 zip 压缩包/)).toBeInTheDocument()
      );
      expect(screen.getByText(/notes\.pdf/)).toBeInTheDocument();
    });

    it("② dropping a zip posts it to /api/skills as `archive`", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ name: "reporter", description: "d", docGenerated: true }), { status: 201 })
      );
      vi.stubGlobal("fetch", fetchMock);
      render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} />);
      const panel = screen.getByLabelText("Agent-Jarvis chat");

      const zip = new File([new Uint8Array([1, 2, 3])], "reporter.zip", { type: "application/zip" });
      fireEvent.drop(panel, { dataTransfer: dataTransferWith([{ file: zip }]) });

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/skills");
      expect((init.body as FormData).get("archive")).toBeInstanceOf(File);
      await waitFor(() => expect(screen.getByText(/已注册技能：reporter/)).toBeInTheDocument());
    });

    it("③ picking a zip through the upload button takes the same submit path", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ name: "picked", description: "d", docGenerated: true }), { status: 201 })
      );
      vi.stubGlobal("fetch", fetchMock);
      render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} />);

      expect(screen.getByRole("button", { name: "上传文件夹" })).toBeInTheDocument();
      const input = screen.getByLabelText("选择技能 zip 压缩包");
      fireEvent.change(input, { target: { files: [new File(["z"], "picked.zip")] } });

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.body as FormData).get("archive")).toBeInstanceOf(File);
      // ⑤ Same receipt wording as the drop path — one shared submit implementation.
      await waitFor(() => expect(screen.getByText(/已注册技能：picked/)).toBeInTheDocument());
    });

    it("④ a registration receipt that excludes files says so", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                name: "s",
                description: "d",
                docGenerated: true,
                excluded: [{ path: "logo.png", reason: "binary" }],
              }),
              { status: 201 }
            )
        )
      );
      render(<FloatingChat hasEnabledProvider probeProviders={readyProbe} />);
      const input = screen.getByLabelText("选择技能 zip 压缩包");
      fireEvent.change(input, { target: { files: [new File(["z"], "s.zip")] } });

      await waitFor(() => expect(screen.getByText(/未纳入技能内容/)).toBeInTheDocument());
      expect(screen.getByText(/logo\.png（二进制文件）/)).toBeInTheDocument();
    });

    it("classifyDrop distinguishes folder / zip / neither", () => {
      expect(classifyDrop(dataTransferWith([{ dir: "skill" }]))).toMatchObject({ kind: "folder", name: "skill" });
      expect(classifyDrop(dataTransferWith([{ file: new File(["z"], "a.zip") }]))).toMatchObject({ kind: "archive" });
      expect(classifyDrop(dataTransferWith([{ file: new File(["z"], "a.pdf") }]))).toMatchObject({ kind: "none" });
      expect(classifyDrop(dataTransferWith([{ dir: "a" }, { dir: "b" }]))).toMatchObject({ kind: "none" });
    });

    it("describeExcluded names the reason and folds a long list", () => {
      expect(describeExcluded([{ path: "a.rs", reason: "not-injected" }])).toContain("不进入对话上下文");
      const many = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}`, reason: "binary" }));
      expect(describeExcluded(many)).toContain("等 7 个文件");
    });
  });

  // CR-20260910-skill-intake — TEST-046 ④⑤: which skill a turn used.
  // REVERSED by CR-20260910-agent-tooling (CP-9): the `skill` tail event is gone —
  // "which skill did this turn use" is now visible as a `read_skill` row in the step
  // stream, where it sits alongside every other tool the turn ran (REQ-F-035 ⑥).
  it("REQ-F-035 ①②: 工具调用出步骤行，结果到达后更新状态并可展开", async () => {
    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={readyProbe}
        onStream={async function* () {
          yield { type: "start", conversationId: "c1", messageId: "m1" };
          yield { type: "tool_call", callId: "t1", name: "read_skill", argsSummary: '{"name":"reporter"}' };
          yield { type: "tool_result", callId: "t1", ok: true, summary: "读取技能 reporter" };
          yield { type: "delta", text: "answer" };
          yield { type: "done", messageId: "m1" };
        }}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Ask Agent-Jarvis"), { target: { value: "go" } });
    fireEvent.submit(screen.getByRole("button", { name: "发送" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("read_skill")).toBeInTheDocument());
    const row = document.querySelector(".floating-chat__step");
    expect(row?.getAttribute("data-state")).toBe("ok");

    // Detail is collapsed until asked for, so a 10-step turn cannot bury the reply.
    const toggle = screen.getByRole("button", { name: /展开 read_skill 的结果/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("读取技能 reporter")).toBeInTheDocument());

    // The superseded per-turn notice must not come back.
    expect(screen.queryByText(/本轮使用技能/)).not.toBeInTheDocument();
  });
});
