"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translator, type Translate } from "@/lib/i18n";
import { DEFAULT_LANGUAGE, HTML_LANG, type UiLanguage } from "@/lib/language";

/**
 * The one place the interface learns which language it is in (REQ-F-340, DEC-460;
 * CR-20260928-ui-strings-i18n). `page.tsx` seeds it with the server-side setting so the first
 * paint is already right; `LanguageToggle` changes it after the server has saved the choice,
 * and every `useT()` consumer re-renders. `<html lang>` follows it. Outside a provider (tests
 * that render one component) the default is Chinese — exactly what the interface said before.
 */

type LanguageContextValue = {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
});

export function LanguageProvider({
  initialLanguage = DEFAULT_LANGUAGE,
  children,
}: {
  initialLanguage?: UiLanguage;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState<UiLanguage>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[language];
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** The dictionary lookup bound to the current language; stable between language changes. */
export function useT(): Translate {
  const { language } = useLanguage();
  return useMemo(() => translator(language), [language]);
}

/** BCP 47 tag for `toLocaleString` and friends, so dates follow the interface language. */
export function useLocale(): string {
  return HTML_LANG[useLanguage().language];
}
