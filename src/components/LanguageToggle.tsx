"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { HTML_LANG, type UiLanguage } from "@/lib/language";
import { LANGUAGE_CHANGED_EVENT } from "@/lib/ui-events";
import { cn } from "@/lib/utils";

/**
 * ☰「语言」switch (REQ-F-330 ②③; CR-20260927-reply-language). Same shape as `ThemeToggle`,
 * but the choice lives on the server (`PUT /api/settings/language`) — it decides what the
 * model replies in for every browser, not a per-browser preference. `<html lang>` follows
 * it. The UI's own strings switching is step 2 of INPUT-2026-09-27-002 and is said so here.
 */

type LanguageToggleProps = {
  /** SSR-resolved value so the switch is right on first paint. */
  initialLanguage?: UiLanguage;
  /** Test seam. */
  save?: (language: UiLanguage) => Promise<{ ok: boolean; message?: string }>;
};

async function saveViaApi(language: UiLanguage) {
  const response = await fetch("/api/settings/language", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language }),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: body.message };
}

const OPTIONS: { value: UiLanguage; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

export function LanguageToggle({ initialLanguage = "zh", save = saveViaApi }: LanguageToggleProps) {
  const [language, setLanguage] = useState<UiLanguage>(initialLanguage);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[language];
  }, [language]);

  async function apply(next: UiLanguage) {
    if (busy || next === language) {
      return;
    }
    const previous = language;
    setBusy(true);
    setLanguage(next);
    setStatus(null);
    try {
      const result = await save(next);
      if (result.ok) {
        window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGED_EVENT, { detail: { language: next } }));
        setStatus(next === "en" ? "Jarvis will reply in English." : "Jarvis 将用中文回复。");
      } else {
        setLanguage(previous);
        setStatus(result.message ?? "保存失败。");
      }
    } catch {
      setLanguage(previous);
      setStatus("保存失败：网络错误。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="language-toggle flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1" role="group" aria-label="语言">
        {OPTIONS.map(({ value, label }) => {
          const active = language === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              disabled={busy}
              onClick={() => void apply(value)}
              className={cn(
                "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Languages aria-hidden="true" className="size-4" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="language-toggle__hint px-1 text-xs text-muted-foreground">决定 Jarvis 的回复语言；界面文案的英文版下一步做。</p>
      {status ? (
        <p className="language-toggle__status px-1 text-xs text-muted-foreground" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
