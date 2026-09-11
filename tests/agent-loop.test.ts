import { describe, expect, it, vi } from "vitest";
import { MAX_TOOL_STEPS, repairDanglingToolCalls, runToolLoop } from "@/lib/agent-loop";
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
  searchConfigured: true,
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
    expect(registry.specsFor({ ...context, searchConfigured: false }).map((s) => s.function.name)).toEqual(["skill_tool"]);
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
