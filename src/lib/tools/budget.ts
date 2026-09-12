import { estimateTokens } from "../adapters";
import type { ChatMessage, ProviderKind } from "../types";

/**
 * Context budget, prefix stability and the tool-result retention window
 * (DEC-026, REQ-NF-007, REQ-NF-008, REQ-F-041, TASK-066).
 *
 * Two lessons drive this module, both from OpenClaw's published token accounting:
 * a per-turn fixed injection that grows without a ceiling, and a system prompt whose
 * leading bytes change every turn (it carries the clock), which throws away prefix
 * caching wholesale. So: everything stable goes first and never moves, the clock is
 * not in it, and each contributor has a ceiling.
 *
 * Pure module — no fs, no network, no db.
 */

/** Context window fallbacks when the provider row has none (DEC-026 ⑤). */
export const DEFAULT_CONTEXT_WINDOW: Record<ProviderKind, number> = {
  openai: 128_000,
  deepseek: 128_000,
  local: 8_192,
};

/** Share of the context window each contributor may occupy (DEC-026 ④). */
export const BUDGET_SHARES = {
  totalInput: 0.6,
  skillCatalogue: 0.02,
  toolDefinitions: 0.08,
  singleToolResult: 0.15,
  sources: 0.01,
} as const;

/** Tool and skill descriptions are injected every turn, so they stay short (DEC-026 ⑦). */
export const MAX_DESCRIPTION_CHARS = 200;

/** How many user turns keep their tool results verbatim (REQ-F-041 ①). */
export const TOOL_RESULT_RETENTION_TURNS = 2;

export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextOverflowError";
  }
}

export function contextWindowFor(input: { kind: ProviderKind; contextWindow?: number | null }): number {
  return input.contextWindow && input.contextWindow > 0
    ? input.contextWindow
    : DEFAULT_CONTEXT_WINDOW[input.kind];
}

export function budgetTokens(window: number, share: number): number {
  return Math.max(1, Math.floor(window * share));
}

/** Truncate to a token budget, leaving a visible marker rather than a silent cut. */
export function truncateToTokens(text: string, maxTokens: number): { text: string; truncated: boolean } {
  if (estimateTokens(text) <= maxTokens) {
    return { text, truncated: false };
  }
  // Estimation is per-character, so a character budget is a safe over-approximation
  // to slice at; re-check keeps us under even for CJK-heavy text.
  let slice = text.slice(0, Math.max(1, maxTokens * 4));
  while (estimateTokens(slice) > maxTokens && slice.length > 1) {
    slice = slice.slice(0, Math.floor(slice.length * 0.9));
  }
  return { text: `${slice}\n\n[内容超出预算，已截断]`, truncated: true };
}

export type SkillCatalogueEntry = { name: string; description: string };

/**
 * The skill list that lives in the stable prefix. Bodies are never in here — the model
 * calls `read_skill` when it wants one, which is the whole point of REQ-F-030 ②.
 * Over budget we list the first N and say so, which is why `search_skills` exists.
 */
export function renderSkillCatalogue(
  skills: SkillCatalogueEntry[],
  maxTokens: number
): { text: string; listed: number; omitted: number } {
  if (skills.length === 0) {
    return { text: "", listed: 0, omitted: 0 };
  }
  const header = "已注册技能（正文需用 read_skill 读取）：";
  const lines: string[] = [];
  let used = estimateTokens(header);
  let listed = 0;
  for (const skill of skills) {
    const line = `- ${skill.name}：${skill.description.slice(0, MAX_DESCRIPTION_CHARS)}`;
    const cost = estimateTokens(line);
    if (used + cost > maxTokens) {
      break;
    }
    lines.push(line);
    used += cost;
    listed += 1;
  }
  const omitted = skills.length - listed;
  if (omitted > 0) {
    lines.push(`- （另有 ${omitted} 个技能未列出，用 search_skills 检索）`);
  }
  return { text: [header, ...lines].join("\n"), listed, omitted };
}

export type StablePrefixInput = {
  identity: string;
  skillCatalogue: string;
  /** Rendered tool list. Empty when the toolset is empty (REQ-NF-008 ④). */
  toolCatalogue: string;
};

/**
 * The cacheable head of the system prompt. Byte-identical across turns of one
 * conversation unless the skill or tool set itself changes (REQ-NF-008 ①).
 * Nothing time-varying may enter here — that is REQ-NF-008 ② and it is the single
 * most expensive mistake in OpenClaw's published numbers.
 */
export function buildStablePrefix(input: StablePrefixInput): string {
  return [input.identity, input.skillCatalogue, input.toolCatalogue].filter(Boolean).join("\n\n");
}

/**
 * Everything that legitimately changes turn to turn goes after the prefix.
 *
 * `runtime` is here rather than in the identity for two reasons (REQ-F-120 ④, DEC-100 ③).
 * It genuinely varies: the user can switch provider or model between turns, and REQ-F-040
 * can fall back to another provider mid-conversation. And putting it in the stable prefix
 * would rewrite that prefix on every such switch, throwing away the cache the prefix exists
 * to protect (REQ-NF-008 ①). It is not a clock — it changes only when the runtime does — so
 * it costs nothing on the turns where nothing changed.
 *
 * Why it exists at all: asked「现在你知道接了什么模型了吗」the assistant answered「我没有
 * 自检接口，拿不到当前接入的是哪家模型」. That was true — nothing in the prompt said.
 */
export function buildVolatileSuffix(input: {
  displayState?: string | null;
  runtime?: string | null;
}): string {
  const lines: string[] = [];
  if (input.runtime) {
    lines.push(input.runtime);
  }
  if (input.displayState) {
    lines.push(`当前展示屏：${input.displayState}`);
  }
  return lines.join("\n");
}

/**
 * One line telling the model what it is actually running on (REQ-F-120 ④).
 *
 * Names the provider row the user configured as well as the model id, because「用的是
 * DeepSeek 吗」and「用的是我配的那个 DeepSeek 吗」are different questions and only the
 * second one is answerable from the row.
 */
export function describeRuntime(input: {
  providerName: string;
  kind: ProviderKind;
  model: string;
  contextWindow: number;
}): string {
  const kindLabel: Record<ProviderKind, string> = {
    openai: "OpenAI 兼容",
    deepseek: "DeepSeek",
    local: "本地 / 自建兼容端点",
  };
  return (
    `当前运行时：Provider「${input.providerName}」（${kindLabel[input.kind]}），模型 ${input.model}，` +
    `上下文窗口约 ${input.contextWindow} tokens。用户问起接的是什么模型时，据此回答，不要说无法得知。`
  );
}

export type TurnMessage = ChatMessage & {
  /** Which user turn this row belongs to; used by the retention window. */
  turn: number;
};

/**
 * Replace tool results older than the retention window with a one-line marker
 * (REQ-F-041 ①). `tool_call_id` is preserved so the assistant/tool pairing stays a
 * legal OpenAI sequence — dropping the row outright would corrupt the protocol.
 *
 * Plain user/assistant text is untouched; full history compaction is B-phase work.
 */
export function applyRetentionWindow(
  messages: TurnMessage[],
  currentTurn: number,
  retainTurns = TOOL_RESULT_RETENTION_TURNS
): ChatMessage[] {
  const cutoff = currentTurn - retainTurns;
  return messages.map((message) => {
    if (message.role !== "tool" || message.turn > cutoff) {
      const { turn: _turn, ...rest } = message;
      return rest;
    }
    const { turn: _turn, ...rest } = message;
    return { ...rest, content: "[结果已省略]" };
  });
}

/**
 * Compaction tuning (DEC-030 ③④⑤, TASK-077).
 *
 * These numbers come from measuring the real dev database, not from taste. The
 * measurement that shaped them: over nine real conversations, a retention window saves
 * 82% on a 109-message conversation — but *costs* 19% on an 18-message one, because the
 * summary is bigger than what it replaces. So compaction is gated on budget pressure and
 * on a net-gain check, never on turn count.
 */
export const COMPACT_TRIGGER_RATIO = 0.8;
/** The compacted span must be at least this many times the summary's own budget. */
export const COMPACT_MIN_GAIN_RATIO = 3;
export const SUMMARY_MAX_TOKENS = 500;
/** Most recent user turns kept verbatim. */
export const COMPACT_KEEP_TURNS = 3;

/** Marks a persisted summary standing in for everything before it (DEC-030 ①). */
export const SUMMARY_STATUS = "summary";

export type CompactionPlan =
  | { shouldCompact: false; reason: "under-budget" | "nothing-old-enough" | "not-worth-it" }
  | { shouldCompact: true; through: number; spanTokens: number; estimatedGain: number };

/**
 * Decide whether compacting would actually help (REQ-F-042 ①③, REQ-NF-012 ①).
 *
 * Pure: no model call, no db, no fs. The caller generates the summary if this says yes.
 */
export function planCompaction(input: {
  messages: TurnMessage[];
  currentTurn: number;
  contextWindow: number;
  keepTurns?: number;
  summaryTokens?: number;
}): CompactionPlan {
  const keepTurns = input.keepTurns ?? COMPACT_KEEP_TURNS;
  const summaryTokens = input.summaryTokens ?? SUMMARY_MAX_TOKENS;
  const limit = budgetTokens(input.contextWindow, BUDGET_SHARES.totalInput);

  const total = input.messages.reduce((sum, message) => sum + estimateTokens(message.content ?? "") + 4, 0);
  // Budget pressure is the ONLY trigger. A short conversation never reaches it, which is
  // exactly what keeps compaction from making short conversations more expensive.
  if (total < limit * COMPACT_TRIGGER_RATIO) {
    return { shouldCompact: false, reason: "under-budget" };
  }

  // Everything at or before this turn is old enough to fold into a summary.
  const cutoff = input.currentTurn - keepTurns;
  if (cutoff < 1) {
    return { shouldCompact: false, reason: "nothing-old-enough" };
  }

  const span = input.messages.filter((message) => message.turn <= cutoff);
  if (span.length === 0) {
    return { shouldCompact: false, reason: "nothing-old-enough" };
  }
  const spanTokens = span.reduce((sum, message) => sum + estimateTokens(message.content ?? "") + 4, 0);

  // The net-gain check. Without it, compacting a small span pays a summary's worth of
  // tokens to remove less than a summary's worth of text — the regression this CR's
  // evidence caught in the naive design.
  if (spanTokens < summaryTokens * COMPACT_MIN_GAIN_RATIO) {
    return { shouldCompact: false, reason: "not-worth-it" };
  }

  return { shouldCompact: true, through: cutoff, spanTokens, estimatedGain: spanTokens - summaryTokens };
}

/** Drop everything the summary covers and put the summary in its place (DEC-030 ①). */
export function applySummary(messages: TurnMessage[], summary: string, through: number): TurnMessage[] {
  const kept = messages.filter((message) => message.turn > through);
  return [{ role: "system", content: summary, turn: through }, ...kept];
}

/**
 * Keep only the last `keepLast` tool results verbatim; older ones become the same marker
 * `applyRetentionWindow` uses. `tool_call_id` is preserved so the assistant/tool pairing
 * stays a legal sequence — dropping rows outright would corrupt the protocol.
 *
 * Operates on plain `ChatMessage`s with no turn numbers, because inside one send there are
 * no turns — only loop steps.
 */
export function narrowToolResults(messages: ChatMessage[], keepLast: number): ChatMessage[] {
  const toolIndexes = messages.flatMap((message, index) => (message.role === "tool" ? [index] : []));
  if (toolIndexes.length <= keepLast) {
    return messages;
  }
  const keep = new Set(toolIndexes.slice(-keepLast));
  return messages.map((message, index) =>
    message.role === "tool" && !keep.has(index) ? { ...message, content: "[结果已省略]" } : message
  );
}

/** Progressively tighter retention attempts before the loop gives up (DEC-080 ②). */
export const IN_TURN_RETENTION_STEPS = [3, 2, 1];

export type ToolLoopFit =
  | { fits: true; messages: ChatMessage[]; narrowed: boolean; estimatedTokens: number }
  | { fits: false; estimatedTokens: number; limit: number };

/**
 * Bound what one send replays as its own tool loop grows (REQ-F-101, DEC-080 ②).
 *
 * `assembleContext` runs once, before the loop starts. Everything the loop then appends —
 * up to `MAX_TOOL_STEPS` assistant/tool pairs, each tool result allowed its own sizeable
 * share — is never re-checked against the budget. With the ceiling at 10 that was bounded
 * by accident; at 100 it is not, and ten page reads alone can pass the whole input budget
 * inside a single request. The failure then surfaces as a provider 400 mid-loop.
 *
 * Unlike the cross-turn window, narrowing here is applied **only under pressure**: within
 * one send every result belongs to the task in hand, so discarding them by default would
 * break exactly the multi-source synthesis the loop exists for. REQ-F-041 ① governs turns,
 * not steps, so it is not in tension with this.
 */
export function fitToolLoopContext(messages: ChatMessage[], contextWindow: number): ToolLoopFit {
  const limit = budgetTokens(contextWindow, BUDGET_SHARES.totalInput);
  const cost = (rows: ChatMessage[]): number =>
    rows.reduce((total, message) => total + estimateTokens(message.content ?? "") + 4, 0);

  const full = cost(messages);
  if (full <= limit) {
    return { fits: true, messages, narrowed: false, estimatedTokens: full };
  }
  for (const keepLast of IN_TURN_RETENTION_STEPS) {
    const narrowed = narrowToolResults(messages, keepLast);
    const narrowedCost = cost(narrowed);
    if (narrowedCost <= limit) {
      return { fits: true, messages: narrowed, narrowed: true, estimatedTokens: narrowedCost };
    }
  }
  return { fits: false, estimatedTokens: full, limit };
}

export type AssembleInput = {
  stablePrefix: string;
  volatileSuffix: string;
  messages: TurnMessage[];
  currentTurn: number;
  contextWindow: number;
};

/**
 * Assemble the messages for one provider call (REQ-F-004 as rewritten).
 *
 * The retention window is applied **unconditionally** (REQ-F-091, DEC-070 ①) — REQ-F-041 ① says "只有最近 N 轮的
 * 工具结果以原文保留", with no budget precondition. The first implementation used it only
 * as an overflow recovery, which meant a conversation that stayed under the limit replayed
 * every tool result it had ever produced. Measured on the real database
 * (EV-2026-09-11-chat-latency §3): 61,770 tokens replayed per turn, 80% of the budget, of
 * which ~40,000 were tool output from turns the user had long moved past — and because it
 * sat under the limit, neither this window nor compaction ever fired. The tool loop then
 * multiplies that by every step in the turn.
 *
 * When the narrowed context is still over budget there is nothing further to try:
 * compressing in a loop would itself cost tokens and could not guarantee termination, so
 * the overflow surfaces as a request-level error (DEC-026 ⑥).
 */
export function assembleContext(input: AssembleInput): { messages: ChatMessage[]; estimatedTokens: number } {
  const limit = budgetTokens(input.contextWindow, BUDGET_SHARES.totalInput);
  const system: ChatMessage[] = [];
  if (input.stablePrefix) {
    system.push({ role: "system", content: input.stablePrefix });
  }
  if (input.volatileSuffix) {
    system.push({ role: "system", content: input.volatileSuffix });
  }

  const narrowed = [...system, ...applyRetentionWindow(input.messages, input.currentTurn)];
  const narrowedCost = narrowed.reduce((total, message) => total + estimateTokens(message.content ?? "") + 4, 0);
  if (narrowedCost <= limit) {
    return { messages: narrowed, estimatedTokens: narrowedCost };
  }

  throw new ContextOverflowError(
    `本轮上下文约 ${narrowedCost} tokens，超出预算 ${limit}。请开启新对话，或改用上下文窗口更大的模型。`
  );
}
