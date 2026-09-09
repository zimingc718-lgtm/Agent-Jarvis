// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSettings } from "@/components/ModelSettings";
import { getDefaultProviderTemplates } from "@/lib/providers";
import type { ProviderSummary } from "@/lib/types";

const templates = getDefaultProviderTemplates();

function savedOpenAI(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: "provider-1",
    name: "OpenAI workspace",
    kind: "openai",
    authMode: "api_key",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    enabled: true,
    connected: true,
    priority: 0,
    secretPreview: "sk-s...cret",
    note: null,
    ...overrides,
  };
}

describe("ModelSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders provider templates and their authentication modes", () => {
    render(<ModelSettings templates={templates} providers={[]} />);

    expect(screen.getByRole("heading", { name: "OpenAI" })).toBeInTheDocument();
    expect(screen.getAllByText("API Key")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Local OpenAI-compatible" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save provider" })).toBeInTheDocument();
  });

  it("submits a new provider and never echoes the secret back", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/providers" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          name: "OpenAI workspace",
          kind: "openai",
          secret: "sk-secret",
        });
        return new Response(JSON.stringify({ id: "provider-1", created: true }), { status: 201 });
      }
      return new Response(JSON.stringify({ providers: [savedOpenAI()] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelSettings templates={templates} providers={[]} />);
    fireEvent.change(screen.getByLabelText("Provider name"), { target: { value: "OpenAI workspace" } });
    fireEvent.change(screen.getByLabelText("Secret / API key"), { target: { value: "sk-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await screen.findByText("Provider saved.");
    expect(await screen.findByText("sk-s...cret")).toBeInTheDocument();
    expect(screen.queryByText("sk-secret")).not.toBeInTheDocument();
  });

  it("edits an existing provider, sending its id and keeping the stored key when blank", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/providers" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({ id: "provider-1", name: "Renamed", secret: "" });
        return new Response(JSON.stringify({ id: "provider-1", created: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ providers: [savedOpenAI({ name: "Renamed" })] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelSettings templates={templates} providers={[savedOpenAI()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const nameField = screen.getByLabelText("Provider name") as HTMLInputElement;
    expect(nameField.value).toBe("OpenAI workspace");
    fireEvent.change(nameField, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Update provider" }));

    await screen.findByText("Provider updated.");
  });

  it("disables and deletes a saved provider through the id routes", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url) === "/api/providers") return new Response(JSON.stringify({ providers: [savedOpenAI()] }));
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelSettings templates={templates} providers={[savedOpenAI()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await screen.findByText("Provider updated.");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Provider deleted.");

    expect(calls).toContain("PATCH /api/providers/provider-1");
    expect(calls).toContain("DELETE /api/providers/provider-1");
  });

  // CR-20260909 — TASK-021 / TEST-025
  it("hides reorder controls with a single enabled provider", () => {
    render(<ModelSettings templates={templates} providers={[savedOpenAI({ id: "p1", name: "Primary" })]} />);
    expect(screen.queryByRole("button", { name: "Raise Primary priority" })).not.toBeInTheDocument();
  });

  it("reorders priority via PATCH { direction } when more than one provider is enabled", async () => {
    const one = savedOpenAI({ id: "p1", name: "Primary", priority: 0 });
    const two = savedOpenAI({ id: "p2", name: "Backup", priority: 1 });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)} ${String(init?.body ?? "")}`);
        if (String(url) === "/api/providers") return new Response(JSON.stringify({ providers: [one, two] }));
        return new Response(JSON.stringify({ ok: true }));
      })
    );

    render(<ModelSettings templates={templates} providers={[one, two]} />);
    fireEvent.click(screen.getByRole("button", { name: "Lower Primary priority" }));
    await screen.findByText("Priority updated.");
    expect(calls.some((c) => c.startsWith("PATCH /api/providers/p1") && c.includes('"direction":"down"'))).toBe(true);
  });

  it("shows the provider connectivity result from the test endpoint", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/providers/test") {
        return new Response(JSON.stringify({ ok: false, message: "Authentication failed — check the API key." }));
      }
      return new Response(JSON.stringify({ providers: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelSettings templates={templates} providers={[]} />);
    fireEvent.change(screen.getByLabelText("Secret / API key"), { target: { value: "bad-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await screen.findByText("Authentication failed — check the API key.");
  });

  it("surfaces the decrypt-failure note for a saved provider", () => {
    render(<ModelSettings templates={templates} providers={[savedOpenAI({ connected: false, note: "缺少 API Key。" })]} />);
    expect(screen.getByText("缺少 API Key。")).toBeInTheDocument();
  });
});
