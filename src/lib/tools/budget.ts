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

/** Everything that legitimately changes turn to turn goes after the prefix. */
export function buildVolatileSuffix(input: { displayState?: string | null }): string {
  return input.displayState ? `当前展示屏：${input.displayState}` : "";
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
 * Order of recovery when over budget (DEC-026 ⑥): narrow by the retention window first,
 * then fail loudly. Compressing in a loop would itself cost tokens and could not
 * guarantee termination, so the overflow surfaces as a request-level error instead.
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

  const full = [...system, ...input.messages.map(({ turn: _turn, ...rest }) => rest)];
  const fullCost = full.reduce((total, message) => total + estimateTokens(message.content ?? "") + 4, 0);
  if (fullCost <= limit) {
    return { messages: full, estimatedTokens: fullCost };
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
