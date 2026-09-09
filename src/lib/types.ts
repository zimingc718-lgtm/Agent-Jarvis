export type ProviderAuthMode = "oauth" | "api_key" | "local" | "unsupported";
export type ProviderKind = "openai" | "deepseek" | "local";

export type ProviderSummary = {
  id: string;
  name: string;
  kind: ProviderKind;
  authMode: ProviderAuthMode;
  baseUrl: string | null;
  defaultModel: string;
  enabled: boolean;
  connected: boolean;
  secretPreview: string | null;
  /** Human-readable reason the provider is not usable, or null when it is fine. */
  note: string | null;
};

export type ProviderRuntimeConfig = {
  id: string;
  name: string;
  kind: ProviderKind;
  authMode: ProviderAuthMode;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  secret: string | null;
};

export type ChatDelta =
  | { type: "start"; conversationId: string; messageId: string }
  | { type: "delta"; text: string }
  | { type: "stopped" }
  | { type: "error"; message: string }
  | { type: "done"; messageId: string };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderTestResult = {
  ok: boolean;
  message: string;
};
