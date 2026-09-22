import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * PDF/DOCX → Markdown/HTML via `scripts/documents_to_html.py` (DEC-390, CR-20260921-markitdown-display;
 * the `--markdown` / `--render` modes serve the optional model pass in CR-20260921-format-skill).
 *
 * Why a subprocess and not a library call: `markitdown` (structure extraction) and
 * `markdown` (Markdown→HTML, with table support the app's own chat renderer lacks) are
 * both Python packages; this app's runtime is Node. `python3 <script>` is used — not the
 * bare `markitdown` console script — so this doesn't depend on pip's script-install
 * directory being on PATH; only `python3`/`python` need to resolve, which the deployment's
 * Python provisioning (DEC-391) already guarantees.
 *
 * `execFile` with an argument array, never `exec` with a shell string: `absPath` is
 * server-validated (via `resolveWithinRoots`) before this is called, but shelling out to
 * build a command line from a filesystem path is a needless injection surface regardless.
 */

const PYTHON_CANDIDATES = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
const DEFAULT_TIMEOUT_MS = 30_000;
/** Ceiling on stdout; keeps a corrupted/huge PDF from filling memory. */
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const SCRIPT_PATH = join(process.cwd(), "scripts", "documents_to_html.py");

export type MarkitdownResult = { ok: true; html: string } | { ok: false; reason: string };
export type MarkdownResult = { ok: true; markdown: string } | { ok: false; reason: string };

type RawResult = { ok: true; text: string } | { ok: false; reason: string };

function runOnce(pythonBin: string, args: string[], stdin: string | undefined, timeoutMs: number): Promise<RawResult> {
  return new Promise((resolve) => {
    const child = execFile(
      pythonBin,
      [SCRIPT_PATH, ...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: "buffer" },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            resolve({ ok: false, reason: `notfound:${pythonBin}` });
            return;
          }
          if (error.killed || error.signal === "SIGTERM") {
            resolve({ ok: false, reason: "timeout" });
            return;
          }
          resolve({ ok: false, reason: `exec:${stderr.toString("utf-8").trim().slice(0, 500) || error.message}` });
          return;
        }
        const text = stdout.toString("utf-8").trim();
        if (!text) {
          resolve({ ok: false, reason: "empty" });
          return;
        }
        resolve({ ok: true, text });
      }
    );
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin, "utf-8");
    }
  });
}

/**
 * Tries each Python candidate in order and stops at the first one that isn't simply
 * "not installed" (`ENOENT`) — a real conversion failure (timeout, corrupt file, the
 * Python side erroring) is reported as-is rather than masked by trying the next name.
 */
async function runPython(args: string[], stdin: string | undefined, timeoutMs: number): Promise<RawResult> {
  let lastNotFound: RawResult | null = null;
  for (const bin of PYTHON_CANDIDATES) {
    const result = await runOnce(bin, args, stdin, timeoutMs);
    if (result.ok || !result.reason.startsWith("notfound:")) {
      return result;
    }
    lastNotFound = result;
  }
  return lastNotFound ?? { ok: false, reason: "notfound:python" };
}

/** Structural conversion straight to HTML (the CR-20260921-markitdown-display path). */
export async function convertToHtml(absPath: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MarkitdownResult> {
  const result = await runPython([absPath], undefined, timeoutMs);
  return result.ok ? { ok: true, html: result.text } : result;
}

/** Structural extraction only — the Markdown the model formatting pass works on. */
export async function convertToMarkdown(absPath: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MarkdownResult> {
  const result = await runPython(["--markdown", absPath], undefined, timeoutMs);
  return result.ok ? { ok: true, markdown: result.text } : result;
}

/** Markdown → HTML through the same Python pipeline, so both display paths render identically. */
export async function renderMarkdown(markdown: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MarkitdownResult> {
  const result = await runPython(["--render"], markdown, timeoutMs);
  return result.ok ? { ok: true, html: result.text } : result;
}

/** Human-readable message for the failure reasons above — never leaks stderr verbatim to the client. */
export function describeMarkitdownFailure(reason: string): string {
  if (reason.startsWith("notfound:")) {
    return "转换服务不可用（Python 运行时未就绪）。";
  }
  if (reason === "timeout") {
    return "文档转换超时，文件可能过大或过于复杂。";
  }
  if (reason === "empty") {
    return "转换结果为空——这份文件可能没有可提取的文字层。";
  }
  return "文档转换失败。";
}
