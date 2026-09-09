import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-config.mjs");
const VARS = ["NEXTAUTH_URL", "NEXTAUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "JARVIS_SECRET_KEY", "JARVIS_DB_PATH"];

type Report = {
  envFilePresent: boolean;
  loaderError: string | null;
  ok: boolean;
  missing: string[];
  shadowedByEnvironment: string[];
};

/**
 * Runs the preflight with `dir` as cwd. The script resolves @next/env from its
 * own location, so the sandbox needs nothing but a .env.local.
 * `extraEnv` values of `undefined` are removed from the child environment.
 */
function runIn(dir: string, extraEnv: Record<string, string | undefined> = {}): { code: number; report: Report } {
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !VARS.includes(k)) env[k] = v;
  }
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v !== undefined) env[k] = v;
  }

  try {
    const out = execFileSync(process.execPath, [SCRIPT, "--json"], { cwd: dir, encoding: "utf8", env });
    return { code: 0, report: JSON.parse(out) as Report };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    return { code: err.status ?? 1, report: JSON.parse(err.stdout ?? "{}") as Report };
  }
}

const complete = [
  "NEXTAUTH_URL=http://localhost:3000",
  "NEXTAUTH_SECRET=s",
  "GOOGLE_CLIENT_ID=id",
  "GOOGLE_CLIENT_SECRET=cs",
  "JARVIS_SECRET_KEY=key",
].join("\n");

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-jarvis-config-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("scripts/check-config.mjs", () => {
  it("reports every required variable as missing when .env.local is absent", () => {
    const { code, report } = runIn(dir);
    expect(code).toBe(1);
    expect(report.envFilePresent).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual([
      "NEXTAUTH_URL",
      "NEXTAUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "JARVIS_SECRET_KEY",
    ]);
  });

  it("reads .env.local and passes when complete — a leading BOM does not hide the first key", () => {
    writeFileSync(join(dir, ".env.local"), `﻿${complete}\n`, "utf8");
    const { code, report } = runIn(dir);
    expect(report.loaderError).toBeNull();
    expect(report.missing).toEqual([]);
    expect(report.ok).toBe(true);
    expect(code).toBe(0);
  });

  it("still flags the encryption key when only the OAuth values are filled in", () => {
    writeFileSync(
      join(dir, ".env.local"),
      "NEXTAUTH_URL=http://localhost:3000\nNEXTAUTH_SECRET=s\nGOOGLE_CLIENT_ID=id\nGOOGLE_CLIENT_SECRET=cs\n",
      "utf8"
    );
    const { code, report } = runIn(dir);
    expect(code).toBe(1);
    expect(report.missing).toEqual(["JARVIS_SECRET_KEY"]);
  });

  it("treats `missing-` placeholders as unset", () => {
    writeFileSync(join(dir, ".env.local"), complete.replace("GOOGLE_CLIENT_ID=id", "GOOGLE_CLIENT_ID=missing-id"), "utf8");
    const { report } = runIn(dir);
    expect(report.missing).toEqual(["GOOGLE_CLIENT_ID"]);
  });

  it("distinguishes an exported-but-empty shell variable from a missing one", () => {
    writeFileSync(join(dir, ".env.local"), `${complete}\n`, "utf8");
    // dotenv will not override this, so the file value never takes effect.
    const { code, report } = runIn(dir, { GOOGLE_CLIENT_ID: "" });
    expect(code).toBe(1);
    expect(report.missing).toEqual(["GOOGLE_CLIENT_ID"]);
    expect(report.shadowedByEnvironment).toEqual(["GOOGLE_CLIENT_ID"]);
  });

  it("does not report shadowing when the variable is simply absent everywhere", () => {
    writeFileSync(join(dir, ".env.local"), "NEXTAUTH_URL=http://localhost:3000\n", "utf8");
    const { report } = runIn(dir);
    expect(report.shadowedByEnvironment).toEqual([]);
  });
});
