import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TEST-600 — the CI gate is wired the way DEC-480 says (CR-20260928-ci-gate): one workflow,
 * runs on pushes to main and CR branches and on pull requests, on Node 24 with Python, and its
 * steps are the developer's `verify:all` minus the live-server smoke — type check, the whole
 * vitest suite, governance unit tests, governance stage `ci`, UI-contract static rules, and a
 * production build. A change that quietly drops a step fails here before it reaches GitHub.
 */
const ROOT = join(__dirname, "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "ci.yml");

describe("TEST-600 CI workflow", () => {
  const text = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, "utf8") : "";

  it("① 工作流文件存在，在 main / cr/** 推送与 PR 上触发，可手动触发", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
    expect(text).toMatch(/^on:\n/m);
    expect(text).toMatch(/branches: \["main", "cr\/\*\*"\]/);
    expect(text).toMatch(/^\s+pull_request:/m);
    expect(text).toMatch(/^\s+workflow_dispatch:/m);
  });

  it("② Node 24 + Python 3.13，安装 npm 与 pip 依赖", () => {
    expect(text).toMatch(/node-version: "24"/);
    expect(text).toMatch(/python-version: "3\.13"/);
    expect(text).toMatch(/npm ci/);
    expect(text).toMatch(/pip install -r requirements\.txt/);
  });

  it("③ 步骤 = verify:all 减 smoke：类型、全量 vitest、治理单测、治理 ci 阶段、UI 契约、生产构建，顺序固定", () => {
    const steps = ["npm run test:typecheck", "npm test", "npm run test:governance", "npm run governance:ci", "npm run test:ui-contract", "npm run build:verify"];
    let cursor = 0;
    for (const step of steps) {
      const at = text.indexOf(`run: ${step}`, cursor);
      expect(at, `missing or out of order: ${step}`).toBeGreaterThan(-1);
      cursor = at;
    }
    expect(text).not.toMatch(/test:smoke/);
  });

  it("④ package.json 有 governance:ci，且它调用的是 check ci", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["governance:ci"]).toBe("python tools/governance.py check ci");
    for (const step of ["test:typecheck", "test:governance", "test:ui-contract", "build:verify"]) {
      expect(pkg.scripts[step], step).toBeTruthy();
    }
  });
});
