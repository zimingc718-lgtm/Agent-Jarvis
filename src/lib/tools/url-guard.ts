/**
 * Outbound address guard for `read_url` (DEC-025, REQ-NF-009 ③, TASK-069).
 *
 * The URL `read_url` fetches is chosen by the **model**, and the model's context contains
 * attacker-controlled web page text (search results, pages already read). Jarvis runs on
 * the user's own machine holding encrypted provider credentials, so anything reachable on
 * the loopback interface or the LAN is a real target, not a theoretical one.
 *
 * Pure module: no `node:fs`, no network. DNS goes through an injected `resolver` so the
 * adversarial cases — redirect-to-internal, multi-A-record, rebinding — can be built
 * against a local HTTP server in tests. Without that injection the redirect case is
 * untestable (the test server is itself loopback and would be rejected on hop 1).
 */

export type Resolver = (hostname: string) => Promise<string[]>;

export type UrlGuardOptions = {
  resolver: Resolver;
  /**
   * Hostnames exempted from the IP checks. Tests point this at their local server;
   * production passes nothing. It never widens what a redirect may reach — each hop is
   * re-checked with the same options.
   */
  allowHosts?: string[];
};

export class UrlNotAllowedError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`拒绝访问 ${url}：${reason}`);
    this.name = "UrlNotAllowedError";
    this.url = url;
    this.reason = reason;
  }
}

/** Hostnames that mean "this machine" without needing DNS. */
const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

function ipv4ToParts(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return null;
  }
  const parts = match.slice(1, 5).map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

/** RFC 1918 + loopback + link-local + CGNAT + "this network" + cloud metadata. */
function isBlockedIpv4(parts: number[]): string | null {
  const [a, b] = parts;
  if (a === 127) return "loopback 地址";
  if (a === 0) return "0.0.0.0/8 保留地址";
  if (a === 10) return "私有网段 10.0.0.0/8";
  if (a === 172 && b >= 16 && b <= 31) return "私有网段 172.16.0.0/12";
  if (a === 192 && b === 168) return "私有网段 192.168.0.0/16";
  if (a === 169 && b === 254) return "链路本地地址（含云元数据 169.254.169.254）";
  if (a === 100 && b >= 64 && b <= 127) return "CGNAT 网段 100.64.0.0/10";
  if (a >= 224) return "组播或保留地址";
  return null;
}

function isBlockedIpv6(raw: string): string | null {
  const host = raw.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped addresses are IPv4 wearing an IPv6 hat — unwrap before judging.
  // Two spellings must both be handled: the dotted form a user types, and the
  // hex form `URL` normalises it to (`::ffff:127.0.0.1` → `::ffff:7f00:1`).
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (mappedDotted) {
    const parts = ipv4ToParts(mappedDotted[1]);
    return parts ? (isBlockedIpv4(parts) ?? null) : "无法解析的 IPv4-mapped 地址";
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const parts = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
    return isBlockedIpv4(parts) ?? null;
  }
  if (host === "::1" || host === "::") return "IPv6 loopback";
  if (/^fe[89ab]/.test(host)) return "IPv6 链路本地地址 fe80::/10";
  if (/^f[cd]/.test(host)) return "IPv6 唯一本地地址 fc00::/7";
  if (host.startsWith("ff")) return "IPv6 组播地址";
  return null;
}

function looksLikeIpv6(host: string): boolean {
  return host.includes(":");
}

/** Judge one literal address. Exported so tests can enumerate without DNS. */
export function blockedReasonForAddress(address: string): string | null {
  if (looksLikeIpv6(address)) {
    return isBlockedIpv6(address);
  }
  const parts = ipv4ToParts(address);
  if (!parts) {
    return null;
  }
  return isBlockedIpv4(parts);
}

/**
 * Throws `UrlNotAllowedError` unless `raw` is a public http(s) address.
 * Returns the parsed URL so callers do not re-parse.
 */
export async function assertAllowedUrl(raw: string, options: UrlGuardOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlNotAllowedError(raw, "不是合法 URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlNotAllowedError(raw, `仅支持 http/https，收到 ${url.protocol}`);
  }
  // `http://user:pass@host` both leaks credentials outbound and is a classic parser-
  // confusion vector; there is no legitimate use for it here.
  if (url.username || url.password) {
    throw new UrlNotAllowedError(raw, "URL 不得包含用户名或密码");
  }

  const host = url.hostname.toLowerCase();
  if (LOCAL_NAMES.has(host)) {
    throw new UrlNotAllowedError(raw, "指向本机");
  }

  if (options.allowHosts?.includes(host)) {
    return url;
  }

  // A literal address needs no DNS; a name does, and every answer must pass.
  const literal = blockedReasonForAddress(host.replace(/^\[|\]$/g, ""));
  if (literal) {
    throw new UrlNotAllowedError(raw, literal);
  }

  let addresses: string[];
  try {
    addresses = await options.resolver(host);
  } catch (error) {
    throw new UrlNotAllowedError(raw, `域名解析失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
  if (addresses.length === 0) {
    throw new UrlNotAllowedError(raw, "域名没有解析结果");
  }
  // ANY blocked answer rejects the whole host: a name that resolves to one public and
  // one private address is the standard way to smuggle a request onto the LAN.
  for (const address of addresses) {
    const reason = blockedReasonForAddress(address);
    if (reason) {
      throw new UrlNotAllowedError(raw, `解析到${reason}（${address}）`);
    }
  }
  return url;
}

export const MAX_REDIRECTS = 5;

/**
 * Fetch with redirects followed by hand so **every hop** is re-validated (REQ-NF-009 ③).
 * `redirect: "manual"` is what makes that possible — the platform's automatic following
 * would take hop 2 onto the LAN without ever consulting the guard.
 *
 * KNOWN LIMITATION (registered): validation and connection are not atomic, so a DNS
 * rebinding window remains. Closing it needs a custom `lookup` on `node:https`; that is
 * out of scope for this CR and recorded rather than papered over.
 */
export async function fetchWithGuardedRedirects(
  raw: string,
  options: UrlGuardOptions & { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number }
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let target = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertAllowedUrl(target, options);
    const response = await fetcher(url.toString(), {
      redirect: "manual",
      signal,
      headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
    });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    target = new URL(location, url).toString();
  }
  throw new UrlNotAllowedError(raw, `重定向超过 ${MAX_REDIRECTS} 跳`);
}
