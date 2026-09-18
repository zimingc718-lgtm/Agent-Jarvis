import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ENTITIES_ROOT } from "./entities";
import { KNOWLEDGE_ROOT } from "./knowledge";

/**
 * Per-user filesystem roots for the file-based modules (CR-20260918-per-user-data-isolation,
 * REQ-NF-002 revived).
 *
 * `entities.ts`/`knowledge.ts` (and, through them, `sources.ts`/`entity-history.ts`, which
 * nest under whatever root they are given) were single-admin-only: every function's `root`
 * parameter defaulted to one process-wide constant. Every real call site — every API route
 * under `src/app/api/entities|knowledge`, and `buildRegistry`'s wiring of the model-facing
 * tools — already resolves a real `userId` via `requireUserId()`/`ToolContext.userId` and
 * then discards it, calling `listEntities(ENTITIES_ROOT)` instead of anything scoped to that
 * id. This module is the missing link: given a userId, hand back the root that id's data
 * actually lives under, and migrate the legacy single-admin data into it exactly once.
 *
 * `library.ts`'s resource library is deliberately NOT covered here — its own file header
 * states it is a git-tracked, version-controlled asset ("字节仍留在资料库目录里（进版本库，
 * 由 git 管）"), which is a different sharing model than per-conversation-created entities/
 * knowledge. Per-user library isolation is an explicit non-goal of this CR — see its
 * document's 非目标 section.
 */

const USERS_BASE = process.env.JARVIS_USERS_PATH ?? join(process.cwd(), ".data", "users");

/**
 * userId can be a Google-issued email (the real shape once login is active — see
 * `auth-guard.ts`'s fallback chain and `src/lib/auth.ts`'s session callback, which never
 * populates `session.user.id`), the operator's own `JARVIS_SINGLE_ADMIN_ID`, or
 * `JARVIS_TEST_USER_ID`. Only the first is attacker-influenced in principle (Google's own
 * format guarantees make that theoretical, not live), but every id here goes through the
 * same allow-list regardless — consistent with this codebase's existing belt-and-suspenders
 * path guards (`entity-history.ts#historyPath`, `sources.ts#snapshotPath`).
 *
 * Deliberately collapses to `_` rather than trying to preserve `@`/`.` for readability:
 * keeping those would let a crafted id contain `..` and walk out of `USERS_BASE`. The
 * resulting directory name is less pretty (`ziming_gmail_com`) but categorically cannot
 * contain a path separator or a traversal sequence. A contrived collision between two
 * distinct real userIds sanitizing to the same token is possible in principle and accepted
 * as a residual risk — see the CR document's 代价/残留风险; Google's own email-uniqueness
 * rules make an actual collision practically unreachable.
 */
function sanitizeUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed) {
    throw new Error("userId 不能为空。");
  }
  const safe = trimmed.replace(/[^A-Za-z0-9_-]/g, "_");
  if (!safe || /^_+$/.test(safe)) {
    throw new Error(`userId 净化后为空：${JSON.stringify(userId)}`);
  }
  return safe;
}

function userBaseFor(userId: string): string {
  return join(USERS_BASE, sanitizeUserId(userId));
}

export function entitiesRootFor(userId: string): string {
  return join(userBaseFor(userId), "entities");
}

export function knowledgeRootFor(userId: string): string {
  return join(userBaseFor(userId), "knowledge");
}

type OwnerEnv = { JARVIS_SINGLE_ADMIN_ID?: string; JARVIS_OWNER_EMAIL?: string; [key: string]: string | undefined };

/**
 * Whether this userId is the one identity allowed to claim the legacy single-admin data.
 *
 * Two independent triggers collapsed into one check, on purpose — they are the same
 * underlying question ("is this the person whose data used to live at the old flat root")
 * asked from two different auth modes:
 *
 * - Single-admin mode (local, loopback, daily use): the fixed `JARVIS_SINGLE_ADMIN_ID` IS
 *   the owner by definition — there is only ever one identity in this mode, and it is the
 *   same person who has been writing to the legacy root every day. This must migrate
 *   transparently on the very first request after this CR ships, or the user's own daily
 *   local instance breaks.
 * - Real session mode (e.g. after Railway + Google login is activated, a later CR): only
 *   the specific email the operator names in `JARVIS_OWNER_EMAIL` may claim the legacy
 *   data — nobody else who happens to log in first. Unset means nobody claims it (a fresh
 *   deployment has no legacy data to worry about; explicitly opt in, don't guess).
 */
function isOwner(userId: string, env: OwnerEnv): boolean {
  const singleAdminId = env.JARVIS_SINGLE_ADMIN_ID?.trim();
  if (singleAdminId && userId === singleAdminId) {
    return true;
  }
  const ownerEmail = env.JARVIS_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail && userId.trim().toLowerCase() === ownerEmail) {
    return true;
  }
  return false;
}

export type RootMigrationOutcome =
  | "exists" // target root already present — no-op, idempotent short-circuit
  | "migrated" // legacy root existed and was moved into the target
  | "created-empty"; // owner, but no legacy data (or none left) — fresh empty root made

export type MigrationResult = { entities: RootMigrationOutcome; knowledge: RootMigrationOutcome };

/**
 * One legacy→per-user root move, idempotent and safe under concurrent callers.
 *
 * Per-module, not per-user-as-one-unit: entities and knowledge are migrated independently
 * so a process interrupted between the two (crash, restart) leaves each module correctly
 * resumable on its own — re-running finds entities already migrated (short-circuits) and
 * knowledge still legacy (finishes the job), rather than the combined check silently
 * treating a half-finished migration as whole.
 *
 * `rename`, not copy-then-delete — the same discipline `entities.ts#deleteEntity` already
 * uses for its own archive move. A crash mid-rename leaves either the old or the new path
 * intact (whichever the filesystem's atomic rename commits), never both a half-written
 * copy and a still-present original.
 */
async function ensureRootMigrated(target: string, legacy: string, owner: boolean): Promise<RootMigrationOutcome> {
  if (existsSync(target)) {
    return "exists";
  }
  if (owner && existsSync(legacy)) {
    await mkdir(dirname(target), { recursive: true });
    try {
      await rename(legacy, target);
      return "migrated";
    } catch (error) {
      // Another concurrent request already won this exact race between our existsSync
      // check above and this rename call. If the target is there now, that IS success —
      // just via a different caller. Anything else (legacy vanished for some other
      // reason, target still missing) is a real failure and must surface, not be eaten.
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && existsSync(target)) {
        return "exists";
      }
      throw error;
    }
  }
  await mkdir(target, { recursive: true });
  return "created-empty";
}

/**
 * Call once per resolved userId before touching entities/knowledge (every API route and
 * `buildRegistry` do this right after `requireUserId`/reading `ToolContext.userId`). Cheap
 * on every call after the first real migration — `existsSync` on an already-created
 * directory, nothing more.
 */
export async function ensureUserDataMigrated(userId: string, env: OwnerEnv = process.env): Promise<MigrationResult> {
  const owner = isOwner(userId, env);
  const entities = await ensureRootMigrated(entitiesRootFor(userId), ENTITIES_ROOT, owner);
  const knowledge = await ensureRootMigrated(knowledgeRootFor(userId), KNOWLEDGE_ROOT, owner);
  return { entities, knowledge };
}

export type UserDataRoots = { userId: string; entitiesRoot: string; knowledgeRoot: string };

/**
 * The one call every real call site makes: resolve-then-migrate-then-hand-back-roots,
 * collapsed into a single await so each of the ~15 API routes and `buildRegistry`'s two
 * callers changes by one line (swap `ENTITIES_ROOT`/`KNOWLEDGE_ROOT` for this) rather than
 * each re-deriving the same three-step sequence its own way.
 */
export async function resolveUserDataRoots(userId: string, env: OwnerEnv = process.env): Promise<UserDataRoots> {
  await ensureUserDataMigrated(userId, env);
  return { userId, entitiesRoot: entitiesRootFor(userId), knowledgeRoot: knowledgeRootFor(userId) };
}
