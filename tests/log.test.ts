import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-611 — the structured server log (REQ-NF-063 ②③, DEC-490 ②; CR-20260929-health-logging):
 * one JSON line per event with ts / level / event / fields, written to stdout (stderr for
 * errors) and appended to the file; denylisted keys — request bodies, credentials, conversation
 * text — never reach either sink and key-shaped strings are masked; the file rolls over at the
 * configured size; `JARVIS_SERVER_LOG=off` and an empty path switch the sinks off.
 *
 * `tests/setup.ts` turns the log off for every suite; this file turns it back on for itself.
 */
const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-log-"));
const file = join(dir, "nested", "server.log");
delete process.env.JARVIS_SERVER_LOG;
process.env.JARVIS_SERVER_LOG_PATH = file;
process.env.JARVIS_SERVER_LOG_MAX_BYTES = "400";

const { errorFields, logEvent, logRouteFailure, newRequestId } = await import("@/lib/log");

function lines(): Array<Record<string, unknown>> {
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
}

/** Calls are read before `mockRestore()` — vitest's restore also resets `mock.calls`. */
function capture(stream: NodeJS.WriteStream, run: () => void): string[] {
  const spy = vi.spyOn(stream, "write").mockImplementation(() => true);
  try {
    run();
    return spy.mock.calls.map((call) => String(call[0]));
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  process.env.JARVIS_SERVER_LOG = "off";
  delete process.env.JARVIS_SERVER_LOG_PATH;
  delete process.env.JARVIS_SERVER_LOG_MAX_BYTES;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TEST-611 structured server log", () => {
  it("① 一行一个 JSON：ts / level / event / 字段；同时写 stdout 与文件（目录不存在会建）", () => {
    const out = capture(process.stdout, () => logEvent("info", "test.event", { requestId: "abc12345", count: 3 }));
    expect(out).toHaveLength(1);
    const written = JSON.parse(out[0]!.trim()) as Record<string, unknown>;
    expect(written).toMatchObject({ level: "info", event: "test.event", requestId: "abc12345", count: 3 });
    expect(typeof written.ts).toBe("string");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ event: "test.event", requestId: "abc12345" });
  });

  it("② error 级别走 stderr；请求体、凭据、对话正文一类的键被丢弃，形似密钥的值被打码", () => {
    const err = capture(process.stderr, () =>
      logEvent("error", "route.failed", {
        requestId: "r1",
        body: { secret: "x" },
        content: "对话正文",
        messages: [{ role: "user", content: "hi" }],
        authorization: "Bearer abc",
        apiKey: "sk-1234567890",
        nested: { token: "t", keep: "yes", why: "401 Bearer eyJhbGciOiJIUzI1NiJ9.abc" },
        errorMessage: "provider said: invalid key sk-abcdefghijklmnop",
        keep: "yes",
      })
    );
    expect(err).toHaveLength(1);
    const written = JSON.parse(err[0]!.trim()) as Record<string, unknown>;
    expect(written).toMatchObject({ level: "error", event: "route.failed", requestId: "r1", keep: "yes" });
    for (const key of ["body", "content", "messages", "authorization", "apiKey"]) {
      expect(written).not.toHaveProperty(key);
    }
    expect(written.nested).toEqual({ keep: "yes", why: "401 Bearer ***" });
    expect(written.errorMessage).toBe("provider said: invalid key sk-***");
    const onDisk = JSON.stringify(lines());
    expect(onDisk).not.toContain("对话正文");
    expect(onDisk).not.toContain("sk-1234567890");
  });

  it("③ errorFields 只取名字、消息与前几行栈；newRequestId 是 8 位十六进制；logRouteFailure 回同一个 id", () => {
    const fields = errorFields(new TypeError("boom"));
    expect(fields).toMatchObject({ errorName: "TypeError", errorMessage: "boom" });
    expect(String(fields.stack).split("\n").length).toBeLessThanOrEqual(6);
    expect(errorFields("plain")).toEqual({ errorMessage: "plain" });
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}$/);
    expect(newRequestId()).not.toBe(newRequestId());

    let requestId = "";
    const err = capture(process.stderr, () => {
      requestId = logRouteFailure("/api/x", new Error("db locked"), { userId: "u1" });
    });
    expect(requestId).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.parse(err[0]!.trim())).toMatchObject({
      event: "route.failed",
      route: "/api/x",
      status: 500,
      requestId,
      userId: "u1",
      errorMessage: "db locked",
    });
  });

  it("④ 文件超过上限时滚动到 .1，写入不中断", () => {
    capture(process.stdout, () => {
      for (let index = 0; index < 8; index += 1) {
        logEvent("info", "filler", { index, padding: "x".repeat(80) });
      }
    });
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(lines().length).toBeGreaterThan(0);
    expect(lines().length).toBeLessThan(8);
  });

  it("⑤ 空路径只写 stdout；JARVIS_SERVER_LOG=off 两个出口都关", () => {
    process.env.JARVIS_SERVER_LOG_PATH = "";
    const out = capture(process.stdout, () => logEvent("info", "stdout.only"));
    expect(out).toHaveLength(1);
    expect(existsSync(file)).toBe(false);

    process.env.JARVIS_SERVER_LOG_PATH = file;
    process.env.JARVIS_SERVER_LOG = "off";
    const silent = capture(process.stdout, () => logEvent("info", "nothing"));
    delete process.env.JARVIS_SERVER_LOG;
    expect(silent).toHaveLength(0);
    expect(existsSync(file)).toBe(false);
  });
});
