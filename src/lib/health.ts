import { errorFields, logEvent } from "./log";

/**
 * The health report behind `/api/health` (REQ-NF-063 ①, DEC-490 ①; CR-20260929-health-logging).
 *
 * Liveness and readiness in one unauthenticated answer: the build the process was made from
 * (the same value as the page's `jarvis-build` meta, so `build` ≠ `git rev-parse HEAD` means
 * an old build is serving), whether the store opens, how long the process has been up, and
 * the time. Nothing else — no providers, no users, no paths — because a stranger may read it.
 *
 * The probe really touches the database: a 200 from a static route proves nothing about the
 * process being able to serve (CLAUDE.md §四, EV-2026-09-12-runtime-visibility). Kept apart
 * from the route file so the 503 branches are unit-testable without unsetting the process's
 * own secret, and because a Next route module may export only handler fields.
 */
export type HealthReport = {
  ok: boolean;
  build: string;
  storage: "ok" | "unconfigured" | "error";
  uptimeSeconds: number;
  timestamp: string;
};

export type HealthInput = {
  /** `getStorageConfig().configured` — false when JARVIS_SECRET_KEY is missing. */
  configured: boolean;
  /** Opens the store and reads one row; throws when the database cannot be opened. */
  probeStore: () => void;
  now?: () => Date;
};

export function healthReport(input: HealthInput): { status: number; report: HealthReport } {
  const base = {
    build: process.env.NEXT_PUBLIC_BUILD_SHA ?? "",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: (input.now ?? (() => new Date()))().toISOString(),
  };
  if (!input.configured) {
    return { status: 503, report: { ok: false, storage: "unconfigured", ...base } };
  }
  try {
    input.probeStore();
  } catch (error) {
    logEvent("error", "health.store_failed", errorFields(error));
    return { status: 503, report: { ok: false, storage: "error", ...base } };
  }
  return { status: 200, report: { ok: true, storage: "ok", ...base } };
}
