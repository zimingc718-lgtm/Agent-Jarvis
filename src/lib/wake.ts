import { estimateTokens } from "./adapters";
import { DEFAULT_SYSTEM_PROMPT } from "./chat";
import { makeCompleter, type Completer } from "./skills";
import { ProviderSecretError, type MessageRecord, type Store } from "./store";
import { truncateToTokens } from "./tools/budget";
import type { ChatMessage } from "./types";

/**
 * Proactive wake-up (REQ-F-060, REQ-F-061, REQ-NF-020, DEC-040; CR-20260911-proactive-wake, D 期).
 *
 * The idea is borrowed from OpenClaw's heartbeat and then stripped to what the user
 * actually asked for: "可以借鉴 openclaw 的主动唤醒，但不消耗大量 token", "默认关，要有开关".
 * So a wake is ONE bounded, non-streaming model call — a trimmed tail of the most
 * recent conversation plus a fixed instruction — that either says NOOP (nothing is
 * shown, nothing is stored) or produces a short reminder that is persisted as a
 * `system` row with status `wake`. That status is deliberately outside
 * `REPLAYABLE_STATUSES`, so a reminder never re-enters the model's context: wake-ups
 * cannot feed on their own output.
 *
 * Cost is fenced three ways: off by default, a daily token cap that stops wake-ups
 * for the rest of the day, and a hard cap on each call's input and output.
 * Everything lives in the existing `app_settings` key/value table — no schema change.
 */

export const SETTING_WAKE_ENABLED = "wake.enabled";
export const SETTING_WAKE_INTERVAL = "wake.interval_minutes";
export const SETTING_WAKE_DAILY_CAP = "wake.daily_token_cap";
export const SETTING_WAKE_USAGE = "wake.usage";

export const WAKE_DEFAULTS = { enabled: false, intervalMinutes: 30, dailyTokenCap: 20_000 } as const;
export const WAKE_INTERVAL_MIN = 1;
export const WAKE_INTERVAL_MAX = 24 * 60;
export const WAKE_DAILY_CAP_MAX = 10_000_000;
/** Tail of the recent conversation handed to the model, and the reply ceiling (REQ-NF-020 ①). */
export const WAKE_CONTEXT_TOKEN_CAP = 1_500;
export const WAKE_MAX_OUTPUT_TOKENS = 200;
export const WAKE_TIMEOUT_MS = 20_000;
/** How many recent text rows are considered before the token cap trims them. */
export const WAKE_TAIL_ROWS = 12;
/** Persisted reminders carry this status — never replayed into context (REQ-F-061 ③). */
export const WAKE_STATUS = "wake";
export const WAKE_NOTICE_PREFIX = "主动提醒：";

const WAKE_INSTRUCTIONS =
  "这是一次空闲唤醒，不是用户提问。请只根据下面截取的最近对话判断：是否有一件值得现在主动提醒用户的事——" +
  "未完成的事项、明显遗漏的下一步、或对方说过要回头处理的点。有就用一两句中文直接说，不要寒暄、不要复述对话。" +
  "没有就只回复 NOOP。";

export type WakeSettings = { enabled: boolean; intervalMinutes: number; dailyTokenCap: number };
export type WakeUsage = { date: string; inputTokens: number; outputTokens: number; runs: number; notices: number };

export type WakeOutcome =
  | {
      kind: "skipped";
      reason: "disabled" | "cap" | "no-provider" | "no-conversation" | "failed";
      message: string;
      usage: WakeUsage;
    }
  | { kind: "noop"; usage: WakeUsage }
  | { kind: "notice"; text: string; conversationId: string; messageId: string; usage: WakeUsage };

// ---------------------------------------------------------------- settings

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function readWakeSettings(store: Store): WakeSettings {
  const enabledRaw = store.getSetting(SETTING_WAKE_ENABLED);
  return {
    // REQ-F-060 ①: off until the user turns it on (user ruling 5, 2026-09-10).
    enabled: enabledRaw === "true",
    intervalMinutes: clampInt(store.getSetting(SETTING_WAKE_INTERVAL), WAKE_DEFAULTS.intervalMinutes, WAKE_INTERVAL_MIN, WAKE_INTERVAL_MAX),
    dailyTokenCap: clampInt(store.getSetting(SETTING_WAKE_DAILY_CAP), WAKE_DEFAULTS.dailyTokenCap, 0, WAKE_DAILY_CAP_MAX),
  };
}

export class WakeSettingsError extends Error {}

/** Validates then persists; rejects rather than silently clamping what the user typed. */
export function writeWakeSettings(store: Store, input: Partial<Record<keyof WakeSettings, unknown>>): WakeSettings {
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") {
      throw new WakeSettingsError("enabled 必须是布尔值。");
    }
    store.setSetting(SETTING_WAKE_ENABLED, String(input.enabled));
  }
  if (input.intervalMinutes !== undefined) {
    const n = Number(input.intervalMinutes);
    if (!Number.isInteger(n) || n < WAKE_INTERVAL_MIN || n > WAKE_INTERVAL_MAX) {
      throw new WakeSettingsError(`唤醒间隔须是 ${WAKE_INTERVAL_MIN}–${WAKE_INTERVAL_MAX} 之间的整数分钟。`);
    }
    store.setSetting(SETTING_WAKE_INTERVAL, String(n));
  }
  if (input.dailyTokenCap !== undefined) {
    const n = Number(input.dailyTokenCap);
    if (!Number.isInteger(n) || n < 0 || n > WAKE_DAILY_CAP_MAX) {
      throw new WakeSettingsError(`每日 token 上限须是 0–${WAKE_DAILY_CAP_MAX} 之间的整数。`);
    }
    store.setSetting(SETTING_WAKE_DAILY_CAP, String(n));
  }
  return readWakeSettings(store);
}

// ---------------------------------------------------------------- daily usage

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's idle spend; a new day starts from zero (REQ-NF-020 ②). */
export function readWakeUsage(store: Store, now: Date = new Date()): WakeUsage {
  const today = dayOf(now);
  const empty: WakeUsage = { date: today, inputTokens: 0, outputTokens: 0, runs: 0, notices: 0 };
  const raw = store.getSetting(SETTING_WAKE_USAGE);
  if (!raw) {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WakeUsage>;
    if (parsed.date !== today) {
      return empty;
    }
    return {
      date: today,
      inputTokens: Number(parsed.inputTokens) || 0,
      outputTokens: Number(parsed.outputTokens) || 0,
      runs: Number(parsed.runs) || 0,
      notices: Number(parsed.notices) || 0,
    };
  } catch {
    return empty;
  }
}

function writeWakeUsage(store: Store, usage: WakeUsage): void {
  store.setSetting(SETTING_WAKE_USAGE, JSON.stringify(usage));
}

// ---------------------------------------------------------------- the prompt (pure)

const TEXT_STATUSES = new Set(["complete", "stopped", "truncated"]);

/**
 * The bounded prompt for one wake. Pure: takes rows, returns messages. Only plain
 * user/assistant text from the tail of the conversation is included — tool rows,
 * summaries and earlier wake reminders are not, so a wake never sees its own output.
 */
export function buildWakeMessages(rows: MessageRecord[], identity: string = DEFAULT_SYSTEM_PROMPT): ChatMessage[] {
  const tail = rows
    .filter(
      (row) =>
        (row.role === "user" || row.role === "assistant") &&
        TEXT_STATUSES.has(row.status) &&
        !row.toolCalls?.length &&
        row.content.trim()
    )
    .slice(-WAKE_TAIL_ROWS);
  const transcript = tail.map((row) => `[${row.role}] ${row.content.trim()}`).join("\n");
  // Trim from the head, not the tail: the most recent turns are the ones that matter.
  const { text } = truncateToTokens(transcript, WAKE_CONTEXT_TOKEN_CAP);
  return [
    { role: "system", content: `${identity}\n\n${WAKE_INSTRUCTIONS}` },
    { role: "user", content: `最近对话（截取）：\n${text || "（无）"}` },
  ];
}

export function isNoop(reply: string): boolean {
  const trimmed = reply.trim();
  return trimmed === "" || /^noop\b/i.test(trimmed);
}

// ---------------------------------------------------------------- one wake

export type RunWakeInput = {
  store: Store;
  userId: string;
  /** The ☰ 「现在唤醒」 button: ignores the on/off switch, never the cap. */
  manual?: boolean;
  now?: () => Date;
  /** Test seam for the model call. */
  complete?: Completer;
};

export async function runWakeTurn(input: RunWakeInput): Promise<WakeOutcome> {
  const now = input.now ?? (() => new Date());
  const settings = readWakeSettings(input.store);
  let usage = readWakeUsage(input.store, now());

  if (!settings.enabled && !input.manual) {
    return { kind: "skipped", reason: "disabled", message: "主动唤醒未开启。", usage };
  }
  if (usage.inputTokens + usage.outputTokens >= settings.dailyTokenCap) {
    return {
      kind: "skipped",
      reason: "cap",
      message: `今日唤醒 token 已达上限（${settings.dailyTokenCap}），明天再试或在 ☰ 中调高上限。`,
      usage,
    };
  }

  let provider;
  try {
    provider = input.store.resolveActiveProvider(input.userId);
  } catch (error) {
    if (error instanceof ProviderSecretError) {
      provider = null;
    } else {
      throw error;
    }
  }
  if (!provider) {
    return { kind: "skipped", reason: "no-provider", message: "没有可用的模型 Provider，本次唤醒跳过。", usage };
  }

  const [recent] = input.store.listRecentConversations(input.userId);
  if (!recent) {
    return { kind: "skipped", reason: "no-conversation", message: "还没有对话可供唤醒参考。", usage };
  }

  const messages = buildWakeMessages(input.store.listMessages(recent.id));
  const inputTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const completer = input.complete ?? makeCompleter(provider);

  let reply: string;
  try {
    reply = await completer(messages, { maxTokens: WAKE_MAX_OUTPUT_TOKENS, timeoutMs: WAKE_TIMEOUT_MS });
  } catch (error) {
    // The request may well have been billed; count its input so a failing provider
    // cannot burn the day's budget in silence (REQ-NF-020 ③).
    usage = { ...usage, inputTokens: usage.inputTokens + inputTokens, runs: usage.runs + 1 };
    writeWakeUsage(input.store, usage);
    return {
      kind: "skipped",
      reason: "failed",
      message: `唤醒调用失败：${error instanceof Error ? error.message : "未知错误"}`,
      usage,
    };
  }

  const outputTokens = estimateTokens(reply);
  usage = {
    ...usage,
    inputTokens: usage.inputTokens + inputTokens,
    outputTokens: usage.outputTokens + outputTokens,
    runs: usage.runs + 1,
  };
  // REQ-F-037 ②: it is a model call inside this conversation, so it counts there too.
  input.store.addUsage(recent.id, { inputTokens, outputTokens, estimated: true });

  if (isNoop(reply)) {
    writeWakeUsage(input.store, usage);
    return { kind: "noop", usage };
  }

  const text = `${WAKE_NOTICE_PREFIX}${reply.trim()}`;
  const messageId = input.store.appendMessage({ conversationId: recent.id, role: "system", content: text, status: WAKE_STATUS });
  usage = { ...usage, notices: usage.notices + 1 };
  writeWakeUsage(input.store, usage);
  return { kind: "notice", text, conversationId: recent.id, messageId, usage };
}
