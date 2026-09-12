import { describe, expect, it, vi } from "vitest";
import { buildVolatileSuffix, describeRuntime } from "@/lib/tools/budget";
import { describeSendFailure, isNetworkFailure } from "@/lib/send-failure";
import { BACKOFF_MS, MAX_RAPID_EXITS, RAPID_EXIT_MS, backoffFor, decideAfterExit } from "@/lib/supervisor-policy";
import { readFileSync } from "node:fs";

/**
 * TEST-180 — the runtime says what it is, and a failed send says what happened
 * (REQ-F-120; DEC-100; TASK-180). CR-20260912-runtime-visibility.
 *
 * Both halves come from the same complaint: state that exists on the server was invisible
 * to the two parties who needed it. The user saw「Failed to fetch」and could not tell whether
 * the server was gone; the model, asked which model it was running on, answered that it had
 * no way to know — and that was true.
 */

const fixedNow = () => new Date("2026-09-12T14:07:31");

describe("TEST-180 ① 失败可读 (REQ-F-120 ①②)", () => {
  it("服务无响应 → 说明是服务不在，并给出下一步与「没有内容被保存」", async () => {
    const failure = await describeSendFailure(new TypeError("Failed to fetch"), {
      probe: async () => false,
      now: fixedNow,
    });
    expect(failure.kind).toBe("server-gone");
    expect(failure.message).toContain("14:07:31");
    expect(failure.message).toContain("服务当前没有响应");
    expect(failure.message).toContain("重新启动");
    expect(failure.message).toContain("没有任何内容被保存");
    // The browser's own words must not reach the user.
    expect(failure.message).not.toContain("Failed to fetch");
  });

  it("服务仍在 → 区分为传输中断，让用户直接重试而不是白重启服务", async () => {
    const failure = await describeSendFailure(new TypeError("Failed to fetch"), {
      probe: async () => true,
      now: fixedNow,
    });
    expect(failure.kind).toBe("transfer-broken");
    expect(failure.message).toContain("服务仍在运行");
    expect(failure.message).toContain("直接重试");
    // The two cases have different next steps — that is the whole point of probing.
    expect(failure.message).not.toContain("重新启动");
  });

  it("探测本身失败也按「服务不在」处理——探不通就是探不通", async () => {
    const failure = await describeSendFailure(new TypeError("Failed to fetch"), {
      probe: async () => {
        throw new Error("probe blew up");
      },
      now: fixedNow,
    });
    expect(failure.kind).toBe("server-gone");
  });

  it("② 服务端答复过的错误照原样传达，不被我们的措辞盖掉", async () => {
    const probe = vi.fn();
    const failure = await describeSendFailure(new Error("没有可用的 Provider，请先在「模型」中添加。"), { probe, now: fixedNow });
    expect(failure.kind).toBe("reported");
    expect(failure.message).toBe("没有可用的 Provider，请先在「模型」中添加。");
    // No probe: the server clearly answered, so asking whether it is alive is pointless.
    expect(probe).not.toHaveBeenCalled();
  });

  it("只有网络层失败才算网络层失败", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
    expect(isNetworkFailure("Failed to fetch")).toBe(false);
  });
});

describe("TEST-180 ④ 运行时自述 (REQ-F-120 ④)", () => {
  it("一句话里同时有 Provider 名、类型与模型 id——「是 DeepSeek 吗」和「是我配的那个吗」是两个问题", () => {
    const line = describeRuntime({
      providerName: "我的 DeepSeek",
      kind: "deepseek",
      model: "deepseek-chat",
      contextWindow: 128_000,
    });
    expect(line).toContain("我的 DeepSeek");
    expect(line).toContain("DeepSeek");
    expect(line).toContain("deepseek-chat");
    expect(line).toContain("128000");
    // The instruction matters as much as the fact: it had been answering "I cannot know".
    expect(line).toContain("不要说无法得知");
  });

  it("三种 Provider 类型都有中文说法，不把 kind 的字面值丢给模型", () => {
    for (const kind of ["openai", "deepseek", "local"] as const) {
      const line = describeRuntime({ providerName: "p", kind, model: "m", contextWindow: 8_192 });
      expect(line).not.toMatch(/（openai）|（local）/);
      expect(line.length).toBeGreaterThan(20);
    }
  });

  it("运行时进的是易变后缀而不是稳定前缀——切模型不该打掉前缀缓存", () => {
    const runtime = describeRuntime({ providerName: "p", kind: "local", model: "m", contextWindow: 8_192 });
    const suffix = buildVolatileSuffix({ runtime, displayState: "首页" });
    expect(suffix).toContain("当前运行时");
    expect(suffix).toContain("当前展示屏：首页");
    // Order is fixed so the suffix itself stays byte-identical when nothing changed.
    expect(suffix.indexOf("当前运行时")).toBeLessThan(suffix.indexOf("当前展示屏"));
  });

  it("没有运行时信息时后缀退化为原来的样子，不留空行", () => {
    expect(buildVolatileSuffix({ displayState: "首页" })).toBe("当前展示屏：首页");
    expect(buildVolatileSuffix({})).toBe("");
  });
});

describe("TEST-181 服务看护的判定 (REQ-F-120 ③)", () => {
  it("跑了一阵才退出 → 判为被外部停掉，重启，且把「起不来」计数清零", () => {
    const decision = decideAfterExit({ uptimeMs: 5 * 60_000, rapidExits: 2, restarts: 0 });
    expect(decision).toMatchObject({ action: "restart", rapidExits: 0 });
    // Resetting matters: an evening of occasional OOM kills must never accumulate into a
    // refusal to restart, which is the failure mode this whole script exists to prevent.
  });

  it("连续短命退出 → 判为起不来，停止重启并说明原因", () => {
    let rapidExits = 0;
    for (let i = 0; i < MAX_RAPID_EXITS - 1; i += 1) {
      const step = decideAfterExit({ uptimeMs: 1_000, rapidExits, restarts: i });
      expect(step.action).toBe("restart");
      rapidExits = step.action === "restart" ? step.rapidExits : rapidExits;
    }
    const final = decideAfterExit({ uptimeMs: 1_000, rapidExits, restarts: MAX_RAPID_EXITS });
    expect(final.action).toBe("give-up");
    if (final.action === "give-up") {
      expect(final.reason).toContain("起不来");
      expect(final.reason).toContain("端口被占");
    }
  });

  it("退避递增并在最后一档封顶，不会无限拉长", () => {
    expect(backoffFor(0)).toBe(BACKOFF_MS[0]);
    expect(backoffFor(1)).toBe(BACKOFF_MS[1]);
    expect(backoffFor(99)).toBe(BACKOFF_MS.at(-1));
    expect(backoffFor(-5)).toBe(BACKOFF_MS[0]);
  });

  it("脚本里的常量副本与策略模块一致——.mjs 引不了 TS，所以用断言挡住漂移", () => {
    const script = readFileSync("scripts/serve-local.mjs", "utf8");
    expect(script).toContain(`const RAPID_EXIT_MS = ${RAPID_EXIT_MS.toLocaleString("en-US").replace(/,/g, "_")};`);
    expect(script).toContain(`const MAX_RAPID_EXITS = ${MAX_RAPID_EXITS};`);
    expect(script).toContain(`const BACKOFF_MS = [${BACKOFF_MS.map((n) => n.toLocaleString("en-US").replace(/,/g, "_")).join(", ")}];`);
  });
});
