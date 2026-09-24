import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChatTurn } from "@/lib/chat";
import { createStore, type AddMessageInput, type Store } from "@/lib/store";
import { ToolRegistry, type ToolDescriptor } from "@/lib/tools/registry";
import type { ChatMessage } from "@/lib/types";

/**
 * What the OpenAI-compatible providers enforce (DEC-420): a `tool` row must answer a call
 * in the immediately preceding assistant message, each call exactly once, and nothing
 * else may sit between an assistant's `tool_calls` and its results.
 */
function isLegalToolSequence(messages: ChatMessage[]): boolean {
  let open = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.tool_call_id || !open.has(message.tool_call_id)) {
        return false;
      }
      open.delete(message.tool_call_id);
      continue;
    }
    if (open.size > 0) {
      return false;
    }
    open = message.role === "assistant" ? new Set((message.tool_calls ?? []).map((call) => call.id)) : new Set();
  }
  return open.size === 0;
}

const encryptionKey = "0123456789abcdef0123456789abcdef";

function localProvider(store: Store, userId: string): string {
  return store.saveProvider(userId, {
    name: "Local",
    kind: "local",
    authMode: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama",
    enabled: true,
  }).id;
}

async function readSse(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("runChatTurn", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-"));
    store = createStore(join(dir, "test.sqlite"), encryptionKey);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams provider deltas, persists the conversation, and returns start/delta/done", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "Explain gravity",
      providerStream: async function* () {
        yield { type: "delta", text: "Gravity" };
        yield { type: "delta", text: " pulls." };
      },
    });

    const body = await readSse(stream);
    const [conversation] = store.listRecentConversations(user.id);

    expect(body).toContain("event: start");
    expect(body).toContain('"text":"Gravity"');
    expect(body).toContain("event: done");
    expect(conversation.title).toBe("Explain gravity");
    expect(store.listMessages(conversation.id)).toEqual([
      expect.objectContaining({ role: "user", content: "Explain gravity", status: "complete" }),
      expect.objectContaining({ role: "assistant", content: "Gravity pulls.", status: "complete" }),
    ]);
  });

  it("continues an existing conversation and replays prior turns as model context", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const first = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "My name is Ada.",
      providerStream: async function* () {
        yield { type: "delta", text: "Nice to meet you, Ada." };
      },
    });
    const firstBody = await readSse(first);
    const conversationId = JSON.parse(firstBody.match(/data: (\{"type":"start".*)/)![1]).conversationId as string;

    let received: ChatMessage[] = [];
    const second = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      conversationId,
      message: "What is my name?",
      providerStream: async function* (input) {
        received = input.messages;
        yield { type: "delta", text: "Your name is Ada." };
      },
    });
    await readSse(second);

    expect(store.listRecentConversations(user.id)).toHaveLength(1);
    expect(received[0]).toEqual({ role: "system", content: expect.stringContaining("Agent-Jarvis") });
    expect(received.map((m) => m.content)).toEqual([
      expect.stringContaining("Agent-Jarvis"),
      // REQ-F-120 ④ (CR-20260912-runtime-visibility): the volatile suffix now always
      // carries which provider and model this turn is running on. It sits AFTER the stable
      // prefix and BEFORE the replayed history — switching model must not rewrite the
      // prefix, which is what REQ-NF-008 ① protects.
      expect.stringContaining("当前运行时"),
      "My name is Ada.",
      "Nice to meet you, Ada.",
      "What is my name?",
    ]);
    expect(received[1]).toMatchObject({ role: "system" });
  });

  it("rejects a conversation the user does not own", async () => {
    const owner = store.upsertUser({ email: "owner@example.com", name: "Owner" });
    const attacker = store.upsertUser({ email: "attacker@example.com", name: "Attacker" });
    const providerId = localProvider(store, attacker.id);
    const conversation = store.createConversation(owner.id, "Owner chat");

    await expect(
      runChatTurn({ store, userId: attacker.id, providerId, conversationId: conversation.id, message: "hi" })
    ).rejects.toMatchObject({ status: 404, message: "Conversation not found." });
  });

  it("persists a stopped status and partial text when the provider stream is aborted", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);
    const controller = new AbortController();

    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "Long answer please",
      signal: controller.signal,
      providerStream: async function* () {
        yield { type: "delta", text: "partial" };
        controller.abort();
        yield { type: "stopped" };
      },
    });

    const body = await readSse(stream);
    const [conversation] = store.listRecentConversations(user.id);

    expect(body).toContain("event: stopped");
    expect(body).not.toContain("event: done");
    expect(store.listMessages(conversation.id).at(-1)).toMatchObject({
      role: "assistant",
      content: "partial",
      status: "stopped",
    });
  });

  it("surfaces provider errors without storing the error text as an assistant reply", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "trigger failure",
      providerStream: async function* () {
        yield { type: "delta", text: "half" };
        yield { type: "error", message: "Provider request failed (401): bad key." };
      },
    });

    const body = await readSse(stream);
    const [conversation] = store.listRecentConversations(user.id);
    const assistant = store.listMessages(conversation.id).at(-1);

    expect(body).toContain('"message":"Provider request failed (401): bad key."');
    expect(assistant).toMatchObject({ role: "assistant", content: "half", status: "error" });
    expect(assistant?.content).not.toContain("401");
  });

  it("rejects missing providers before creating a conversation", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });

    await expect(
      runChatTurn({ store, userId: user.id, providerId: "missing", message: "hello" })
    ).rejects.toMatchObject({ status: 404, message: "Selected model provider is not connected." });
    expect(store.listRecentConversations(user.id)).toHaveLength(0);
  });

  // CR-20260909 — TASK-022 / TEST-025 / TEST-026
  it("resolves the highest-priority connected provider when the turn names none", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const first = store.saveProvider(user.id, {
      name: "Primary",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:1/v1",
      defaultModel: "primary-model",
      enabled: true,
    }).id;
    store.saveProvider(user.id, {
      name: "Secondary",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:2/v1",
      defaultModel: "secondary-model",
      enabled: true,
    });

    let sentModel = "";
    const stream = await runChatTurn({
      store,
      userId: user.id,
      message: "hi",
      providerStream: async function* (input) {
        sentModel = input.provider.defaultModel;
        yield { type: "delta", text: "ok" };
      },
    });
    await readSse(stream);
    expect(sentModel).toBe("primary-model");

    // Raising the second provider makes it the resolved one.
    store.reorderProvider(user.id, first, "down");
    let secondModel = "";
    const stream2 = await runChatTurn({
      store,
      userId: user.id,
      message: "hi again",
      providerStream: async function* (input) {
        secondModel = input.provider.defaultModel;
        yield { type: "delta", text: "ok" };
      },
    });
    await readSse(stream2);
    expect(secondModel).toBe("secondary-model");
  });

  it("falls through to the next provider when the top one is not connected", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    // api_key provider with no secret -> not connected; must be skipped.
    store.saveProvider(user.id, {
      name: "Broken",
      kind: "openai",
      authMode: "api_key",
      baseUrl: "http://127.0.0.1:1/v1",
      defaultModel: "broken-model",
      enabled: true,
    });
    store.saveProvider(user.id, {
      name: "Working",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:2/v1",
      defaultModel: "working-model",
      enabled: true,
    });

    let used = "";
    const stream = await runChatTurn({
      store,
      userId: user.id,
      message: "hi",
      providerStream: async function* (input) {
        used = input.provider.defaultModel;
        yield { type: "delta", text: "ok" };
      },
    });
    await readSse(stream);
    expect(used).toBe("working-model");
  });

  it("rejects with 409 and creates no conversation when nothing is connected", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    store.saveProvider(user.id, {
      name: "Disabled",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:1/v1",
      defaultModel: "m",
      enabled: false,
    });

    await expect(runChatTurn({ store, userId: user.id, message: "hi" })).rejects.toMatchObject({ status: 409 });
    expect(store.listRecentConversations(user.id)).toHaveLength(0);
  });

  // CR-20260909-skills — TEST-035 (injection) / TEST-036 (HTML capture) / CP-14 (default unchanged)
  // SUPERSEDED by CR-20260910-agent-tooling. Two behaviours went away together:
  //   - the per-turn skill segment (REQ-F-022): the body is no longer pasted into the
  //     system prompt; the model calls `read_skill` when it wants one (TEST-069).
  //   - the ```html fence capture (REQ-F-023): "skill turn" stopped being a concept, so
  //     capture became the explicit `save_insight` tool (TEST-070).
  // What replaces them here is the property that made both possible: the loop.
  it("REQ-F-029: 工具调用循环——回喂结果后继续，直到模型不再要求工具", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const rounds: ChatMessage[][] = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "读一下技能",
      providerStream: async function* (input) {
        rounds.push(input.messages);
        if (rounds.length === 1) {
          yield { type: "tool_call", callId: "t1", name: "list_skills", argsSummary: "{}" };
          return;
        }
        yield { type: "delta", text: "done" };
      },
    });
    const sse = await readSse(stream);

    // Two provider calls: the tool request, then the answer once the result was fed back.
    expect(rounds).toHaveLength(2);
    const toolMessage = rounds[1].find((message) => message.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("t1");
    // The step stream reached the client.
    expect(sse).toContain("event: tool_call");
    expect(sse).toContain("event: tool_result");

    // The tool round-trip is persisted so a refresh can rebuild it (REQ-F-013).
    const [conversation] = store.listRecentConversations(user.id);
    const stored = store.listMessages(conversation.id);
    expect(stored.some((row) => row.role === "tool" && row.toolCallId === "t1")).toBe(true);
  });

  // CR-20260911-tool-availability. The defect this guards: `unknown` is the state every
  // provider starts in, and the first version treated it like `no` — so out of the box
  // no tools registered and the model could not reach web_search at all.
  it("REQ-F-040 ③: 未探测的 Provider 仍然注册工具，模型可以调起来", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);
    // No probe has ever run for this provider/model pair.
    expect(store.getProviderForUser(user.id, providerId)?.toolSupport ?? null).toBeNull();

    let offeredTools: unknown[] | undefined;
    let round = 0;
    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "搜一下",
      providerStream: async function* (input) {
        round += 1;
        offeredTools = input.tools;
        if (round === 1) {
          yield { type: "tool_call", callId: "t1", name: "show_home", argsSummary: "{}" };
          return;
        }
        yield { type: "delta", text: "done" };
      },
    });
    await readSse(stream);

    expect(offeredTools, "未探测的 Provider 也必须收到 tools 定义").toBeDefined();
    expect((offeredTools ?? []).length).toBeGreaterThan(0);

    // And the turn teaches the store what it learned, so later turns skip the guessing.
    expect(store.getProviderForUser(user.id, providerId)?.toolSupport).toMatchObject({ llama: "yes" });
  });

  /**
   * TEST-360 — 能力不足与失败时按优先级下沉（REQ-F-210，DEC-280）。
   *
   * 用户 2026-09-14：「若有时候 DeepSeek 作为优先级高的模型能力不足的地方，可由优先级
   * 不高的模型如 openai 执行。」2026-09-14 实测的那次超时正是它要救的场面：队首返回 200
   * 之后 60 秒零字节，而第二个 Provider 3.6 秒就答完了。
   */
  function twoProviders(userId: string): { head: string; next: string } {
    const head = store.saveProvider(userId, {
      name: "队首", kind: "local", authMode: "local",
      baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "head-model", enabled: true,
    }).id;
    const next = store.saveProvider(userId, {
      name: "备用", kind: "local", authMode: "local",
      baseUrl: "http://127.0.0.1:11435/v1", defaultModel: "next-model", enabled: true,
    }).id;
    return { head, next };
  }

  it("① 队首不支持工具调用时，换给排在后面那个（而不是整轮降级）", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const { head } = twoProviders(user.id);
    store.setProviderToolSupport(user.id, head, "head-model", "no");

    const used: string[] = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      message: "hi",
      providerStream: async function* (input) {
        used.push(input.provider.baseUrl);
        yield { type: "delta", text: "ok" };
      },
    });
    const sse = await readSse(stream);

    expect(used).toEqual(["http://127.0.0.1:11435/v1"]); // 备用那台
    expect(sse).toContain("不支持工具调用，本轮改用");
    // 换过去的那个没被判过 no，所以工具照常注册——不该再出现降级提示。
    expect(sse).not.toContain("event: tools-unavailable");
  });

  it("② 队首零输出就失败时，换下一个重试一次，并说出原因", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    twoProviders(user.id);

    const seen: string[] = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      message: "hi",
      providerStream: async function* (input) {
        seen.push(input.provider.baseUrl);
        if (seen.length === 1) {
          // 2026-09-14 实测的形状：usage 先到，然后整整 60 秒零 delta。
          yield { type: "usage", usage: { inputTokens: 10, outputTokens: 0, estimated: true } };
          yield { type: "error", message: "Provider stream timed out." };
          return;
        }
        yield { type: "delta", text: "备用答完了" };
      },
    });
    const sse = await readSse(stream);

    expect(seen).toEqual(["http://127.0.0.1:11434/v1", "http://127.0.0.1:11435/v1"]);
    expect(sse).toContain("备用答完了");
    expect(sse).toContain("未能应答");
    expect(sse).not.toContain("event: error");
  });

  it("③ 已经吐字之后再失败就不换——半句话被另一个模型接着写，比失败更糟", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    twoProviders(user.id);

    const seen: string[] = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      message: "hi",
      providerStream: async function* (input) {
        seen.push(input.provider.baseUrl);
        yield { type: "delta", text: "说了一半" };
        yield { type: "error", message: "断了" };
      },
    });
    const sse = await readSse(stream);

    expect(seen).toEqual(["http://127.0.0.1:11434/v1"]);
    expect(sse).toContain("event: error");
    expect(sse).not.toContain("未能应答");
  });

  it("④ 用户显式指定 Provider 时不下沉——那是他自己的选择", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const { head } = twoProviders(user.id);

    const seen: string[] = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId: head,
      message: "hi",
      providerStream: async function* (input) {
        seen.push(input.provider.baseUrl);
        yield { type: "error", message: "挂了" };
      },
    });
    const sse = await readSse(stream);

    expect(seen).toEqual(["http://127.0.0.1:11434/v1"]);
    expect(sse).toContain("event: error");
  });

  it("REQ-F-040 ③: 明确探测为 no 的 Provider 降级为纯对话并提醒", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);
    store.setProviderToolSupport(user.id, providerId, "llama", "no");

    let offeredTools: unknown[] | undefined = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "hi",
      providerStream: async function* (input) {
        offeredTools = input.tools;
        yield { type: "delta", text: "plain" };
      },
    });
    const sse = await readSse(stream);

    expect(offeredTools).toBeUndefined();
    expect(sse).toContain("event: tools-unavailable");
  });

  it("REQ-F-030 ②: 技能正文不进 system prompt，只留名录", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);
    store.insertSkill(user.id, {
      name: "reporter",
      description: "写报告",
      dirPath: "/tmp/does-not-need-to-exist",
    });

    let sent: ChatMessage[] = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "hi",
      providerStream: async function* (input) {
        sent = input.messages;
        yield { type: "delta", text: "ok" };
      },
    });
    await readSse(stream);

    const system = sent.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    expect(system).toContain("reporter");
    expect(system).toContain("read_skill");
    // The catalogue is a name plus one line — never the folder contents.
    expect(system).not.toContain("SKILL.md 正文");
  });

  /**
   * TEST-541 — DEC-420 (CR-20260923-orphan-tool-results). Three defects, one measured
   * conversation (EV-2026-09-23 §1): a user row landed between an assistant's `tool_calls`
   * and its results because the previous turn was still running server-side when the user
   * pressed stop and typed again; the replay never repaired it, so every later send was
   * refused with a 400; and each refused send still added an *estimated* context cost to
   * the conversation total, which reached 891,627 "input tokens" that were never sent.
   */
  it("DEC-420 ①: 回放时跳过没有对应调用的 tool 行并提示，数据库一行不动", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);
    const conversation = store.createConversation(user.id, "受损会话");
    const seed = (row: Omit<AddMessageInput, "conversationId">) => store.appendMessage({ conversationId: conversation.id, ...row });
    const call = (id: string) => ({ id, type: "function" as const, function: { name: "save_knowledge", arguments: "{}" } });

    // The production seam, verbatim in shape.
    seed({ role: "user", content: "拉一下对比表", status: "complete" });
    seed({ role: "assistant", content: "", status: "complete", toolCalls: [call("k1"), call("k2")] });
    seed({ role: "user", content: "你好", status: "complete" });
    seed({ role: "tool", content: "已存为知识条目 1", status: "complete", toolCallId: "k1" });
    seed({ role: "tool", content: "已存为知识条目 2", status: "complete", toolCallId: "k2" });
    seed({ role: "assistant", content: "你好！刚才那批抓取被中止了。", status: "stopped" });

    let sent: ChatMessage[] = [];
    const stream = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      conversationId: conversation.id,
      message: "继续",
      providerStream: async function* (input) {
        sent = input.messages;
        yield { type: "delta", text: "继续中" };
      },
    });
    const sse = await readSse(stream);

    expect(sse).toContain("已跳过 2 条错位的工具结果");
    expect(sse).toContain("event: done");
    // What the provider receives is legal: the two calls get「已中止」right behind their
    // assistant row; the stranded results are not sent at all.
    expect(isLegalToolSequence(sent.filter((message) => message.role !== "system"))).toBe(true);
    expect(sent.some((message) => message.content === "已存为知识条目 1")).toBe(false);
    expect(sent.filter((message) => message.role === "tool").map((message) => message.content)).toEqual(["[已中止]", "[已中止]"]);
    // The database keeps every row — six seeded plus this turn's user and assistant.
    const rows = store.listMessages(conversation.id);
    expect(rows).toHaveLength(8);
    expect(rows.filter((row) => row.role === "tool").map((row) => row.content)).toEqual(["已存为知识条目 1", "已存为知识条目 2"]);
  });

  it("DEC-420 ②: 上一轮未结束时再次发送——先中止旧轮，库里 tool_calls 与其结果之间不再插入 user 行", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);
    const conversation = store.createConversation(user.id, "长任务");

    // A tool that never finishes on its own — the shape of "still saving knowledge entries
    // when the user pressed stop and typed again". Only the abort ends it.
    const slowTool: ToolDescriptor = {
      name: "slow_tool",
      description: "慢工具",
      parameters: { type: "object", properties: {} },
      available: () => true,
      execute: () => new Promise(() => {}) as never,
    };
    const extraTools = new ToolRegistry().register(slowTool);

    let firstRounds = 0;
    const first = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      conversationId: conversation.id,
      message: "开始长任务",
      extraTools,
      providerStream: async function* () {
        firstRounds += 1;
        if (firstRounds === 1) {
          yield { type: "tool_call", callId: "slow-1", name: "slow_tool", argsSummary: "{}" };
          return;
        }
        yield { type: "delta", text: "不该到这里" };
      },
    });
    const firstBody = readSse(first);
    // The first turn has written its tool_calls row and is now inside the tool.
    await vi.waitFor(() => {
      expect(store.listMessages(conversation.id).some((row) => row.role === "assistant" && (row.toolCalls?.length ?? 0) > 0)).toBe(true);
    });

    let secondSent: ChatMessage[] = [];
    const second = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      conversationId: conversation.id,
      message: "你好",
      providerStream: async function* (input) {
        secondSent = input.messages;
        yield { type: "delta", text: "你好！" };
      },
    });
    const secondBody = await readSse(second);
    const firstSse = await firstBody;

    // The superseded turn ended as stopped, its call answered with「已中止」BEFORE the new
    // user row — that ordering is the whole point.
    expect(firstSse).toContain("event: stopped");
    const shape = store
      .listMessages(conversation.id)
      .map((row) => `${row.role}${(row.toolCalls?.length ?? 0) > 0 ? "+calls" : ""}${row.toolCallId ? `[${row.toolCallId}]` : ""}`);
    expect(shape).toEqual(["user", "assistant+calls", "tool[slow-1]", "user", "assistant"]);
    expect(secondBody).toContain("上一轮尚未结束，已先将其中止");
    expect(secondBody).toContain("event: done");
    expect(isLegalToolSequence(secondSent.filter((message) => message.role !== "system"))).toBe(true);
    expect(firstRounds).toBe(1);
  });

  it("DEC-420 ③: 被提供方拒绝且没有 usage 的请求不计入会话累计用量；正常完成仍保留预估", async () => {
    const user = store.upsertUser({ email: "user@example.com", name: "User" });
    const providerId = localProvider(store, user.id);

    const refused = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      message: "hi",
      providerStream: async function* () {
        yield { type: "error", message: "Provider request failed (400): Messages with role 'tool' must be a response to a preceding message with 'tool_calls'." };
      },
    });
    const refusedSse = await readSse(refused);
    const [conversation] = store.listRecentConversations(user.id);

    expect(refusedSse).toContain("event: error");
    expect(refusedSse).not.toContain("event: usage");
    expect(store.getUsage(conversation.id)).toMatchObject({ inputTokens: 0, outputTokens: 0 });

    // A completed turn from a provider that reports no usage is still estimated (REQ-F-037 ④).
    const completed = await runChatTurn({
      store,
      userId: user.id,
      providerId,
      conversationId: conversation.id,
      message: "again",
      providerStream: async function* () {
        yield { type: "delta", text: "ok" };
      },
    });
    const completedSse = await readSse(completed);
    expect(completedSse).toContain("event: usage");
    const usage = store.getUsage(conversation.id);
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.estimated).toBe(true);
  });
});
