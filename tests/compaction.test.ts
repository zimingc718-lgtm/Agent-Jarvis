import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChatTurn } from "@/lib/chat";
import { createStore, type Store } from "@/lib/store";
import {
  applySummary,
  COMPACT_KEEP_TURNS,
  COMPACT_MIN_GAIN_RATIO,
  COMPACT_TRIGGER_RATIO,
  planCompaction,
  SUMMARY_MAX_TOKENS,
  SUMMARY_STATUS,
  type TurnMessage,
} from "@/lib/tools/budget";
import type { ChatMessage } from "@/lib/types";

/**
 * TEST-079 / TEST-080 / TEST-081 — context compaction (REQ-F-042, REQ-NF-012, REQ-F-004).
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

/**
 * Build a conversation of a given SHAPE, taken from the real dev database rather than
 * invented (EV-2026-09-11 §1). The short shapes are the ones that matter: a naive
 * turn-count rule made those *more* expensive, and only real proportions expose it.
 */
function conversationOfShape(messages: number, totalChars: number): TurnMessage[] {
  const perMessage = Math.max(1, Math.floor(totalChars / messages));
  const rows: TurnMessage[] = [];
  let turn = 0;
  for (let i = 0; i < messages; i += 1) {
    const role = i % 2 === 0 ? "user" : "assistant";
    if (role === "user") {
      turn += 1;
    }
    rows.push({ role, content: "内容".repeat(Math.max(1, Math.floor(perMessage / 2))), turn });
  }
  return rows;
}

/** The five real shapes measured on the dev database. */
const SHAPES = {
  long109: conversationOfShape(109, 249_029),
  long78: conversationOfShape(78, 28_208),
  mid28: conversationOfShape(28, 8_668),
  short18: conversationOfShape(18, 2_053),
  short10: conversationOfShape(10, 1_470),
};

function turnsOf(rows: TurnMessage[]): number {
  return Math.max(...rows.map((row) => row.turn));
}

describe("planCompaction (REQ-F-042 ①③ / REQ-NF-012 ①)", () => {
  const WINDOW = 8_000;

  it("② 长会话触发压缩并给出显著净省", () => {
    for (const [name, rows] of [
      ["long109", SHAPES.long109],
      ["long78", SHAPES.long78],
    ] as const) {
      const plan = planCompaction({ messages: rows, currentTurn: turnsOf(rows), contextWindow: WINDOW });
      expect(plan.shouldCompact, name).toBe(true);
      if (plan.shouldCompact) {
        expect(plan.estimatedGain, name).toBeGreaterThan(SUMMARY_MAX_TOKENS * (COMPACT_MIN_GAIN_RATIO - 1));
      }
    }
  });

  it("③ 短会话不压缩——净省校验拦住了「压了反而更贵」", () => {
    // This is the regression the evidence caught: an 18-message conversation LOSES 19%
    // and a 10-message one loses 11% if compacted on turn count.
    for (const [name, rows] of [
      ["short18", SHAPES.short18],
      ["short10", SHAPES.short10],
    ] as const) {
      const plan = planCompaction({ messages: rows, currentTurn: turnsOf(rows), contextWindow: WINDOW });
      expect(plan.shouldCompact, name).toBe(false);
    }
  });

  it("④ 未达预算阈值就不压缩，不论轮数多少（守住「绝不按轮数触发」）", () => {
    // 200 turns of almost nothing: a turn-count rule would compact hard here.
    const many: TurnMessage[] = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "hi",
      turn: Math.floor(i / 2) + 1,
    }));
    const plan = planCompaction({ messages: many, currentTurn: 100, contextWindow: 128_000 });
    expect(plan.shouldCompact).toBe(false);
    if (!plan.shouldCompact) {
      expect(plan.reason).toBe("under-budget");
    }
  });

  it("保留最近 K 轮逐字，压缩边界落在 currentTurn - K", () => {
    const rows = SHAPES.long109;
    const currentTurn = turnsOf(rows);
    const plan = planCompaction({ messages: rows, currentTurn, contextWindow: WINDOW });
    expect(plan.shouldCompact).toBe(true);
    if (plan.shouldCompact) {
      expect(plan.through).toBe(currentTurn - COMPACT_KEEP_TURNS);
    }
  });

  it("会话太短到没有可压的轮次时，报 nothing-old-enough 而非硬压", () => {
    const rows: TurnMessage[] = [{ role: "user", content: "字".repeat(40_000), turn: 1 }];
    const plan = planCompaction({ messages: rows, currentTurn: 1, contextWindow: 1_000 });
    expect(plan.shouldCompact).toBe(false);
    if (!plan.shouldCompact) {
      expect(plan.reason).toBe("nothing-old-enough");
    }
  });

  it("applySummary 用摘要替掉被覆盖的轮次，保留其后的原文", () => {
    const rows: TurnMessage[] = [
      { role: "user", content: "old-1", turn: 1 },
      { role: "assistant", content: "old-2", turn: 1 },
      { role: "user", content: "recent", turn: 5 },
    ];
    const applied = applySummary(rows, "SUMMARY", 3);
    expect(applied.map((row) => row.content)).toEqual(["SUMMARY", "recent"]);
    expect(applied[0].role).toBe("system");
  });

  it("COMPACT_TRIGGER_RATIO 是比例而非轮数（守住设计意图）", () => {
    expect(COMPACT_TRIGGER_RATIO).toBeGreaterThan(0);
    expect(COMPACT_TRIGGER_RATIO).toBeLessThanOrEqual(1);
  });
});

describe("摘要生成与回放 (REQ-F-042 ② / REQ-NF-012 ②③④ / REQ-F-004)", () => {
  let dir: string;
  let store: Store;
  let userId: string;
  let providerId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-comp-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;
    providerId = store.saveProvider(userId, {
      name: "Local",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama",
      enabled: true,
    }).id;
    // No context_window is set, so the budget comes from the per-kind default for
    // `local` (8192 → 4915 input budget). The seeded conversations below are sized
    // against that number rather than against a value configured here.
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Seed a conversation big enough to cross the trigger. */
  function seedLongConversation(): string {
    const conversationId = store.createConversation(userId, "long").id;
    for (let turn = 0; turn < 8; turn += 1) {
      store.appendMessage({
        conversationId,
        role: "user",
        content: `问题 ${turn}：` + "细节".repeat(400),
        status: "complete",
      });
      store.appendMessage({
        conversationId,
        role: "assistant",
        content: `回答 ${turn}：` + "说明".repeat(400),
        status: "complete",
      });
    }
    return conversationId;
  }

  async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
    return new Response(stream).text();
  }

  it("① 压缩后摘要落库为 system/summary 行，原始消息仍在", async () => {
    const conversationId = seedLongConversation();
    const before = store.listMessages(conversationId).length;

    const stream = await runChatTurn({
      store,
      userId,
      providerId,
      conversationId,
      message: "继续",
      summarize: async () => "早前讨论了 A、B 两个方案，已选 B。",
      providerStream: async function* () {
        yield { type: "delta", text: "ok" };
      },
    });
    await drain(stream);

    const rows = store.listMessages(conversationId);
    const summaries = rows.filter((row) => row.status === SUMMARY_STATUS);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].role).toBe("system");
    // REQ-F-042 ⑥: compaction changes what is SENT, never what is stored.
    expect(rows.length).toBeGreaterThan(before);
    expect(rows.filter((row) => row.role === "user" && row.content.startsWith("问题 0"))).toHaveLength(1);
  });

  it("① 回放 = 最后一条摘要 + 其后原文，摘要之前的不再发送；保留的 K 轮仍逐字在场", async () => {
    const conversationId = seedLongConversation();
    const first = await drain(
      await runChatTurn({
        store,
        userId,
        providerId,
        conversationId,
        message: "第一次",
        summarize: async () => "摘要甲",
        providerStream: async function* () {
          yield { type: "delta", text: "ok" };
        },
      })
    );

    // DEC-030 ①: the summary row's POSITION is the boundary. Seed turns 1..8 (labelled
    // 问题 0..7), current turn 9, keep 3 → covered through turn 6 (回答 5). The row must
    // sit right behind 回答 5 — not at the end of the table, where it would put the
    // still-verbatim turns 7–8 *before* the boundary and drop them from the next replay.
    const rows = store.listMessages(conversationId);
    const summaryAt = rows.findIndex((row) => row.status === SUMMARY_STATUS);
    const coveredEnd = rows.findIndex((row) => row.content.startsWith("回答 5"));
    expect(summaryAt).toBe(coveredEnd + 1);
    expect(rows[summaryAt + 1].content.startsWith("问题 6")).toBe(true);

    // The client is told where the boundary is, ahead of the reply (REQ-F-043).
    expect(first).toContain("event: compacted");
    const compacted = JSON.parse(
      first.split("\n").find((line) => line.startsWith("data: ") && line.includes('"compacted"'))!.slice(6)
    ) as { summary: string; afterMessageId: string; keptTurns: number };
    expect(compacted.summary).toBe("摘要甲");
    expect(compacted.afterMessageId).toBe(rows[coveredEnd].id);
    expect(compacted.keptTurns).toBe(COMPACT_KEEP_TURNS);

    let sent: ChatMessage[] = [];
    await drain(
      await runChatTurn({
        store,
        userId,
        providerId,
        conversationId,
        message: "第二次",
        summarize: async () => "摘要乙",
        providerStream: async function* (input) {
          sent = input.messages;
          yield { type: "delta", text: "ok" };
        },
      })
    );

    const contents = sent.map((message) => message.content).join("\n");
    expect(contents).toContain("摘要甲");
    // Covered turns were folded in and must not be resent verbatim …
    expect(contents).not.toContain("问题 0");
    expect(contents).not.toContain("问题 5");
    // … while the kept turns and the turn that triggered compaction are still verbatim.
    expect(contents).toContain("问题 6");
    expect(contents).toContain("问题 7");
    expect(contents).toContain("第一次");
    // TEST-081 ⑤: the summary travels as a system message, never as user/assistant text.
    const summaryMessage = sent.find((message) => message.content === "摘要甲");
    expect(summaryMessage?.role).toBe("system");
  });

  it("① 请求形状：摘要调用走同一 Provider 与本轮解析出的同一模型，非流式且 max_tokens 有界", async () => {
    const conversationId = seedLongConversation();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(JSON.stringify({ choices: [{ message: { content: "同模型摘要" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    try {
      await drain(
        await runChatTurn({
          store,
          userId,
          providerId,
          conversationId,
          message: "继续",
          // Per-turn model override: the summary must follow it, not the provider default.
          model: "llama-override",
          providerStream: async function* () {
            yield { type: "delta", text: "ok" };
          },
        })
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(calls[0].body.stream).toBe(false);
    expect(calls[0].body.model).toBe("llama-override");
    expect(calls[0].body.max_tokens).toBe(SUMMARY_MAX_TOKENS);
    // TEST-080 ③ structure guard: the span handed to the model carries the covered turns.
    const messages = calls[0].body.messages as ChatMessage[];
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("问题 0");
    expect(messages[1].content).not.toContain("问题 6");
    expect(store.listMessages(conversationId).find((row) => row.status === SUMMARY_STATUS)?.content).toBe("同模型摘要");
  });

  it("① 摘要行插在被覆盖区间末尾之后——即便相邻行在同一毫秒写入，顺序也由 seq 保证", () => {
    const conversationId = store.createConversation(userId, "ms").id;
    const ids = ["a", "b", "c", "d"].map((label) =>
      store.appendMessage({ conversationId, role: "user", content: label, status: "complete" })
    );
    store.insertMessageAfter(ids[1], { conversationId, role: "system", content: "摘要", status: SUMMARY_STATUS });
    expect(store.listMessages(conversationId).map((row) => row.content)).toEqual(["a", "b", "摘要", "c", "d"]);
    // A later append still lands last: the renumbering did not confuse the seq counter.
    store.appendMessage({ conversationId, role: "user", content: "e", status: "complete" });
    expect(store.listMessages(conversationId).map((row) => row.content)).toEqual(["a", "b", "摘要", "c", "d", "e"]);
  });

  /**
   * Just past the compaction trigger but still inside the budget: compaction is
   * attempted, and if it fails the turn must still go through. This is the shape that
   * actually tests fail-open — a conversation already over budget would fail with or
   * without compaction, so it proves nothing about compaction.
   */
  function seedJustOverTrigger(): string {
    const conversationId = store.createConversation(userId, "borderline").id;
    for (let turn = 0; turn < 4; turn += 1) {
      store.appendMessage({ conversationId, role: "user", content: "问".repeat(90), status: "complete" });
      store.appendMessage({ conversationId, role: "assistant", content: "答".repeat(90), status: "complete" });
    }
    return conversationId;
  }

  it("③ fail-open：摘要抛错时，本来放得下的对话照常完成且不落库摘要", async () => {
    const conversationId = seedJustOverTrigger();
    const sse = await drain(
      await runChatTurn({
        store,
        userId,
        providerId,
        conversationId,
        message: "继续",
        summarize: async () => {
          throw new Error("summary provider down");
        },
        providerStream: async function* () {
          yield { type: "delta", text: "still answered" };
        },
      })
    );

    expect(sse).toContain("still answered");
    expect(sse).toContain("event: done");
    expect(store.listMessages(conversationId).filter((row) => row.status === SUMMARY_STATUS)).toHaveLength(0);
  });

  it("③ fail-open：摘要返回空字符串同样放弃压缩而不打断", async () => {
    const conversationId = seedJustOverTrigger();
    const sse = await drain(
      await runChatTurn({
        store,
        userId,
        providerId,
        conversationId,
        message: "继续",
        summarize: async () => "   ",
        providerStream: async function* () {
          yield { type: "delta", text: "answered anyway" };
        },
      })
    );
    expect(sse).toContain("answered anyway");
    expect(store.listMessages(conversationId).filter((row) => row.status === SUMMARY_STATUS)).toHaveLength(0);
  });

  it("③ fail-open 的边界：本来就超预算的会话，压缩失败后仍报请求级错误——与压缩引入前一致，不是新失败点", async () => {
    const conversationId = seedLongConversation();
    await expect(
      runChatTurn({
        store,
        userId,
        providerId,
        conversationId,
        message: "继续",
        summarize: async () => {
          throw new Error("down");
        },
        providerStream: async function* () {
          yield { type: "delta", text: "unreachable" };
        },
      })
    ).rejects.toMatchObject({ status: 413, message: expect.stringContaining("压缩早前对话未成功") });
  });

  it("CP-8 三级顺序：压缩成功但保留轮次本身就超预算时才报错，且文案说明已压缩过", async () => {
    // Each kept turn is so large that three of them alone exceed the input budget, so
    // narrowing → compacting → still over → refuse, in that order.
    const conversationId = store.createConversation(userId, "huge").id;
    for (let turn = 0; turn < 6; turn += 1) {
      store.appendMessage({ conversationId, role: "user", content: `问题 ${turn}：` + "巨".repeat(2500), status: "complete" });
      store.appendMessage({ conversationId, role: "assistant", content: `回答 ${turn}：` + "大".repeat(2500), status: "complete" });
    }
    const summarize = vi.fn(async () => "压缩成功的摘要");
    await expect(
      runChatTurn({
        store,
        userId,
        providerId,
        conversationId,
        message: "继续",
        summarize,
        providerStream: async function* () {
          yield { type: "delta", text: "unreachable" };
        },
      })
    ).rejects.toMatchObject({ status: 413, message: expect.stringContaining("已压缩早前对话") });
    // Exactly one compaction attempt per send (DEC-030 ⑨) — no loop of re-summarising.
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("④ 摘要生成的 token 计入会话累计，不隐藏成本", async () => {
    const conversationId = seedLongConversation();
    const before = store.getUsage(conversationId).inputTokens;
    await drain(
      await runChatTurn({
        store,
        userId,
        providerId,
        conversationId,
        message: "继续",
        summarize: async () => "一份摘要",
        providerStream: async function* () {
          yield { type: "delta", text: "ok" };
        },
      })
    );
    expect(store.getUsage(conversationId).inputTokens).toBeGreaterThan(before);
  });

  it("② 增量：第二次压缩的输入包含上一份摘要，而不是从头重压", async () => {
    const conversationId = seedLongConversation();
    const seen: string[] = [];
    const summarize = vi.fn(async (messages: ChatMessage[]) => {
      seen.push(messages.map((m) => m.content).join("\n"));
      return `摘要 ${seen.length}`;
    });

    for (const text of ["第一次", "第二次"]) {
      // Grow the conversation between compactions so the second one has new material.
      for (let i = 0; i < 4; i += 1) {
        store.appendMessage({ conversationId, role: "user", content: "补充".repeat(400), status: "complete" });
        store.appendMessage({ conversationId, role: "assistant", content: "回应".repeat(400), status: "complete" });
      }
      await drain(
        await runChatTurn({
          store,
          userId,
          providerId,
          conversationId,
          message: text,
          summarize,
          providerStream: async function* () {
            yield { type: "delta", text: "ok" };
          },
        })
      );
    }

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[1]).toContain("摘要 1");
  });

  it("④ 回滚安全：旧的 REPLAYABLE_STATUSES 会过滤掉摘要行，不把它当真实对话外发", () => {
    // The pre-CR filter set. A rolled-back build uses exactly this, and the assertion
    // proves a summary row cannot leak into the model context as if it were a real turn.
    const legacyReplayable = new Set(["complete", "stopped", "truncated"]);
    const conversationId = store.createConversation(userId, "x").id;
    store.appendMessage({ conversationId, role: "user", content: "real", status: "complete" });
    store.appendMessage({ conversationId, role: "system", content: "摘要", status: SUMMARY_STATUS });

    const replayed = store.listMessages(conversationId).filter((row) => legacyReplayable.has(row.status));
    expect(replayed.map((row) => row.content)).toEqual(["real"]);
  });
});
