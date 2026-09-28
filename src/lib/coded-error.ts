import type { Vars } from "./i18n-core";
import { type ServerMessageKey, type ServerTranslate, zhMessage } from "./i18n-server";

/**
 * A typed domain error that also knows *which* message it is (DEC-470 ③; CR-20260928-server-strings-i18n).
 *
 * The `message` stays the Chinese sentence it always was — derived from the server dictionary,
 * so a tool result relayed to the model reads exactly as before. The route boundary looks at
 * `code` + `params` instead and words the same failure in the interface language
 * (`messageFor`). Errors without a code (tool-path-only ones, foreign errors) fall back to
 * their own `message`.
 */
export type Coded = { readonly code: ServerMessageKey; readonly params?: Vars };

export function isCoded(error: unknown): error is Error & Coded {
  return error instanceof Error && typeof (error as Partial<Coded>).code === "string";
}

/** Attach a dictionary code to an error instance and give it the Chinese message for that code. */
export function withCode<E extends Error>(error: E, code: ServerMessageKey, params?: Vars): E & Coded {
  const coded = error as E & { code: ServerMessageKey; params?: Vars };
  coded.code = code;
  coded.params = params;
  return coded;
}

/** The wording for `error` in the request's language: the coded sentence, else the error's own message, else `fallback`. */
export function messageFor(t: ServerTranslate, error: unknown, fallback?: ServerMessageKey): string {
  if (isCoded(error)) {
    return t(error.code, error.params);
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback ? t(fallback) : String(error);
}

export { zhMessage };
