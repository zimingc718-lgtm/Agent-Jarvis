import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { BUDGET_SHARES, budgetTokens } from "@/lib/tools/budget";
import type { ToolContext } from "@/lib/tools/registry";
import { createWebTools, SETTING_SEARCH_BASE_URL } from "@/lib/tools/web-tools";

/**
 * TEST-162 — one web result is sized against the model actually in play (REQ-F-101 ⑥;
 * DEC-080 ③; TASK-160 ③). CR-20260912-sandbox-and-budget.
 *
 * What this replaces: `Math.floor(8_000 * BUDGET_SHARES.singleToolResult * 10)` — an
 * expression shaped like a budget but constant at 12,000, because the 8,000 stood in for
 * the window and the ×10 cancelled the share back out. One page could therefore overflow
 * an 8k local model outright, while a 128k model was held to a tenth of its allowance.
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

function contextWith(contextWindow: number): ToolContext {
  return {
    userId: "u1",
    conversationId: "c1",
    skillCount: 0,
    webEnabled: true,
    searchConfigured: true,
    knowledgeCount: 0,
    contextWindow,
  };
}

/** A page far longer than any cap under test, so the cap is always what decides. */
const longPage = `<html><head><title>长文</title></head><body><p>${"供电架构与散热设计。".repeat(20_000)}</p></body></html>`;

describe("TEST-162 单条网页结果按真实窗口取上限 (REQ-F-101 ⑥)", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-cap-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    store.setSetting(SETTING_SEARCH_BASE_URL, "http://127.0.0.1:8080");
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function readWith(contextWindow: number): Promise<string> {
    const fetcher = (async () =>
      new Response(longPage, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const tools = createWebTools({ store, fetcher, resolver: async () => ["93.184.216.34"] });
    const readUrl = tools.find((tool) => tool.name === "read_url");
    expect(readUrl).toBeTruthy();
    const result = await readUrl!.execute({ url: "https://example.com/doc" }, contextWith(contextWindow));
    return result.content;
  }

  it("① 大窗口拿到的正文明显多于小窗口——上限不再是常量", async () => {
    const small = await readWith(8_192);
    const large = await readWith(128_000);
    expect(large.length).toBeGreaterThan(small.length * 4);
  });

  it("② 两者都落在各自申报的份额内（singleToolResult），不是随手拍的数", async () => {
    for (const window of [8_192, 128_000]) {
      const content = await readWith(window);
      const cap = budgetTokens(window, BUDGET_SHARES.singleToolResult);
      // The estimator is per-character; the generous factor keeps this an assertion about
      // the budget being honoured, not about the estimator's exact ratio.
      expect(content.length).toBeLessThan(cap * 4 + 200);
    }
  });

  it("③ 8k 模型下单页不再能独吞整个输入预算——旧的 12,000 常量正是这个故障", async () => {
    const content = await readWith(8_192);
    const inputBudget = budgetTokens(8_192, BUDGET_SHARES.totalInput);
    const singleShare = budgetTokens(8_192, BUDGET_SHARES.singleToolResult);
    expect(singleShare).toBeLessThan(inputBudget);
    expect(content.length).toBeLessThan(inputBudget * 4);
  });
});
