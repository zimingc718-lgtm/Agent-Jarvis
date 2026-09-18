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
  /** Per-model tool-calling capability (REQ-F-040 ①). Absent model = not yet probed. */
  toolSupport?: Record<string, "yes" | "no"> | null;
  /** Context window in tokens; null falls back to the per-kind default (DEC-026 ⑤). */
  contextWindow?: number | null;
};

/** One tool invocation requested by the model (DEC-024 ①, OpenAI wire shape). */
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** A cited source, produced server-side from this turn's tool results (REQ-F-039). */
export type Source = { url: string; title: string };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** True when the numbers came from local estimation, not the provider (REQ-F-037 ④). */
  estimated: boolean;
};

export type ChatDelta =
  | { type: "start"; conversationId: string; messageId: string }
  | { type: "delta"; text: string }
  | { type: "stopped" }
  | { type: "error"; message: string }
  | { type: "done"; messageId: string }
  // CR-20260909: skill-turn tail events, emitted after the reply is persisted.
  | { type: "insight"; insightId: string }
  // CR-20260910-agent-tooling (REQ-F-035 ③): the step stream. `tool_call` opens a step
  // row, `tool_result` closes it. Emitted mid-loop, not as a tail event.
  // REQ-F-051 ② (CR-20260911-display-console-ux): `truncated` marks a call whose
  // arguments were cut by the provider's output limit (`finish_reason: "length"`);
  // `argsLength` is how many characters arrived. The loop refuses to run such a call.
  | { type: "tool_call"; callId: string; name: string; argsSummary: string; truncated?: boolean; argsLength?: number }
  | { type: "tool_result"; callId: string; ok: boolean; summary: string }
  // REQ-F-039: sources travel as their own structure so the streamed prose is never rewritten.
  | { type: "sources"; sources: Source[] }
  // REQ-F-037 ②: one per model call inside the loop; the client shows the running total.
  | { type: "usage"; usage: TokenUsage }
  // REQ-F-029 ②: the step ceiling (MAX_TOOL_STEPS) was reached; partial work is kept.
  | { type: "truncated"; steps: number }
  // REQ-NF-060 ②: the provider stopped at its output cap. Typed rather than a prose
  // notice so the loop can continue the answer itself; the notice is emitted by the
  // loop only when it stops continuing.
  | { type: "length_capped" }
  // REQ-NF-060 ④: THIS turn's running total. The conversation total (REQ-F-037) hides
  // the event that matters — one research question came to 1,028,825 input tokens and
  // was invisible because it only ever landed in a session sum.
  | { type: "turn_usage"; usage: { inputTokens: number; outputTokens: number } }
  // REQ-F-040 ③: the resolved provider cannot call tools, so this turn ran tool-free.
  | { type: "tools-unavailable"; reason: string }
  // REQ-F-023 ③: a plain informational line in the transcript — "no insight this turn"
  // and similar. Keeps such messages from being silently dropped.
  | { type: "notice"; text: string }
  // REQ-F-043 (CR-20260911-context-compaction): this send folded earlier turns into a
  // summary. Sent before the reply so the boundary marker appears where a refresh
  // would rebuild it — after `afterMessageId`, ahead of the `keptTurns` verbatim turns.
  | { type: "compacted"; summary: string; afterMessageId: string | null; keptTurns: number }
  // REQ-F-046 ③ (CR-20260911-knowledge-base): the model proposed a knowledge entry; it
  // sits in the pending queue until the user adopts it in the ☰ 知识库 list.
  | { type: "knowledge_pending"; name: string; title: string }
  // CR-20260912-entity-pending (CR-20260911-home-dashboard 出口义务 2): the model
  // proposed a tracked object or a change to one. `what` separates the two queues —
  // a whole new object waits in `entities/pending/`, a single field or parameter waits
  // in `entities/proposals/` — because adopting them is two different clicks.
  //
  // `name` (对象名) is on every `what:"entity"` event — `propose_entity` is its one
  // source and always has it. `id`/`field`/`value` on `what:"update"` are optional:
  // `propose_entity_update` (one field, one call) always has them; `extract_fields`
  // (many fields in one call) only carries a summary count, not a usable id per field —
  // the client renders a card when the identifying fields are present and falls back to
  // the plain notice when they are not (CR-20260915-entity-proposal-card).
  | { type: "entity_pending"; title: string; what: "entity"; name: string }
  | { type: "entity_pending"; title: string; what: "update"; id?: string; field?: string; value?: string }
  // REQ-F-102 (CR-20260912-stage-reach): move the display screen between its two session
  // stages. Transient by design — the board is deliberately NOT a persisted display_state
  // value (CR-20260912-display-stage rejected that), so the only way a tool can reach it
  // is a message that travels once and is not stored.
  | { type: "display_stage"; stage: "opening" | "board" | "industry-spec-comparison" };

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Assistant messages that requested tools. */
  tool_calls?: ToolCall[];
  /** Tool messages: which call this answers. */
  tool_call_id?: string;
};

export type ProviderTestResult = {
  ok: boolean;
  message: string;
};
