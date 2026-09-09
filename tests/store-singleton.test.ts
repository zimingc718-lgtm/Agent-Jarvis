import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("store singleton", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not open SQLite during module import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-singleton-"));
    dirs.push(dir);
    const dbPath = join(dir, "lazy.sqlite");
    process.env.JARVIS_DB_PATH = dbPath;

    await import("@/lib/store-singleton");

    expect(existsSync(dbPath)).toBe(false);
  });
});
