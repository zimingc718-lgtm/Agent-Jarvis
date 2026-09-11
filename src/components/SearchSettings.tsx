"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { USAGE_CHANGED_EVENT } from "@/lib/ui-events";
import type { TokenUsage } from "@/lib/types";

/**
 * Search backend config and the running token total (REQ-F-038, REQ-F-037; TASK-074).
 *
 * Lives in the ☰ menu next to 「模型」 rather than inside it: that dialog is the provider
 * priority surface and REQ-NF-006 ② keeps it that way.
 */

type SearchSettingsProps = {
  /** Test seams. */
  load?: () => Promise<{ enabled: boolean; baseUrl: string }>;
  save?: (input: { enabled: boolean; baseUrl: string }) => Promise<{ ok: boolean; message?: string }>;
  test?: (baseUrl: string) => Promise<{ ok: boolean; message: string }>;
};

async function loadFromApi() {
  const response = await fetch("/api/settings/search", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`search settings fetch failed (${response.status})`);
  }
  return (await response.json()) as { enabled: boolean; baseUrl: string };
}

async function saveToApi(input: { enabled: boolean; baseUrl: string }) {
  const response = await fetch("/api/settings/search", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: body.message };
}

async function testViaApi(baseUrl: string) {
  const response = await fetch("/api/settings/search/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl }),
  });
  return (await response.json()) as { ok: boolean; message: string };
}

export function SearchSettings({ load = loadFromApi, save = saveToApi, test = testViaApi }: SearchSettingsProps) {
  const [enabled, setEnabled] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((settings) => {
        if (!cancelled) {
          setEnabled(settings.enabled);
          setBaseUrl(settings.baseUrl);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    // The chat owns the stream and the menu owns the display; neither imports the other.
    const onUsage = (event: Event) => setUsage((event as CustomEvent<TokenUsage>).detail);
    window.addEventListener(USAGE_CHANGED_EVENT, onUsage);
    return () => window.removeEventListener(USAGE_CHANGED_EVENT, onUsage);
  }, []);

  const persist = async (next: { enabled: boolean; baseUrl: string }) => {
    const result = await save(next);
    setStatus(result.ok ? "已保存。" : (result.message ?? "保存失败。"));
  };

  return (
    <section className="search-settings flex flex-col gap-2 rounded-md border border-border p-2" aria-label="搜索与用量">
      <h3 className="search-settings__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        搜索
      </h3>

      <label className="search-settings__toggle flex items-center justify-between gap-2 text-sm">
        <span>联网</span>
        <Switch
          aria-label="联网总开关"
          checked={enabled}
          onCheckedChange={(next) => {
            setEnabled(next);
            void persist({ enabled: next, baseUrl });
          }}
        />
      </label>

      <label className="search-settings__url flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">SearXNG 地址</span>
        <input
          aria-label="搜索服务地址"
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          placeholder="http://127.0.0.1:8080"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          onBlur={() => void persist({ enabled, baseUrl })}
        />
      </label>

      <button
        type="button"
        className="search-settings__test self-start rounded px-1 text-xs underline underline-offset-2"
        onClick={async () => {
          setStatus("正在测试…");
          try {
            const result = await test(baseUrl);
            setStatus(result.message);
          } catch {
            setStatus("测试失败：网络错误。");
          }
        }}
      >
        测试连接
      </button>

      {status ? (
        <p className="search-settings__status text-xs text-muted-foreground" role="status">
          {status}
        </p>
      ) : null}

      <h3 className="search-settings__usage-title text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        本会话用量
      </h3>
      <p className="search-settings__usage text-xs text-muted-foreground">
        {usage
          ? `输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} tokens${usage.estimated ? "（估算）" : ""}`
          : "尚无数据"}
      </p>
    </section>
  );
}
