import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ENTITIES_ROOT } from "./entities";

/**
 * Per-entity message history (CR-20260918-change-history-and-sources, CP-1).
 *
 * Append-only, one JSONL file per entity — the same shape as the governance ledger
 * (`project/.governance/ledger.jsonl`), not a new persistence idea. Entries are written
 * ONLY from `sources.ts#fetchSource`'s own diff, never by a model: that function's own
 * comment already states the reason ("a generated sentence here would be an invented
 * fact wearing the same typeface as a measured one"), and a message list is exactly that
 * sentence, kept instead of overwritten.
 *
 * `entities.ts`'s `change`/`changeAt` fields (a single latest line) are left as they are
 * — this module does not replace them, it adds the history they never kept. The board's
 * collapsed-card glance still reads `change`; the message list reads this.
 */

export const HISTORY_DIR = "history";
/**
 * How many of the most recent entries a single read ever returns. This bounds what one
 * request has to parse, not what is kept on disk — storage itself is NOT trimmed (see
 * the CR document's 代价/残留风险: an accepted, documented tradeoff for a first version,
 * not an oversight).
 */
export const MAX_HISTORY_READ = 200;

export type HistoryEntry = { at: string; url: string; change: string };

function historyPath(root: string, entityName: string): string {
  const path = join(root, HISTORY_DIR, `${entityName}.jsonl`);
  const rootAbs = resolve(root);
  if (!resolve(path).startsWith(rootAbs + sep)) {
    throw new Error("历史记录路径越界");
  }
  return path;
}

/**
 * `entityName` is trusted here the same way `sources.ts#snapshotPath` trusts it: by the
 * time either is called, the caller has already resolved the entity through
 * `readEntity`/`entityPath`, which is where the name-safety check actually lives. This
 * function adds no second copy of that check — only the path-boundary guard above, which
 * is the same belt-and-suspenders `snapshotPath` already carries.
 */
export async function appendHistoryEntry(root: string, entityName: string, entry: HistoryEntry): Promise<void> {
  const path = historyPath(root, entityName);
  await mkdir(join(root, HISTORY_DIR), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Newest first — a message list reads top-down like a chat, not like a log file. */
export async function readHistory(entityName: string, root: string = ENTITIES_ROOT, limit = MAX_HISTORY_READ): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(historyPath(root, entityName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const cap = Math.max(1, Math.min(limit, MAX_HISTORY_READ));
  const lines = raw.split("\n").filter(Boolean);
  const tail = lines.slice(-cap);
  const parsed: HistoryEntry[] = [];
  for (const line of tail) {
    try {
      const entry = JSON.parse(line) as Partial<HistoryEntry>;
      if (typeof entry.at === "string" && typeof entry.url === "string" && typeof entry.change === "string") {
        parsed.push({ at: entry.at, url: entry.url, change: entry.change });
      }
    } catch {
      // A hand-edited or torn line (e.g. process killed mid-append) is skipped, not fatal
      // to the entries around it — the file is a log, not a transaction.
    }
  }
  return parsed.reverse();
}
