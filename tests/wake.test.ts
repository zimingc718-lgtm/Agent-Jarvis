import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChatTurn } from "@/lib/chat";
import { createStore, type Store } from "@/lib/store";
import { buildTranscript } from "@/lib/transcript";
import type { ChatMessage } from "@/lib/types";
import {
  buildWakeMessages,
  isNoop,
  readWakeSettings,
  readWakeUsage,
  runWakeTurn,
  WAKE_CONTEXT_TOKEN_CAP,
  WAKE_DEFAULTS,
  WAKE_MAX_OUTPUT_TOKENS,
  WAKE_NOTICE_PREFIX,
  WAKE_STATUS,
  WakeSettingsError,
  writeWakeSettings,
} from "@/lib/wake";

/**
 * TEST-100 (settings & daily usage) / TEST-101 (one wake, its outcomes, its cost fences,
 * and the guarantee that a reminder never re-enters the model's context)
 * — REQ-F-060, REQ-F-061, REQ-NF-020; TASK-100.
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("wake settings (REQ-F-060 ①②③)", () => {
  let dir: string;
  let store: Store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-wake-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("① 默认关，间隔 30 分钟，日上限 20000（用户 2026-09-10 终裁 5）", () => {
    expect(readWakeSettings(store)).toEqual({ enabled: false, intervalMinutes: 30, dailyTokenCap: 20_000 });
    expect(WAKE_DEFAULTS.enabled).toBe(false);
  });

  it("② 写入经校验：非法值拒绝而不是悄悄夹住；合法值落库并读回", () => {
    expect(() => writeWakeSettings(store, { intervalMinutes: 0 })).toThrow(WakeSettingsError);
    expect(() => writeWakeSettings(store, { intervalMinutes: 1.5 })).toThrow(WakeSettingsError);
    expect(() => writeWakeSettings(store, { dailyTokenCap: -1 })).toThrow(WakeSettingsError);
    expect(() => writeWakeSettings(store, { enabled: "yes" })).toThrow(WakeSettingsError);
    expect(writeWakeSettings(store, { enabled: true, intervalMinutes: 5, dailyTokenCap: 100 })).toEqual({
      enabled: true,
      intervalMinutes: 5,
      dailyTokenCap: 100,
    });
    expect(readWakeSettings(store).enabled).toBe(true);
  });

  it("③ 日用量按日期归零；坏数据视为空", () => {
    expect(readWakeUsage(store, new Date("2026-09-11T10:00:00Z"))).toMatchObject({ date: "2026-09-11", inputTokens: 0, runs: 0 });
    store.setSetting("wake.usage", JSON.stringify({ date: "2026-09-10", inputTokens: 500, outputTokens: 20, runs: 3, notices: 1 }));
    expect(readWakeUsage(store, new Date("2026-09-10T23:00:00Z")).inputTokens).toBe(500);
    expect(readWakeUsage(store, new Date("2026-09-11T00:00:01Z")).inputTokens).toBe(0);
    store.setSetting("wake.usage", "{not json");
    expect(readWakeUsage(store).runs).toBe(0);
  });
});

describe("buildWakeMessages (REQ-NF-020 ①)", () => {
  const row = (role: "user" | "assistant" | "tool" | "system", content: string, status = "complete") => ({
    id: content.slice(0, 8),
    role,
    content,
    status,
    createdAt: "t",
    toolCalls: null,
    toolCallId: null,
    seq: 0,
    sources: null,
  });

  it("只取最近的用户/助手文本，排除工具行、摘要与早前的唤醒提醒；输入有界", () => {
    const rows = [
      row("user", "第一问"),
      row("assistant", "第一答"),
      row("tool", "工具结果"),
      row("system", "早前摘要", "summary"),
      row("system", "主动提醒：旧提醒", WAKE_STATUS),
      row("user", "第二问"),
      row("assistant", "第二答"),
    ];
    const messages = buildWakeMessages(rows, "身份");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("空闲唤醒");
    expect(messages[1].content).toContain("[user] 第一问");
    expect(messages[1].content).toContain("[assistant] 第二答");
    expect(messages[1].content).not.toContain("工具结果");
    expect(messages[1].content).not.toContain("早前摘要");
    expect(messages[1].content).not.toContain("旧提醒");
  });

  it("超长历史被截到上限并留标记", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i % 2 ? "assistant" : "user", `${i}：` + "字".repeat(600)));
    const [, user] = buildWakeMessages(rows, "身份");
    expect(user.content).toContain("[内容超出预算，已截断]");
    // The cap is a ceiling on what the model gets, not an estimate.
    expect(user.content.length).toBeLessThan(WAKE_CONTEXT_TOKEN_CAP * 4);
  });

  it("isNoop 识别 NOOP（大小写、尾随标点）与空回复", () => {
    expect(isNoop("NOOP")).toBe(true);
    expect(isNoop(" noop. ")).toBe(true);
    expect(isNoop("")).toBe(true);
    expect(isNoop("NOOP 之外还有话")).toBe(true);
    expect(isNoop("记得处理端口")).toBe(false);
  });
});

describe("runWakeTurn (REQ-F-060 ④⑤, REQ-F-061, REQ-NF-020)", () => {
  let dir: string;
  let store: Store;
  let userId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-wake-run-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;
    store.saveProvider(userId, {
      name: "Local",
      kind: "local",
      authMode: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama",
      enabled: true,
    });
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(): string {
    const id = store.createConversation(userId, "部署").id;
    store.appendMessage({ conversationId: id, role: "user", content: "明天记得把 8443 端口的反向代理配好。", status: "complete" });
    store.appendMessage({ conversationId: id, role: "assistant", content: "好的，用 Caddy 配置。", status: "complete" });
    return id;
  }

  it("① 未开启且非手动 → 跳过，不调模型", async () => {
    seed();
    const complete = vi.fn(async () => "x");
    const outcome = await runWakeTurn({ store, userId, complete });
    expect(outcome).toMatchObject({ kind: "skipped", reason: "disabled" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("② 手动唤醒忽略开关但不忽略上限；上限到达即跳过且不调模型", async () => {
    seed();
    writeWakeSettings(store, { enabled: false, dailyTokenCap: 10 });
    store.setSetting("wake.usage", JSON.stringify({ date: new Date().toISOString().slice(0, 10), inputTokens: 8, outputTokens: 2, runs: 1, notices: 0 }));
    const complete = vi.fn(async () => "x");
    const outcome = await runWakeTurn({ store, userId, manual: true, complete });
    expect(outcome).toMatchObject({ kind: "skipped", reason: "cap" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("③ 无对话 / 无 Provider → 跳过并说明", async () => {
    writeWakeSettings(store, { enabled: true });
    expect(await runWakeTurn({ store, userId, complete: async () => "x" })).toMatchObject({ kind: "skipped", reason: "no-conversation" });
  });

  it("④ NOOP → 不落库、不显示，但 token 计入日用量与会话累计（REQ-F-037 ②）", async () => {
    const conversationId = seed();
    writeWakeSettings(store, { enabled: true });
    const before = store.getUsage(conversationId).inputTokens;
    const complete = vi.fn(async (_messages: ChatMessage[], opts: { maxTokens: number }) => {
      expect(opts.maxTokens).toBe(WAKE_MAX_OUTPUT_TOKENS);
      return "NOOP";
    });
    const outcome = await runWakeTurn({ store, userId, complete });
    expect(outcome.kind).toBe("noop");
    expect(outcome.usage.runs).toBe(1);
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
    expect(outcome.usage.notices).toBe(0);
    expect(store.listMessages(conversationId).filter((row) => row.status === WAKE_STATUS)).toHaveLength(0);
    expect(store.getUsage(conversationId).inputTokens).toBeGreaterThan(before);
    expect(store.getUsage(conversationId).estimated).toBe(true);
  });

  it("⑤ 有内容 → 落为 system/wake 行，带「主动提醒：」前缀；转录区还原为 system 行", async () => {
    const conversationId = seed();
    writeWakeSettings(store, { enabled: true });
    const outcome = await runWakeTurn({ store, userId, complete: async () => "记得配 8443 的反向代理。" });
    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") {
      return;
    }
    expect(outcome.text).toBe(`${WAKE_NOTICE_PREFIX}记得配 8443 的反向代理。`);
    expect(outcome.usage.notices).toBe(1);
    const rows = store.listMessages(conversationId);
    const wakeRow = rows.find((row) => row.status === WAKE_STATUS);
    expect(wakeRow).toMatchObject({ role: "system", id: outcome.messageId });
    const transcript = buildTranscript(rows);
    expect(transcript.at(-1)).toMatchObject({ role: "system", status: WAKE_STATUS, content: outcome.text });
  });

  it("⑥ 提醒行绝不回放进模型上下文（REQ-F-061 ③）", async () => {
    const conversationId = seed();
    writeWakeSettings(store, { enabled: true });
    await runWakeTurn({ store, userId, complete: async () => "一条提醒" });
    let sent: ChatMessage[] = [];
    const stream = await runChatTurn({
      store,
      userId,
      conversationId,
      message: "继续",
      providerStream: async function* (input) {
        sent = input.messages;
        yield { type: "delta", text: "ok" };
      },
    });
    await new Response(stream).text();
    expect(sent.map((message) => message.content).join("\n")).not.toContain("一条提醒");
    // The reminder is still in the database for the transcript.
    expect(store.listMessages(conversationId).some((row) => row.status === WAKE_STATUS)).toBe(true);
  });

  it("⑦ 调用失败 → 跳过（fail-silent），输入 token 仍计入日用量，不落库", async () => {
    const conversationId = seed();
    writeWakeSettings(store, { enabled: true });
    const outcome = await runWakeTurn({
      store,
      userId,
      complete: async () => {
        throw new Error("provider down");
      },
    });
    expect(outcome).toMatchObject({ kind: "skipped", reason: "failed" });
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
    expect(store.listMessages(conversationId).filter((row) => row.status === WAKE_STATUS)).toHaveLength(0);
  });

  it("⑧ 日用量跨次累加，达上限后下一次跳过", async () => {
    seed();
    writeWakeSettings(store, { enabled: true });
    const first = await runWakeTurn({ store, userId, complete: async () => "NOOP" });
    expect(first.kind).toBe("noop");
    const perRun = first.usage.inputTokens + first.usage.outputTokens;
    expect(perRun).toBeGreaterThan(0);
    // Cap = exactly two runs' worth: the second still fits, the third must not.
    writeWakeSettings(store, { dailyTokenCap: perRun * 2 });
    const second = await runWakeTurn({ store, userId, complete: async () => "NOOP" });
    expect(second.kind).toBe("noop");
    expect(second.usage.runs).toBe(2);
    const third = await runWakeTurn({ store, userId, complete: async () => "NOOP" });
    expect(third).toMatchObject({ kind: "skipped", reason: "cap" });
  });
});
