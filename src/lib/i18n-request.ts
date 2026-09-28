import { readLanguage } from "./language";
import { serverTranslator, type ServerTranslate } from "./i18n-server";
import { getStore } from "./store-singleton";

/**
 * The server dictionary bound to the interface language a request should be answered in
 * (DEC-470 ②; CR-20260928-server-strings-i18n). Routes call this once at the top of a handler;
 * it reads the global `ui.language` setting exactly like `page.tsx` does for the first paint.
 *
 * When the store cannot be opened (JARVIS_SECRET_KEY missing — the 503 path) there is no
 * setting to read, so the answer is Chinese, the default. Server-only: it reaches the store
 * singleton, so no component may import it.
 */
export function requestTranslator(): ServerTranslate {
  try {
    return serverTranslator(readLanguage(getStore()));
  } catch {
    return serverTranslator("zh");
  }
}
