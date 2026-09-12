import { describe, expect, it } from "vitest";
import { estimateTokens } from "@/lib/adapters";
import { BUDGET_SHARES, budgetTokens } from "@/lib/tools/budget";
import { TOOL_PRIORITY, ToolRegistry, type ToolContext, type ToolDescriptor } from "@/lib/tools/registry";

/**
 * TEST-133 — the tool-definition budget, finally enforced
 * (CR-20260912-tool-budget; 出口义务 3 与 4).
 *
 * `BUDGET_SHARES.toolDefinitions` was declared when budget.ts was written and then never
 * read by anything. Measured afterwards: 18 tools ship 1734 tokens of schema against a
 * 655-token allowance at an 8k window. These cases pin the fix and, more importantly,
 * pin the honesty requirement — a tool that does not fit must be NAMED, not silently
 * missing.
 */

const context: ToolContext = {
  userId: "u",
  conversationId: "c",
  skillCount: 1,
  webEnabled: true,
  searchConfigured: true,
  knowledgeCount: 1,
};

function tool(name: string, priority: ToolDescriptor["priority"], padding = 0): ToolDescriptor {
  return {
    name,
    description: `${name} 的说明`,
    priority,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 1 + padding }, (_, index) => [`arg${index}`, { type: "string", description: "参数说明文字" }])
      ),
    },
    available: () => true,
    async execute() {
      return { ok: true, content: "", summary: "" };
    },
  };
}

function registryOf(...tools: ToolDescriptor[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const item of tools) {
    registry.register(item);
  }
  return registry;
}

describe("工具定义预算", () => {
  it("① 预算够时全部装载，顺序保持注册顺序（前缀逐字稳定）", () => {
    const registry = registryOf(
      tool("m1", TOOL_PRIORITY.management),
      tool("e1", TOOL_PRIORITY.essential),
      tool("n1", TOOL_PRIORITY.normal)
    );
    const fit = registry.fitFor(context, 10_000);
    expect(fit.dropped).toEqual([]);
    expect(fit.loaded.map((t) => t.name)).toEqual(["m1", "e1", "n1"]);
    expect(fit.specs.map((s) => s.function.name)).toEqual(["m1", "e1", "n1"]);
  });

  it("② 预算不够时按优先级丢：先丢管理类，基础读取工具留到最后", () => {
    const registry = registryOf(
      tool("manage", TOOL_PRIORITY.management, 6),
      tool("read", TOOL_PRIORITY.essential, 6),
      tool("web", TOOL_PRIORITY.normal, 6)
    );
    const one = estimateTokens(JSON.stringify(registry.specsFor(context)[0])) + 10;
    const fit = registry.fitFor(context, one * 2);
    expect(fit.loaded.map((t) => t.name)).toEqual(["read", "web"]);
    expect(fit.dropped.map((t) => t.name)).toEqual(["manage"]);
  });

  it("③ 被丢掉的工具必须在名录里被点名——静默消失会变成模型悄悄做不了事", () => {
    const registry = registryOf(tool("read", TOOL_PRIORITY.essential, 6), tool("manage", TOOL_PRIORITY.management, 6));
    const fit = registry.fitFor(context, estimateTokens(JSON.stringify(registry.specsFor(context)[0])) + 10);
    const catalogue = registry.catalogueFor(context, fit);
    expect(catalogue).toContain("read");
    expect(catalogue).toContain("本轮未加载");
    expect(catalogue).toContain("manage");
    // And the loaded list in the prefix matches the wire array exactly.
    expect(fit.specs.map((s) => s.function.name)).toEqual(["read"]);
  });

  it("④ 预算小到连一个都装不下时仍装一个——零工具等于 agent 完全不能动", () => {
    const registry = registryOf(tool("read", TOOL_PRIORITY.essential, 20));
    const fit = registry.fitFor(context, 1);
    expect(fit.loaded.map((t) => t.name)).toEqual(["read"]);
    expect(fit.tokens).toBeGreaterThan(1);
  });

  it("⑤ 没有声明优先级的工具按 normal 处理，排在管理类之前", () => {
    const undeclared: ToolDescriptor = { ...tool("plain", undefined, 6) };
    const registry = registryOf(tool("manage", TOOL_PRIORITY.management, 6), undeclared);
    const fit = registry.fitFor(context, estimateTokens(JSON.stringify(registry.specsFor(context)[0])) + 10);
    expect(fit.loaded.map((t) => t.name)).toEqual(["plain"]);
  });

  it("⑥ 不可用的工具不占预算，也不出现在「未加载」里", () => {
    const offline: ToolDescriptor = { ...tool("offline", TOOL_PRIORITY.normal), available: () => false };
    const registry = registryOf(tool("read", TOOL_PRIORITY.essential), offline);
    const fit = registry.fitFor(context, 10_000);
    expect(fit.loaded.map((t) => t.name)).toEqual(["read"]);
    expect(fit.dropped).toEqual([]);
  });

  it("⑦ 真实工具集在 8k 窗口下装得进声明的子预算，在 128k 下全装", async () => {
    const { buildRegistry } = await import("@/lib/chat");
    const store = { getSetting: () => null, setSetting: () => {} } as never;
    const registry = buildRegistry(store);
    const full: ToolContext = { ...context, skillCount: 3, knowledgeCount: 5 };

    const small = registry.fitFor(full, budgetTokens(8192, BUDGET_SHARES.toolDefinitions));
    expect(small.tokens).toBeLessThanOrEqual(budgetTokens(8192, BUDGET_SHARES.toolDefinitions));
    expect(small.dropped.length).toBeGreaterThan(0);
    // The four read tools the board depends on survive the squeeze.
    for (const name of ["search_knowledge", "read_knowledge", "list_entities", "read_entity"]) {
      expect(small.loaded.map((t) => t.name)).toContain(name);
    }

    const large = registry.fitFor(full, budgetTokens(128_000, BUDGET_SHARES.toolDefinitions));
    expect(large.dropped).toEqual([]);
  });
});
