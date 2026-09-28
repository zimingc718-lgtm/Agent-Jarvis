"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { useLanguage, useT } from "@/components/LanguageProvider";
import type { MessageKey } from "@/lib/i18n";
import type { UiLanguage } from "@/lib/language";
import { LANGUAGE_CHANGED_EVENT } from "@/lib/ui-events";
import { cn } from "@/lib/utils";

/**
 * ☰「语言」switch (REQ-F-330 ②③, REQ-F-340; CR-20260927-reply-language, CR-20260928-ui-strings-i18n).
 * Same shape as `ThemeToggle`, but the choice lives on the server (`PUT /api/settings/language`):
 * it decides what the model replies in and what language the interface is in, for every
 * browser. The live value comes from `LanguageProvider`; this component only asks the server
 * to save the change and reverts the provider if that fails.
 */

type LanguageToggleProps = {
  /** Test seam. */
  save?: (language: UiLanguage) => Promise<{ ok: boolean; message?: string }>;
};

type SaveStatus = { kind: "switched" } | { kind: "failed"; message?: string } | { kind: "network" };

async function saveViaApi(language: UiLanguage) {
  const response = await fetch("/api/settings/language", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language }),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: body.message };
}

const OPTIONS: { value: UiLanguage; label: MessageKey }[] = [
  { value: "zh", label: "language.zh" },
  { value: "en", label: "language.en" },
];

export function LanguageToggle({ save = saveViaApi }: LanguageToggleProps) {
  const { language, setLanguage } = useLanguage();
  const t = useT();
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const [busy, setBusy] = useState(false);

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
        setStatus({ kind: "switched" });
      } else {
        setLanguage(previous);
        setStatus({ kind: "failed", message: result.message });
      }
    } catch {
      setLanguage(previous);
      setStatus({ kind: "network" });
    } finally {
      setBusy(false);
    }
  }

  // Rendered through `t` so the note is in the language the interface has just switched to.
  const statusText =
    status === null
      ? null
      : status.kind === "switched"
        ? t("language.switched")
        : status.kind === "failed"
          ? (status.message ?? t("common.saveFailed"))
          : t("common.saveFailedNetwork");

  return (
    <div className="language-toggle flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1" role="group" aria-label={t("language.aria")}>
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
              {t(label)}
            </button>
          );
        })}
      </div>
      <p className="language-toggle__hint px-1 text-xs text-muted-foreground">{t("language.hint")}</p>
      {statusText ? (
        <p className="language-toggle__status px-1 text-xs text-muted-foreground" role="status">
          {statusText}
        </p>
      ) : null}
    </div>
  );
}
