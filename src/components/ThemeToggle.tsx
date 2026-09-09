"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "jarvis-theme";

/** The inline script the root layout runs before paint, kept next to the toggle it pairs with. */
export const themeBootstrapScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  // Start from the light default so server and client markup agree, then adopt
  // whatever the bootstrap script / OS preference resolved to after mount.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode, blocked site data) — the
      // choice still applies for this page view.
    }
  }

  return (
    <div className="theme-toggle" role="group" aria-label="外观主题">
      <button type="button" aria-pressed={theme === "light"} onClick={() => apply("light")}>
        浅色
      </button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => apply("dark")}>
        深色
      </button>
    </div>
  );
}
