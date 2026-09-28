import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/lib/tools/registry";
import type { ChatDelta } from "@/lib/types";

/**
 * TEST-591 — server text follows the interface language (REQ-F-350 ①③, DEC-470 ②④⑤;
 * CR-20260928-server-strings-i18n). The same requests answer in Chinese by default — byte for
 * byte what they said before — and in English once `ui.language` is `en`: a route literal,
 * a `validateRoot` code, a coded `WakeSettingsError` through `messageFor`, a literal with
 * params; the wake-up prompt and a tool step row's status follow the same setting.
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-server-strings-"));
process.env.JARVIS_DB_PATH = join(dir, "s.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const wakeRoute = await import("@/app/api/settings/wake/route");
const documentsRoute = await import("@/app/api/settings/documents/route");
const decideRoute = await import("@/app/api/library/decide/route");
const actionsRoute = await import("@/app/api/actions/route");
const { getStore } = await import("@/lib/store-singleton");
const { SETTING_LANGUAGE } = await import("@/lib/language");
const { buildWakeMessages } = await import("@/lib/wake");
const { runToolLoop } = await import("@/lib/agent-loop");
const { ToolRegistry } = await import("@/lib/tools/registry");
const { serverTranslator } = await import("@/lib/i18n-server");

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function json(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function messages() {
  const wake = await wakeRoute.PUT(json("http://test/api/settings/wake", "PUT", { intervalMinutes: 0 }));
  const docs = await documentsRoute.POST(json("http://test/api/settings/documents", "POST", { path: "relative/dir" }));
  const decide = await decideRoute.POST(json("http://test/api/library/decide", "POST", "not json"));
  const actions = await actionsRoute.GET(new Request("http://test/api/actions?effects=bogus"));
  for (const response of [wake, docs, decide, actions]) {
    expect(response.status).toBe(400);
  }
  return {
    wake: ((await wake.json()) as { message: string }).message,
    docs: ((await docs.json()) as { message: string }).message,
    decide: ((await decide.json()) as { message: string }).message,
    actions: ((await actions.json()) as { message: string }).message,
  };
}

beforeEach(() => {
  as("owner@example.com");
  getStore().setSetting(SETTING_LANGUAGE, null);
});

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TEST-591 服务端文案随界面语言", () => {
  it("① 默认中文：四类 message 与改写前逐字一致", async () => {
    const got = await messages();
    expect(got.wake).toMatch(/^唤醒间隔须是 \d+–\d+ 之间的整数分钟。$/);
    expect(got.docs).toBe("请填绝对路径。");
    expect(got.decide).toBe("请求体不是合法的 JSON。");
    expect(got.actions).toBe("未知的 effects 取值：bogus（只接受 read / write / network）。");
  });

  it("② 切到 English 后同一批请求返回英文；切回中文恢复", async () => {
    getStore().setSetting(SETTING_LANGUAGE, "en");
    const en = await messages();
    expect(en.wake).toMatch(/^The wake-up interval must be a whole number of minutes between \d+ and \d+\.$/);
    expect(en.docs).toBe("Enter an absolute path.");
    expect(en.decide).toBe("The request body is not valid JSON.");
    expect(en.actions).toBe("Unknown effects value(s): bogus (only read / write / network are accepted).");

    getStore().setSetting(SETTING_LANGUAGE, "zh");
    const zh = await messages();
    expect(zh.docs).toBe("请填绝对路径。");
  });

  it("③ 唤醒提示词与转录标题按语言取字典；缺省仍是中文", () => {
    const zh = buildWakeMessages([]);
    expect(zh[0]!.content).toContain("这是一次空闲唤醒，不是用户提问。");
    expect(zh[0]!.content).toContain("有就用一两句中文直接说");
    expect(zh[1]!.content).toBe("最近对话（截取）：\n（无）");

    const en = buildWakeMessages([], undefined, "en");
    expect(en[0]!.content).toContain("This is an idle wake-up, not a user question.");
    expect(en[0]!.content).toContain("one or two English sentences");
    expect(en[0]!.content).not.toMatch(/[㐀-鿿]/);
    expect(en[1]!.content).toBe("Recent conversation (excerpt):\n(none)");
  });

  it("④ 工具步骤行状态跟随传入的 t；不传时是中文", async () => {
    const context: ToolContext = {
      userId: "u1",
      conversationId: "c1",
      skillCount: 0,
      webEnabled: false,
      searchConfigured: false,
      knowledgeCount: 0,
      contextWindow: 128_000,
    };
    async function unknownToolSummary(t?: ReturnType<typeof serverTranslator>): Promise<string> {
      const emitted: ChatDelta[] = [];
      let round = 0;
      await runToolLoop({
        registry: new ToolRegistry(),
        toolContext: context,
        messages: [{ role: "user", content: "hi" }],
        emit: (delta) => emitted.push(delta),
        persist: () => undefined,
        providerTurn: async function* () {
          round += 1;
          if (round === 1) {
            yield { type: "tool_call", callId: "t1", name: "nope", argsSummary: "{}" };
            return;
          }
          yield { type: "delta", text: "done" };
        },
        ...(t ? { t } : {}),
      });
      const result = emitted.find((delta) => delta.type === "tool_result") as { summary: string } | undefined;
      expect(result).toBeDefined();
      return result!.summary;
    }
    expect(await unknownToolSummary()).toBe("未知工具");
    expect(await unknownToolSummary(serverTranslator("en"))).toBe("unknown tool");
  });
});
