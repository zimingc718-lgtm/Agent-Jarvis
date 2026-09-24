import { describe, expect, it, vi } from "vitest";
import { dropOrphanToolResults, MAX_TOOL_STEPS, repairDanglingToolCalls, runToolLoop } from "@/lib/agent-loop";
import { ToolRegistry, normalizeArgs, type ToolContext, type ToolDescriptor } from "@/lib/tools/registry";
import type { ChatDelta, ChatMessage } from "@/lib/types";

/**
 * TEST-066 / TEST-067 — the registry and the loop (REQ-F-029, REQ-NF-010; TASK-064/065).
 *
 * `providerTurn` is a factory that sees the messages fed back to it, so a multi-round
 * loop can be driven deterministically with no network at all.
 */

const context: ToolContext = {
  userId: "u1",
  conversationId: "c1",
  skillCount: 1,
  webEnabled: true,
  searchConfigured: true, knowledgeCount: 0, contextWindow: 128_000
};

function fakeTool(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    name: "echo",
    description: "回显参数",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute(args) {
      return { ok: true, content: `echo:${JSON.stringify(args)}`, summary: "echo" };
    },
    ...overrides,
  };
}

type Harness = {
  emitted: ChatDelta[];
  persisted: Array<ChatMessage & { status: string }>;
  rounds: ChatMessage[][];
};

function harness(): Harness {
  return { emitted: [], persisted: [], rounds: [] };
}

function callDelta(id: string, name: string, args = "{}"): ChatDelta {
  return { type: "tool_call", callId: id, name, argsSummary: args };
}

describe("ToolRegistry (REQ-NF-010)", () => {
  it("① 注册一个假工具即可被循环调用，无需改对话核心", async () => {
    const registry = new ToolRegistry().register(fakeTool());
    const h = harness();
    let round = 0;
    await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "hi" }],
      emit: (delta) => h.emitted.push(delta),
      persist: (message) => h.persisted.push(message),
      providerTurn: async function* () {
        round += 1;
        if (round === 1) {
          yield callDelta("t1", "echo", '{"x":1}');
          return;
        }
        yield { type: "delta", text: "done" };
      },
    });
    expect(h.emitted.filter((event) => event.type === "tool_result")).toHaveLength(1);
  });

  it("② 四种不注册场景下工具定义不进 prompt", () => {
    const registry = new ToolRegistry()
      .register(fakeTool({ name: "skill_tool", available: (ctx) => ctx.skillCount > 0 }))
      .register(fakeTool({ name: "search_tool", available: (ctx) => ctx.webEnabled && ctx.searchConfigured }));

    expect(registry.specsFor(context).map((spec) => spec.function.name)).toEqual(["skill_tool", "search_tool"]);
    expect(registry.specsFor({ ...context, skillCount: 0 }).map((s) => s.function.name)).toEqual(["search_tool"]);
    expect(registry.specsFor({ ...context, webEnabled: false }).map((s) => s.function.name)).toEqual(["skill_tool"]);
    expect(registry.specsFor({ ...context, searchConfigured: false, knowledgeCount: 0, contextWindow: 128_000 }).map((s) => s.function.name)).toEqual(["skill_tool"]);
    // Nothing available → no tool catalogue text at all.
    expect(registry.catalogueFor({ ...context, skillCount: 0, webEnabled: false })).toBe("");
  });

  it("④ description 超长即拒绝注册（前缀是每轮固定成本）", () => {
    expect(() => new ToolRegistry().register(fakeTool({ description: "长".repeat(201) }))).toThrow(/description/);
  });

  it("normalizeArgs 与键序无关", () => {
    expect(normalizeArgs({ a: 1, b: { c: 2, d: 3 } })).toBe(normalizeArgs({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

describe("tool events (CR-20260911-knowledge-base)", () => {
  it("a tool's `events` are emitted right after its tool_result, in order", async () => {
    const registry = new ToolRegistry().register(
      fakeTool({
        name: "propose",
        async execute() {
          return {
            ok: true,
            content: "proposed",
            summary: "提议",
            events: [{ type: "knowledge_pending", name: "n", title: "t" }],
          };
        },
      })
    );
    const h = harness();
    let round = 0;
    await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "hi" }],
      emit: (delta) => h.emitted.push(delta),
      persist: (message) => h.persisted.push(message),
      providerTurn: async function* () {
        round += 1;
        if (round === 1) {
          yield callDelta("t1", "propose");
          return;
        }
        yield { type: "delta", text: "done" };
      },
    });
    const types = h.emitted.map((event) => event.type);
    const at = types.indexOf("tool_result");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(types[at + 1]).toBe("knowledge_pending");
  });
});

describe("runToolLoop (REQ-F-029)", () => {
  it("①② 触顶：第 11 步被拒，成果保留并落 truncated", async () => {
    const registry = new ToolRegistry().register(fakeTool());
    const h = harness();
    await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "go" }],
      emit: (delta) => h.emitted.push(delta),
      persist: (message) => h.persisted.push(message),
      providerTurn: async function* ({ messages }) {
        h.rounds.push(messages);
        yield callDelta(`t${h.rounds.length}`, "echo");
      },
    });

    const truncated = h.emitted.find((event) => event.type === "truncated");
    expect(truncated).toBeTruthy();
    expect(h.persisted.some((message) => message.status === "truncated")).toBe(true);
    // Exactly the ceiling ran — never an 11th tool.
    expect(h.emitted.filter((event) => event.type === "tool_result")).toHaveLength(MAX_TOOL_STEPS);
  });

  it("④ 工具失败作结果回喂，循环继续", async () => {
    const registry = new ToolRegistry().register(
      fakeTool({
        async execute() {
          return { ok: false, content: "boom", summary: "失败" };
        },
      })
    );
    const h = harness();
    let round = 0;
    const result = await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "go" }],
      emit: (delta) => h.emitted.push(delta),
      persist: (message) => h.persisted.push(message),
      providerTurn: async function* ({ messages }) {
        round += 1;
        h.rounds.push(messages);
        if (round === 1) {
          yield callDelta("t1", "echo");
          return;
        }
        yield { type: "delta", text: "recovered" };
      },
    });

    expect(result.status).toBe("complete");
    // The failure text reached the model as that tool's result.
    expect(h.rounds[1].find((message) => message.role === "tool")?.content).toBe("boom");
  });

  it("⑤ 同工具同参数连续失败 2 次后第 3 次被拒", async () => {
    const execute = vi.fn(async () => ({ ok: false, content: "still broken", summary: "失败" }));
    const registry = new ToolRegistry().register(fakeTool({ execute }));
    const h = harness();
    let round = 0;
    await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "go" }],
      emit: (delta) => h.emitted.push(delta),
      persist: (message) => h.persisted.push(message),
      providerTurn: async function* () {
        round += 1;
        if (round <= 3) {
          yield callDelta(`t${round}`, "echo", '{"same":true}');
          return;
        }
        yield { type: "delta", text: "give up" };
      },
    });

    // Third identical call short-circuits before reaching the tool.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(h.emitted.some((event) => event.type === "tool_result" && !event.ok)).toBe(true);
  });

  it("⑦ 工具执行期 abort 立即生效，已完成步骤仍落库", async () => {
    const controller = new AbortController();
    const registry = new ToolRegistry().register(
      fakeTool({
        async execute() {
          controller.abort();
          // Never settles on its own — only the abort ends it.
          return new Promise(() => {}) as never;
        },
      })
    );
    const h = harness();
    const result = await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "go" }],
      signal: controller.signal,
      emit: (delta) => h.emitted.push(delta),
      persist: (message) => h.persisted.push(message),
      providerTurn: async function* () {
        yield callDelta("t1", "echo");
      },
    });

    expect(result.status).toBe("stopped");
    expect(h.persisted.some((message) => message.content === "[已中止]")).toBe(true);
  });

  it("来源只来自工具实际返回的集合（REQ-F-039 ②）", async () => {
    const registry = new ToolRegistry().register(
      fakeTool({
        async execute() {
          return {
            ok: true,
            content: "found",
            summary: "搜索",
            sources: [{ url: "https://real.example/a", title: "Real" }],
          };
        },
      })
    );
    const h = harness();
    let round = 0;
    const result = await runToolLoop({
      registry,
      toolContext: context,
      messages: [{ role: "user", content: "go" }],
      emit: (delta) => h.emitted.push(delta),
      persist: (message) => h.persisted.push(message),
      providerTurn: async function* () {
        round += 1;
        if (round === 1) {
          yield callDelta("t1", "echo");
          return;
        }
        // The model cites a URL it never fetched; it must not become a source.
        yield { type: "delta", text: "见 https://fabricated.example/b" };
      },
    });

    expect(result.sources).toEqual([{ url: "https://real.example/a", title: "Real" }]);
    expect(result.sources.some((source) => source.url.includes("fabricated"))).toBe(false);
  });
});

describe("repairDanglingToolCalls (DEC-024 ④)", () => {
  it("⑧ 为缺失结果的 tool_call 合成「已中止」，外发序列保持合法", () => {
    const repaired = repairDanglingToolCalls([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "a", type: "function", function: { name: "echo", arguments: "{}" } },
          { id: "b", type: "function", function: { name: "echo", arguments: "{}" } },
        ],
      },
      { role: "tool", content: "done-a", tool_call_id: "a" },
    ]);

    const toolRows = repaired.filter((message) => message.role === "tool");
    expect(toolRows.map((row) => row.tool_call_id)).toEqual(["a", "b"]);
    expect(toolRows[1].content).toBe("[已中止]");
  });

  it("完整的往返不被改动", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "e", arguments: "{}" } }] },
      { role: "tool", content: "ok", tool_call_id: "a" },
    ];
    expect(repairDanglingToolCalls(messages)).toEqual(messages);
  });
});

/**
 * TEST-540 — dropOrphanToolResults (DEC-420 ①, CR-20260923-orphan-tool-results).
 *
 * The shapes below are lifted from the production conversation that stayed dead for
 * seventeen sends (EV-2026-09-23-orphan-tool-results §1), not invented.
 */
describe("dropOrphanToolResults (DEC-420 ①)", () => {
  const call = (id: string) => ({ id, type: "function" as const, function: { name: "save_knowledge", arguments: "{}" } });

  it("① 生产库里的接缝：user 行插在 tool_calls 与其 4 条结果之间——结果被跳过，其余原样，串联修复后序列合法", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "拉一下对比表" },
      { role: "assistant", content: "", tool_calls: [call("a"), call("b"), call("c"), call("d")] },
      { role: "user", content: "你好" },
      { role: "tool", content: "已存为知识条目 1", tool_call_id: "a" },
      { role: "tool", content: "已存为知识条目 2", tool_call_id: "b" },
      { role: "tool", content: "已存为知识条目 3", tool_call_id: "c" },
      { role: "tool", content: "已存为知识条目 4", tool_call_id: "d" },
      { role: "assistant", content: "你好！刚才那批抓取被中止了。" },
    ];

    const { messages: kept, dropped } = dropOrphanToolResults(messages);

    expect(dropped).toBe(4);
    expect(kept.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // Input untouched — the caller owns the rows.
    expect(messages).toHaveLength(8);

    const repaired = repairDanglingToolCalls(kept);
    expect(repaired.map((message) => message.role)).toEqual(["user", "assistant", "tool", "tool", "tool", "tool", "user", "assistant"]);
    expect(repaired.filter((message) => message.role === "tool").map((message) => message.tool_call_id)).toEqual(["a", "b", "c", "d"]);
    expect(repaired.filter((message) => message.role === "tool").every((message) => message.content === "[已中止]")).toBe(true);
  });

  it("② 合法序列一条不动", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "", tool_calls: [call("a"), call("b")] },
      { role: "tool", content: "ok-a", tool_call_id: "a" },
      { role: "tool", content: "ok-b", tool_call_id: "b" },
      { role: "assistant", content: "done" },
      { role: "user", content: "more" },
    ];
    expect(dropOrphanToolResults(messages)).toEqual({ messages, dropped: 0 });
  });

  it("③ 摘要边界之后紧跟的 tool 行是孤儿——它的调用已被折进摘要", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "# 对话历史摘要 …" },
      { role: "tool", content: "已存为知识条目", tool_call_id: "a" },
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！" },
    ];
    const { messages: kept, dropped } = dropOrphanToolResults(messages);
    expect(dropped).toBe(1);
    expect(kept.map((message) => message.role)).toEqual(["system", "user", "assistant"]);
  });

  it("④ 同一 tool_call_id 只认第一条回答，重复的按孤儿跳过；没有 tool_call_id 的 tool 行也是孤儿", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "", tool_calls: [call("a")] },
      { role: "tool", content: "first", tool_call_id: "a" },
      { role: "tool", content: "second", tool_call_id: "a" },
      { role: "tool", content: "no id" },
    ];
    const { messages: kept, dropped } = dropOrphanToolResults(messages);
    expect(dropped).toBe(2);
    expect(kept.map((message) => message.content)).toEqual(["", "first"]);
  });

  it("⑤ 泛型：TurnMessage 之类带附加字段的行原样保留（同一对象引用）", () => {
    const rows = [
      { role: "user" as const, content: "go", turn: 1 },
      { role: "assistant" as const, content: "", tool_calls: [call("a")], turn: 1 },
      { role: "tool" as const, content: "ok", tool_call_id: "a", turn: 1 },
      { role: "user" as const, content: "again", turn: 2 },
      { role: "tool" as const, content: "stray", tool_call_id: "zzz", turn: 2 },
    ];
    const { messages: kept, dropped } = dropOrphanToolResults(rows);
    expect(dropped).toBe(1);
    expect(kept).toEqual([rows[0], rows[1], rows[2], rows[3]]);
    expect(kept[1]).toBe(rows[1]);
    expect(kept[1].turn).toBe(1);
  });
});
