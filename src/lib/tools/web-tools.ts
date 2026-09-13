import { lookup } from "node:dns/promises";
import type { Store } from "../store";
import { extractPdfText, looksLikePdf } from "../pdf-text";
import { BUDGET_SHARES, budgetTokens, truncateToTokens } from "./budget";
import { fetchThroughBrowser, type BrowserLauncher } from "./browser-fetch";
import { TOOL_PRIORITY, type ToolDescriptor, type ToolResult } from "./registry";
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
/** REQ-F-057 ④: the browser fallback can be switched off; absent means on. */
export const SETTING_BROWSER_FALLBACK = "search.browser_fallback";

const MAX_RESULTS = 10;
const READ_URL_MAX_BYTES = 2 * 1024 * 1024;
/** PDFs are routinely larger than a page; this one is measured against real whitepapers. */
const READ_PDF_MAX_BYTES = 24 * 1024 * 1024;
const READ_URL_TIMEOUT_MS = 15_000;
/** Consecutive failures after which the backend is presumed down for this turn. */
const FAILURE_SHORT_CIRCUIT = 2;

export type WebToolDeps = {
  store: Store;
  fetcher?: typeof fetch;
  resolver?: Resolver;
  allowHosts?: string[];
  /** Test seam for the browser channel (REQ-F-057). */
  browserLauncher?: BrowserLauncher;
};

/**
 * Does this response mean "a browser is required" rather than "this page is gone"?
 * (REQ-F-056 ②)
 *
 * The distinction matters because the model cannot see the difference otherwise: faced
 * with a bare「返回 403」it retried the same URL until the repeat-failure breaker stopped
 * it. Cloudflare states it outright in `cf-mitigated`; Akamai does not, so the status
 * plus the server banner is what identifies it.
 */
export function detectBotChallenge(status: number, headers: Headers, body: string): string | null {
  if (headers.get("cf-mitigated") === "challenge") {
    return "Cloudflare 人机校验";
  }
  if (looksLikeChallengePage(body)) {
    return "JavaScript 人机校验";
  }
  const server = (headers.get("server") ?? "").toLowerCase();
  if (status === 403 && (server.includes("cloudflare") || server.includes("akamai"))) {
    return server.includes("akamai") ? "Akamai 机器人防护" : "Cloudflare 机器人防护";
  }
  // A bare 403/429 with no challenge marker is still worth one browser attempt: some
  // sites refuse a non-browser client without announcing why. tsmc.com is the measured
  // case — 403 to fetch, 8,579 characters of real text through the browser.
  if (status === 403 || status === 429) {
    return "站点拒绝了非浏览器请求";
  }
  return null;
}

/**
 * The interstitial itself, in either language. Both are needed: the page is served in the
 * client's locale, and the Chinese wording is what the measured runs actually returned
 * ("正在进行安全验证" / "请稍候…"), so an English-only check reported a challenge page as a
 * successful read.
 */
export function looksLikeChallengePage(body: string): boolean {
  const snippet = body.slice(0, 6000).toLowerCase();
  return (
    snippet.includes("just a moment") ||
    snippet.includes("enable javascript") ||
    snippet.includes("checking your browser") ||
    snippet.includes("verifying you are human") ||
    snippet.includes("正在进行安全验证") ||
    snippet.includes("请稍候") ||
    snippet.includes("需要验证您是真人") ||
    snippet.includes("请开启 javascript")
  );
}

export function browserFallbackEnabled(store: Store): boolean {
  return store.getSetting(SETTING_BROWSER_FALLBACK) !== "false";
}

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
  const flattened = body
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ");

  // Trim per line BEFORE collapsing blank runs (CR-20260912-ingest-extract-chain).
  // `[ \t]+ -> " "` leaves a single space on every structurally-empty element, so those
  // lines are not empty and `\n{3,}` never matched them. A real ingest came back with
  // dozens of " " lines for exactly this reason.
  const lines = flattened.split("\n").map((line) => line.trim());
  return dropLeadingDataBlob(lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Drops a front-matter-like data line that some CMSs render into the body — the Vertiv
 * page opened with its language-switch JSON, which then became the entry's first line,
 * polluted the search index, and made the model report `UrlForCurrentLanguage` as the
 * entry's source (it was not inventing one; it was the only URL-shaped thing it could see).
 *
 * Only a LEADING line is dropped, and only when it parses as a complete JSON object: a
 * JSON snippet quoted inside an article is content, not boilerplate.
 */
function dropLeadingDataBlob(lines: string[]): string[] {
  const first = lines.findIndex((line) => line !== "");
  if (first === -1) {
    return lines;
  }
  const candidate = lines[first];
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) {
    return lines;
  }
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return lines;
    }
  } catch {
    return lines;
  }
  return [...lines.slice(0, first), ...lines.slice(first + 1)];
}

/**
 * The page's title, preferring `og:title` over `<title>`.
 *
 * `<title>` is what a site tunes for search-result width, so it is the one that arrives
 * truncated — a real ingest stored «… reference architecture for the NVIDIA GB300 NVL72
 * platform, available», a sentence cut mid-phrase. Open Graph titles are written for
 * sharing and are normally the complete headline.
 */
export function extractTitle(html: string): string {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? html;
  const og =
    /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(head)?.[1] ??
    /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:title["']/i.exec(head)?.[1];
  const tag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return (og ?? tag ?? "").replace(/\s+/g, " ").trim();
}

export function createWebTools(deps: WebToolDeps): ToolDescriptor[] {
  const fetcher = deps.fetcher ?? fetch;
  const resolver: Resolver =
    deps.resolver ?? (async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  // Per-turn failure counters. Reaching the limit short-circuits `execute` — the
  // descriptor stays registered so the stable prefix does not change (DEC-026 ②).
  const failures = new Map<string, number>();

  /**
   * How many tokens one web result may occupy (DEC-080 ③).
   *
   * This used to read `Math.floor(8_000 * BUDGET_SHARES.singleToolResult * 10)` — an
   * expression shaped like a budget but constant at 12,000, because the 8,000 stood in for
   * the context window and the ×10 cancelled the share back out. It overflowed an 8k local
   * model on a single page and left two thirds of a 128k window unused. Now it is the
   * declared share of the window actually in play.
   */
  const searchResultCap = (window: number): number => budgetTokens(window, BUDGET_SHARES.singleToolResult);

  const webSearch: ToolDescriptor = {
    name: "web_search",
    priority: TOOL_PRIORITY.normal,
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
        const { text } = truncateToTokens(rendered, searchResultCap(context.contextWindow));
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

  /** Shape an HTML string into the tool result (REQ-F-034 ①: only the extract travels). */
  const renderHtml = (html: string, url: string, via: string, window: number): ToolResult => {
    const title = extractTitle(html) || url;
    const { text } = truncateToTokens(extractReadableText(html), searchResultCap(window));
    if (!text) {
      return {
        ok: false,
        content: `页面 ${url} 没有可提取的正文（可能整页由脚本渲染或只有图片）。`,
        summary: "无正文可读",
      };
    }
    return {
      ok: true,
      content: `标题：${title}\n来源：${url}${via}\n\n${text}`,
      summary: `读取 ${title}`,
      sources: [{ url, title }],
    };
  };

  /** REQ-F-055: a PDF is text, not markup — and never silently garbage. */
  const renderPdf = (bytes: Uint8Array, url: string, window: number): ToolResult => {
    const extraction = extractPdfText(bytes);
    if (extraction.encrypted) {
      return {
        ok: false,
        content: `${url} 是加密 PDF，无法提取文字。请下载后另存为未加密副本，或改用其它来源。`,
        summary: "PDF 已加密",
      };
    }
    if (!extraction.text) {
      return {
        ok: false,
        content: `${url} 是 PDF，但提取不到文字——通常是扫描件（整页为图片），本工具不做 OCR。请改用其它来源，或把关键内容直接贴给我。`,
        summary: "PDF 无文字层（疑似扫描件）",
      };
    }
    const { text, truncated } = truncateToTokens(extraction.text, searchResultCap(window));
    const note = truncated ? "（PDF 正文较长，已按预算截断）" : "";
    return {
      ok: true,
      content: `标题：${url.split("/").pop() ?? url}\n来源：${url}（PDF，${extraction.streams} 个内容流）${note}\n\n${text}`,
      summary: `读取 PDF ${extraction.text.length} 字`,
      sources: [{ url, title: url.split("/").pop() ?? url }],
    };
  };

  const readUrl: ToolDescriptor = {
    name: "read_url",
    priority: TOOL_PRIORITY.normal,
    description: "读取一个网页或 PDF 的正文。参数 url 必须是 http/https 公网地址；遇到人机校验会自动改用浏览器重试。",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "网页或 PDF 地址" } },
      required: ["url"],
    },
    available: (context) => context.webEnabled,
    async execute(args, context): Promise<ToolResult> {
      const raw = typeof args.url === "string" ? args.url.trim() : "";
      if (!raw) {
        return { ok: false, content: "缺少参数 url。", summary: "参数缺失" };
      }

      /** REQ-F-057 ②: the browser path, used only once the plain one is refused. */
      const viaBrowser = async (reason: string): Promise<ToolResult> => {
        if (!browserFallbackEnabled(deps.store)) {
          return {
            ok: false,
            content: `${raw} 被${reason}拦截，浏览器回退已关闭。可在「搜索设置」中开启，或换一个来源。`,
            summary: `被拦截：${reason}`,
          };
        }
        try {
          const result = await fetchThroughBrowser(raw, {
            resolver,
            allowHosts: deps.allowHosts,
            signal: context.signal,
            launcher: deps.browserLauncher,
          });
          // Measured limit, stated plainly rather than papered over: Cloudflare- and
          // Akamai-class JavaScript challenges are NOT solved by driving Chromium. Both
          // headless and headed runs sat on 「请稍候…」 for 25s and stayed 403
          // (EV-2026-09-11-web-reading §2). Returning that interstitial as a successful
          // read is the one outcome that must never happen — the model would then
          // "summarise" a security notice as if it were the source.
          if (looksLikeChallengePage(result.html)) {
            return {
              ok: false,
              content: `${raw} 的${reason}用浏览器也没有通过——该站点的校验能识别自动化浏览器。请改用其它来源，或把正文直接贴给我 / 存成文件拖进知识库。不要重复请求这个地址。`,
              summary: `人机校验未通过：${reason}`,
            };
          }
          return renderHtml(result.html, result.finalUrl, `（经浏览器读取，已通过${reason}）`, context.contextWindow);
        } catch (error) {
          if (error instanceof UrlNotAllowedError) {
            return { ok: false, content: error.message, summary: "地址被拒绝" };
          }
          return {
            ok: false,
            content: `${raw} 被${reason}拦截，浏览器回退也失败：${error instanceof Error ? error.message : "未知错误"}。请改用其它来源。`,
            summary: `被拦截：${reason}`,
          };
        }
      };

      try {
        const response = await fetchWithGuardedRedirects(raw, {
          resolver,
          allowHosts: deps.allowHosts,
          fetcher,
          signal: context.signal,
          timeoutMs: READ_URL_TIMEOUT_MS,
        });

        if (!response.ok) {
          // Read a little of the body: telling a challenge from a genuine 403 is what
          // stops the model retrying the same address (REQ-F-056 ②).
          const body = await response.text().catch(() => "");
          const challenge = detectBotChallenge(response.status, response.headers, body);
          if (challenge) {
            return viaBrowser(challenge);
          }
          return {
            ok: false,
            content: `读取失败，服务器返回 ${response.status}。这是站点本身的拒绝，不是人机校验；换一个来源即可，重复请求同一地址不会成功。`,
            summary: `读取失败 ${response.status}`,
          };
        }

        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
        const isPdf = contentType.includes("application/pdf") || looksLikePdf(bytes);

        if (isPdf) {
          if (bytes.byteLength > READ_PDF_MAX_BYTES) {
            return { ok: false, content: `PDF 超过 ${READ_PDF_MAX_BYTES / 1024 / 1024} MiB 上限，未读取。`, summary: "PDF 过大" };
          }
          return renderPdf(bytes, raw, context.contextWindow);
        }

        if (buffer.byteLength > READ_URL_MAX_BYTES) {
          return { ok: false, content: "页面超过 2 MiB 上限，未读取。", summary: "页面过大" };
        }
        return renderHtml(new TextDecoder().decode(buffer), raw, "", context.contextWindow);
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
