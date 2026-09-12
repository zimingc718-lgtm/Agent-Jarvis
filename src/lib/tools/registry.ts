import { estimateTokens, type ToolSpec } from "../adapters";
import type { ChatDelta } from "../types";
import { MAX_DESCRIPTION_CHARS } from "./budget";

/**
 * Tool registry (DEC-022, REQ-NF-010, TASK-064).
 *
 * A capability is a descriptor, not a branch in the chat core: adding a tool means
 * registering one of these, and `src/lib/chat.ts` never imports a concrete tool module
 * (guarded by grep in TEST-066 ⑤). This is the part of DeepSeek Harness's plugin model
 * worth copying — read for structure, not installed as a dependency.
 */

export type ToolContext = {
  userId: string;
  conversationId: string;
  signal?: AbortSignal;
  /** Skills registered for this user; empty means the skill tools do not register. */
  skillCount: number;
  /** Whether outbound search/fetch is switched on and configured (REQ-F-038 ④). */
  webEnabled: boolean;
  searchConfigured: boolean;
  /** Entries in the local knowledge base; zero means the read tools do not register (REQ-F-045 ③). */
  knowledgeCount: number;
};

export type ToolResult = {
  ok: boolean;
  /** Text handed back to the model as the `tool` message content. */
  content: string;
  /** Short line for the step row in the UI (REQ-F-035 ①). */
  summary: string;
  /** URLs this call surfaced, feeding the source allow-list (REQ-F-039 ②). */
  sources?: Array<{ url: string; title: string }>;
  /**
   * Client-facing events the loop emits right after this call's `tool_result`
   * (CR-20260911-knowledge-base: `knowledge_pending`). A side channel like `sources`,
   * so a tool can tell the UI something without the loop knowing which tool it was.
   */
  events?: ChatDelta[];
};

export type ToolDescriptor = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /**
   * What survives a small context window (CR-20260912-tool-budget). Default `normal`.
   * Ranking is by what breaks when the tool is missing, not by how often it is used.
   */
  priority?: ToolPriority;
  /** Whether this tool exists at all for the current context (REQ-NF-008 ④). */
  available(context: ToolContext): boolean;
  /**
   * `rawArguments` is the model's original argument string, so a tool can explain a
   * parse problem precisely via `describeArgsProblem` (REQ-F-050 ⑤). Optional: tests and
   * callers that already have parsed args may omit it.
   */
  execute(args: Record<string, unknown>, context: ToolContext, rawArguments?: string): Promise<ToolResult>;
};

/**
 * Load order under pressure (CR-20260912-tool-budget).
 *
 * `essential` — without it the model answers from memory and nobody can tell: the
 *   knowledge and entity READ tools. Their absence is silent, which is what makes them
 *   first.
 * `normal` — outbound reading and skills. Losing them is visible: the model says it
 *   cannot reach the network.
 * `management` — writes and configuration (propose, ingest, extract, collect). Losing
 *   them is the most visible of all, because the user asked for the write and hears
 *   that it did not happen.
 */
export const TOOL_PRIORITY = { essential: 1, normal: 2, management: 3 } as const;
export type ToolPriority = (typeof TOOL_PRIORITY)[keyof typeof TOOL_PRIORITY];

export type ToolFit = {
  /** What the provider request may carry this turn. */
  specs: ToolSpec[];
  loaded: ToolDescriptor[];
  /** Available but left out because the window could not hold them. */
  dropped: ToolDescriptor[];
  tokens: number;
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();

  register(tool: ToolDescriptor): this {
    if (tool.description.length > MAX_DESCRIPTION_CHARS) {
      // Descriptions ride in the stable prefix on every call, so an unbounded one is a
      // permanent tax on every turn (REQ-NF-008 ③).
      throw new Error(
        `工具 ${tool.name} 的 description 超过 ${MAX_DESCRIPTION_CHARS} 字符（当前 ${tool.description.length}）`
      );
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  /**
   * Tools that exist for this context. The set is computed **once per send** and must
   * not change mid-turn — a tool that stops registering halfway would rewrite the
   * stable prefix and throw away the cached prefix (DEC-026 ②). Runtime give-up, such
   * as a search backend that keeps failing, short-circuits inside `execute` instead.
   */
  availableFor(context: ToolContext): ToolDescriptor[] {
    return [...this.tools.values()].filter((tool) => tool.available(context));
  }

  /** The `tools` array for the provider request body. */
  specsFor(context: ToolContext): ToolSpec[] {
    return this.availableFor(context).map(specOf);
  }

  /**
   * As many tools as the declared budget can carry (REQ-NF-007 ②, 出口义务 4).
   *
   * `BUDGET_SHARES.toolDefinitions` was declared when the budget module was written and
   * then never consulted; measured afterwards, 18 tools ship 1734 tokens of schema
   * against a 655-token allowance at an 8k window — 21% of the whole window, spent
   * before the conversation starts (EV-2026-09-11-home-dashboard §8.2b).
   *
   * Three decisions worth stating:
   * ① The cost measured is the WIRE array, not the catalogue text. The first estimate
   *    looked at descriptions and was wrong by 5x: the weight is in the parameter schemas.
   * ② Dropping is by priority, and the caller is told what was dropped so the prefix can
   *    say so. A tool that vanishes silently turns into a model that quietly stops being
   *    able to do something, which is the failure this project has already shipped once.
   * ③ The first tool always loads, even if it alone exceeds the budget. Zero tools means
   *    the agent loop cannot act at all; being slightly over is caught later by the
   *    overall context check, which fails loudly.
   */
  fitFor(context: ToolContext, maxTokens: number): ToolFit {
    const available = this.availableFor(context);
    const byPriority = [...available].sort((a, b) => (a.priority ?? TOOL_PRIORITY.normal) - (b.priority ?? TOOL_PRIORITY.normal));

    const keep = new Set<string>();
    let tokens = 0;
    for (const tool of byPriority) {
      const cost = estimateTokens(JSON.stringify(specOf(tool)));
      if (keep.size > 0 && tokens + cost > maxTokens) {
        continue;
      }
      keep.add(tool.name);
      tokens += cost;
    }

    // Emitted in registration order, so the prefix stays byte-identical turn to turn
    // whenever the toolset itself has not changed (REQ-NF-008 ①).
    const loaded = available.filter((tool) => keep.has(tool.name));
    const dropped = available.filter((tool) => !keep.has(tool.name));
    return { specs: loaded.map(specOf), loaded, dropped, tokens };
  }

  /**
   * One line per tool for the stable prefix. Given a fit, it lists what is actually
   * callable and names the rest — the model needs to be able to tell the user "that
   * tool did not fit in this model's window" instead of failing at the call.
   */
  catalogueFor(context: ToolContext, fit?: ToolFit): string {
    const tools = fit ? fit.loaded : this.availableFor(context);
    if (tools.length === 0) {
      return "";
    }
    const lines = ["可用工具：", ...tools.map((tool) => `- ${tool.name}：${tool.description}`)];
    if (fit && fit.dropped.length > 0) {
      lines.push(
        `（另有 ${fit.dropped.length} 个工具本轮未加载，因为超出该模型窗口的工具预算：${fit.dropped
          .map((tool) => tool.name)
          .join("、")}。需要它们时请告知用户换用上下文窗口更大的模型。）`
      );
    }
    return lines.join("\n");
  }
}

function specOf(tool: ToolDescriptor): ToolSpec {
  return {
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/** Stable, order-insensitive key for "same tool, same arguments" (REQ-F-029 ④). */
export function normalizeArgs(args: unknown): string {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, walk(entry)])
      );
    }
    return value;
  };
  try {
    return JSON.stringify(walk(args));
  } catch {
    return String(args);
  }
}

/** Compact one-line rendering of call arguments for a step row (REQ-F-035 ①). */
export function summarizeArgs(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DESCRIPTION_CHARS ? `${flat.slice(0, MAX_DESCRIPTION_CHARS)}…` : flat;
}

/** Single-key wrappers some models put around the real arguments (REQ-F-050 ④). */
const ARGUMENT_WRAPPERS = new Set(["arguments", "parameters", "input"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse the model's argument string. Unwraps `{"arguments": {...}}` and friends: after a
 * few truncated attempts DeepSeek switched to that shape and a 63-byte valid call was
 * then rejected as "empty" (EV-2026-09-11-display-console-ux §1.1). Anything unparseable
 * still yields `{}` — `describeArgsProblem` is how a tool explains *why* to the model.
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (!isPlainObject(parsed)) {
      return {};
    }
    const keys = Object.keys(parsed);
    if (keys.length === 1 && ARGUMENT_WRAPPERS.has(keys[0]) && isPlainObject(parsed[keys[0]])) {
      return parsed[keys[0]] as Record<string, unknown>;
    }
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Why a call's arguments did not satisfy the tool, in words the model can act on
 * (REQ-F-050 ⑤): which required keys are missing, which keys actually arrived, and
 * whether the raw string was even JSON. Returns null when nothing is wrong.
 */
export function describeArgsProblem(raw: string, args: Record<string, unknown>, required: string[]): string | null {
  let json = true;
  try {
    JSON.parse(raw || "{}");
  } catch {
    json = false;
  }
  if (!json) {
    return `参数不是合法 JSON（收到 ${raw.length} 字符，末尾：${JSON.stringify(raw.slice(-40))}），疑似在生成中被截断。请缩短内容或分块提交。`;
  }
  const missing = required.filter((key) => !(key in args) || args[key] === undefined || args[key] === null);
  if (missing.length === 0) {
    return null;
  }
  const received = Object.keys(args);
  return `缺少参数 ${missing.join("、")}；收到的键：${received.length > 0 ? received.join("、") : "（无）"}。参数须是顶层 JSON 对象，例如 {"${missing[0]}": …}。`;
}
