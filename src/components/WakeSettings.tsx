"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { WAKE_CHANGED_EVENT, WAKE_NOTICE_EVENT, type WakeClientOutcome, type WakeClientSettings } from "@/lib/ui-events";

/**
 * Proactive wake-up controls in the ☰ menu (REQ-F-060 ①②③⑤, REQ-NF-020 ②; TASK-102).
 *
 * Off by default (user ruling 5, 2026-09-10). The switch, the interval, the daily
 * token cap and today's spend live together so the cost of turning it on is visible
 * right where it is turned on. 「现在唤醒」 fires one wake immediately — useful to see
 * what a wake looks like before leaving it running, and it is the real-entry test's
 * way of not waiting half an hour.
 */

type WakeSettingsProps = {
  /** Test seams. */
  load?: () => Promise<WakeClientSettings>;
  save?: (input: Partial<Pick<WakeClientSettings, "enabled" | "intervalMinutes" | "dailyTokenCap">>) => Promise<{ ok: boolean; message?: string; settings?: WakeClientSettings }>;
  wake?: () => Promise<WakeClientOutcome>;
};

async function loadFromApi(): Promise<WakeClientSettings> {
  const response = await fetch("/api/settings/wake", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`wake settings fetch failed (${response.status})`);
  }
  return (await response.json()) as WakeClientSettings;
}

async function saveToApi(input: Partial<Pick<WakeClientSettings, "enabled" | "intervalMinutes" | "dailyTokenCap">>) {
  const response = await fetch("/api/settings/wake", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string } & Partial<WakeClientSettings>;
  return { ok: response.ok, message: body.message, settings: response.ok ? (body as WakeClientSettings) : undefined };
}

async function wakeViaApi(): Promise<WakeClientOutcome> {
  const response = await fetch("/api/chat/wake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manual: true }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `wake failed (${response.status})`);
  }
  return (await response.json()) as WakeClientOutcome;
}

const OUTCOME_TEXT: Record<Exclude<WakeClientOutcome["kind"], "skipped">, string> = {
  noop: "本次唤醒：没有需要提醒的事。",
  notice: "已在对话里给出一条主动提醒。",
};

export function WakeSettings({ load = loadFromApi, save = saveToApi, wake = wakeViaApi }: WakeSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("30");
  const [dailyTokenCap, setDailyTokenCap] = useState("20000");
  const [usage, setUsage] = useState<WakeClientSettings["usage"] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);

  const apply = (settings: WakeClientSettings) => {
    setEnabled(settings.enabled);
    setIntervalMinutes(String(settings.intervalMinutes));
    setDailyTokenCap(String(settings.dailyTokenCap));
    setUsage(settings.usage);
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .then((settings) => {
        if (!cancelled) {
          apply(settings);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const persist = async (input: Partial<Pick<WakeClientSettings, "enabled" | "intervalMinutes" | "dailyTokenCap">>) => {
    const result = await save(input);
    setStatus(result.ok ? "已保存。" : (result.message ?? "保存失败。"));
    if (result.ok && result.settings) {
      apply(result.settings);
      // The chat owns the timer; tell it the schedule changed (REQ-F-060 ④).
      window.dispatchEvent(new Event(WAKE_CHANGED_EVENT));
    }
  };

  const wakeNow = async () => {
    setWaking(true);
    setStatus("正在唤醒…");
    try {
      const outcome = await wake();
      setUsage(outcome.usage);
      if (outcome.kind === "skipped") {
        setStatus(outcome.message);
      } else {
        setStatus(OUTCOME_TEXT[outcome.kind]);
        if (outcome.kind === "notice") {
          window.dispatchEvent(new CustomEvent(WAKE_NOTICE_EVENT, { detail: { text: outcome.text, messageId: outcome.messageId } }));
        }
      }
    } catch (error) {
      setStatus(`唤醒失败：${error instanceof Error ? error.message : "网络错误"}`);
    } finally {
      setWaking(false);
    }
  };

  return (
    <section className="wake-settings flex flex-col gap-2 rounded-md border border-border p-2" aria-label="主动唤醒">
      <h3 className="wake-settings__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">主动唤醒</h3>

      <label className="wake-settings__toggle flex items-center justify-between gap-2 text-sm">
        <span>空闲时主动提醒</span>
        <Switch
          aria-label="主动唤醒开关"
          checked={enabled}
          onCheckedChange={(next) => {
            setEnabled(next);
            void persist({ enabled: next });
          }}
        />
      </label>

      <label className="wake-settings__interval flex items-center justify-between gap-2 text-sm">
        <span className="text-xs text-muted-foreground">间隔（分钟）</span>
        <input
          aria-label="唤醒间隔（分钟）"
          className="w-20 rounded-md border border-input bg-background px-2 py-1 text-right text-sm"
          inputMode="numeric"
          value={intervalMinutes}
          onChange={(event) => setIntervalMinutes(event.target.value)}
          onBlur={() => void persist({ intervalMinutes: Number(intervalMinutes) })}
        />
      </label>

      <label className="wake-settings__cap flex items-center justify-between gap-2 text-sm">
        <span className="text-xs text-muted-foreground">每日 token 上限</span>
        <input
          aria-label="每日唤醒 token 上限"
          className="w-24 rounded-md border border-input bg-background px-2 py-1 text-right text-sm"
          inputMode="numeric"
          value={dailyTokenCap}
          onChange={(event) => setDailyTokenCap(event.target.value)}
          onBlur={() => void persist({ dailyTokenCap: Number(dailyTokenCap) })}
        />
      </label>

      <p className="wake-settings__usage text-xs text-muted-foreground">
        {usage
          ? `今日唤醒用量：${usage.inputTokens + usage.outputTokens} token（${usage.runs} 次，${usage.notices} 条提醒，估算）`
          : "今日唤醒用量：—"}
      </p>

      <button
        type="button"
        className="wake-settings__now self-start rounded px-1 text-xs underline underline-offset-2 disabled:opacity-50"
        disabled={waking}
        onClick={() => void wakeNow()}
      >
        现在唤醒
      </button>

      {status ? (
        <p className="wake-settings__status text-xs text-muted-foreground" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
