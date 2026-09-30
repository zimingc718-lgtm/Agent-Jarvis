import { execSync } from "node:child_process";

/**
 * Which commit this build was made from (DEC-210 ①, DEC-500 ②; CR-20260930-railway-healthcheck-buildsha).
 *
 * A local build has a git checkout, so git answers. Railway's Railpack build context has no `.git`
 * — the 2026-09-30 deployment stamped `build: ""` — but Railway injects `RAILWAY_GIT_COMMIT_SHA`
 * at build time, so that is the fallback. Anything else stays empty on purpose: `/api/health` and
 * the page's `jarvis-build` meta show this value, and a wrong stamp is worse than none.
 */
const SHA = /^[0-9a-f]{7,40}$/i;

export function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function resolveBuildSha(env = process.env, head = gitHead) {
  const fromGit = head();
  if (SHA.test(fromGit)) {
    return fromGit;
  }
  const fromRailway = (env.RAILWAY_GIT_COMMIT_SHA ?? "").trim();
  if (SHA.test(fromRailway)) {
    return fromRailway;
  }
  return "";
}
