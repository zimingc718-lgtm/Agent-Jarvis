import { assertAllowedUrl, UrlNotAllowedError, type UrlGuardOptions } from "./url-guard";

/**
 * Reading a page with a real browser engine (REQ-F-057, DEC-033 ③; TASK-095).
 *
 * Measured reason this exists: opencompute.org, iea.org (Cloudflare `cf-mitigated:
 * challenge`) and tesla.com (Akamai) answer 403 to plain `fetch`, and answer it
 * identically with full browser headers — the body is "Just a moment / Enable
 * JavaScript". The gate is a JavaScript challenge, so nothing a header can say gets past
 * it (EV-2026-09-11-web-reading §2). This is not fingerprint spoofing: the challenge is
 * executed the way any browser executes it, in the user's own Chromium, on a page the
 * user asked for.
 *
 * SECURITY: the browser resolves DNS itself, so DEC-025's guard has to be re-applied
 * inside it. Every request the page makes is intercepted and aborted unless it passes the
 * same `assertAllowedUrl` used by `read_url` — otherwise a model-chosen URL could reach
 * the LAN through a redirect or a subresource, which is the whole threat DEC-025 exists
 * for. This is a tighter net than the plain path: subresources are checked too.
 */

/** Kept deliberately small: one engine, one context, headless. */
export type BrowserFetchOptions = UrlGuardOptions & {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Test seam: a stub launcher, so the tool logic is testable without a browser. */
  launcher?: BrowserLauncher;
};

export type BrowserFetchResult = {
  status: number;
  /** Serialised DOM after scripts ran — the point of using a browser at all. */
  html: string;
  /** The URL finally shown, after any redirect or challenge hop. */
  finalUrl: string;
};

/** The slice of Playwright this module uses, named so a test can supply its own. */
export type BrowserLauncher = (input: {
  url: string;
  timeoutMs: number;
  guard: (candidate: string) => Promise<boolean>;
  userAgent: string;
}) => Promise<BrowserFetchResult>;

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const DEFAULT_TIMEOUT_MS = 30_000;
/** How long to let an interstitial clear itself before giving up on it. */
const CHALLENGE_WAIT_MS = 8_000;

/** Cheap markup-level check used only to decide whether to keep waiting. */
function isChallengeMarkup(html: string): boolean {
  const snippet = html.slice(0, 6000).toLowerCase();
  return (
    snippet.includes("just a moment") ||
    snippet.includes("正在进行安全验证") ||
    snippet.includes("请稍候") ||
    snippet.includes("checking your browser") ||
    snippet.includes("verifying you are human")
  );
}

/**
 * The real launcher. `playwright-core` is imported lazily so that nothing but an actual
 * browser read pays for loading it — the module graph of a normal chat turn stays as it
 * was, and a machine with no browser binary only fails when this path is taken.
 */
const playwrightLauncher: BrowserLauncher = async ({ url, timeoutMs, guard, userAgent }) => {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent,
      locale: "zh-CN",
      viewport: { width: 1366, height: 900 },
    });
    // DEC-025 re-applied inside the engine: the page may not reach anything the guard
    // would refuse, including subresources it requests on its own.
    await context.route("**/*", async (route) => {
      const candidate = route.request().url();
      if (await guard(candidate)) {
        await route.continue();
      } else {
        await route.abort();
      }
    });

    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10_000) }).catch(() => {});

    // A challenge that is going to clear does so within a few seconds, and the page then
    // replaces itself. Poll for that, but keep the budget short: the measured
    // Cloudflare case never clears, and waiting 25s to fail is 25s of the user's turn.
    const deadline = Date.now() + Math.min(timeoutMs, CHALLENGE_WAIT_MS);
    let html = await page.content();
    while (isChallengeMarkup(html) && Date.now() < deadline) {
      await page.waitForTimeout(1_000);
      html = await page.content();
    }

    const finalUrl = page.url();
    const status = response?.status() ?? 0;
    return { status, html, finalUrl };
  } finally {
    await browser.close().catch(() => {});
  }
};

/**
 * Fetch `raw` through a real browser. Throws `UrlNotAllowedError` when the address is
 * refused, and a plain `Error` when the engine itself is unavailable or times out.
 */
export async function fetchThroughBrowser(raw: string, options: BrowserFetchOptions): Promise<BrowserFetchResult> {
  // Check before launching anything: a refused address should never start a browser.
  await assertAllowedUrl(raw, options);

  const launcher = options.launcher ?? playwrightLauncher;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const guard = async (candidate: string): Promise<boolean> => {
    try {
      await assertAllowedUrl(candidate, options);
      return true;
    } catch {
      return false;
    }
  };

  if (options.signal?.aborted) {
    throw new Error("aborted");
  }
  return launcher({ url: raw, timeoutMs, guard, userAgent: BROWSER_USER_AGENT });
}

export { UrlNotAllowedError };
