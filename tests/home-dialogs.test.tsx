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
  secretPreview: null,
  note: null,
};

describe("SettingsDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
  });

  it("stays closed until 配置 is pressed, then holds appearance and provider settings", () => {
    render(<SettingsDialog templates={templates} providers={[saved]} />);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "配置" }));
    expect(dialog.hasAttribute("open")).toBe(true);

    // Appearance section
    expect(screen.getByRole("group", { name: "外观主题" })).toBeInTheDocument();
    // Model provider section, reusing the existing ModelSettings component
    expect(screen.getByRole("heading", { name: "Model Providers" })).toBeInTheDocument();
    expect(screen.getByText("Local runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save provider" })).toBeInTheDocument();
  });

  it("does not introduce a second h1 or a nested main landmark", () => {
    const { container } = render(<SettingsDialog templates={templates} providers={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "配置" }));

    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelectorAll("main")).toHaveLength(0);
  });

  it("switches theme from inside the dialog", () => {
    render(<SettingsDialog templates={templates} providers={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "配置" }));
    fireEvent.click(screen.getByRole("button", { name: "深色" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("blocks provider settings with a named variable when storage is unconfigured", () => {
    render(
      <SettingsDialog
        templates={templates}
        providers={[]}
        storage={{ configured: false, missing: ["JARVIS_SECRET_KEY"] }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "配置" }));

    expect(screen.getByText("本地存储未配置，无法保存 Provider")).toBeInTheDocument();
    expect(screen.getByText("JARVIS_SECRET_KEY")).toBeInTheDocument();
    // The form is withheld rather than shown and doomed to fail on save.
    expect(screen.queryByRole("button", { name: "Save provider" })).not.toBeInTheDocument();
    // Appearance still works without storage.
    expect(screen.getByRole("group", { name: "外观主题" })).toBeInTheDocument();
  });

  it("shows provider settings when storage is configured", () => {
    render(<SettingsDialog templates={templates} providers={[saved]} storage={{ configured: true, missing: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "配置" }));

    expect(screen.getByRole("button", { name: "Save provider" })).toBeInTheDocument();
    expect(screen.queryByText(/本地存储未配置/)).not.toBeInTheDocument();
  });

  it("closes from the close button", () => {
    render(<SettingsDialog templates={templates} providers={[]} />);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    fireEvent.click(screen.getByRole("button", { name: "配置" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(dialog.hasAttribute("open")).toBe(false);
  });
});
