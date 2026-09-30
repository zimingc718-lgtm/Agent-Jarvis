import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitHead, resolveBuildSha } from "../scripts/build-sha.mjs";

/**
 * TEST-620 — the build stamp survives a build context without git (DEC-500 ②;
 * CR-20260930-railway-healthcheck-buildsha). Locally git answers; on Railway the Railpack build has no
 * `.git` and the stamp was empty (EV-2026-09-29-health-logging §4 ③), so `RAILWAY_GIT_COMMIT_SHA` is the
 * fallback; anything that is not a hex sha stays empty rather than inventing a value.
 */
const FULL = "a92128ea46e791431e01a4e0f8824eac4c04460e";

describe("TEST-620 resolveBuildSha", () => {
  it("① git 可用时用 git 的 HEAD，忽略环境变量", () => {
    expect(resolveBuildSha({ RAILWAY_GIT_COMMIT_SHA: FULL }, () => "0af1513e9dbf7ffd8f70e7181d2d852a5d881009")).toBe(
      "0af1513e9dbf7ffd8f70e7181d2d852a5d881009"
    );
  });

  it("② git 取不到时回退到 Railway 注入的 RAILWAY_GIT_COMMIT_SHA（去空白）", () => {
    expect(resolveBuildSha({ RAILWAY_GIT_COMMIT_SHA: ` ${FULL}\n` }, () => "")).toBe(FULL);
  });

  it("③ 两者都没有、或环境变量不是十六进制提交号 → 留空，不编值", () => {
    expect(resolveBuildSha({}, () => "")).toBe("");
    expect(resolveBuildSha({ RAILWAY_GIT_COMMIT_SHA: "not-a-sha" }, () => "")).toBe("");
    expect(resolveBuildSha({ RAILWAY_GIT_COMMIT_SHA: "" }, () => "fatal: not a git repository")).toBe("");
  });

  it("④ 仓库里 git 真的答得出来，且 next.config.mjs 用的是这一份解析器", () => {
    expect(gitHead()).toMatch(/^[0-9a-f]{40}$/);
    const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
    expect(config).toContain('from "./scripts/build-sha.mjs"');
    expect(config).toContain("NEXT_PUBLIC_BUILD_SHA: resolveBuildSha()");
  });
});
