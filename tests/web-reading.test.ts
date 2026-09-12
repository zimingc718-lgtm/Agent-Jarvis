import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type Store } from "@/lib/store";
import { DEFAULT_FETCH_HEADERS } from "@/lib/tools/url-guard";
import {
  browserFallbackEnabled,
  createWebTools,
  detectBotChallenge,
  looksLikeChallengePage,
  SETTING_BROWSER_FALLBACK,
} from "@/lib/tools/web-tools";
import type { ToolContext } from "@/lib/tools/registry";

/**
 * TEST-098 / TEST-099 — telling a challenge from a refusal, the browser channel, and
 * `read_url`'s content-type dispatch (REQ-F-055 ③, REQ-F-056, REQ-F-057, REQ-NF-014;
 * DEC-033 ①③④; TASK-094/095/096). CR-20260911-web-reading.
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";
const publicResolver = async () => ["93.184.216.34"];

/** A fetchable PDF body. `ArrayBuffer` because that is what `Response` accepts as BodyInit. */
function pdfBytes(content: string): ArrayBuffer {
  const body = deflateSync(Buffer.from(content, "latin1"));
  const joined = Buffer.concat([
    Buffer.from("%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n", "latin1"),
    body,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< >>\n%%EOF\n", "latin1"),
  ]);
  const copy = new ArrayBuffer(joined.byteLength);
  new Uint8Array(copy).set(joined);
  return copy;
}

describe("TEST-098 拦截识别 (REQ-F-056 ②)", () => {
  it("① Cloudflare 的 cf-mitigated 头直接判定为人机校验", () => {
    const headers = new Headers({ "cf-mitigated": "challenge", server: "cloudflare" });
    expect(detectBotChallenge(403, headers, "")).toBe("Cloudflare 人机校验");
  });

  it("② 校验页文案中英文都认——中文是实测返回的那一种", () => {
    expect(looksLikeChallengePage("<title>Just a moment...</title>")).toBe(true);
    expect(looksLikeChallengePage("<h1>正在进行安全验证</h1>")).toBe(true);
    expect(looksLikeChallengePage("<title>请稍候…</title>")).toBe(true);
    expect(looksLikeChallengePage("<h1>Quarterly report</h1>")).toBe(false);
  });

  it("③ Akamai 的 403 按 server 头判定", () => {
    expect(detectBotChallenge(403, new Headers({ server: "AkamaiGHost" }), "")).toBe("Akamai 机器人防护");
  });

  it("④ 404 / 500 不是拦截，不触发浏览器回退", () => {
    expect(detectBotChallenge(404, new Headers(), "not found")).toBeNull();
    expect(detectBotChallenge(500, new Headers(), "oops")).toBeNull();
  });

  it("⑤ 无标记的 403 / 429 仍值得试一次浏览器（tsmc.com 实测可救回）", () => {
    expect(detectBotChallenge(403, new Headers(), "forbidden")).toBe("站点拒绝了非浏览器请求");
    expect(detectBotChallenge(429, new Headers(), "slow down")).toBe("站点拒绝了非浏览器请求");
  });

  it("⑥ 出站请求带完整浏览器请求头，accept 里含 application/pdf", () => {
    expect(DEFAULT_FETCH_HEADERS["user-agent"]).toMatch(/Mozilla\/5\.0/);
    expect(DEFAULT_FETCH_HEADERS.accept).toContain("application/pdf");
    expect(DEFAULT_FETCH_HEADERS["accept-language"]).toContain("zh-CN");
  });
});

describe("TEST-099 read_url 分流与浏览器回退 (REQ-F-055, REQ-F-057)", () => {
  let dir: string;
  let store: Store;
  let context: ToolContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jarvis-web-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    const userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;
    const conversationId = store.createConversation(userId, "chat").id;
    context = { userId, conversationId, skillCount: 0, webEnabled: true, searchConfigured: true, knowledgeCount: 0, contextWindow: 128_000 };
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const readTool = (fetcher: typeof fetch, launcher?: Parameters<typeof createWebTools>[0]["browserLauncher"]) =>
    createWebTools({ store, fetcher, resolver: publicResolver, browserLauncher: launcher })[1];

  it("① content-type 为 application/pdf 时走 PDF 提取，而不是 HTML 剥离", async () => {
    const fetcher = vi.fn(async () =>
      new Response(pdfBytes("BT (Executive Summary of the report) Tj ET"), {
        headers: { "content-type": "application/pdf" },
      })
    ) as unknown as typeof fetch;
    const result = await readTool(fetcher).execute({ url: "https://example.com/a.pdf" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Executive Summary of the report");
    expect(result.summary).toMatch(/读取 PDF/);
    // The old behaviour: raw bytes decoded as text. Nothing structural may leak through.
    expect(result.content).not.toContain("FlateDecode");
    expect(result.content).not.toContain("%PDF");
  });

  it("① 声明为 octet-stream 但内容是 PDF 时也按 PDF 处理", async () => {
    const fetcher = vi.fn(async () =>
      new Response(pdfBytes("BT (magic sniffed) Tj ET"), { headers: { "content-type": "application/octet-stream" } })
    ) as unknown as typeof fetch;
    const result = await readTool(fetcher).execute({ url: "https://example.com/x" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("magic sniffed");
  });

  it("② 扫描件 PDF 报失败并说明原因，而不是空的成功", async () => {
    const fetcher = vi.fn(async () =>
      new Response(pdfBytes("/Im0 Do"), { headers: { "content-type": "application/pdf" } })
    ) as unknown as typeof fetch;
    const result = await readTool(fetcher).execute({ url: "https://example.com/scan.pdf" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/扫描件/);
    expect(result.summary).toMatch(/无文字层/);
  });

  it("③ 遇到人机校验时改走浏览器，成功则标注来路", async () => {
    const fetcher = vi.fn(async () =>
      new Response("<html><title>Just a moment...</title></html>", {
        status: 403,
        headers: { "cf-mitigated": "challenge", server: "cloudflare" },
      })
    ) as unknown as typeof fetch;
    const launcher = vi.fn(async () => ({
      status: 200,
      html: "<html><head><title>真实标题</title></head><body><p>真实正文内容</p></body></html>",
      finalUrl: "https://example.com/real",
    }));
    const result = await readTool(fetcher, launcher).execute({ url: "https://example.com/blocked" }, context);
    expect(launcher).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("真实正文内容");
    expect(result.content).toContain("经浏览器读取");
  });

  it("④ 浏览器也没过校验时报失败，绝不把校验页当正文返回", async () => {
    const fetcher = vi.fn(async () =>
      new Response("<html><title>Just a moment...</title></html>", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      })
    ) as unknown as typeof fetch;
    // What the real Cloudflare case returns: the interstitial, in Chinese, still 403.
    const launcher = vi.fn(async () => ({
      status: 403,
      html: "<html><head><title>请稍候…</title></head><body>正在进行安全验证</body></html>",
      finalUrl: "https://example.com/blocked",
    }));
    const result = await readTool(fetcher, launcher).execute({ url: "https://example.com/blocked" }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/人机校验未通过/);
    expect(result.content).toMatch(/不要重复请求/);
    expect(result.content).not.toContain("正在进行安全验证");
  });

  it("⑤ 非拦截的失败（404）不启动浏览器，并告诉模型别重试同一地址", async () => {
    const fetcher = vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    const launcher = vi.fn();
    const result = await readTool(fetcher, launcher as never).execute({ url: "https://example.com/missing" }, context);
    expect(launcher).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/不是人机校验/);
  });

  it("⑥ 关闭浏览器回退后不启动浏览器，并说明如何开启", async () => {
    store.setSetting(SETTING_BROWSER_FALLBACK, "false");
    expect(browserFallbackEnabled(store)).toBe(false);
    const fetcher = vi.fn(async () =>
      new Response("blocked", { status: 403, headers: { server: "cloudflare" } })
    ) as unknown as typeof fetch;
    const launcher = vi.fn();
    const result = await readTool(fetcher, launcher as never).execute({ url: "https://example.com/blocked" }, context);
    expect(launcher).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/浏览器回退已关闭/);
  });

  it("⑦ 默认开启浏览器回退", () => {
    expect(browserFallbackEnabled(store)).toBe(true);
  });

  it("⑧ 正常 HTML 仍走原路径，不启动浏览器", async () => {
    const fetcher = vi.fn(async () =>
      new Response("<html><head><title>普通页</title></head><body><p>正文</p></body></html>", {
        headers: { "content-type": "text/html" },
      })
    ) as unknown as typeof fetch;
    const launcher = vi.fn();
    const result = await readTool(fetcher, launcher as never).execute({ url: "https://example.com/ok" }, context);
    expect(launcher).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.content).toContain("正文");
    expect(result.content).not.toContain("经浏览器读取");
  });
});
