// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/SettingsDialog";
import { getDefaultProviderTemplates } from "@/lib/providers";
import type { ProviderSummary } from "@/lib/types";

const templates = getDefaultProviderTemplates();

const saved: ProviderSummary = {
  id: "provider-1",
  name: "Local runtime",
  kind: "local",
  authMode: "local",
  baseUrl: "http://127.0.0.1:11434/v1",
  defaultModel: "llama",
  enabled: true,
  connected: true,
  priority: 0,
  secretPreview: null,
  note: null,
};

describe("SettingsDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
  });

  // CR-20260909-corner-menu: the trigger is 「模型」and the dialog holds only
  // provider settings — the theme toggle moved to the ☰ corner menu.
  it("stays closed until 模型 is pressed, then shows provider settings", () => {
    render(<SettingsDialog templates={templates} providers={[saved]} />);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(dialog.hasAttribute("open")).toBe(true);

    expect(screen.getByRole("heading", { name: "Model Providers" })).toBeInTheDocument();
    expect(screen.getByText("Local runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save provider" })).toBeInTheDocument();
    // No appearance section any more.
    expect(screen.queryByRole("group", { name: "外观主题" })).not.toBeInTheDocument();
  });

  it("does not introduce a second h1 or a nested main landmark", () => {
    const { container } = render(<SettingsDialog templates={templates} providers={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "模型" }));

    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelectorAll("main")).toHaveLength(0);
  });

  it("blocks provider settings with a named variable when storage is unconfigured", () => {
    render(
      <SettingsDialog
        templates={templates}
        providers={[]}
        storage={{ configured: false, missing: ["JARVIS_SECRET_KEY"] }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "模型" }));

    expect(screen.getByText("本地存储未配置，无法保存 Provider")).toBeInTheDocument();
    expect(screen.getByText("JARVIS_SECRET_KEY")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save provider" })).not.toBeInTheDocument();
  });

  it("shows provider settings when storage is configured", () => {
    render(<SettingsDialog templates={templates} providers={[saved]} storage={{ configured: true, missing: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "模型" }));

    expect(screen.getByRole("button", { name: "Save provider" })).toBeInTheDocument();
    expect(screen.queryByText(/本地存储未配置/)).not.toBeInTheDocument();
  });

  it("closes from the close button", () => {
    render(<SettingsDialog templates={templates} providers={[]} />);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    fireEvent.click(screen.getByRole("button", { name: "模型" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(dialog.hasAttribute("open")).toBe(false);
  });
});
