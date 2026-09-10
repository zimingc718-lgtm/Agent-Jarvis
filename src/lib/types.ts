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
  /** Lower runs first. Rows are returned already sorted by this (CR-20260909). */
  priority: number;
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
  | { type: "done"; messageId: string }
  // CR-20260909: skill-turn tail events, emitted after the reply is persisted.
  | { type: "insight"; insightId: string }
  | { type: "insight-missing"; reason: "none" | "incomplete" }
  | { type: "display"; kind: "home" };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderTestResult = {
  ok: boolean;
  message: string;
};
