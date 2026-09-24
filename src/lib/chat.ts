import { randomUUID } from "node:crypto";
import { dropOrphanToolResults, repairDanglingToolCalls, runToolLoop } from "./agent-loop";
import { listKnowledge } from "./knowledge";
import { resolveUserDataRoots, type UserDataRoots } from "./user-data-paths";
import { estimateMessagesTokens, estimateTokens, sendProviderStream, type StreamProviderConfig, type ToolSpec } from "./adapters";
import { resolveDisplayView } from "./display";
import { ProviderSecretError, type SourceRecord, type Store } from "./store";
import { makeCompleter, type Completer } from "./skills";
import {
  applySummary,
  assembleContext,
  budgetTokens,
  BUDGET_SHARES,
  buildStablePrefix,
  buildVolatileSuffix,
  describeRuntime,
  contextWindowFor,
  ContextOverflowError,
  planCompaction,
  renderSkillCatalogue,
  SUMMARY_MAX_TOKENS,
  SUMMARY_STATUS,
  type TurnMessage,
} from "./tools/budget";
import { ToolRegistry, type ToolContext } from "./tools/registry";
import { createSkillTools } from "./tools/skill-tools";
import { createDisplayTools } from "./tools/display-tools";
import { createKnowledgeTools } from "./tools/knowledge-tools";
import { createDocumentTools } from "./tools/document-tools";
import { createEntityTools } from "./tools/entity-tools";
import { createWebTools, readWebSettings } from "./tools/web-tools";
import type { ChatDelta, ChatMessage, ProviderRuntimeConfig, Source } from "./types";

export const DEFAULT_SYSTEM_PROMPT =
  "You are Agent-Jarvis, a concise assistant running locally on the user's machine. Answer directly and keep prior turns of this conversation in mind.";

/**
 * Statuses that replay as context. `truncated` joins the set because a turn that hit the
 * step ceiling still produced real work the next turn should see (REQ-F-029 ②).
 */
const REPLAYABLE_STATUSES = new Set(["complete", "stopped", "truncated"]);

type ProviderStreamInput = {
  provider: StreamProviderConfig;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  tools?: ToolSpec[];
  includeUsage?: boolean;
};

type RunChatTurnInput = {
  store: Store;
  userId: string;
  providerId?: string;
  message: string;
  conversationId?: string;
  model?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  providerStream?: (input: ProviderStreamInput) => AsyncIterable<ChatDelta>;
  /** Extra tools, used by tests to register a fake capability (REQ-NF-010 ②). */
  extraTools?: ToolRegistry;
  /** Test seam for the compaction summary call (REQ-F-042 ②). */
  summarize?: Completer;
  /** `toolsUsed` lets the caller report on what actually ran this turn (REQ-F-023 ③). */
  onFinal?: (finalText: string, status: string, conversationId: string, toolsUsed: string[]) => ChatDelta[];
};

const encoder = new TextEncoder();

/**
 * Turns in flight, one per conversation (DEC-420 ②, CR-20260923-orphan-tool-results).
 *
 * The measured failure (EV-2026-09-23-orphan-tool-results §1): the user pressed stop and
 * typed again while the previous turn's tools were still finishing. The client had already
 * let go — `handleStop` aborts its fetch and re-enables sending — but nothing here knew, so
 * the new `user` row landed between an assistant's `tool_calls` and its `tool` rows, and
 * every later replay was refused by the provider. A new send now aborts whatever this
 * conversation still has running and waits for it to wind down BEFORE history is read.
 *
 * Process-local on purpose: one `next start` process serves the app (locally and on
 * Railway alike), and a lock that outlived the process would need its own cleanup story.
 */
const inFlightTurns = new Map<string, { controller: AbortController; settled: Promise<void> }>();

/** Longest a new send waits for the superseded turn to wind down before proceeding anyway. */
const SUPERSEDE_WAIT_MS = 15_000;

async function settleWithin(settled: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    settled,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
}

export class ChatServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function formatSse(delta: ChatDelta): string {
  return `event: ${delta.type}\ndata: ${JSON.stringify(delta)}\n\n`;
}

/** Build the toolset for one send. Composition is fixed for the whole turn (DEC-026 ②). */
export function buildRegistry(store: Store, roots: UserDataRoots, extra?: ToolRegistry): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of createSkillTools(store)) {
    registry.register(tool);
  }
  for (const tool of createDisplayTools(store)) {
    registry.register(tool);
  }
  for (const tool of createWebTools({ store })) {
    registry.register(tool);
  }
  for (const tool of createKnowledgeTools({ root: roots.knowledgeRoot, entitiesRoot: roots.entitiesRoot })) {
    registry.register(tool);
  }
  // CR-20260911-home-dashboard: entity tools register unconditionally, like save_knowledge.
  // Making them conditional needs a ToolContext field, and that file is being rewritten
  // by the display-console CR right now; the condition joins in the wiring step.
  for (const tool of createEntityTools({ root: roots.entitiesRoot, knowledgeRoot: roots.knowledgeRoot })) {
    registry.register(tool);
  }
  /**
   * REQ-F-110: the user's own files, read where they lie. Registered unconditionally so
   * the model can say "no folder is configured yet" instead of silently having no idea
   * that local documents exist at all — the mistake `search_knowledge` made.
   *
   * Registered **after** the entity tools on purpose. Both sets are `essential`, and
   * `fitFor` breaks ties by registration order, so at a small window the board's read
   * tools survive and these are the ones named in the dropped list instead (TEST-171 ④).
   * Being named is what keeps the capability explainable rather than invisible.
   */
  for (const tool of createDocumentTools(store)) {
    registry.register(tool);
  }
  if (extra) {
    for (const tool of extra.availableFor({} as ToolContext)) {
      registry.register(tool);
    }
  }
  return registry;
}

/** Which (provider, model) pairs are known to call tools (REQ-F-040 ①). */
function toolSupportFor(provider: ProviderRuntimeConfig, model: string): "yes" | "no" | "unknown" {
  const raw = provider.toolSupport;
  if (!raw) {
    return "unknown";
  }
  const value = raw[model];
  return value === "yes" || value === "no" ? value : "unknown";
}

export async function runChatTurn(input: RunChatTurnInput): Promise<ReadableStream<Uint8Array>> {
  const message = input.message.trim();
  if (!message) {
    throw new ChatServiceError(400, "Message is required.");
  }

  let provider: ProviderRuntimeConfig | null;
  /**
   * 队首之后还排着谁（REQ-F-210）。
   *
   * 用户显式指定了 Provider 就不下沉——那是他自己的选择，替他换掉比失败更糟。
   */
  let chain: ProviderRuntimeConfig[] = [];
  try {
    if (input.providerId) {
      provider = input.store.getProviderForUser(input.userId, input.providerId);
    } else {
      chain = input.store.resolveProviderChain(input.userId);
      provider = chain[0] ?? null;
    }
  } catch (error) {
    if (error instanceof ProviderSecretError) {
      throw new ChatServiceError(400, "无法读取该 Provider 的凭据，请在模型设置中重新输入 API Key。");
    }
    throw error;
  }
  if (!provider) {
    throw input.providerId
      ? new ChatServiceError(404, "Selected model provider is not connected.")
      : new ChatServiceError(409, "没有可用的模型 Provider。请在「模型」中启用一个并通过连接测试。");
  }

  let conversationId: string;
  if (input.conversationId) {
    const existing = input.store.getConversationForUser(input.userId, input.conversationId);
    if (!existing) {
      throw new ChatServiceError(404, "Conversation not found.");
    }
    conversationId = existing.id;
  } else {
    conversationId = input.store.createConversation(input.userId, titleFromMessage(message)).id;
  }

  const skills = input.store.listSkills(input.userId);
  const web = readWebSettings(input.store);

  /**
   * ① 能力下沉（REQ-F-210 ①）：队首已知不支持工具调用时，换给排在后面、没被判过
   * "no" 的那个。全都不支持才走 REQ-F-040 ③ 的降级——那一条没变，只是往后挪了一步。
   *
   * 只认 `"no"`（探测得到的真结论）。`unknown` 仍按「先试试看」处理（DEC-260）。
   */
  let capabilitySwitch: { from: string; to: string } | null = null;
  if (!input.providerId && chain.length > 1) {
    const head = provider;
    if (toolSupportFor(head, input.model?.trim() || head.defaultModel) === "no") {
      const abler = chain.find(
        (candidate) => toolSupportFor(candidate, candidate.defaultModel) !== "no"
      );
      if (abler && abler.id !== head.id) {
        capabilitySwitch = { from: head.name, to: abler.name };
        provider = abler;
      }
    }
  }

  const model = input.model?.trim() || provider.defaultModel;
  const support = toolSupportFor(provider, model);
  /**
   * REQ-F-040 ③ as corrected by CR-20260911-tool-availability.
   *
   * `unknown` is the state every provider starts in, and the first version treated it
   * like `no` — so out of the box no tools registered at all and the model could not
   * reach `web_search` however much the user wanted it to. "Not yet probed" is not
   * "does not support"; only the latter was what the user ruled should degrade.
   *
   * So `unknown` now attempts tools. If the provider rejects the `tools` field we fall
   * back once and remember `no` (see `toolRejection` below) — the same shape as the
   * `stream_options` fallback. Priority order is untouched (REQ-F-006 ⑦).
   */
  const toolsUsable = support !== "no";

  const dataRoots = await resolveUserDataRoots(input.userId);
  const registry = buildRegistry(input.store, dataRoots, input.extraTools);
  // Counted once per send like the skills: the toolset is fixed for the turn (DEC-026 ②).
  const knowledgeCount = (await listKnowledge(dataRoots.knowledgeRoot)).length;
  const window = contextWindowFor({ kind: provider.kind, contextWindow: provider.contextWindow });
  const toolContext: ToolContext = {
    userId: input.userId,
    conversationId,
    skillCount: skills.length,
    webEnabled: web.enabled,
    searchConfigured: Boolean(web.baseUrl),
    knowledgeCount,
    contextWindow: window,
  };

  const catalogue = renderSkillCatalogue(
    skills.map((skill) => ({ name: skill.name, description: skill.description })),
    budgetTokens(window, BUDGET_SHARES.skillCatalogue)
  );
  // The declared tool-definition budget, finally enforced (出口义务 4). The catalogue in
  // the prefix and the `tools` array on the wire are computed from ONE fit, so the prefix
  // can never advertise a tool the request does not carry.
  const toolFit = registry.fitFor(toolContext, budgetTokens(window, BUDGET_SHARES.toolDefinitions));
  const stablePrefix = buildStablePrefix({
    identity: input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    skillCatalogue: catalogue.text,
    toolCatalogue: toolsUsable ? registry.catalogueFor(toolContext, toolFit) : "",
  });
  const volatileSuffix = buildVolatileSuffix({
    // REQ-F-120 ④: without this the model has no way to know which provider or model it is
    // running on, and said so when asked.
    runtime: describeRuntime({ providerName: provider.name, kind: provider.kind, model, contextWindow: window }),
    displayState: describeDisplay(),
  });

  // DEC-420 ②: at most one turn per conversation. Whatever is still running here is
  // aborted and allowed to wind down before history is read, so its final rows land in
  // order and this turn's user row cannot fall between a `tool_calls` row and its results.
  const previous = inFlightTurns.get(conversationId);
  const supersededPrevious = previous !== undefined;
  if (previous) {
    previous.controller.abort();
    await settleWithin(previous.settled, SUPERSEDE_WAIT_MS);
  }
  const turnController = new AbortController();
  if (input.signal?.aborted) {
    turnController.abort();
  } else {
    input.signal?.addEventListener("abort", () => turnController.abort(), { once: true });
  }
  let markSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  const inFlight = { controller: turnController, settled };
  inFlightTurns.set(conversationId, inFlight);
  const releaseTurn = () => {
    markSettled();
    if (inFlightTurns.get(conversationId) === inFlight) {
      inFlightTurns.delete(conversationId);
    }
  };
  const turnSignal = turnController.signal;

  const loaded = loadHistory(input.store, conversationId);
  const lastRowIdByTurn = loaded.lastRowIdByTurn;
  // DEC-420 ①: tool results whose call is no longer in front of them are skipped in the
  // replay. The rows stay in the database — compaction works the same way (DEC-030 ①).
  const { messages: history, dropped } = dropOrphanToolResults(loaded.messages);
  input.store.appendMessage({ conversationId, role: "user", content: message, status: "complete" });

  const currentTurn = history.length > 0 ? Math.max(...history.map((entry) => entry.turn)) + 1 : 1;
  const turnMessages: TurnMessage[] = [...history, { role: "user", content: message, turn: currentTurn }];

  // REQ-NF-007 ④ as rewritten: narrow tool results, then compact text history, then —
  // only then — refuse. Compaction runs at most once per send (DEC-030 ⑨).
  let contextMessages = turnMessages;
  let compaction: CompactionOutcome = "not-attempted";
  const preamble: ChatDelta[] = [];
  if (supersededPrevious) {
    preamble.push({ type: "notice", text: "上一轮尚未结束，已先将其中止，再处理这条消息。" });
  }
  if (dropped > 0) {
    preamble.push({
      type: "notice",
      text: `已跳过 ${dropped} 条错位的工具结果（上一轮被中止时留下的），按修复后的历史继续。`,
    });
  }
  const plan = planCompaction({ messages: turnMessages, currentTurn, contextWindow: window });
  if (plan.shouldCompact) {
    // The summary row goes right behind the last row it covers — its position is the
    // boundary (DEC-030 ①). Appending it at the end would put the still-verbatim recent
    // turns before it and silently drop them from the next replay.
    const anchorId = lastRowIdByTurn.get(plan.through) ?? null;
    const summary = await summarizeSpan({
      store: input.store,
      conversationId,
      provider,
      model,
      messages: turnMessages,
      through: plan.through,
      anchorId,
      summarize: input.summarize,
    });
    if (summary) {
      contextMessages = applySummary(turnMessages, summary, plan.through);
      compaction = "applied";
      preamble.push({
        type: "compacted",
        summary,
        afterMessageId: anchorId,
        keptTurns: currentTurn - plan.through,
      });
    } else {
      // The model call failed, timed out or came back empty. Compaction exists to save
      // tokens; it must never become a way for a turn to fail (REQ-NF-012 ③), so we
      // simply carry on uncompacted.
      compaction = "failed";
    }
  }

  let assembled: ChatMessage[];
  try {
    const fitted = assembleContext({
      stablePrefix,
      volatileSuffix,
      messages: contextMessages,
      currentTurn,
      contextWindow: window,
    });
    assembled = fitted.messages;
    // REQ-F-130 ④ / REQ-F-023: tightening changes what the model can see, so it is said
    // out loud rather than left for the user to infer from a vaguer answer.
    if (fitted.degraded) {
      const { retainedTurns, affected } = fitted.degraded;
      preamble.push({
        type: "notice",
        text:
          retainedTurns === 0
            ? `本轮上下文超出预算，已省略全部 ${affected} 条工具结果的正文以继续。需要其中内容请让我重新读取。`
            : `本轮上下文超出预算，已缩短 ${affected} 条较早的工具结果（保留最近 ${retainedTurns} 轮）。需要被略去的部分请让我重新读取。`,
      });
    }
  } catch (error) {
    releaseTurn();
    if (error instanceof ContextOverflowError) {
      throw new ChatServiceError(413, describeOverflow(error.message, compaction));
    }
    throw error;
  }
  assembled = repairDanglingToolCalls(assembled);

  const messageId = randomUUID();
  const streamFactory = input.providerStream ?? sendProviderStream;
  const providerConfig = toStreamProviderConfig(provider);

  /**
   * ② 失败下沉（REQ-F-210 ②）：第一次模型调用在**尚未产出任何可见内容**时失败，
   * 就换链上的下一个再试一次。
   *
   * 三条边界都写在这里，不靠调用方记得：
   *   - 只有第一次调用下沉。第二步及以后已经跑过工具，换模型等于重复副作用。
   *   - 只有零可见输出时下沉。已经吐字再换，用户会看到半句话被另一个模型接着写。
   *   - 每轮最多换一次。
   *
   * `usage` 不算可见输出：它在第一个字之前就到（2026-09-14 那次超时的实测序列正是
   * `start → usage → error`，整整 60 秒零 delta）。
   */
  const fallbacks = chain.filter((candidate) => candidate.id !== provider.id);
  let firstCallDone = false;
  let failoverUsed = false;
  let failoverNote: { from: string; to: string; why: string } | null = null;

  async function* withFailover(
    make: (config: ProviderRuntimeConfig, model?: string) => AsyncIterable<ChatDelta>
  ): AsyncIterable<ChatDelta> {
    const attempts: ProviderRuntimeConfig[] =
      firstCallDone || failoverUsed || fallbacks.length === 0 ? [provider!] : [provider!, fallbacks[0]!];
    firstCallDone = true;

    for (let index = 0; index < attempts.length; index += 1) {
      const candidate = attempts[index]!;
      const isLast = index === attempts.length - 1;
      let produced = false;
      for await (const delta of make(candidate, index === 0 ? input.model : candidate.defaultModel)) {
        if (delta.type === "error" && !produced && !isLast) {
          failoverUsed = true;
          failoverNote = { from: candidate.name, to: attempts[index + 1]!.name, why: delta.message };
          break;
        }
        if (delta.type !== "usage") {
          produced = true;
        }
        yield delta;
      }
      if (produced || isLast) {
        return;
      }
    }
  }

  return createStreamingResponse({
    conversationId,
    messageId,
    signal: turnSignal,
    preamble,
    toolsUsable,
    // ③ 换了模型必须说出来（REQ-F-210 ③）：静默换模型比换错模型更坏——用户会拿着
    // 一份不知道出自谁的答案去做判断。
    providerNotice: capabilitySwitch
      ? `「${capabilitySwitch.from}」不支持工具调用，本轮改用「${capabilitySwitch.to}」执行。`
      : "",
    readFailoverNote: () =>
      failoverNote ? `「${failoverNote.from}」未能应答（${failoverNote.why}），本轮改用「${failoverNote.to}」。` : "",
    toolsUnavailableReason:
      support === "unknown"
        ? "当前模型尚未探测工具调用能力，本轮按普通对话进行。可在「模型」中点「测试」完成探测。"
        : "当前模型不支持工具调用，本轮按普通对话进行。",
    /**
     * Learn the provider's tool capability from what actually happened, so an unprobed
     * provider converges after one turn instead of re-asking forever
     * (CR-20260911-tool-availability).
     */
    recordToolSupport: (result) => {
      if (support !== "unknown" || !toolsUsable) {
        return;
      }
      input.store.setProviderToolSupport(input.userId, provider.id, model, result);
    },
    run: (emit, persist) =>
      runToolLoop({
        registry,
        toolSpecs: toolFit.specs,
        toolContext: { ...toolContext, signal: turnSignal },
        messages: assembled,
        contextWindow: window,
        emit,
        signal: turnSignal,
        persist,
        providerTurn: ({ messages, tools }) =>
          withFailover((candidate, model) =>
            streamFactory({
              provider: candidate.id === provider.id ? providerConfig : toStreamProviderConfig(candidate),
              messages,
              model,
              signal: turnSignal,
              tools: toolsUsable ? tools : undefined,
              includeUsage: candidate.kind !== "local",
            })
          ),
      }),
    store: input.store,
    estimateFallback: () => estimateMessagesTokens(assembled),
    onFinal: input.onFinal,
    onSettled: releaseTurn,
  });
}

/**
 * Rebuild conversation messages, tagging each with the user turn it belongs to.
 *
 * When a compaction summary exists, the LAST one is the boundary: everything before it
 * has already been folded in, so only the summary plus what follows is replayed
 * (DEC-030 ①). The original rows stay in the database untouched — compaction only
 * changes what is sent to the model.
 */
function loadHistory(
  store: Store,
  conversationId: string
): { messages: TurnMessage[]; lastRowIdByTurn: Map<number, string> } {
  const all = store.listMessages(conversationId);

  // Summaries are found before the replayable filter, because `summary` is deliberately
  // NOT in REPLAYABLE_STATUSES — that omission is what makes a rollback safe (DEC-030 ②).
  let boundary = -1;
  for (let index = all.length - 1; index >= 0; index -= 1) {
    if (all[index].status === SUMMARY_STATUS) {
      boundary = index;
      break;
    }
  }

  const summaryRow = boundary >= 0 ? all[boundary] : null;
  const scoped = boundary >= 0 ? all.slice(boundary + 1) : all;
  const records = scoped.filter((record) => REPLAYABLE_STATUSES.has(record.status));

  const messages: TurnMessage[] = [];
  // Where each turn ends in the database — the anchor a compaction summary is inserted
  // behind (DEC-030 ①). Turn 0 is the previous summary itself.
  const lastRowIdByTurn = new Map<number, string>();
  let turn = 0;
  if (summaryRow) {
    messages.push({ role: "system", content: summaryRow.content, turn });
    lastRowIdByTurn.set(turn, summaryRow.id);
  }
  for (const record of records) {
    if (record.role === "user") {
      turn += 1;
    }
    lastRowIdByTurn.set(turn, record.id);
    if (record.role === "tool") {
      messages.push({
        role: "tool",
        content: record.content,
        tool_call_id: record.toolCallId ?? undefined,
        turn,
      });
      continue;
    }
    messages.push({
      role: record.role,
      content: record.content,
      ...(record.toolCalls ? { tool_calls: record.toolCalls } : {}),
      turn,
    });
  }
  return { messages, lastRowIdByTurn };
}

type CompactionOutcome = "not-attempted" | "applied" | "failed";

/**
 * REQ-NF-007 ④ (CP-8): the refusal names what was already tried, so the user is not told
 * to open a new conversation as if compaction had never been attempted.
 */
function describeOverflow(base: string, compaction: CompactionOutcome): string {
  if (compaction === "applied") {
    return `已压缩早前对话并收窄工具结果，${base}`;
  }
  if (compaction === "failed") {
    return `压缩早前对话未成功，已按原样收窄工具结果，${base}`;
  }
  return base;
}

const SUMMARY_SYSTEM_PROMPT =
  "你在压缩一段对话历史，供后续轮次作为背景使用。请写一份简洁的中文摘要，必须保留：" +
  "已经做出的决定、明确的约束与偏好、专有名词与标识符（文件名、接口名、编号）、以及尚未完成的事项。" +
  "不要复述寒暄，不要添加原文没有的内容。只输出摘要正文。";

/**
 * Fold `messages` up to `through` into one summary, persist it, and return it
 * (REQ-F-042 ②, REQ-NF-012 ②③④; TASK-078).
 *
 * Uses the same provider and model as the conversation itself (user ruling, 2026-09-11).
 * Returns `null` on any failure — the caller then proceeds uncompacted.
 */
async function summarizeSpan(input: {
  store: Store;
  conversationId: string;
  provider: ProviderRuntimeConfig;
  /** The model this turn resolved to — the summary uses the very same one (CP-2). */
  model: string;
  messages: TurnMessage[];
  through: number;
  /** Database id of the last row the summary covers; the summary is inserted behind it. */
  anchorId: string | null;
  summarize?: Completer;
}): Promise<string | null> {
  const span = input.messages.filter((message) => message.turn <= input.through);
  if (span.length === 0) {
    return null;
  }

  // Incremental (REQ-NF-012 ②): a previous summary arrives as a `system` row inside the
  // span, so folding the span forward re-summarises the summary rather than the whole
  // conversation. Without this, every compaction would re-read everything from turn 1.
  const transcript = span
    .map((message) => {
      const who = message.role === "system" ? "已有摘要" : message.role === "tool" ? "工具结果" : message.role;
      return `[${who}] ${message.content}`;
    })
    .join("\n\n");

  // Same provider AND same model as the conversation (user ruling Q2, 2026-09-11):
  // `makeCompleter` sends `defaultModel`, so a per-turn model override has to be folded
  // in here or the summary would quietly come from a different model.
  const completer = input.summarize ?? makeCompleter({ ...input.provider, defaultModel: input.model });
  let summary: string;
  try {
    summary = await completer(
      [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      { maxTokens: SUMMARY_MAX_TOKENS, timeoutMs: 30_000 }
    );
  } catch {
    return null;
  }

  const text = summary?.trim();
  if (!text) {
    return null;
  }

  const row = {
    conversationId: input.conversationId,
    role: "system" as const,
    content: text,
    status: SUMMARY_STATUS,
  };
  if (input.anchorId) {
    input.store.insertMessageAfter(input.anchorId, row);
  } else {
    input.store.appendMessage(row);
  }
  // REQ-NF-012 ④: the summary call costs tokens, and hiding that would defeat the
  // measurement REQ-NF-007 relies on.
  input.store.addUsage(input.conversationId, {
    inputTokens: estimateTokens(transcript),
    outputTokens: estimateTokens(text),
    estimated: true,
  });
  return text;
}

function describeDisplay(): string | null {
  try {
    const view = resolveDisplayView();
    return view.kind === "insight" ? "正在显示一份洞察报告" : "标题视图";
  } catch {
    return null;
  }
}

function createStreamingResponse(input: {
  conversationId: string;
  messageId: string;
  signal?: AbortSignal;
  /** Events that describe this send's preparation (e.g. `compacted`), sent right after `start`. */
  preamble?: ChatDelta[];
  toolsUsable: boolean;
  /** Called once per turn with what the provider actually demonstrated. */
  recordToolSupport?: (result: "yes" | "no") => void;
  /** 开场就说清的换模型原因（能力不足），空串表示没换。 */
  providerNotice: string;
  /** 流结束时回看有没有发生过失败下沉——它在第一次调用之中才知道。 */
  readFailoverNote: () => string;
  toolsUnavailableReason: string;
  store: Store;
  estimateFallback: () => number;
  run: (
    emit: (delta: ChatDelta) => void,
    persist: (message: ChatMessage & { status: string; sources?: Source[] }) => void
  ) => Promise<{ text: string; status: string; sources: Source[]; toolsUsed: string[]; errorMessage?: string }>;
  onFinal?: (finalText: string, status: string, conversationId: string, toolsUsed: string[]) => ChatDelta[];
  /** Runs once the stream has closed, however it ended — the turn's in-flight slot is released here (DEC-420 ②). */
  onSettled?: () => void;
}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (delta: ChatDelta) => {
        if (!closed) {
          controller.enqueue(encoder.encode(formatSse(delta)));
        }
      };

      let sawUsage = false;
      let toolsRejected = false;
      const emit = (delta: ChatDelta) => {
        if (delta.type === "usage") {
          sawUsage = true;
          input.store.addUsage(input.conversationId, delta.usage);
          send({ type: "usage", usage: input.store.getUsage(input.conversationId) });
          return;
        }
        if (delta.type === "tools-unavailable") {
          // The adapter dropped `tools` after the provider rejected the field.
          toolsRejected = true;
        }
        send(delta);
      };

      const persist = (message: ChatMessage & { status: string; sources?: Source[] }) => {
        input.store.appendMessage({
          conversationId: input.conversationId,
          role: message.role,
          content: message.content,
          status: message.status,
          toolCalls: message.tool_calls ?? null,
          toolCallId: message.tool_call_id ?? null,
          sources: (message.sources as SourceRecord[] | undefined) ?? null,
        });
      };

      send({ type: "start", conversationId: input.conversationId, messageId: input.messageId });

      if (input.providerNotice) {
        send({ type: "notice", text: input.providerNotice });
      }
      for (const delta of input.preamble ?? []) {
        send(delta);
      }
      if (!input.toolsUsable) {
        send({ type: "tools-unavailable", reason: input.toolsUnavailableReason });
      }

      try {
        const result = await input.run(emit, persist);

        // Evidence beats guessing: a tool that actually ran proves support, a rejected
        // `tools` field proves the opposite. Anything else leaves the state unknown so
        // the next turn tries again rather than locking in a wrong answer.
        if (toolsRejected) {
          input.recordToolSupport?.("no");
        } else if (result.toolsUsed.length > 0) {
          input.recordToolSupport?.("yes");
        }

        // REQ-F-039: sources are their own structure, assembled server-side from what the
        // tools actually returned. The prose already streamed and is never rewritten.
        if (result.sources.length > 0) {
          send({ type: "sources", sources: result.sources });
        }

        // REQ-F-037 ④: providers that never report usage still get a number, flagged.
        // DEC-420 ③: unless the provider refused the request — nothing was processed, so
        // nothing is estimated. Seventeen refused retries once pushed one conversation's
        // total to 891,627 "input tokens" that were never sent (EV-2026-09-23 §1).
        if (!sawUsage && result.status !== "error") {
          const usage = {
            inputTokens: input.estimateFallback(),
            outputTokens: estimateTokens(result.text),
            estimated: true,
          };
          input.store.addUsage(input.conversationId, usage);
          send({ type: "usage", usage: input.store.getUsage(input.conversationId) });
        }

        // 失败下沉是在流里发生的，只有跑完才知道有没有换过——所以这句话在这里说，
        // 而不是开场（REQ-F-210 ③）。
        const failover = input.readFailoverNote();
        if (failover) {
          send({ type: "notice", text: failover });
        }

        for (const delta of input.onFinal?.(result.text, result.status, input.conversationId, result.toolsUsed) ?? []) {
          send(delta);
        }

        if (result.status === "stopped") {
          send({ type: "stopped" });
        } else if (result.status === "error") {
          send({ type: "error", message: result.errorMessage ?? "Provider stream failed." });
        } else {
          send({ type: "done", messageId: input.messageId });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider stream failed.";
        send({ type: "error", message });
      } finally {
        closed = true;
        controller.close();
        input.onSettled?.();
      }
    },
  });
}

function toStreamProviderConfig(provider: ProviderRuntimeConfig): StreamProviderConfig {
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    secret: provider.secret,
  };
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= 60) {
    return compact;
  }
  return `${compact.slice(0, 57)}...`;
}
