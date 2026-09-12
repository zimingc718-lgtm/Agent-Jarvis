import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ENTITIES_ROOT, EntityError, readEntity, updateEntity, type Health } from "./entities";
import { extractReadableText, extractTitle } from "./tools/web-tools";
import { fetchWithGuardedRedirects, UrlNotAllowedError, type Resolver } from "./tools/url-guard";

/**
 * Running one collection source (CR-20260911-home-dashboard, 出口义务 5).
 *
 * Until something actually fetches, a card's health can only ever read 未接入 or 陈旧 and
 * the whole indicator is decorative. This module is the engine behind it: fetch one
 * source, extract its text, compare against the last snapshot, and write back the health
 * and a change line.
 *
 * The change summary is computed, never written by a model. The knowledge base is raw
 * material and the board states facts; a generated sentence here would be an invented
 * fact wearing the same typeface as a measured one. So the summary says how many lines
 * appeared and quotes the first of them, and nothing else.
 *
 * Outbound traffic reuses the existing guard: every redirect hop is re-validated against
 * the SSRF rules (REQ-NF-009 ③). Nothing new reaches the network here.
 */

export const SNAPSHOTS_DIR = "snapshots";
/** Response body ceiling; a source is a page, not a download. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
/** Extracted text kept per source so the next run has something to diff against. */
export const MAX_SNAPSHOT_CHARS = 200_000;
/** Below this, "we got bytes but no readable text" is the honest reading. */
export const MIN_READABLE_CHARS = 40;
export const FETCH_TIMEOUT_MS = 20_000;

export type Snapshot = { url: string; hash: string; at: string; text: string };

export type FetchOutcome = {
  health: Health;
  changed: boolean;
  /** Mechanical one-liner, empty when nothing changed or the fetch failed. */
  change: string;
  /** Human-readable reason, always set — the card and the tool both surface it. */
  detail: string;
  at: string;
};

export type FetchSourceDeps = {
  root?: string;
  fetcher?: typeof fetch;
  resolver?: Resolver;
  allowHosts?: string[];
  signal?: AbortSignal;
  now?: () => Date;
};

/**
 * One guarded fetch plus text extraction.
 *
 * Shared by source collection and URL ingestion on purpose: "what counts as unreadable"
 * must be one decision, not two that drift apart. A page that is too thin to diff is
 * also too thin to file as knowledge.
 */
export type ReadableFetch =
  | { ok: true; text: string; title: string }
  | { ok: false; health: Extract<Health, "failed_fetch" | "parse_failed">; detail: string };

export async function fetchReadable(url: string, deps: FetchSourceDeps = {}): Promise<ReadableFetch> {
  const resolver: Resolver =
    deps.resolver ?? (async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address));

  let response: Response;
  try {
    response = await fetchWithGuardedRedirects(url, {
      resolver,
      allowHosts: deps.allowHosts,
      fetcher: deps.fetcher,
      signal: deps.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
  } catch (error) {
    const reason = error instanceof UrlNotAllowedError ? error.message : error instanceof Error ? error.message : "网络错误";
    return { ok: false, health: "failed_fetch", detail: `抓取失败：${reason}` };
  }
  if (!response.ok) {
    return { ok: false, health: "failed_fetch", detail: `抓取失败：HTTP ${response.status}` };
  }

  let body: string;
  try {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_SOURCE_BYTES) {
      return { ok: false, health: "failed_fetch", detail: `抓取失败：响应超过 ${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)}MB` };
    }
    body = new TextDecoder("utf-8").decode(buffer);
  } catch {
    return { ok: false, health: "failed_fetch", detail: "抓取失败：响应读取失败" };
  }

  const text = extractReadableText(body).slice(0, MAX_SNAPSHOT_CHARS);
  if (text.length < MIN_READABLE_CHARS) {
    return { ok: false, health: "parse_failed", detail: "解析失败：抓到了页面但取不出正文，可能是改版或需要脚本渲染" };
  }
  return { ok: true, text, title: extractTitle(body) };
}

function snapshotPath(root: string, entity: string, url: string): string {
  const key = `${entity}__${createHash("sha256").update(url).digest("hex").slice(0, 16)}.json`;
  const path = join(root, SNAPSHOTS_DIR, key);
  if (!resolve(path).startsWith(resolve(root) + sep)) {
    throw new EntityError("快照路径越界", 400);
  }
  return path;
}

export async function readSnapshot(root: string, entity: string, url: string): Promise<Snapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(snapshotPath(root, entity, url), "utf8")) as Snapshot;
    return parsed && typeof parsed.hash === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(root: string, entity: string, snapshot: Snapshot): Promise<void> {
  const path = snapshotPath(root, entity, snapshot.url);
  await mkdir(join(root, SNAPSHOTS_DIR), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

/**
 * What changed, in counted terms. Line-based and order-insensitive: a page that only
 * reorders its nav should not read as new content.
 */
export function describeChange(before: string, after: string): string {
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 1);
  const old = new Set(lines(before));
  const added = lines(after).filter((line) => !old.has(line));
  const fresh = new Set(lines(after));
  const removed = lines(before).filter((line) => !fresh.has(line));
  if (added.length === 0 && removed.length === 0) {
    return "";
  }
  const counts = [added.length > 0 ? `新增 ${added.length} 行` : "", removed.length > 0 ? `移除 ${removed.length} 行` : ""]
    .filter(Boolean)
    .join("，");
  const first = added[0] ?? "";
  const quoted = first.length > 60 ? `${first.slice(0, 60)}…` : first;
  return quoted ? `${counts}：${quoted}` : counts;
}

/**
 * Fetch one source and write the result onto the entity.
 *
 * Health mapping, and each distinction matters on the board:
 * - network or HTTP error  → `failed_fetch`  (we could not get the page)
 * - bytes but no text      → `parse_failed`  (we got it and learned nothing — the
 *                                             dangerous one: the page may be changing
 *                                             while we see nothing)
 * - text, same as before   → `fresh`         (collection works, they are quiet)
 * - text, different        → `fresh` + change
 */
export async function fetchSource(entityName: string, url: string, deps: FetchSourceDeps = {}): Promise<FetchOutcome> {
  const root = deps.root ?? ENTITIES_ROOT;
  const at = (deps.now ?? (() => new Date()))().toISOString();

  const entity = await readEntity(entityName, root);
  if (!entity) {
    throw new EntityError(`没有名为「${entityName}」的跟踪对象。`, 404);
  }
  if (!entity.sources.includes(url)) {
    throw new EntityError("该链接不是这个对象已登记的采集源。", 400);
  }

  const fail = async (health: Health, detail: string): Promise<FetchOutcome> => {
    await updateEntity(entityName, { field: "health", value: health, now: () => new Date(at) }, root);
    // `checkedAt` deliberately NOT advanced on failure: it records the last time we
    // actually learned something, which is what staleness should measure.
    return { health, changed: false, change: "", detail, at };
  };

  const readable = await fetchReadable(url, deps);
  if (!readable.ok) {
    return fail(readable.health, readable.detail);
  }
  const text = readable.text;

  const hash = createHash("sha256").update(text).digest("hex");
  const previous = await readSnapshot(root, entityName, url);
  await writeSnapshot(root, entityName, { url, hash, at, text });

  await updateEntity(entityName, { field: "checkedAt", value: at, now: () => new Date(at) }, root);
  await updateEntity(entityName, { field: "health", value: "fresh", now: () => new Date(at) }, root);

  if (!previous) {
    // First run establishes the baseline. Calling that "changed" would light up every
    // card the moment its source is configured.
    return { health: "fresh", changed: false, change: "", detail: "首次采集，已建立基线", at };
  }
  if (previous.hash === hash) {
    return { health: "fresh", changed: false, change: "", detail: "采集正常，页面无变化", at };
  }

  const change = describeChange(previous.text, text) || "页面有变化";
  await updateEntity(
    entityName,
    { field: "change", value: change, evidence: { url, at, locator: "采集比对" }, now: () => new Date(at) },
    root
  );
  return { health: "fresh", changed: true, change, detail: `检测到变化：${change}`, at };
}
