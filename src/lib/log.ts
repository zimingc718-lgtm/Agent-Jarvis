import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * Structured server-side log (REQ-NF-063 ②③, DEC-490 ②; CR-20260929-health-logging).
 *
 * One JSON object per line — `ts`, `level`, `event`, then the fields — written to stdout
 * (stderr for `error`, so Railway's log panel marks it) and appended to `.data/server.log`
 * on the machine that runs the server, so a supervisor restart does not take the history
 * with it. The file rolls over once at `JARVIS_SERVER_LOG_MAX_BYTES` (default 5 MiB) to
 * `server.log.1`; the pair is the whole retention.
 *
 * What never goes in, by construction: request bodies, credentials, conversation text.
 * Keys on the denylist are dropped before serialisation whatever the caller passed, and
 * string values are scrubbed of anything shaped like an API key or bearer token. A log line
 * says *that* something happened and *where*; the content stays in the store.
 *
 * Knobs (all optional): `JARVIS_SERVER_LOG=off` silences both sinks (the test setup sets it,
 * so a suite never appends to the repository's own `.data/server.log`); `JARVIS_SERVER_LOG_PATH`
 * moves the file, and an empty value keeps the log on stdout only; `JARVIS_SERVER_LOG_MAX_BYTES`
 * sets the rollover size.
 *
 * Server-only (`node:fs`); nothing under `src/components` may import it.
 */
export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const DENYLIST = new Set([
  "body",
  "content",
  "messages",
  "message_body",
  "text",
  "prompt",
  "arguments",
  "args",
  "apikey",
  "api_key",
  "secret",
  "authorization",
  "cookie",
  "password",
  "token",
]);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const SECRET_SHAPES: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{6,}/g, "sk-***"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***"],
];

function logPath(): string {
  return process.env.JARVIS_SERVER_LOG_PATH ?? join(process.cwd(), ".data", "server.log");
}

function maxBytes(): number {
  const raw = Number(process.env.JARVIS_SERVER_LOG_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

/** Short id a person can quote back from an error response; 8 hex chars are plenty for one server. */
export function newRequestId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

/** The safe subset of an unknown thrown value: name, message, and the first lines of the stack. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(error.stack ? { stack: error.stack.split("\n").slice(0, 6).join("\n") } : {}),
    };
  }
  return { errorMessage: String(error) };
}

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_SHAPES.reduce((text, [shape, mask]) => text.replace(shape, mask), value);
  }
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (value && typeof value === "object") {
    return sanitize(value as LogFields);
  }
  return value;
}

function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (DENYLIST.has(key.toLowerCase())) {
      continue;
    }
    out[key] = scrub(value);
  }
  return out;
}

function rotateIfNeeded(path: string): void {
  try {
    if (statSync(path).size >= maxBytes()) {
      renameSync(path, `${path}.1`);
    }
  } catch {
    /* no file yet, or rename lost a race — either way, keep writing */
  }
}

/** Emit one line. Never throws: a log that could take the server down would defeat its purpose. */
export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (process.env.JARVIS_SERVER_LOG === "off") {
    return;
  }
  const record = { ts: new Date().toISOString(), level, event, ...sanitize(fields) };
  let line: string;
  try {
    line = `${JSON.stringify(record)}\n`;
  } catch {
    line = `${JSON.stringify({ ts: record.ts, level, event, unserializable: true })}\n`;
  }
  try {
    (level === "error" ? process.stderr : process.stdout).write(line);
  } catch {
    /* a closed pipe is not our problem */
  }
  const path = logPath();
  if (!path) {
    return;
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    rotateIfNeeded(path);
    appendFileSync(path, line, "utf8");
  } catch {
    /* the file is a convenience; stdout already has the line */
  }
}

/**
 * The one line every route's 500 branch writes (REQ-NF-063 ② "路由 500"). Returns the request
 * id so the response can carry it too — the person reads it in the error, the operator greps it.
 */
export function logRouteFailure(route: string, error: unknown, fields: LogFields = {}): string {
  const requestId = newRequestId();
  logEvent("error", "route.failed", { route, status: 500, requestId, ...fields, ...errorFields(error) });
  return requestId;
}
