import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/lib/tools/registry";
import type { ChatDelta } from "@/lib/types";

/**
 * TEST-613 — the log lines at the sites the ruling named (REQ-NF-063 ②③, DEC-490 ②④, TASK-610;
 * CR-20260929-health-logging): a route's 500 carries a `requestId` that the `route.failed` line
 * repeats; a tool that throws leaves a `tool.failed` line naming the tool but not its arguments;
 * a wake-up leaves a `wake.outcome` line without the notice text; a sweep round leaves a
 * `sweep.outcome` line with counts only.
 *
 * Every data root points into the temp dir — the sweep route resolves user roots, and the
 * default would be the repository's own `.data/`.
 */
const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-log-sites-"));
process.env.JARVIS_DB_PATH = join(dir, "s.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
process.env.JARVIS_ENTITIES_PATH = join(dir, "entities");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_USERS_PATH = join(dir, "users");
delete process.env.JARVIS_TEST_USER_ID;
delete process.env.JARVIS_SERVER_LOG;
process.env.JARVIS_SERVER_LOG_PATH = "";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat")>();
  return {
    ...actual,
    runChatTurn: vi.fn(async () => {
      throw new Error("db locked (sk-abcdefghijklmnop)");
    }),
  };
});

const { getServerSession } = await import("next-auth");
const streamRoute = await import("@/app/api/chat/stream/route");
const wakeRoute = await import("@/app/api/chat/wake/route");
const sweepRoute = await import("@/app/api/entities/sweep/route");
const { getStore } = await import("@/lib/store-singleton");
const { runToolLoop } = await import("@/lib/agent-loop");
const { ToolRegistry } = await import("@/lib/tools/registry");

type Line = Record<string, unknown>;

/** Calls are read before `mockRestore()` — vitest's restore also resets `mock.calls`. */
async function captureLines(run: () => Promise<unknown> | unknown): Promise<Line[]> {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await run();
    return [...out.mock.calls, ...err.mock.calls]
      .map((call) => String(call[0]).trim())
      .filter((text) => text.startsWith("{"))
      .map((text) => JSON.parse(text) as Line);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

function json(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { email: "owner@example.com" } } as never);
});

afterAll(() => {
  process.env.JARVIS_SERVER_LOG = "off";
  delete process.env.JARVIS_SERVER_LOG_PATH;
  delete process.env.JARVIS_ENTITIES_PATH;
  delete process.env.JARVIS_KNOWLEDGE_PATH;
  delete process.env.JARVIS_USERS_PATH;
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TEST-613 日志落点", () => {
  it("① 路由 500：响应体带 requestId，route.failed 一行重复同一个 id，密钥形状被打码", async () => {
    let response: Response | undefined;
    const lines = await captureLines(async () => {
      response = await streamRoute.POST(json("http://test/api/chat/stream", { message: "hi" }));
    });
    expect(response!.status).toBe(500);
    const body = (await response!.json()) as { message: string; requestId: string };
    expect(body.requestId).toMatch(/^[0-9a-f]{8}$/);
    const failed = lines.find((line) => line.event === "route.failed");
    expect(failed).toMatchObject({ level: "error", route: "/api/chat/stream", status: 500, requestId: body.requestId });
    expect(failed!.errorMessage).toBe("db locked (sk-***)");
    expect(JSON.stringify(failed)).not.toContain('"body"');
  });

  it("② 工具抛错：tool.failed 记工具名与错误，不记参数", async () => {
    const context: ToolContext = {
      userId: "u1",
      conversationId: "c1",
      skillCount: 0,
      webEnabled: false,
      searchConfigured: false,
      knowledgeCount: 0,
      contextWindow: 128_000,
    };
    const registry = new ToolRegistry().register({
      name: "explode",
      description: "throws",
      parameters: { type: "object", properties: {} },
      available: () => true,
      execute: async () => {
        throw new Error("kaboom");
      },
    });
    const emitted: ChatDelta[] = [];
    let round = 0;
    const lines = await captureLines(() =>
      runToolLoop({
        registry,
        toolContext: context,
        messages: [{ role: "user", content: "secret user text" }],
        emit: (delta) => emitted.push(delta),
        persist: () => undefined,
        providerTurn: async function* () {
          round += 1;
          if (round === 1) {
            yield { type: "tool_call", callId: "t1", name: "explode", argsSummary: '{"q":"private"}' };
            return;
          }
          yield { type: "delta", text: "done" };
        },
      })
    );
    const failed = lines.filter((line) => line.event === "tool.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: "warn", tool: "explode", callId: "t1", conversationId: "c1", errorMessage: "kaboom" });
    expect(JSON.stringify(failed[0])).not.toContain("private");
    expect(JSON.stringify(failed[0])).not.toContain("secret user text");
    expect(emitted.some((delta) => delta.type === "tool_result" && !delta.ok)).toBe(true);
  });

  it("③ 唤醒与巡检：各留一行结果，只有类别与计数", async () => {
    const lines = await captureLines(async () => {
      const wake = await wakeRoute.POST(json("http://test/api/chat/wake", { manual: false }));
      expect(wake.status).toBe(200);
      const sweep = await sweepRoute.POST(json("http://test/api/entities/sweep", { force: true }));
      expect(sweep.status).toBe(200);
    });
    const wake = lines.find((line) => line.event === "wake.outcome");
    expect(wake).toMatchObject({ level: "info", kind: "skipped", reason: "disabled", manual: false });
    expect(wake).not.toHaveProperty("text");
    expect(wake).not.toHaveProperty("message");
    const sweep = lines.find((line) => line.event === "sweep.outcome");
    expect(sweep).toMatchObject({ level: "info", ran: false, reasonCode: "sweep.noSources", count: 0, changed: 0, remaining: 0, force: true });
  });
});
