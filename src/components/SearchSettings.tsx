"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TURN_USAGE_EVENT, USAGE_CHANGED_EVENT } from "@/lib/ui-events";
import type { TokenUsage } from "@/lib/types";
import { useT } from "@/components/LanguageProvider";

/**
 * Search backend config and the running token total (REQ-F-038, REQ-F-037; TASK-074).
 *
 * Lives in the ☰ menu next to 「模型」 rather than inside it: that dialog is the provider
 * priority surface and REQ-NF-006 ② keeps it that way.
 *
 * CR-20260911-display-console-ux (REQ-F-053 ④): the form moved out of the menu into a
 * dialog, same shape as 「模型」. The menu row shows the current state and opens it; the
 * usage line stays in the menu because it is read-only and glanceable.
 */

export type SearchSettingsValue = { enabled: boolean; baseUrl: string; browserFallback?: boolean };

type SearchSettingsProps = {
  /** Test seams. */
  load?: () => Promise<SearchSettingsValue>;
  save?: (input: SearchSettingsValue) => Promise<{ ok: boolean; message?: string }>;
  test?: (baseUrl: string) => Promise<{ ok: boolean; message: string }>;
};

async function loadFromApi() {
  const response = await fetch("/api/settings/search", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`search settings fetch failed (${response.status})`);
  }
  return (await response.json()) as SearchSettingsValue;
}

async function saveToApi(input: SearchSettingsValue) {
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  /** REQ-F-057 ④: default on, matching the server's own default. */
  const [browserFallback, setBrowserFallback] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  /** REQ-NF-060 ④: what the question you just asked cost, next to what the session cost. */
  const [turnUsage, setTurnUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((settings) => {
        if (!cancelled) {
          setEnabled(settings.enabled);
          setBaseUrl(settings.baseUrl);
          setBrowserFallback(settings.browserFallback ?? true);
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
    const onTurnUsage = (event: Event) =>
      setTurnUsage((event as CustomEvent<{ inputTokens: number; outputTokens: number }>).detail);
    window.addEventListener(USAGE_CHANGED_EVENT, onUsage);
    window.addEventListener(TURN_USAGE_EVENT, onTurnUsage);
    return () => {
      window.removeEventListener(USAGE_CHANGED_EVENT, onUsage);
      window.removeEventListener(TURN_USAGE_EVENT, onTurnUsage);
    };
  }, []);

  const persist = async (next: SearchSettingsValue) => {
    const result = await save(next);
    setStatus(result.ok ? t("common.saved") : (result.message ?? t("common.saveFailed")));
  };

  const summary =
    t("search.summary", { state: enabled ? t("common.on") : t("common.off") }) +
    (baseUrl ? ` · ${baseUrl.replace(/^https?:\/\//, "")}` : t("search.noAddress"));

  return (
    <section className="search-settings flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label={t("search.title")}>
      <h3 className="search-settings__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("search.title")}
      </h3>

      {/* Entry row: same shape as 「模型」 / 「账号登录」, so the drawer reads as one list. */}
      <Button type="button" variant="ghost" className="w-full justify-start gap-2" onClick={() => setOpen(true)}>
        <Globe aria-hidden="true" className="size-4" />
        {t("search.settingsHeading")}
      </Button>
      <p className="search-settings__summary px-3 text-xs text-muted-foreground" aria-live="polite">
        {summary}
      </p>

      <p className="search-settings__usage px-3 text-xs text-muted-foreground">
        {t("search.turnUsageLabel")}
        {turnUsage ? t("search.usage", { input: turnUsage.inputTokens, output: turnUsage.outputTokens }) : t("search.noData")}
        <br />
        {t("search.sessionUsageLabel")}
        {usage
          ? t("search.usage", { input: usage.inputTokens, output: usage.outputTokens }) + (usage.estimated ? t("search.estimated") : "")
          : t("search.noData")}
      </p>

      <Dialog open={open} title={t("search.settingsHeading")} onClose={() => setOpen(false)}>
        <div className="search-settings__form flex flex-col gap-3">
          <label className="search-settings__toggle flex items-center justify-between gap-2 text-sm">
            <span>{t("search.web")}</span>
            <Switch
              aria-label={t("search.webToggleAria")}
              checked={enabled}
              onCheckedChange={(next) => {
                setEnabled(next);
                void persist({ enabled: next, baseUrl, browserFallback });
              }}
            />
          </label>

          <label className="search-settings__url flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">{t("search.searxngUrl")}</span>
            <input
              aria-label={t("search.serviceUrlAria")}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              placeholder="http://127.0.0.1:8080"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              onBlur={() => void persist({ enabled, baseUrl, browserFallback })}
            />
          </label>

          {/* REQ-F-057 ④: its own switch — a browser read costs seconds and RAM, and only
              helps on some blocked pages, so it has to be refusable. */}
          <label className="search-settings__browser flex items-center justify-between gap-2 text-sm">
            <span>
              {t("search.browserFallback")}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("search.browserFallbackHint")}
              </span>
            </span>
            <Switch
              aria-label={t("search.browserFallback")}
              checked={browserFallback}
              onCheckedChange={(next) => {
                setBrowserFallback(next);
                void persist({ enabled, baseUrl, browserFallback: next });
              }}
            />
          </label>

          <button
            type="button"
            className="search-settings__test self-start rounded px-1 text-xs underline underline-offset-2"
            onClick={async () => {
              setStatus(t("search.testing"));
              try {
                const result = await test(baseUrl);
                setStatus(result.message);
              } catch {
                setStatus(t("search.testFailedNetwork"));
              }
            }}
          >
            {t("search.testConnection")}
          </button>

          {status ? (
            <p className="search-settings__status text-xs text-muted-foreground" role="status">
              {status}
            </p>
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}
