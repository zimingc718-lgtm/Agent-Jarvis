import type { Store } from "./store";

/**
 * Reply language (REQ-F-330, DEC-450; CR-20260927-reply-language — step 1 of
 * INPUT-2026-09-27-002「Jarvis应该支持英文」).
 *
 * One global `app_settings` key, like search / wake / documents: the user ruled that a
 * single ☰ switch decides the language, and every other setting here is global too.
 * Per-user language is a later CR. Step 1 controls what the MODEL answers in; the UI's own
 * Chinese strings are step 2. Tool descriptions and tool results stay Chinese on purpose
 * (user ruling ④) — the instruction below tells the model to read them and still answer in
 * the chosen language.
 */

export type UiLanguage = "zh" | "en";

export const SETTING_LANGUAGE = "ui.language";
export const DEFAULT_LANGUAGE: UiLanguage = "zh";

/** What `<html lang>` should say for each choice. */
export const HTML_LANG: Record<UiLanguage, string> = { zh: "zh-CN", en: "en" };

export class LanguageSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguageSettingError";
  }
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zh" || value === "en";
}

export function readLanguage(store: Pick<Store, "getSetting">): UiLanguage {
  const stored = store.getSetting(SETTING_LANGUAGE);
  return isUiLanguage(stored) ? stored : DEFAULT_LANGUAGE;
}

export function writeLanguage(store: Pick<Store, "setSetting">, value: unknown): UiLanguage {
  if (!isUiLanguage(value)) {
    throw new LanguageSettingError('language 只接受 "zh" 或 "en"。');
  }
  store.setSetting(SETTING_LANGUAGE, value);
  return value;
}

/**
 * The line that joins the stable prefix's identity (REQ-F-330 ①). It changes only when
 * the setting changes, so prefix caching (REQ-NF-008 ①) is unaffected between switches.
 */
export function languageInstruction(language: UiLanguage): string {
  return language === "en"
    ? "Reply language: English. You MUST write every reply in English — including when the user writes in Chinese, and when tool descriptions, tool results or documents are in Chinese: read them and translate their content into English, quoting Chinese names only where needed. Switch languages only if the user explicitly asks you to."
    : "回复语言：中文。每一条回复都必须用中文——即使用户用英文提问，或工具描述、工具结果、文档是英文：读懂后用中文转述，必要时保留原文名称。只有用户明确要求换语言时才切换。";
}

/**
 * The same rule restated at the END of the system prompt, in the volatile suffix (REQ-F-330 ①).
 * Real entry 2026-09-27: with only the identity line, DeepSeek opened in English and slid back
 * into Chinese as soon as it listed Chinese skill names — the user's language and the tool
 * output outweighed one sentence at the top. The suffix is re-read every turn anyway.
 */
export function languageReminder(language: UiLanguage): string {
  return language === "en"
    ? "Reply language for this turn: English. The user's message and the tool results below may be Chinese — still answer in English."
    : "本轮回复语言：中文。用户消息与工具结果可能是英文——仍用中文作答。";
}
