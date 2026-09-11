import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Schema migration framework (DEC-023, TASK-059).
 *
 * Before this CR the repo grew columns with inline `PRAGMA table_info` + `ALTER`
 * checks and had **no `down` anywhere** — which is exactly why CR-20260910-agent-tooling
 * could not honour the rollback it promised for six one-way schema change points.
 * Every migration here must supply both directions; `registerMigrations` throws if one
 * is missing rather than letting an irreversible migration reach the database.
 */
export type Migration = {
  version: number;
  name: string;
  up(db: DatabaseSync): void;
  /** Required. A migration without a reverse is not accepted (DEC-023 ②). */
  down(db: DatabaseSync): void;
  /**
   * Rows to export before `down` runs, so a rollback never silently drops data
   * (DEC-023 ④). Returns `{table, rows}` batches written to `.data/rollback-<ts>.jsonl`.
   */
  exportBeforeDown?(db: DatabaseSync): Array<{ table: string; rows: unknown[] }>;
};

export class MigrationError extends Error {}

/** Where `down` dumps the data it is about to drop. Overridable for tests. */
export const ROLLBACK_DIR = process.env.JARVIS_ROLLBACK_DIR ?? join(process.cwd(), ".data");

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** `ALTER TABLE ... ADD COLUMN` guarded so re-running a migration is harmless. */
function addColumn(db: DatabaseSync, table: string, column: string, decl: string): void {
  if (tableColumns(db, table).has(column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

/**
 * `node:sqlite` ships SQLite 3.35+, so `DROP COLUMN` exists — but it refuses on
 * indexed/generated columns. None of ours are, and the guard keeps `down` idempotent.
 */
function dropColumn(db: DatabaseSync, table: string, column: string): void {
  if (!tableColumns(db, table).has(column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

function selectAll(db: DatabaseSync, sql: string): unknown[] {
  return db.prepare(sql).all() as unknown[];
}

/**
 * Version 1 is the pre-existing `migrateProviderPriority` (CR-20260909), folded in
 * unchanged so the framework starts from the schema already in the field rather than
 * re-deriving it. Its `down` drops the column the same way the original `up` added it.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "provider-priority",
    up(db) {
      if (tableColumns(db, "providers").has("priority")) {
        return;
      }
      db.exec("ALTER TABLE providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 1000000");
      const rows = db
        .prepare("SELECT id, user_id AS userId FROM providers ORDER BY user_id ASC, created_at ASC, rowid ASC")
        .all() as Array<{ id: string; userId: string }>;
      const seen = new Map<string, number>();
      const update = db.prepare("UPDATE providers SET priority = ? WHERE id = ?");
      for (const row of rows) {
        const next = seen.get(row.userId) ?? 0;
        update.run(next, row.id);
        seen.set(row.userId, next + 1);
      }
    },
    down(db) {
      dropColumn(db, "providers", "priority");
    },
    exportBeforeDown(db) {
      return [{ table: "providers", rows: selectAll(db, "SELECT id, priority FROM providers") }];
    },
  },
  {
    // CP-10 / CP-39: the tool round-trip has to survive a refresh (REQ-F-013), and
    // `created_at` alone reorders same-millisecond rows, so `seq` carries the real order.
    version: 2,
    name: "message-tool-records",
    up(db) {
      addColumn(db, "messages", "tool_calls", "TEXT");
      addColumn(db, "messages", "tool_call_id", "TEXT");
      addColumn(db, "messages", "seq", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "messages", "sources", "TEXT");
    },
    down(db) {
      for (const column of ["tool_calls", "tool_call_id", "seq", "sources"]) {
        dropColumn(db, "messages", column);
      }
    },
    exportBeforeDown(db) {
      return [
        {
          table: "messages",
          rows: selectAll(
            db,
            "SELECT id, tool_calls, tool_call_id, seq, sources FROM messages WHERE tool_calls IS NOT NULL OR tool_call_id IS NOT NULL OR sources IS NOT NULL"
          ),
        },
      ];
    },
  },
  {
    // CP-29 / CP-32: tool support is per (provider, model); context window feeds the budget.
    version: 3,
    name: "provider-capabilities",
    up(db) {
      addColumn(db, "providers", "tool_support", "TEXT");
      addColumn(db, "providers", "context_window", "INTEGER");
    },
    down(db) {
      dropColumn(db, "providers", "tool_support");
      dropColumn(db, "providers", "context_window");
    },
    exportBeforeDown(db) {
      return [
        { table: "providers", rows: selectAll(db, "SELECT id, tool_support, context_window FROM providers") },
      ];
    },
  },
  {
    // CP-30: token totals accumulate across every model call in the conversation and
    // must survive a refresh, so they live on the row rather than in component state.
    version: 4,
    name: "conversation-token-usage",
    up(db) {
      addColumn(db, "conversations", "input_tokens", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "conversations", "output_tokens", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "conversations", "usage_estimated", "INTEGER NOT NULL DEFAULT 0");
    },
    down(db) {
      for (const column of ["input_tokens", "output_tokens", "usage_estimated"]) {
        dropColumn(db, "conversations", column);
      }
    },
    exportBeforeDown(db) {
      return [
        {
          table: "conversations",
          rows: selectAll(db, "SELECT id, input_tokens, output_tokens, usage_estimated FROM conversations"),
        },
      ];
    },
  },
  {
    // CP-6: search backend config. A key/value table rather than columns on a
    // singleton row — the next settings group should not need another migration.
    version: 5,
    name: "app-settings",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    },
    down(db) {
      db.exec("DROP TABLE IF EXISTS app_settings");
    },
    exportBeforeDown(db) {
      return [{ table: "app_settings", rows: selectAll(db, "SELECT key, value FROM app_settings") }];
    },
  },
];

export function registeredMigrations(): Migration[] {
  for (const migration of MIGRATIONS) {
    if (typeof migration.up !== "function" || typeof migration.down !== "function") {
      throw new MigrationError(
        `migration ${migration.version} (${migration.name}) must supply both up and down (DEC-023 ②)`
      );
    }
  }
  return [...MIGRATIONS].sort((a, b) => a.version - b.version);
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

function setVersion(db: DatabaseSync, version: number): void {
  // PRAGMA does not accept bound parameters; the value is an integer we produced.
  db.exec(`PRAGMA user_version = ${Math.trunc(version)}`);
}

/** Apply every migration above `PRAGMA user_version`, in order. */
export function migrateUp(db: DatabaseSync, target = Number.POSITIVE_INFINITY): number {
  let version = currentVersion(db);
  for (const migration of registeredMigrations()) {
    if (migration.version <= version || migration.version > target) {
      continue;
    }
    migration.up(db);
    version = migration.version;
    setVersion(db, version);
  }
  return version;
}

/**
 * Roll back to `target`, newest first, dumping the columns each step is about to drop
 * (DEC-023 ④). The dump path is returned so a rollback record can cite it.
 *
 * Callers must run this **before** starting the old code — old `chat.ts` would otherwise
 * read `role:"tool"` rows it does not understand and send them to the provider verbatim.
 */
export function migrateDown(db: DatabaseSync, target: number): { version: number; dumpPath: string | null } {
  const applied = registeredMigrations()
    .filter((migration) => migration.version > target && migration.version <= currentVersion(db))
    .sort((a, b) => b.version - a.version);

  if (applied.length === 0) {
    return { version: currentVersion(db), dumpPath: null };
  }

  const batches: Array<{ migration: string; table: string; rows: unknown[] }> = [];
  for (const migration of applied) {
    for (const batch of migration.exportBeforeDown?.(db) ?? []) {
      batches.push({ migration: migration.name, table: batch.table, rows: batch.rows });
    }
  }

  let dumpPath: string | null = null;
  if (batches.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    dumpPath = join(ROLLBACK_DIR, `rollback-${stamp}.jsonl`);
    mkdirSync(dirname(dumpPath), { recursive: true });
    writeFileSync(dumpPath, batches.map((batch) => JSON.stringify(batch)).join("\n") + "\n", "utf8");
  }

  for (const migration of applied) {
    migration.down(db);
    setVersion(db, migration.version - 1);
  }
  return { version: currentVersion(db), dumpPath };
}
