import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * TEST-610 — `/api/health` (REQ-NF-063 ①, DEC-490 ①; CR-20260929-health-logging): no login,
 * no secrets, really opens the store; 200 when it can serve, 503 with the reason when it cannot.
 *
 * No `next-auth` mock on purpose — the route must answer without a session.
 */
const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-health-"));
process.env.JARVIS_DB_PATH = join(dir, "health.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;
delete process.env.JARVIS_SERVER_LOG;
process.env.JARVIS_SERVER_LOG_PATH = "";

const route = await import("@/app/api/health/route");
const { healthReport } = await import("@/lib/health");
const { getStore } = await import("@/lib/store-singleton");

afterAll(() => {
  process.env.JARVIS_SERVER_LOG = "off";
  delete process.env.JARVIS_SERVER_LOG_PATH;
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/health (TEST-610)", () => {
  it("① 免登录：存储可用时 200，只报构建号 / 存储 / 运行时长 / 时间戳，不缓存", async () => {
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, storage: "ok" });
    expect(typeof body.build).toBe("string");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(typeof body.timestamp).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["build", "ok", "storage", "timestamp", "uptimeSeconds"]);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("② 存储未配置 → 503 unconfigured；库打不开 → 503 error 并记一行日志（不抛）", () => {
    const unconfigured = healthReport({ configured: false, probeStore: () => undefined });
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.report).toMatchObject({ ok: false, storage: "unconfigured" });

    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const broken = healthReport({
        configured: true,
        probeStore: () => {
          throw new Error("SQLITE_CANTOPEN");
        },
      });
      expect(broken.status).toBe(503);
      expect(broken.report).toMatchObject({ ok: false, storage: "error" });
      expect(err).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(err.mock.calls[0]![0]).trim())).toMatchObject({
        event: "health.store_failed",
        errorMessage: "SQLITE_CANTOPEN",
      });
    } finally {
      err.mockRestore();
    }
  });
});
