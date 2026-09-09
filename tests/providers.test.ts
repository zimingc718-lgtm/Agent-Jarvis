import { describe, expect, it } from "vitest";
import { getDefaultProviderTemplates, resolveProviderAction } from "@/lib/providers";

describe("provider configuration", () => {
  it("exposes OpenAI, DeepSeek, and local provider templates with correct auth modes", () => {
    const templates = getDefaultProviderTemplates();

    expect(templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "openai", authMode: "api_key" }),
        expect.objectContaining({ kind: "deepseek", authMode: "api_key", baseUrl: "https://api.deepseek.com" }),
        expect.objectContaining({ kind: "local", authMode: "local" })
      ])
    );
  });

  it("does not allow unsupported providers to connect", () => {
    expect(resolveProviderAction("unsupported")).toEqual({
      type: "blocked",
      message: "This provider does not expose an official supported connection method yet."
    });
  });
});
