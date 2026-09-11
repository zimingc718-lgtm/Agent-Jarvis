import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type Store } from "@/lib/store";
import type { ToolContext } from "@/lib/tools/registry";
import {
  createWebTools,
  extractReadableText,
  extractTitle,
  probeSearchBackend,
  readWebSettings,
  SETTING_SEARCH_BASE_URL,
  SETTING_WEB_ENABLED,
  validateSearchBaseUrl,
} from "@/lib/tools/web-tools";

/**
 * TEST-072 — outbound tools and their degradation (REQ-F-033/034, REQ-NF-009/011; TASK-070).
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

const context: ToolContext = {
  userId: "u1",
  conversationId: "c1",
  skillCount: 0,
  webEnabled: true,
  searchConfigured: true,
};

describe("web tools", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-web-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    store.setSetting(SETTING_SEARCH_BASE_URL, "http://127.0.0.1:8080");
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("① 请求形如 /search?q=&format=json，载荷只含查询词", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ results: [{ title: "T", url: "https://e.example/a", content: "C" }] }));
    });
    const [webSearch] = createWebTools({ store, fetcher: fetcher as unknown as typeof fetch });

    const result = await webSearch.execute({ query: "量子计算" }, context);

    expect(urls[0]).toBe(`http://127.0.0.1:8080/search?q=${encodeURIComponent("量子计算")}&format=json`);
    // Nothing about the conversation, the user or any credential leaves the machine.
    expect(urls[0]).not.toMatch(/conversation|history|Bearer|secret|u1/i);
    expect(result.sources).toEqual([{ url: "https://e.example/a", title: "T" }]);
  });

  it("③ 后端不可用作工具失败回喂，不抛出", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const [webSearch] = createWebTools({ store, fetcher: fetcher as unknown as typeof fetch });
    const result = await webSearch.execute({ query: "x" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("搜索失败");
  });

  it("④ 连续失败 2 次后本轮短路，但描述符仍在（保前缀稳定）", async () => {
    const fetcher = vi.fn(async () => new Response("boom", { status: 500 }));
    const [webSearch] = createWebTools({ store, fetcher: fetcher as unknown as typeof fetch });

    await webSearch.execute({ query: "a" }, context);
    await webSearch.execute({ query: "b" }, context);
    const third = await webSearch.execute({ query: "c" }, context);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(third.summary).toContain("搜索后端不可用");
    // Deregistering would rewrite the stable prefix mid-conversation (DEC-026 ②).
    expect(webSearch.available(context)).toBe(true);
  });

  it("② 未配置地址时 web_search 不注册；总开关关闭时两个工具都不注册", () => {
    const [webSearch, readUrl] = createWebTools({ store });
    expect(webSearch.available({ ...context, searchConfigured: false })).toBe(false);
    expect(readUrl.available({ ...context, searchConfigured: false })).toBe(true);
    expect(webSearch.available({ ...context, webEnabled: false })).toBe(false);
    expect(readUrl.available({ ...context, webEnabled: false })).toBe(false);
  });

  it("⑤ read_url 返回摘要而非原文", async () => {
    const html = `<html><head><title>Doc</title></head><body><script>evil()</script><p>正文一</p><p>正文二</p></body></html>`;
    const fetcher = vi.fn(async () => new Response(html, { status: 200 }));
    const [, readUrl] = createWebTools({
      store,
      fetcher: fetcher as unknown as typeof fetch,
      resolver: async () => ["93.184.216.34"],
    });

    const result = await readUrl.execute({ url: "https://example.com/doc" }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("正文一");
    // Markup and scripts are stripped — the raw page never enters the context.
    expect(result.content).not.toContain("<p>");
    expect(result.content).not.toContain("evil()");
  });

  it("read_url 的地址校验生效：内网目标被拒", async () => {
    const [, readUrl] = createWebTools({ store, resolver: async () => ["10.0.0.1"] });
    const result = await readUrl.execute({ url: "http://intranet.example/secret" }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("地址被拒绝");
  });
});

describe("搜索后端配置 (REQ-F-038)", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-cfg-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("② 联网总开关默认开（用户终裁 4）", () => {
    expect(readWebSettings(store).enabled).toBe(true);
    store.setSetting(SETTING_WEB_ENABLED, "false");
    expect(readWebSettings(store).enabled).toBe(false);
  });

  it("④ 含 userinfo 的 URL 被拒绝保存", () => {
    expect(validateSearchBaseUrl("http://user:pass@searx.example")).toMatchObject({ ok: false });
    expect(validateSearchBaseUrl("ftp://searx.example")).toMatchObject({ ok: false });
    expect(validateSearchBaseUrl("http://searx.example/")).toMatchObject({ ok: true, url: "http://searx.example" });
  });

  it("⑤ 测试连接判据：2xx 且 JSON 含 results", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    await expect(probeSearchBackend("http://x", ok as unknown as typeof fetch)).resolves.toMatchObject({ ok: true });

    const noResults = vi.fn(async () => new Response(JSON.stringify({ answers: [] })));
    await expect(probeSearchBackend("http://x", noResults as unknown as typeof fetch)).resolves.toMatchObject({
      ok: false,
    });
  });

  it("⑤ SearXNG 未开 json 输出时给针对性报错", async () => {
    // The single most likely setup failure: SearXNG ships with JSON off and answers HTML.
    const html = vi.fn(async () => new Response("<html><body>results</body></html>", { status: 200 }));
    const result = await probeSearchBackend("http://x", html as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("json");
    expect(result.message).toContain("settings.yml");
  });
});

describe("正文抽取（确定性，不额外调模型）", () => {
  it("去掉 script/style 与标签，保留段落", () => {
    const text = extractReadableText(
      "<html><body><style>a{}</style><script>x()</script><h1>标题</h1><p>第一段</p><p>第二段</p></body></html>"
    );
    expect(text).toContain("标题");
    expect(text).toContain("第一段");
    expect(text).not.toContain("x()");
    expect(text).not.toContain("<p>");
  });

  it("解出 title", () => {
    expect(extractTitle("<html><head><title> 我的页面 </title></head></html>")).toBe("我的页面");
  });
});
