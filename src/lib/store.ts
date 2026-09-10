import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto";
import type { ProviderAuthMode, ProviderKind, ProviderRuntimeConfig, ProviderSummary } from "./types";

type UserInput = {
  email: string;
  name: string;
};

type ProviderInput = {
  /** When set and owned by the user, the provider is updated in place instead of created. */
  id?: string;
  name: string;
  kind: ProviderKind;
  authMode: ProviderAuthMode;
  baseUrl: string | null;
  defaultModel: string;
  enabled: boolean;
  /** Only written when non-empty; on update an empty value keeps the stored secret. */
  secret?: string | null;
};

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  createdAt: string;
};

/** A registered skill folder (CR-20260909-skills). */
export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  dirPath: string;
  createdAt: string;
};

/** A captured skill HTML output (CR-20260909-skills). */
export type InsightRecord = {
  id: string;
  conversationId: string;
  kind: string;
  html: string;
  createdAt: string;
};

/**
 * The single global pointer for the dynamic display screen (CR-20260909-display-screen, DEC-017).
 * `kind` is an extension point: F2 renders "home" / "insight", anything else falls back to home.
 */
export type DisplayStateRecord = {
  kind: string;
  refId: string | null;
  updatedAt: string;
};

/** Thrown when a stored provider secret exists but cannot be decrypted (usually a changed JARVIS_SECRET_KEY). */
export class ProviderSecretError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super("Stored provider secret could not be decrypted.");
    this.name = "ProviderSecretError";
    this.providerId = providerId;
  }
}

/** Thrown by `insertSkill` when the user already has a skill with the same name (CR-20260909-skills). */
export class SkillNameConflictError extends Error {
  readonly skillName: string;

  constructor(skillName: string) {
    super(`A skill named "${skillName}" is already registered.`);
    this.name = "SkillNameConflictError";
    this.skillName = skillName;
  }
}

export type SaveProviderResult = { id: string; created: boolean };

export type Store = {
  upsertUser(input: UserInput): { id: string; email: string; name: string };
  saveProvider(userId: string, input: ProviderInput): SaveProviderResult;
  setProviderEnabled(userId: string, providerId: string, enabled: boolean): boolean;
  deleteProvider(userId: string, providerId: string): boolean;
  /** Swap this provider's priority with its neighbour in the given direction. CR-20260909. */
  reorderProvider(userId: string, providerId: string, direction: "up" | "down"): boolean;
  listProviders(userId: string): ProviderSummary[];
  /**
   * The provider a chat turn should use when the request names none (CR-20260909):
   * the highest-priority provider that is both enabled and connected, or null.
   */
  resolveActiveProvider(userId: string): ProviderRuntimeConfig | null;
  getProviderForUser(userId: string, providerId: string): ProviderRuntimeConfig | null;
  revealProviderSecret(userId: string, providerId: string): string | null;
  dumpProviderSecretsForTest(): Array<{ id: string; encryptedSecret: string | null }>;
  createConversation(userId: string, title: string): ConversationSummary;
  getConversationForUser(userId: string, conversationId: string): ConversationSummary | null;
  addMessage(conversationId: string, role: "user" | "assistant", content: string, status: string): string;
  listRecentConversations(userId: string): ConversationSummary[];
  listMessages(conversationId: string): MessageRecord[];
  // --- Skills (CR-20260909-skills) ---
  /** Register a skill folder. Throws if the user already has a skill with this name. */
  insertSkill(userId: string, input: { name: string; description: string; dirPath: string }): SkillRecord;
  listSkills(userId: string): SkillRecord[];
  getSkill(userId: string, skillId: string): SkillRecord | null;
  // --- Insights (CR-20260909-skills) ---
  insertInsight(input: { conversationId: string; kind: string; html: string }): InsightRecord;
  listInsights(conversationId: string): InsightRecord[];
  getInsight(insightId: string): InsightRecord | null;
  // --- Display state (CR-20260909-display-screen, DEC-017) ---
  getDisplayState(): DisplayStateRecord;
  setDisplayState(next: { kind: string; refId?: string | null }): void;
  dumpDisplayStateRowsForTest(): DisplayStateRecord[];
  close(): void;
};

export function createStore(databasePath: string, encryptionKey = process.env.JARVIS_SECRET_KEY ?? ""): Store {
  if (!encryptionKey) {
    throw new Error(
      "JARVIS_SECRET_KEY is required to open the store. Set it in .env.local (see docs/LOCAL_CONFIGURATION.md)."
    );
  }

  const db = new DatabaseSync(databasePath);
  migrate(db);
  migrateProviderPriority(db);

  function readProviderRow(userId: string, providerId: string) {
    return db
      .prepare(
        `SELECT id, name, kind, auth_mode AS authMode, base_url AS baseUrl, default_model AS defaultModel,
                enabled, encrypted_secret AS encryptedSecret
           FROM providers
          WHERE user_id = ? AND id = ?
          LIMIT 1`
      )
      .get(userId, providerId) as
      | {
          id: string;
          name: string;
          kind: ProviderKind;
          authMode: ProviderAuthMode;
          baseUrl: string | null;
          defaultModel: string;
          enabled: 0 | 1;
          encryptedSecret: string | null;
        }
      | undefined;
  }

  return {
    upsertUser(input) {
      const existing = db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(input.email) as
        | { id: string; email: string; name: string }
        | undefined;
      if (existing) {
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(input.name, existing.id);
        return { ...existing, name: input.name };
      }

      const id = randomUUID();
      db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)").run(id, input.email, input.name);
      return { id, email: input.email, name: input.name };
    },

    saveProvider(userId, input) {
      ensureUserRecord(db, userId);

      if (input.id) {
        const owned = db
          .prepare("SELECT id FROM providers WHERE id = ? AND user_id = ?")
          .get(input.id, userId) as { id: string } | undefined;
        if (owned) {
          if (input.secret) {
            db.prepare(
              `UPDATE providers
                  SET name = ?, kind = ?, auth_mode = ?, base_url = ?, default_model = ?, enabled = ?,
                      encrypted_secret = ?, secret_preview = ?
                WHERE id = ? AND user_id = ?`
            ).run(
              input.name,
              input.kind,
              input.authMode,
              input.baseUrl,
              input.defaultModel,
              input.enabled ? 1 : 0,
              encryptSecret(input.secret, encryptionKey),
              maskSecret(input.secret),
              input.id,
              userId
            );
          } else {
            db.prepare(
              `UPDATE providers
                  SET name = ?, kind = ?, auth_mode = ?, base_url = ?, default_model = ?, enabled = ?
                WHERE id = ? AND user_id = ?`
            ).run(
              input.name,
              input.kind,
              input.authMode,
              input.baseUrl,
              input.defaultModel,
              input.enabled ? 1 : 0,
              input.id,
              userId
            );
          }
          return { id: input.id, created: false };
        }
      }

      const id = randomUUID();
      const encryptedSecret = input.secret ? encryptSecret(input.secret, encryptionKey) : null;
      const nextPriority =
        ((db.prepare("SELECT MAX(priority) AS max FROM providers WHERE user_id = ?").get(userId) as
          | { max: number | null }
          | undefined)?.max ?? -1) + 1;
      db.prepare(
        `INSERT INTO providers
          (id, user_id, name, kind, auth_mode, base_url, default_model, enabled, encrypted_secret, secret_preview, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        userId,
        input.name,
        input.kind,
        input.authMode,
        input.baseUrl,
        input.defaultModel,
        input.enabled ? 1 : 0,
        encryptedSecret,
        maskSecret(input.secret),
        nextPriority
      );
      return { id, created: true };
    },

    setProviderEnabled(userId, providerId, enabled) {
      const result = db
        .prepare("UPDATE providers SET enabled = ? WHERE id = ? AND user_id = ?")
        .run(enabled ? 1 : 0, providerId, userId);
      return result.changes > 0;
    },

    reorderProvider(userId, providerId, direction) {
      const ordered = db
        .prepare("SELECT id, priority FROM providers WHERE user_id = ? ORDER BY priority ASC, created_at DESC")
        .all(userId) as Array<{ id: string; priority: number }>;
      const index = ordered.findIndex((row) => row.id === providerId);
      if (index < 0) {
        return false;
      }
      const neighbour = direction === "up" ? ordered[index - 1] : ordered[index + 1];
      if (!neighbour) {
        return false;
      }
      const current = ordered[index];
      const swap = db.prepare("UPDATE providers SET priority = ? WHERE id = ? AND user_id = ?");
      swap.run(neighbour.priority, current.id, userId);
      swap.run(current.priority, neighbour.id, userId);
      return true;
    },

    deleteProvider(userId, providerId) {
      const result = db.prepare("DELETE FROM providers WHERE id = ? AND user_id = ?").run(providerId, userId);
      return result.changes > 0;
    },

    listProviders(userId) {
      const rows = db
        .prepare(
          `SELECT id, name, kind, auth_mode AS authMode, base_url AS baseUrl, default_model AS defaultModel,
                  enabled, priority, encrypted_secret AS encryptedSecret, secret_preview AS secretPreview
             FROM providers
            WHERE user_id = ?
            ORDER BY priority ASC, created_at DESC`
        )
        .all(userId) as Array<
        Omit<ProviderSummary, "connected" | "enabled" | "note"> & {
          enabled: 0 | 1;
          encryptedSecret: string | null;
        }
      >;

      return rows.map((row) => {
        let connected = row.authMode === "local";
        let note: string | null = null;

        if (!connected && row.encryptedSecret) {
          try {
            decryptSecret(row.encryptedSecret, encryptionKey);
            connected = true;
          } catch {
            connected = false;
            note = "凭据无法解密，请重新输入 API Key（JARVIS_SECRET_KEY 可能已更改）。";
          }
        } else if (!connected && row.authMode === "api_key" && !row.encryptedSecret) {
          note = "缺少 API Key。";
        }

        return {
          id: row.id,
          name: row.name,
          kind: row.kind,
          authMode: row.authMode,
          baseUrl: row.baseUrl,
          defaultModel: row.defaultModel,
          enabled: Boolean(row.enabled),
          connected,
          priority: row.priority,
          secretPreview: row.secretPreview,
          note,
        };
      });
    },

    resolveActiveProvider(userId) {
      // Same "connected" notion as listProviders (secret decryptable / local),
      // walked in priority order so a broken top provider falls through.
      for (const summary of this.listProviders(userId)) {
        if (!summary.enabled || !summary.connected) {
          continue;
        }
        const runtime = this.getProviderForUser(userId, summary.id);
        if (runtime) {
          return runtime;
        }
      }
      return null;
    },

    getProviderForUser(userId, providerId) {
      const row = readProviderRow(userId, providerId);
      if (!row || !row.enabled || !row.baseUrl) {
        return null;
      }

      let secret: string | null = null;
      if (row.encryptedSecret) {
        try {
          secret = decryptSecret(row.encryptedSecret, encryptionKey);
        } catch {
          throw new ProviderSecretError(row.id);
        }
      }
      if (row.authMode === "api_key" && !secret) {
        return null;
      }

      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        authMode: row.authMode,
        baseUrl: row.baseUrl,
        defaultModel: row.defaultModel,
        enabled: Boolean(row.enabled),
        secret,
      };
    },

    revealProviderSecret(userId, providerId) {
      const row = readProviderRow(userId, providerId);
      if (!row?.encryptedSecret) {
        return null;
      }
      try {
        return decryptSecret(row.encryptedSecret, encryptionKey);
      } catch {
        throw new ProviderSecretError(row.id);
      }
    },

    dumpProviderSecretsForTest() {
      return db.prepare("SELECT id, encrypted_secret AS encryptedSecret FROM providers").all() as Array<{
        id: string;
        encryptedSecret: string | null;
      }>;
    },

    createConversation(userId, title) {
      ensureUserRecord(db, userId);
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO conversations (id, user_id, title, updated_at) VALUES (?, ?, ?, ?)").run(
        id,
        userId,
        title,
        now
      );
      return { id, title, updatedAt: now };
    },

    getConversationForUser(userId, conversationId) {
      const row = db
        .prepare("SELECT id, title, updated_at AS updatedAt FROM conversations WHERE id = ? AND user_id = ? LIMIT 1")
        .get(conversationId, userId) as ConversationSummary | undefined;
      return row ?? null;
    },

    addMessage(conversationId, role, content, status) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, conversationId, role, content, status, now);
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
      return id;
    },

    listRecentConversations(userId) {
      return db
        .prepare(
          "SELECT id, title, updated_at AS updatedAt FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10"
        )
        .all(userId) as ConversationSummary[];
    },

    listMessages(conversationId) {
      return db
        .prepare(
          `SELECT id, role, content, status, created_at AS createdAt
             FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC`
        )
        .all(conversationId) as MessageRecord[];
    },

    insertSkill(userId, input) {
      ensureUserRecord(db, userId);
      const clash = db
        .prepare("SELECT id FROM skills WHERE user_id = ? AND name = ?")
        .get(userId, input.name) as { id: string } | undefined;
      if (clash) {
        throw new SkillNameConflictError(input.name);
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO skills (id, user_id, name, description, dir_path, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, userId, input.name, input.description, input.dirPath, createdAt);
      return { id, name: input.name, description: input.description, dirPath: input.dirPath, createdAt };
    },

    listSkills(userId) {
      return db
        .prepare(
          `SELECT id, name, description, dir_path AS dirPath, created_at AS createdAt
             FROM skills WHERE user_id = ? ORDER BY created_at ASC`
        )
        .all(userId) as SkillRecord[];
    },

    getSkill(userId, skillId) {
      const row = db
        .prepare(
          `SELECT id, name, description, dir_path AS dirPath, created_at AS createdAt
             FROM skills WHERE user_id = ? AND id = ? LIMIT 1`
        )
        .get(userId, skillId) as SkillRecord | undefined;
      return row ?? null;
    },

    insertInsight(input) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO insights (id, conversation_id, kind, html, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(id, input.conversationId, input.kind, input.html, createdAt);
      return { id, conversationId: input.conversationId, kind: input.kind, html: input.html, createdAt };
    },

    listInsights(conversationId) {
      return db
        .prepare(
          `SELECT id, conversation_id AS conversationId, kind, html, created_at AS createdAt
             FROM insights WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC`
        )
        .all(conversationId) as InsightRecord[];
    },

    getInsight(insightId) {
      const row = db
        .prepare(
          `SELECT id, conversation_id AS conversationId, kind, html, created_at AS createdAt
             FROM insights WHERE id = ? LIMIT 1`
        )
        .get(insightId) as InsightRecord | undefined;
      return row ?? null;
    },

    getDisplayState() {
      const row = db
        .prepare("SELECT kind, ref_id AS refId, updated_at AS updatedAt FROM display_state WHERE id = 'singleton'")
        .get() as DisplayStateRecord | undefined;
      return row ?? { kind: "home", refId: null, updatedAt: new Date(0).toISOString() };
    },

    setDisplayState(next) {
      db.prepare(
        "INSERT OR REPLACE INTO display_state (id, kind, ref_id, updated_at) VALUES ('singleton', ?, ?, ?)"
      ).run(next.kind, next.refId ?? null, new Date().toISOString());
    },

    dumpDisplayStateRowsForTest() {
      return db
        .prepare("SELECT kind, ref_id AS refId, updated_at AS updatedAt FROM display_state")
        .all() as DisplayStateRecord[];
    },

    close() {
      db.close();
    },
  };
}

function ensureUserRecord(db: DatabaseSync, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)").run(userId, userId, userId);
}

/**
 * CR-20260909: providers gain a `priority` column (lower = used first). `node:sqlite`
 * has no migration framework, so add the column only when absent and backfill existing
 * rows per user in creation order (older = higher priority) — an accepted initial order
 * the user can then reorder.
 */
function migrateProviderPriority(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(providers)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "priority")) {
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
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      auth_mode TEXT NOT NULL,
      base_url TEXT,
      default_model TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      encrypted_secret TEXT,
      secret_preview TEXT,
      priority INTEGER NOT NULL DEFAULT 1000000,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      dir_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, name)
    );

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      html TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS display_state (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ref_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_insights_conversation ON insights(conversation_id, created_at DESC);
  `);
}
