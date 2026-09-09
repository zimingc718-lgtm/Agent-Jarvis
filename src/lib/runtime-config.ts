/**
 * Startup configuration probes.
 *
 * Every required environment variable is reported as a named, user-facing
 * status instead of being allowed to fail deep in a request: a missing OAuth
 * client blocks the sign-in button, and a missing encryption key blocks the
 * store with the same shape of message rather than throwing a 500.
 */

export type RuntimeConfigStatus = { configured: true; missing: [] } | { configured: false; missing: string[] };

/** Rejects empty/whitespace values and the `missing-` placeholders used by fixtures. */
export function isRealValue(value: string | undefined): value is string {
  if (!value?.trim()) {
    return false;
  }
  return !value.startsWith("missing-");
}

// The index signature keeps this assignable from both `process.env` and plain
// test literals (a single-optional-property type would trip weak-type checking).
type StorageEnv = { JARVIS_SECRET_KEY?: string; [key: string]: string | undefined };

/**
 * `JARVIS_SECRET_KEY` encrypts provider secrets at rest. Without it the store
 * refuses to open (see `createStore`), which would otherwise surface only after
 * a successful login — so it is checked before any store access.
 */
export function getStorageConfig(env: StorageEnv = process.env): RuntimeConfigStatus {
  return isRealValue(env.JARVIS_SECRET_KEY)
    ? { configured: true, missing: [] }
    : { configured: false, missing: ["JARVIS_SECRET_KEY"] };
}

export const STORAGE_CONFIG_HINT =
  "该密钥用于加密保存 Provider 凭据。请在 .env.local 中设置后重启开发服务器，参见 docs/LOCAL_CONFIGURATION.md。";
