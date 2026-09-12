/**
 * Turning a failed send into something a person can act on (REQ-F-120 ①②, TASK-180 ①).
 *
 * What the user actually saw was the browser's own words, passed through verbatim:
 *
 *     Failed to fetch
 *
 * That string says only "the request never completed". It cannot distinguish the local
 * server having gone away from a transfer that broke mid-flight, and it carries no time,
 * so afterwards there is nothing to correlate against — which is exactly why one report of
 * it took an hour of elimination to place (EV-2026-09-12-runtime-visibility §1).
 *
 * So: ask. One cheap request to an endpoint that is always there answers the only question
 * that changes what the user should do next — is the server still running?
 */

/** Endpoint used only to decide whether the server is answering at all. */
export const HEALTH_PATH = "/api/display";
export const HEALTH_TIMEOUT_MS = 3_000;

export type SendFailureKind = "server-gone" | "transfer-broken" | "reported";

export type SendFailure = { kind: SendFailureKind; message: string };

function stamp(now: Date): string {
  return now.toTimeString().slice(0, 8);
}

/**
 * A network-layer failure, as opposed to an HTTP error the server actually answered with.
 * `TypeError` is what both Chrome ("Failed to fetch") and Firefox ("NetworkError when
 * attempting to fetch resource") raise; the name check keeps it from swallowing anything else.
 */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

export async function describeSendFailure(
  error: unknown,
  deps: { probe?: () => Promise<boolean>; now?: () => Date } = {}
): Promise<SendFailure> {
  const now = (deps.now ?? (() => new Date()))();
  const at = stamp(now);

  if (!isNetworkFailure(error)) {
    // The server answered with something. Its own words are better than ours.
    return { kind: "reported", message: error instanceof Error ? error.message : "对话请求失败。" };
  }

  const probe = deps.probe ?? defaultProbe;
  const alive = await probe().catch(() => false);

  if (!alive) {
    return {
      kind: "server-gone",
      message:
        `${at} 与本机服务的连接中断，且服务当前没有响应。` +
        `常见原因是它被重启，或在内存紧张时被系统停掉。请重新启动服务后重试——这一轮没有任何内容被保存。`,
    };
  }
  return {
    kind: "transfer-broken",
    message: `${at} 请求在传输中断开，但服务仍在运行，可以直接重试。这一轮没有任何内容被保存。`,
  };
}

async function defaultProbe(): Promise<boolean> {
  const response = await fetch(HEALTH_PATH, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  return response.ok;
}
