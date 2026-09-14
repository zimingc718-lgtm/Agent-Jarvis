/**
 * Is the running dev server actually serving the current build configuration?
 *
 * Next reads `postcss.config.*` once, at startup. A server started before that
 * file existed keeps an empty PostCSS pipeline for its whole life: it happily
 * hot-reloads new components and new CSS, but `@import "tailwindcss"` is never
 * processed, so every utility class resolves to nothing. On 2026-09-10 that put
 * a server from the previous evening in front of a freshly migrated UI — every
 * element fell out of its layout into the top-left corner, and nothing in the
 * test suite could see it, because the suite reads files from disk while the
 * browser reads bytes from the server.
 *
 * So this checks the bytes the server actually returns (原则 12, real entry).
 *
 * Exit codes — a skip must never look like a pass (TEST-058 ③):
 *   0  PASS  the served CSS carries compiled utilities AND the served build is current
 *   1  FAIL  it does not — the server predates the build config, restart it
 *   2  SKIP  nothing is listening; stated explicitly, not silently green
 *
 * Usage:
 *   node scripts/check-dev-server.mjs [--url http://127.0.0.1:3000]
 *   node scripts/check-dev-server.mjs --css-file <path>   # analyse a file instead
 */

/** Markers that only exist once Tailwind has compiled: a utility, and a token. */
const REQUIRED = [
  { name: "position utility", re: /\.fixed\s*\{[^}]*position:\s*fixed/ },
  { name: "centring utility", re: /\.mx-auto\s*\{/ },
  { name: "semantic token", re: /--background:/ },
];

/** Raw Tailwind source that survives when the PostCSS plugin never ran. */
const UNPROCESSED = /@tailwind\b|@import\s+["']tailwindcss["']/;

export function analyseCss(css) {
  const missing = REQUIRED.filter((marker) => !marker.re.test(css)).map((m) => m.name);
  const unprocessed = UNPROCESSED.test(css);
  return { ok: missing.length === 0, missing, unprocessed, bytes: css.length };
}

/**
 * 服务器供的提交与磁盘上的 HEAD 是否一致（DEC-210 ①）。
 *
 * 样式检查守的是「构建配置没生效」；这一条守的是「构建本身是旧的」。后者在 2026-09-13
 * 真的发生过：编译 worker 崩掉后服务器继续供旧构建，样式一切正常，只是新写的东西一个
 * 都不在——而当时没有任何一处检查会说话。
 */
export function analyseBuild(html, headSha) {
  const served = /<meta[^>]+name="jarvis-build"[^>]+content="([^"]*)"/.exec(html)?.[1]
    ?? /<meta[^>]+content="([^"]*)"[^>]+name="jarvis-build"/.exec(html)?.[1]
    ?? null;
  if (served === null) return { state: "absent" };
  if (!served) return { state: "unknown" };
  if (!headSha) return { state: "no-head", served };
  return { state: served === headSha ? "current" : "stale", served, head: headSha };
}

export function describeBuild(result) {
  switch (result.state) {
    case "current":
      return `PASS served build matches HEAD (${result.served.slice(0, 8)})`;
    case "stale":
      return (
        `FAIL the server is serving an older build: it was built from ${result.served.slice(0, 8)}, ` +
        `HEAD is ${result.head.slice(0, 8)}.\n` +
        "  Everything you are looking at in the browser predates your recent commits.\n" +
        "  Production mode has no hot reload: stop the process, `npm run build:local`, then `npm run serve:local`.\n" +
        "  In dev mode, stopping the process and `npm run dev` is enough."
      );
    case "absent":
      return "FAIL the page carries no jarvis-build meta — this server predates the build stamp itself; restart it.";
    case "unknown":
      return "SKIP the build stamp is empty (no git available where the server started); nothing to compare.";
    default:
      return "SKIP cannot read HEAD here; nothing to compare the served build against.";
  }
}

export function describe(result) {
  if (result.ok) {
    return `PASS served CSS carries compiled Tailwind output (${result.bytes} bytes)`;
  }
  const why = result.unprocessed
    ? "the stylesheet still contains raw Tailwind directives, so the PostCSS plugin never ran"
    : "no compiled utility classes are present";
  return (
    `FAIL ${why}; missing: ${result.missing.join(", ")}.\n` +
    "  The dev server was almost certainly started before postcss.config.* existed — " +
    "Next reads that config once, at startup.\n" +
    "  Restart it: stop the process, `npm run clean`, then `npm run dev`."
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };

  const cssFile = at("--css-file");
  if (cssFile) {
    const { readFileSync } = await import("node:fs");
    const result = analyseCss(readFileSync(cssFile, "utf8"));
    console.log(describe(result));
    return result.ok ? 0 : 1;
  }

  const url = at("--url") ?? "http://127.0.0.1:3000";
  let html;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      console.log(`SKIP ${url} answered HTTP ${response.status}; nothing to check.`);
      return 2;
    }
    html = await response.text();
  } catch (error) {
    const why = error.cause?.code ?? error.code ?? error.name;
    console.log(
      `SKIP no dev server reachable at ${url} (${why}). ` +
        "This is a real-entry check: with no server there is nothing to measure, " +
        "so it reports SKIP rather than passing."
    );
    return 2;
  }

  const hrefs = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]);
  if (hrefs.length === 0) {
    console.log(`FAIL ${url} references no stylesheet at all.`);
    return 1;
  }

  let combined = "";
  for (const href of hrefs) {
    const cssUrl = href.startsWith("http") ? href : new URL(href, url).toString();
    const response = await fetch(cssUrl, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) combined += await response.text();
  }

  const result = analyseCss(combined);
  console.log(`${describe(result)}\n  source: ${url} (${hrefs.length} stylesheet(s))`);

  // 版本戳（DEC-210 ①）。样式对了不代表构建是新的——这两件事分开报。
  let head = "";
  try {
    const { execSync } = await import("node:child_process");
    head = execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    head = "";
  }
  const build = analyseBuild(html, head);
  console.log(`  ${describeBuild(build)}`);

  if (!result.ok) return 1;
  if (build.state === "stale" || build.state === "absent") return 1;
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-dev-server.mjs")) {
  // Set the code and let the loop drain. `process.exit()` here tears down undici's
  // still-open keep-alive sockets mid-flight, which trips a libuv assertion on
  // Windows (`!(handle->flags & UV_HANDLE_CLOSING)`) and reports 127 after a PASS.
  process.exitCode = await main();
}
