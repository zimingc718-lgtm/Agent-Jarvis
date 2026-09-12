import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Keep the local production server up (REQ-F-120 ③, TASK-180 ②).
 *
 * `npm run start:local` starts `next start` and that is the end of its involvement. On a
 * machine running at ~90% memory, Windows picks background processes to stop — and this is
 * one. When it happens the server simply stays dead, and the only thing the user sees is a
 * failed send with no explanation (EV-2026-09-12-runtime-visibility §2).
 *
 * This is a supervisor, not a daemon: it stays in the foreground so Ctrl+C still stops
 * everything, and it writes one line per event so a later "it broke at some point" has
 * something to check.
 *
 * Deliberately not a restart-forever loop. A server that cannot start — a bad build, a port
 * already taken — would otherwise spin invisibly. Rapid repeated exits stop the supervisor
 * and say why.
 */

const DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-prod";
const LOG_PATH = join(".data", "server-events.log");
// The restart/give-up judgement lives in `src/lib/supervisor-policy.ts` so it can be unit
// tested; these mirror its constants for the log lines only.
const RAPID_EXIT_MS = 20_000;
const MAX_RAPID_EXITS = 3;
const BACKOFF_MS = [1_000, 3_000, 10_000];

function decideAfterExit({ uptimeMs, rapidExits, restarts }) {
  const rapid = uptimeMs < RAPID_EXIT_MS;
  const next = rapid ? rapidExits + 1 : 0;
  if (next >= MAX_RAPID_EXITS) {
    return {
      action: "give-up",
      reason:
        `连续 ${MAX_RAPID_EXITS} 次在 ${RAPID_EXIT_MS / 1000}s 内退出。` +
        `这不像被系统停掉，更像起不来——构建缺失、端口被占或配置有误。不再重启，请看上面的输出。`,
    };
  }
  return { action: "restart", waitMs: BACKOFF_MS[Math.min(restarts, BACKOFF_MS.length - 1)], rapidExits: next };
}

mkdirSync(".data", { recursive: true });

function record(event, detail) {
  const line = `${new Date().toISOString()} ${event}${detail ? " " + detail : ""}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(LOG_PATH, line, "utf8");
  } catch {
    /* the log is a convenience; never let it stop the server */
  }
}

let rapidExits = 0;
let restarts = 0;
let stopping = false;
let child = null;

function start() {
  const startedAt = Date.now();
  child = spawn("npx", ["next", "start"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NEXT_DIST_DIR: DIST_DIR },
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) {
      return;
    }
    const alive = Date.now() - startedAt;
    const how = signal ? `signal=${signal}` : `code=${code}`;
    record("server-exited", `${how} uptime=${Math.round(alive / 1000)}s`);

    const decision = decideAfterExit({ uptimeMs: alive, rapidExits, restarts });
    if (decision.action === "give-up") {
      record("supervisor-giving-up", decision.reason);
      process.exit(1);
    }
    rapidExits = decision.rapidExits;
    restarts += 1;
    record("restarting", `第 ${restarts} 次，${decision.waitMs}ms 后`);
    setTimeout(start, decision.waitMs);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    record("supervisor-stopping", signal);
    child?.kill();
    process.exit(0);
  });
}

record("supervisor-started", `dist=${DIST_DIR} log=${LOG_PATH}`);
start();
