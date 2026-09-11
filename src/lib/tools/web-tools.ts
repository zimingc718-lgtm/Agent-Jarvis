import { lookup } from "node:dns/promises";
import type { Store } from "../store";
import { BUDGET_SHARES, truncateToTokens } from "./budget";
import type { ToolDescriptor, ToolResult } from "./registry";
import { fetchWithGuardedRedirects, UrlNotAllowedError, type Resolver } from "./url-guard";

/**
 * Outbound tools: `web_search` and `read_url` (REQ-F-033/034, DEC-027, TASK-070).
 *
 * Search goes through a user-run SearXNG-compatible endpoint: no API key, no per-query
 * bill, nothing but the query word leaves the machine, and Jarvis needs no new npm
 * dependency to talk to it. When no endpoint is configured the tool does not register at
 * all, so its definition never occupies prompt budget either (REQ-NF-008 ④).
 */

export const SETTING_WEB_ENABLED = "search.enabled";
export const SETTING_SEARCH_BASE_URL = "search.base_url";

const MAX_RESULTS = 10;
const READ_URL_MAX_BYTES = 2 * 1024 * 1024;
const READ_URL_TIMEOUT_MS = 15_000;
/** Consecutive failures after which the backend is presumed down for this turn. */
const FAILURE_SHORT_CIRCUIT = 2;

export type WebToolDeps = {
  store: Store;
  fetcher?: typeof fetch;
  resolver?: Resolver;
  allowHosts?: string[];
};

export function readWebSettings(store: Store): { enabled: boolean; baseUrl: string | null } {
  // REQ-F-038 ②: the master switch defaults ON (user ruling 4). Outbound traffic still
  // waits on a configured endpoint, so the URL is the real gate.
  const raw = store.getSetting(SETTING_WEB_ENABLED);
  const enabled = raw === null ? true : raw === "true";
  const baseUrl = store.getSetting(SETTING_SEARCH_BASE_URL);
  return { enabled, baseUrl: baseUrl && baseUrl.trim() ? baseUrl.trim() : null };
}

/** Rejects credentials-in-URL before anything is stored (REQ-F-038 ③). */
export function validateSearchBaseUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "不是合法的 URL。" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "仅支持 http/https。" };
  }
  if (url.username || url.password) {
    return { ok: false, message: "URL 不得包含用户名或密码。" };
  }
  return { ok: true, url: url.toString().replace(/\/$/, "") };
}

type SearxResponse = { results?: Array<{ title?: string; url?: string; content?: string }> };

/**
 * Classifies a search-backend failure. Shared with the settings "Test connection" action
 * so the two can never disagree about what counts as working (REQ-NF-011 ③).
 */
export async function probeSearchBackend(
  baseUrl: string,
  fetcher: typeof fetch = fetch
): Promise<{ ok: boolean; message: string }> {
  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/$/, "")}/search?q=jarvis&format=json`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return { ok: false, message: `无法连接搜索服务：${error instanceof Error ? error.message : "网络错误"}。` };
  }
  if (!response.ok) {
    return { ok: false, message: `搜索服务返回 ${response.status}。` };
  }
  const body = await response.text();
  let parsed: SearxResponse;
  try {
    parsed = JSON.parse(body) as SearxResponse;
  } catch {
    // SearXNG ships with JSON output disabled and answers HTML — the single most
    // likely setup failure, so it gets its own message instead of "invalid response".
    return {
      ok: false,
      message: "搜索服务返回的不是 JSON。SearXNG 默认未开启 json 输出，请在 settings.yml 的 search.formats 中加入 json 后重启。",
    };
  }
  if (!Array.isArray(parsed.results)) {
    return { ok: false, message: "响应中没有 results 数组，可能不是 SearXNG 兼容接口。" };
  }
  return { ok: true, message: "搜索服务连接正常。" };
}

/**
 * Strips a fetched page down to readable text (REQ-F-034 ①).
 * Deterministic and dependency-free on purpose: summarising with a model would add a
 * second model call — and its latency, cost and non-determinism — to every `read_url`.
 */
export function extractReadableText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(withoutNoise)?.[1] ?? withoutNoise;
  return body
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractTitle(html: string): string {
  return /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

export function createWebTools(deps: WebToolDeps): ToolDescriptor[] {
  const fetcher = deps.fetcher ?? fetch;
  const resolver: Resolver =
    deps.resolver ?? (async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  // Per-turn failure counters. Reaching the limit short-circuits `execute` — the
  // descriptor stays registered so the stable prefix does not change (DEC-026 ②).
  const failures = new Map<string, number>();

  const searchResultCap = (): number => Math.floor(8_000 * BUDGET_SHARES.singleToolResult * 10);

  const webSearch: ToolDescriptor = {
    name: "web_search",
    description: "用配置的搜索服务检索网页，返回标题、网址与摘要。需要网页正文时再调 read_url。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "检索关键词" } },
      required: ["query"],
    },
    available: (context) => context.webEnabled && context.searchConfigured,
    async execute(args, context): Promise<ToolResult> {
      if ((failures.get("web_search") ?? 0) >= FAILURE_SHORT_CIRCUIT) {
        return { ok: false, content: "搜索后端不可用，本轮不再尝试。", summary: "搜索后端不可用" };
      }
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { ok: false, content: "缺少参数 query。", summary: "参数缺失" };
      }
      const { baseUrl } = readWebSettings(deps.store);
      if (!baseUrl) {
        return { ok: false, content: "尚未配置搜索服务地址。", summary: "搜索未配置" };
      }

      try {
        // Only the query word crosses the boundary: no history, no credentials,
        // no user identity (REQ-NF-009 ②).
        const response = await fetcher(
          `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`,
          { signal: context.signal ?? AbortSignal.timeout(15_000), headers: { accept: "application/json" } }
        );
        if (!response.ok) {
          failures.set("web_search", (failures.get("web_search") ?? 0) + 1);
          return { ok: false, content: `搜索服务返回 ${response.status}。`, summary: "搜索失败" };
        }
        const parsed = JSON.parse(await response.text()) as SearxResponse;
        const results = (parsed.results ?? []).slice(0, MAX_RESULTS).filter((entry) => entry.url);
        failures.delete("web_search");
        if (results.length === 0) {
          return { ok: true, content: `「${query}」没有检索结果。`, summary: `搜索无结果：${query}` };
        }
        const rendered = results
          .map((entry, index) => `${index + 1}. ${entry.title ?? entry.url}\n   ${entry.url}\n   ${entry.content ?? ""}`)
          .join("\n");
        const { text } = truncateToTokens(rendered, searchResultCap());
        return {
          ok: true,
          content: text,
          summary: `搜索「${query}」→ ${results.length} 条`,
          sources: results.map((entry) => ({ url: entry.url as string, title: entry.title ?? (entry.url as string) })),
        };
      } catch (error) {
        failures.set("web_search", (failures.get("web_search") ?? 0) + 1);
        return {
          ok: false,
          content: `搜索失败：${error instanceof Error ? error.message : "未知错误"}。`,
          summary: "搜索失败",
        };
      }
    },
  };

  const readUrl: ToolDescriptor = {
    name: "read_url",
    description: "读取一个网页的正文摘要。参数 url 必须是 http/https 公网地址。",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "网页地址" } },
      required: ["url"],
    },
    available: (context) => context.webEnabled,
    async execute(args, context): Promise<ToolResult> {
      const raw = typeof args.url === "string" ? args.url.trim() : "";
      if (!raw) {
        return { ok: false, content: "缺少参数 url。", summary: "参数缺失" };
      }
      try {
        const response = await fetchWithGuardedRedirects(raw, {
          resolver,
          allowHosts: deps.allowHosts,
          fetcher,
          signal: context.signal,
          timeoutMs: READ_URL_TIMEOUT_MS,
        });
        if (!response.ok) {
          return { ok: false, content: `读取失败，服务器返回 ${response.status}。`, summary: `读取失败 ${response.status}` };
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > READ_URL_MAX_BYTES) {
          return { ok: false, content: "页面超过 2 MiB 上限，未读取。", summary: "页面过大" };
        }
        const html = new TextDecoder().decode(buffer);
        const title = extractTitle(html) || raw;
        // Only the extract enters the context and the database — the raw page never
        // does (REQ-F-034 ①).
        const { text } = truncateToTokens(extractReadableText(html), searchResultCap());
        return {
          ok: true,
          content: `标题：${title}\n来源：${raw}\n\n${text}`,
          summary: `读取 ${title}`,
          sources: [{ url: raw, title }],
        };
      } catch (error) {
        if (error instanceof UrlNotAllowedError) {
          return { ok: false, content: error.message, summary: "地址被拒绝" };
        }
        return {
          ok: false,
          content: `读取失败：${error instanceof Error ? error.message : "未知错误"}。`,
          summary: "读取失败",
        };
      }
    },
  };

  return [webSearch, readUrl];
}
