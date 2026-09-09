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

/** Thrown when a stored provider secret exists but cannot be decrypted (usually a changed JARVIS_SECRET_KEY). */
export class ProviderSecretError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super("Stored provider secret could not be decrypted.");
    this.name = "ProviderSecretError";
    this.providerId = providerId;
  }
}

export type SaveProviderResult = { id: string; created: boolean };

export type Store = {
  upsertUser(input: UserInput): { id: string; email: string; name: string };
  saveProvider(userId: string, input: ProviderInput): SaveProviderResult;
  setProviderEnabled(userId: string, providerId: string, enabled: boolean): boolean;
  deleteProvider(userId: string, providerId: string): boolean;
  listProviders(userId: string): ProviderSummary[];
  getProviderForUser(userId: string, providerId: string): ProviderRuntimeConfig | null;
  revealProviderSecret(userId: string, providerId: string): string | null;
  dumpProviderSecretsForTest(): Array<{ id: string; encryptedSecret: string | null }>;
  createConversation(userId: string, title: string): ConversationSummary;
  getConversationForUser(userId: string, conversationId: string): ConversationSummary | null;
  addMessage(conversationId: string, role: "user" | "assistant", content: string, status: string): string;
  listRecentConversations(userId: string): ConversationSummary[];
  listMessages(conversationId: string): MessageRecord[];
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
      db.prepare(
        `INSERT INTO providers
          (id, user_id, name, kind, auth_mode, base_url, default_model, enabled, encrypted_secret, secret_preview)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        maskSecret(input.secret)
      );
      return { id, created: true };
    },

    setProviderEnabled(userId, providerId, enabled) {
      const result = db
        .prepare("UPDATE providers SET enabled = ? WHERE id = ? AND user_id = ?")
        .run(enabled ? 1 : 0, providerId, userId);
      return result.changes > 0;
    },

    deleteProvider(userId, providerId) {
      const result = db.prepare("DELETE FROM providers WHERE id = ? AND user_id = ?").run(providerId, userId);
      return result.changes > 0;
    },

    listProviders(userId) {
      const rows = db
        .prepare(
          `SELECT id, name, kind, auth_mode AS authMode, base_url AS baseUrl, default_model AS defaultModel,
                  enabled, encrypted_secret AS encryptedSecret, secret_preview AS secretPreview
             FROM providers
            WHERE user_id = ?
            ORDER BY created_at DESC`
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
          secretPreview: row.secretPreview,
          note,
        };
      });
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

    close() {
      db.close();
    },
  };
}

function ensureUserRecord(db: DatabaseSync, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)").run(userId, userId, userId);
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

    CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  `);
}
