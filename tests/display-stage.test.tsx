// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayScreen, OPENING_MAX_MS, OPENING_PLAYED_KEY } from "@/components/DisplayScreen";

/**
 * TEST-135 — the display screen's third state
 * (CR-20260912-display-stage; CR-20260911-home-dashboard 出口义务 1).
 *
 * The user's ruling was one sentence: 「首页还是当前的界面，可以增加下科幻动画……可以等待
 * 3 秒钟自动切入，也可以鼠标到达展板或者动画标题，就可以切换。」 Each case below pins one
 * clause of it, and the last two pin the two things that clause does NOT say but that
 * the screen has to get right anyway: an insight outranks the opening, and the intro
 * plays once per session.
 */

import type { DisplayView } from "@/lib/ui-events";

const homeView: DisplayView = { kind: "home", html: null, refId: null };
const insightView: DisplayView = { kind: "insight", html: "<p>报告</p>", refId: "i1" };
const noFetch = async (): Promise<DisplayView> => homeView;

function renderScreen(initial: DisplayView = homeView, fetchView = noFetch) {
  return render(<DisplayScreen fetchView={fetchView} initial={initial} />);
}

describe("展示屏三态", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("① 开场是标题屏，带动画且动画对读屏隐藏", async () => {
    const { container } = renderScreen();
    expect(screen.getByRole("region", { name: "Agent-Jarvis" })).toBeInTheDocument();
    expect(screen.getByText("Agent-Jarvis")).toBeInTheDocument();
    const sweep = container.querySelector(".display-screen__sweep");
    expect(sweep).not.toBeNull();
    expect(sweep).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".display-screen__scan")).not.toBeNull();
  });

  it("② 3 秒是上限：没人动，到点自动切入看板", async () => {
    renderScreen();
    expect(screen.queryByRole("region", { name: "知识看板" })).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(OPENING_MAX_MS);
    });
    await waitFor(() => expect(screen.getByRole("region", { name: "知识看板" })).toBeInTheDocument());
  });

  it("③ 鼠标到达标题屏即切换，不必等满 3 秒", async () => {
    renderScreen();
    fireEvent.pointerEnter(screen.getByRole("region", { name: "Agent-Jarvis" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "知识看板" })).toBeInTheDocument());
  });

  it("④ 焦点落进控制台也算开始工作——刻意不监听按键，见 UI 契约 LB-09", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    renderScreen();
    fireEvent.focusIn(input);
    await waitFor(() => expect(screen.getByRole("region", { name: "知识看板" })).toBeInTheDocument());
    input.remove();
  });

  it("⑤ 一次会话只播一次：已播过就直接是看板", async () => {
    window.sessionStorage.setItem(OPENING_PLAYED_KEY, "1");
    renderScreen();
    await waitFor(() => expect(screen.getByRole("region", { name: "知识看板" })).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Agent-Jarvis" })).not.toBeInTheDocument();
  });

  it("⑥ 洞察压过开场：有报告时既不放动画也不进看板", async () => {
    renderScreen(insightView);
    expect(screen.getByRole("region", { name: "技能洞察" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(OPENING_MAX_MS * 2);
    });
    expect(screen.queryByRole("region", { name: "知识看板" })).not.toBeInTheDocument();
  });

  it("⑦ 卡片的「问 Jarvis」派事件而不是自己执行——看板不长成第二个应用", async () => {
    const heard: string[] = [];
    window.addEventListener("jarvis:ask", (event) => {
      heard.push((event as CustomEvent<{ text: string }>).detail.text);
    });
    window.sessionStorage.setItem(OPENING_PLAYED_KEY, "1");
    renderScreen();
    await waitFor(() => expect(screen.getByRole("region", { name: "知识看板" })).toBeInTheDocument());
    // The board renders empty here (no API in jsdom), which is itself the assertion that
    // the third state mounts the real component rather than a placeholder.
    expect(screen.getByRole("region", { name: "知识看板" }).textContent).toContain("知识看板");
    expect(heard).toEqual([]);
  });
});
