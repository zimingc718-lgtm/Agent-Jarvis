import type { ProviderAuthMode, ProviderKind } from "./types";

export type ProviderTemplate = {
  kind: ProviderKind;
  name: string;
  authMode: ProviderAuthMode;
  baseUrl: string | null;
  defaultModel: string;
};

export type ProviderAction =
  | { type: "oauth_redirect" }
  | { type: "credential_form" }
  | { type: "local_form" }
  | { type: "blocked"; message: string };

export function getDefaultProviderTemplates(): ProviderTemplate[] {
  return [
    {
      kind: "openai",
      name: "OpenAI",
      authMode: "api_key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5"
    },
    {
      kind: "deepseek",
      name: "DeepSeek",
      authMode: "api_key",
      baseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-chat"
    },
    {
      kind: "local",
      name: "Local OpenAI-compatible",
      authMode: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "local-model"
    }
  ];
}

export function resolveProviderAction(authMode: ProviderAuthMode): ProviderAction {
  if (authMode === "oauth") {
    return { type: "oauth_redirect" };
  }
  if (authMode === "api_key") {
    return { type: "credential_form" };
  }
  if (authMode === "local") {
    return { type: "local_form" };
  }
  return {
    type: "blocked",
    message: "This provider does not expose an official supported connection method yet."
  };
}
