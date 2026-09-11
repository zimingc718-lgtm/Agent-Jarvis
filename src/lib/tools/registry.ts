import type { ToolSpec } from "../adapters";
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
  /** Whether this tool exists at all for the current context (REQ-NF-008 ④). */
  available(context: ToolContext): boolean;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
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
    return this.availableFor(context).map((tool) => ({
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }

  /** One line per tool for the stable prefix, so the model can see what it has. */
  catalogueFor(context: ToolContext): string {
    const tools = this.availableFor(context);
    if (tools.length === 0) {
      return "";
    }
    return ["可用工具：", ...tools.map((tool) => `- ${tool.name}：${tool.description}`)].join("\n");
  }
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

export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
