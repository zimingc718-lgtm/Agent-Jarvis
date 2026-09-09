// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountDialog } from "@/components/AccountDialog";
import { CornerMenu } from "@/components/CornerMenu";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getDefaultProviderTemplates } from "@/lib/providers";

const templates = getDefaultProviderTemplates();

function Harness() {
  return (
    <CornerMenu>
      <ThemeToggle />
      <SettingsDialog templates={templates} providers={[]} />
      <AccountDialog authenticated={false} googleOAuth={{ configured: true, missing: [] }} />
    </CornerMenu>
  );
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom always has it */
  }
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

// CR-20260909-corner-menu — REQ-F-015 / TEST-032
describe("CornerMenu", () => {
  it("keeps its items out of the DOM until the ☰ trigger is pressed (TEST-032 ①②③)", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开菜单" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Closed: menu items are not mounted.
    expect(screen.queryByRole("button", { name: "模型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "账号登录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "外观主题" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "关闭菜单" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Agent-Jarvis 菜单" })).toBeInTheDocument();
    // Inline theme toggle + two launchers.
    expect(screen.getByRole("group", { name: "外观主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模型" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "账号登录" })).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger (TEST-032 ②)", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开菜单" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "打开菜单" }));
  });

  it("closes on a click outside the menu (TEST-032 ②)", () => {
    render(
      <div>
        <button type="button">elsewhere</button>
        <Harness />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "打开菜单" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("switches theme inline without opening any dialog (TEST-032 ④)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "打开菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "深色" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("jarvis-theme")).toBe("dark");
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("launches the 模型 and 账号登录 dialogs from the menu (TEST-032 ⑥)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "打开菜单" }));

    fireEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(screen.getByRole("heading", { name: "Model Providers" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "账号登录" }));
    expect(screen.getByText("尚未登录 Agent-Jarvis。")).toBeInTheDocument();
  });
});
