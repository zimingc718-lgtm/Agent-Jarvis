import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentVersion, migrateDown, migrateUp, registeredMigrations } from "@/lib/migrations";

/**
 * TEST-061 — the migration framework (DEC-023, TASK-059).
 *
 * The point of this suite is the reverse direction. Six one-way schema change points in
 * this CR promise a rollback, and before TASK-059 the repo had no `down` anywhere for
 * that promise to rest on.
 */

function baseSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name)
    .sort();
}

function schemaSnapshot(db: DatabaseSync): string {
  return JSON.stringify({
    providers: columns(db, "providers"),
    messages: columns(db, "messages"),
    conversations: columns(db, "conversations"),
  });
}

describe("migration framework (DEC-023)", () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-mig-"));
    process.env.JARVIS_ROLLBACK_DIR = dir;
    db = new DatabaseSync(join(dir, "test.sqlite"));
    baseSchema(db);
  });

  afterEach(() => {
    db.close();
    delete process.env.JARVIS_ROLLBACK_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("① up 到最新后 user_version 正确", () => {
    const latest = registeredMigrations().at(-1)!.version;
    expect(migrateUp(db)).toBe(latest);
    expect(currentVersion(db)).toBe(latest);
  });

  it("③ 每条迁移都同时提供 up 与 down", () => {
    for (const migration of registeredMigrations()) {
      expect(typeof migration.up, `${migration.name}.up`).toBe("function");
      expect(typeof migration.down, `${migration.name}.down`).toBe("function");
    }
  });

  it("② up → down → up 零 diff（schema 与数据）", () => {
    migrateUp(db);
    db.prepare("INSERT INTO providers (id, user_id, name) VALUES (?, ?, ?)").run("p1", "u1", "Local");
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("m1", "c1", "user", "hi", "complete", "2026-09-10T00:00:00.000Z");

    const afterFirstUp = schemaSnapshot(db);

    migrateDown(db, 0);
    expect(currentVersion(db)).toBe(0);

    migrateUp(db);
    expect(schemaSnapshot(db)).toBe(afterFirstUp);
    // Rows that predate the added columns survive the round trip untouched.
    expect(db.prepare("SELECT id, name FROM providers").all()).toEqual([{ id: "p1", name: "Local" }]);
    expect((db.prepare("SELECT content FROM messages WHERE id = 'm1'").get() as { content: string }).content).toBe("hi");
  });

  it("④ down 之前把将被删除的列导出到 rollback 文件", () => {
    migrateUp(db);
    db.prepare("INSERT INTO providers (id, user_id, name) VALUES (?, ?, ?)").run("p1", "u1", "Local");
    db.prepare("UPDATE providers SET tool_support = ? WHERE id = ?").run('{"m":"yes"}', "p1");

    const { dumpPath } = migrateDown(db, 0);
    expect(dumpPath).toBeTruthy();
    const dumped = readFileSync(dumpPath!, "utf8");
    expect(dumped).toContain("tool_support");
    expect(dumped).toContain('{\\"m\\":\\"yes\\"}');
  });

  it("⑤ version 1 仍按创建顺序回填 priority（既有行为不变）", () => {
    db.prepare("INSERT INTO providers (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "a",
      "u1",
      "A",
      "2026-01-01T00:00:00.000Z"
    );
    db.prepare("INSERT INTO providers (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "b",
      "u1",
      "B",
      "2026-01-02T00:00:00.000Z"
    );

    migrateUp(db, 1);
    const rows = db.prepare("SELECT id, priority FROM providers ORDER BY priority ASC").all();
    expect(rows).toEqual([
      { id: "a", priority: 0 },
      { id: "b", priority: 1 },
    ]);
  });
});
