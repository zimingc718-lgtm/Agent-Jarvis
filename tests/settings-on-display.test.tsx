// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisplayScreen } from "@/components/DisplayScreen";
import { ToolPanel, type ToolPanelValue } from "@/components/ToolPanel";
import { SETTINGS_PANEL_EVENT, type DisplayView } from "@/lib/ui-events";

/**
 * TEST-330 — 设置类界面在动态屏上（REQ-F-200，DEC-240；用户 2026-09-13 决策 3）。
 *
 * 用户原话：「支持会话框调出菜单内嵌表单，如模型，技能，工具等在动态屏」。这里守三件事：
 * 面板真的出现在展示屏上（不是弹窗）、能退回去、以及**未注册的工具也要列出来**——
 * 「没注册」和「不存在」对用户是两件事，而这正是本轮几个缺陷的共同形状。
 */

const board: DisplayView = { kind: "home", refId: null, html: null };

function openPanel(panel: string | null) {
  act(() => {
    window.dispatchEvent(new CustomEvent(SETTINGS_PANEL_EVENT, { detail: { panel } }));
  });
}

describe("展示屏上的设置面板 (REQ-F-200 ①②)", () => {
  it("① 对话框唤起「工具」→ 面板出现在展示屏上", async () => {
    render(<DisplayScreen initial={board} fetchView={async () => board} />);
    openPanel("tools");
    await waitFor(() => expect(screen.getByRole("region", { name: "工具设置" })).toBeInTheDocument());
  });

  it("② 「返回」退回原来的屏，不残留面板", async () => {
    render(<DisplayScreen initial={board} fetchView={async () => board} />);
    openPanel("tools");
    await waitFor(() => expect(screen.getByRole("region", { name: "工具设置" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /返回/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "工具设置" })).not.toBeInTheDocument());
  });

  it("③ panel=null 也退回——对话框可以关掉它，不必只靠按钮", async () => {
    render(<DisplayScreen initial={board} fetchView={async () => board} />);
    openPanel("skills");
    await waitFor(() => expect(screen.getByRole("region", { name: "技能设置" })).toBeInTheDocument());
    openPanel(null);
    await waitFor(() => expect(screen.queryByRole("region", { name: "技能设置" })).not.toBeInTheDocument());
  });

  it("④ 没拿到 Provider 模板时明说打不开，而不是画一个存不了的空表单", async () => {
    render(<DisplayScreen initial={board} fetchView={async () => board} />);
    openPanel("models");
    await waitFor(() => expect(screen.getByText(/模型设置暂时打不开/)).toBeInTheDocument());
  });

  it("⑤ 设置面板同样给控制台让出底部，不被它盖住", async () => {
    const { container } = render(<DisplayScreen initial={board} fetchView={async () => board} />);
    openPanel("tools");
    await waitFor(() => expect(container.querySelector(".display-screen--settings")).toBeTruthy());
    const pane = container.querySelector(".display-screen--settings") as HTMLElement;
    expect(pane.style.bottom).toBe("var(--jarvis-console-h, 0px)");
  });
});

describe("工具面板 (REQ-F-200 ③)", () => {
  const value: ToolPanelValue = {
    tools: [
      { name: "search_knowledge", description: "检索本地知识库。", priority: 1, registered: true },
      { name: "web_search", description: "联网搜索。", priority: 2, registered: false },
    ],
    context: {
      skillCount: 2,
      webEnabled: false,
      searchConfigured: false,
      knowledgeCount: 7,
      contextWindow: 128_000,
      providerName: "MockRuntime",
    },
  };

  it("⑥ 未注册的工具也列出来并标明——「没注册」和「不存在」是两件事", async () => {
    render(<ToolPanel load={async () => value} />);
    await waitFor(() => expect(screen.getByText("search_knowledge")).toBeInTheDocument());
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "未注册的工具" })).toBeInTheDocument();
    // 一个把未注册项过滤掉的实现照样能让上面两条通过，所以要断言它落在「未注册」那一组里。
    const idle = screen.getByRole("region", { name: "未注册的工具" });
    expect(idle.textContent).toContain("web_search");
    expect(idle.textContent).not.toContain("search_knowledge");
  });

  it("⑦ 摘要行说清此刻的条件——工具为什么这样注册，答案就在这一行里", async () => {
    render(<ToolPanel load={async () => value} />);
    await waitFor(() => expect(screen.getByText(/本轮可调用 1 个，未注册 1 个/)).toBeInTheDocument());
    expect(screen.getByText(/联网已关/)).toBeInTheDocument();
    expect(screen.getByText(/MockRuntime/)).toBeInTheDocument();
  });

  it("⑧ 读不到时说人话，而不是空白一片", async () => {
    render(
      <ToolPanel
        load={async () => {
          throw new Error("boom");
        }}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("读不到工具清单"));
  });
});
