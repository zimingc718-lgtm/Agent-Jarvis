// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WakeSettings } from "@/components/WakeSettings";
import { WAKE_CHANGED_EVENT, WAKE_NOTICE_EVENT, type WakeClientSettings } from "@/lib/ui-events";

/** TEST-103 ①②③ — the ☰ wake controls (REQ-F-060 ①②③⑤, REQ-NF-020 ②; TASK-102). */

const usage = { date: "2026-09-11", inputTokens: 120, outputTokens: 30, runs: 2, notices: 1 };
const settings = (over: Partial<WakeClientSettings> = {}): WakeClientSettings => ({
  enabled: false,
  intervalMinutes: 30,
  dailyTokenCap: 20_000,
  usage,
  ...over,
});

describe("WakeSettings", () => {
  it("① starts off, shows interval, cap and today's spend from the server", async () => {
    render(<WakeSettings load={async () => settings()} />);
    const toggle = screen.getByRole("switch", { name: "主动唤醒开关" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(screen.getByLabelText("唤醒间隔（分钟）")).toHaveValue("30"));
    expect(screen.getByLabelText("每日唤醒 token 上限")).toHaveValue("20000");
    expect(screen.getByText(/今日唤醒用量：150 token（2 次，1 条提醒，估算）/)).toBeInTheDocument();
  });

  it("② the switch saves immediately and announces the schedule change; a bad interval shows the server's reason", async () => {
    const save = vi.fn(async (input: Partial<WakeClientSettings>) => {
      if (input.intervalMinutes === 0) {
        return { ok: false, message: "唤醒间隔须是 1–1440 之间的整数分钟。" };
      }
      return { ok: true, settings: settings({ enabled: true, ...input }) };
    });
    const changed = vi.fn();
    window.addEventListener(WAKE_CHANGED_EVENT, changed);
    render(<WakeSettings load={async () => settings()} save={save} />);

    fireEvent.click(screen.getByRole("switch", { name: "主动唤醒开关" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存。"));
    expect(changed).toHaveBeenCalled();

    const interval = screen.getByLabelText("唤醒间隔（分钟）");
    fireEvent.change(interval, { target: { value: "0" } });
    fireEvent.blur(interval);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1–1440"));
    window.removeEventListener(WAKE_CHANGED_EVENT, changed);
  });

  it("③ 现在唤醒 is a real button: a notice is announced to the chat, a cap skip shows its message, usage updates", async () => {
    const outcomes = [
      { kind: "notice" as const, text: "主动提醒：记得配 8443。", conversationId: "c", messageId: "w1", usage: { ...usage, runs: 3, notices: 2 } },
      { kind: "skipped" as const, reason: "cap", message: "今日唤醒 token 已达上限（20000）", usage: { ...usage, runs: 3, notices: 2 } },
    ];
    const wake = vi.fn(async () => outcomes.shift()!);
    const notices: unknown[] = [];
    const onNotice = (event: Event) => notices.push((event as CustomEvent).detail);
    window.addEventListener(WAKE_NOTICE_EVENT, onNotice);
    render(<WakeSettings load={async () => settings()} wake={wake} />);

    const button = screen.getByRole("button", { name: "现在唤醒" });
    expect(button.classList.contains("wake-settings__now")).toBe(true);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已在对话里给出一条主动提醒。"));
    expect(notices).toEqual([{ text: "主动提醒：记得配 8443。", messageId: "w1" }]);
    expect(screen.getByText(/（3 次，2 条提醒，估算）/)).toBeInTheDocument();

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已达上限"));
    window.removeEventListener(WAKE_NOTICE_EVENT, onNotice);
  });
});
