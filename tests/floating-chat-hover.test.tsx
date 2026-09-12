// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_HIDE_DELAY_MS, FloatingChat, type FloatingMessage } from "@/components/FloatingChat";

/**
 * TEST-095 — the hover tuck-away (REQ-F-054 ①..⑨, REQ-F-019 ②④⑥; DEC-032 ⑦; TASK-092).
 * CR-20260911-display-console-ux.
 *
 * Fake timers drive the 400ms delay; `matchMedia` is stubbed to say whether the device
 * can hover. The transcript must stay in the DOM while auto-hidden (that is what allows
 * the transition) and must leave the DOM only for the user's own collapse.
 */

const readyProbe = () => Promise.resolve(true);
const neverWake = () => Promise.resolve({ enabled: false, intervalMinutes: 30 });
const seed: FloatingMessage[] = [
  { id: "u1", role: "user", content: "hi" },
  { id: "a1", role: "assistant", content: "hello there" },
];

function stubHover(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("hover") ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
}

function transcript(): HTMLElement | null {
  return document.querySelector(".floating-chat__messages");
}

function isHidden(): boolean {
  const el = transcript();
  return Boolean(el && el.classList.contains("floating-chat__messages--hidden") && el.getAttribute("aria-hidden") === "true");
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderChat() {
  return render(
    <FloatingChat
      hasEnabledProvider
      probeProviders={readyProbe}
      loadWake={neverWake}
      initialConversationId="c1"
      initialMessages={seed}
      onStream={async function* () {
        yield { type: "start", conversationId: "c1", messageId: "m" };
        yield { type: "delta", text: "reply" };
        yield { type: "done", messageId: "m" };
      }}
    />
  );
}

describe("TEST-095 对话面板悬停态 (REQ-F-054)", () => {
  it("① 指针离开后 399ms 仍可见、400ms 隐藏；记录区仍在 DOM", () => {
    stubHover(true);
    renderChat();
    const section = screen.getByLabelText("Agent-Jarvis chat");
    expect(transcript()).not.toBeNull();
    expect(isHidden()).toBe(false);

    fireEvent.pointerLeave(section);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS - 1));
    expect(isHidden()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(isHidden()).toBe(true);
    expect(transcript()).not.toBeNull();
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });

  it("② 隐藏后指针进入 / 输入框获焦 / 按键各自立即恢复", () => {
    stubHover(true);
    renderChat();
    const section = screen.getByLabelText("Agent-Jarvis chat");
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");

    const hide = () => {
      fireEvent.pointerLeave(section);
      act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
      expect(isHidden()).toBe(true);
    };

    hide();
    fireEvent.pointerEnter(section);
    expect(isHidden()).toBe(false);

    hide();
    fireEvent.focus(input);
    expect(isHidden()).toBe(false);

    hide();
    fireEvent.keyDown(input, { key: "a" });
    expect(isHidden()).toBe(false);
  });

  it("离开后在延迟内回来 → 不隐藏（定时器被取消）", () => {
    stubHover(true);
    renderChat();
    const section = screen.getByLabelText("Agent-Jarvis chat");
    fireEvent.pointerLeave(section);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS / 2));
    fireEvent.pointerEnter(section);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(isHidden()).toBe(false);
  });

  it("③ 流式进行中离开不隐藏", async () => {
    stubHover(true);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(
      <FloatingChat
        hasEnabledProvider
        probeProviders={readyProbe}
        loadWake={neverWake}
        initialConversationId="c1"
        initialMessages={seed}
        onStream={async function* () {
          yield { type: "start", conversationId: "c1", messageId: "m" };
          yield { type: "delta", text: "partial" };
          await gate;
          yield { type: "done", messageId: "m" };
        }}
      />
    );
    const section = screen.getByLabelText("Agent-Jarvis chat");
    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "go" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();

    fireEvent.pointerLeave(section);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 2));
    expect(isHidden()).toBe(false);
    await act(async () => {
      release();
    });
  });

  it("④ 用户手动收起时：记录区不在 DOM，指针进入也不展开", () => {
    stubHover(true);
    localStorage.setItem("jarvis:chat-collapsed", "1");
    renderChat();
    const section = screen.getByLabelText("Agent-Jarvis chat");
    expect(transcript()).toBeNull();
    fireEvent.pointerEnter(section);
    expect(transcript()).toBeNull();
    // And leaving does nothing either — nothing to hide.
    fireEvent.pointerLeave(section);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(transcript()).toBeNull();
  });

  it("⑤ 无 hover 能力（触屏）时离开无效果", () => {
    stubHover(false);
    renderChat();
    const section = screen.getByLabelText("Agent-Jarvis chat");
    fireEvent.pointerLeave(section);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 2));
    expect(isHidden()).toBe(false);
  });

  it("⑥ 全程不写 localStorage 折叠偏好；⑦ 发送消息复位隐藏", async () => {
    stubHover(true);
    renderChat();
    const section = screen.getByLabelText("Agent-Jarvis chat");
    fireEvent.pointerLeave(section);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(isHidden()).toBe(true);
    expect(localStorage.getItem("jarvis:chat-collapsed")).toBeNull();
    // The manual control still reads "expanded": auto-hide is not the user's preference.
    expect(screen.getByRole("button", { name: "收起对话" })).toHaveAttribute("aria-expanded", "true");

    const input = screen.getByPlaceholderText("Ask Agent-Jarvis");
    fireEvent.change(input, { target: { value: "next" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(isHidden()).toBe(false);
    expect(localStorage.getItem("jarvis:chat-collapsed")).toBeNull();
  });
});
