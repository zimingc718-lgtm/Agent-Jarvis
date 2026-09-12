/**
 * When to restart the local server and when to stop trying (REQ-F-120 ③, TASK-180 ③).
 *
 * Pure on purpose: the supervisor itself spawns processes and cannot be unit tested, but the
 * one judgement it makes — "was this killed, or can it not start?" — is exactly the part
 * worth locking down. A supervisor that restarts forever turns a bad build into an invisible
 * spin; one that gives up too easily leaves the user with a dead server and no server.
 */

/** Exits sooner than this look like "cannot start" rather than "was running and got killed". */
export const RAPID_EXIT_MS = 20_000;
/** Consecutive rapid exits tolerated before the supervisor stops. */
export const MAX_RAPID_EXITS = 3;
/** Backoff between restarts, in order; the last value repeats. */
export const BACKOFF_MS = [1_000, 3_000, 10_000];

export type ExitDecision =
  | { action: "restart"; waitMs: number; rapidExits: number }
  | { action: "give-up"; reason: string };

export function backoffFor(restarts: number): number {
  return BACKOFF_MS[Math.min(Math.max(restarts, 0), BACKOFF_MS.length - 1)]!;
}

export function decideAfterExit(input: {
  uptimeMs: number;
  /** Consecutive rapid exits so far, not counting this one. */
  rapidExits: number;
  /** Restarts already performed, used only to pick the backoff. */
  restarts: number;
}): ExitDecision {
  const rapid = input.uptimeMs < RAPID_EXIT_MS;
  // A process that ran for a while and then died was stopped from outside — the memory
  // pressure case this exists for. That resets the counter, so an evening of occasional
  // kills never accumulates into a refusal to restart.
  const rapidExits = rapid ? input.rapidExits + 1 : 0;

  if (rapidExits >= MAX_RAPID_EXITS) {
    return {
      action: "give-up",
      reason:
        `连续 ${MAX_RAPID_EXITS} 次在 ${RAPID_EXIT_MS / 1000}s 内退出。` +
        `这不像被系统停掉，更像起不来——构建缺失、端口被占或配置有误。不再重启，请看上面的输出。`,
    };
  }
  return { action: "restart", waitMs: backoffFor(input.restarts), rapidExits };
}
