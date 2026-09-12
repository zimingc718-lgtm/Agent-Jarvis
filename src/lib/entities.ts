import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * Tracked entities for the home knowledge dashboard
 * (EV-2026-09-11-home-dashboard §3; CR-20260911-home-dashboard).
 *
 * Same shape as `knowledge.ts` on purpose: one Markdown file per entity, plain
 * `key: value` frontmatter, a `pending/` queue the model writes into, and nothing in
 * the database. That keeps every change point a two-way door — rolling this back
 * leaves a folder of notes, not a migration to undo (the DEC-031 手法).
 *
 * Three kinds, three status models. The standards bodies and the grid operators are
 * ONE kind, not two: a grid connection rule is published by the operator, so listing
 * them separately would show the same thing twice (user ruling, 2026-09-11).
 */

export const ENTITIES_ROOT = process.env.JARVIS_ENTITIES_PATH ?? join(process.cwd(), ".data", "entities");
export const PENDING_DIR = "pending";

/** `authority` is deliberately not called `industry`: a wide label becomes a dumping ground. */
export const ENTITY_KINDS = ["competitor", "authority", "customer"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const KIND_LABEL: Record<EntityKind, string> = {
  competitor: "友商",
  authority: "规则与准入方",
  customer: "客户",
};

/**
 * Collection health, kept separate from content change (EV §4). An entity with no
 * source and an entity whose source went quiet both look silent; only this field tells
 * them apart. The project has already shipped that bug once, when "not yet probed" was
 * read as "does not support" and web search became unreachable.
 */
export const HEALTH_STATES = ["fresh", "stale", "failed_fetch", "parse_failed", "unconfigured"] as const;
export type Health = (typeof HEALTH_STATES)[number];

export const HEALTH_LABEL: Record<Health, string> = {
  fresh: "采集正常",
  stale: "信息陈旧",
  failed_fetch: "抓取失败",
  parse_failed: "解析失败",
  unconfigured: "未配置采集源",
};

/** How long without a successful fetch before a configured source reads as stale. */
export const STALE_AFTER_DAYS = 14;
export const MAX_NAME_CHARS = 60;
export const MAX_ENTITY_BYTES = 64 * 1024;
const MAX_TITLE_CHARS = 120;
const MAX_LINE_CHARS = 200;

/** One recorded provenance for a second-hand value (EV §6: 二手值必须可回溯). */
export type Evidence = {
  /** Which field this backs, e.g. `capacity`. */
  field: string;
  url: string;
  /** When it was captured, ISO. */
  at: string;
  /** Where in the source, free text, e.g. 第 3 节表 2. */
  locator: string;
};

/**
 * Whether WE meet this requirement (CR-20260912-technical-spine).
 *
 * Deliberately NOT settable by a tool. The value of a parameter is a fact read out of
 * someone's document and can be checked against the document; whether our own product
 * meets it is a judgement about us, which no source page contains. A model that could
 * write `meets` would be inventing the one thing the board exists to tell the truth about.
 */
export const PARAM_STATES = ["unknown", "meets", "unmet"] as const;
export type ParamState = (typeof PARAM_STATES)[number];
export const PARAM_STATE_LABEL: Record<ParamState, string> = {
  unknown: "未判定",
  meets: "满足",
  unmet: "不满足",
};

/** A named technical requirement or parameter carried by an entity. */
export type Param = {
  /** e.g. 「LVRT 持续时间」, 「效率」, 「通信规约」. */
  name: string;
  /** Exactly as the source states it, unit included. */
  value: string;
  status: ParamState;
};

export const MAX_PARAMS = 60;
export const MAX_PARAM_NAME_CHARS = 40;

/**
 * Names that belong to the entity's own structure and therefore may NOT become a
 * parameter. Without this, a caller aiming at a field that simply is not updatable
 * through that path (`title`) would silently get a parameter named 「title」 sitting on
 * the card — a shadow of a real field, which is worse than a refusal.
 */
export const RESERVED_PARAM_NAMES = ["name", "title", "kind", "body", "sources", "source", "evidence", "param", "params", "created", "status"] as const;

export function isReservedParamName(raw: string): boolean {
  return (RESERVED_PARAM_NAMES as readonly string[]).includes(raw.trim().toLowerCase());
}

export function isParamState(value: unknown): value is ParamState {
  return typeof value === "string" && (PARAM_STATES as readonly string[]).includes(value);
}

/** Names are display text, so the only rules are: non-empty, bounded, single-line, no separator. */
export function normalizeParamName(raw: string): string {
  return raw.replace(/[|\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_PARAM_NAME_CHARS);
}

export type Entity = {
  name: string;
  kind: EntityKind;
  title: string;
  /** One line of positioning. */
  summary: string;
  /** Optional, only grid operators and customers carry one. */
  capacity: string;
  /** Next milestone, both optional and shown together. */
  nextLabel: string;
  nextDate: string;
  health: Health;
  /** Last successful collection, ISO; empty when never collected. */
  checkedAt: string;
  /** Latest change summary, one line. */
  change: string;
  changeAt: string;
  /** When the user last opened this entity's message list. */
  seenAt: string;
  sources: string[];
  /**
   * Named technical parameters and requirements — the board's spine
   * (用户 2026-09-12：「我是技术方，不是市场方」). Order is the order they were added;
   * nothing re-sorts them, for the same reason the lanes never re-sort.
   */
  params: Param[];
  evidence: Evidence[];
  createdAt: string;
  /** Free notes below the frontmatter. */
  body: string;
};

export type EntitySummary = Omit<Entity, "body" | "evidence"> & {
  /** Derived: a change arrived after the last time the user looked. */
  unread: boolean;
  /** Derived: how many of this entity's requirements we do not meet. */
  unmet: number;
};

export class EntityError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 = 400
  ) {
    super(message);
    this.name = "EntityError";
  }
}

// ---------------------------------------------------------------- names & paths

export function slugifyEntityName(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_CHARS)
    .replace(/-+$/g, "");
}

function isSafeName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_CHARS && /^[\p{L}\p{N}_-]+$/u.test(name);
}

function entityPath(root: string, name: string, pending = false): string {
  if (!isSafeName(name)) {
    throw new EntityError(`非法的实体名称「${name}」`, 400);
  }
  const path = pending ? join(root, PENDING_DIR, `${name}.md`) : join(root, `${name}.md`);
  const rootAbs = resolve(root);
  const targetAbs = resolve(path);
  if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) {
    throw new EntityError("实体路径越界", 400);
  }
  return path;
}

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KINDS as readonly string[]).includes(value);
}

function asHealth(value: string): Health {
  return (HEALTH_STATES as readonly string[]).includes(value) ? (value as Health) : "unconfigured";
}

// ---------------------------------------------------------------- file format

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function line(key: string, value: string): string {
  return value ? `${key}: ${value.replace(/\r?\n/g, " ").slice(0, MAX_LINE_CHARS)}\n` : "";
}

export function renderEntityFile(entity: Omit<Entity, "name">): string {
  const head =
    "---\n" +
    line("kind", entity.kind) +
    line("title", entity.title) +
    line("summary", entity.summary) +
    line("capacity", entity.capacity) +
    line("next_label", entity.nextLabel) +
    line("next_date", entity.nextDate) +
    line("health", entity.health) +
    line("checked", entity.checkedAt) +
    line("change", entity.change) +
    line("change_at", entity.changeAt) +
    line("seen_at", entity.seenAt) +
    line("created", entity.createdAt) +
    entity.sources.map((url) => line("source", url)).join("") +
    entity.params.map((p) => line("param", [p.name, p.value, p.status].join(" | "))).join("") +
    entity.evidence.map((e) => line("evidence", [e.field, e.url, e.at, e.locator].join(" | "))).join("") +
    "---\n";
  return `${head}\n${entity.body.trim()}\n`;
}

/** Tolerant on purpose: a hand-written file with only `kind:` is a valid entity. */
export function parseEntityFile(raw: string, fallback: { name: string; createdAt: string }): Omit<Entity, "name"> {
  const text = raw.replace(/^﻿/, "");
  const match = FRONTMATTER.exec(text);
  const meta: Record<string, string> = {};
  const sources: string[] = [];
  const params: Param[] = [];
  const evidence: Evidence[] = [];
  let body = text;
  if (match) {
    body = text.slice(match[0].length);
    for (const row of match[1].split(/\r?\n/)) {
      const at = row.indexOf(":");
      if (at <= 0) {
        continue;
      }
      const key = row.slice(0, at).trim().toLowerCase();
      const value = row.slice(at + 1).trim();
      if (key === "source") {
        if (value) {
          sources.push(value);
        }
      } else if (key === "param") {
        // `name | value | status`; a hand-written line may stop after the value.
        const [rawName, rawValue, rawStatus] = value.split("|").map((part) => part.trim());
        const name = normalizeParamName(rawName ?? "");
        if (name && params.length < MAX_PARAMS) {
          params.push({ name, value: rawValue ?? "", status: isParamState(rawStatus) ? rawStatus : "unknown" });
        }
      } else if (key === "evidence") {
        const [field, url, when, ...rest] = value.split("|").map((part) => part.trim());
        if (field && url) {
          evidence.push({ field, url, at: when ?? "", locator: rest.join(" | ") });
        }
      } else {
        meta[key] = value;
      }
    }
  }
  const content = body.trim();
  const heading = /^#{1,6}\s+(.+)$/m.exec(content)?.[1]?.trim();
  return {
    kind: isEntityKind(meta.kind) ? meta.kind : "competitor",
    title: (meta.title || heading || fallback.name).slice(0, MAX_TITLE_CHARS),
    summary: meta.summary ?? "",
    capacity: meta.capacity ?? "",
    nextLabel: meta.next_label ?? "",
    nextDate: meta.next_date ?? "",
    // A file that never names a health state has never been collected from.
    health: asHealth(meta.health ?? (sources.length > 0 ? "stale" : "unconfigured")),
    checkedAt: meta.checked ?? "",
    change: meta.change ?? "",
    changeAt: meta.change_at ?? "",
    seenAt: meta.seen_at ?? "",
    sources,
    params,
    evidence,
    createdAt: meta.created || fallback.createdAt,
    body: content,
  };
}

// ---------------------------------------------------------------- read

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((file) => file.toLowerCase().endsWith(".md")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readEntityAt(path: string, name: string): Promise<Entity | null> {
  let raw: string;
  let info: { mtime: Date };
  try {
    [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return { name, ...parseEntityFile(raw, { name, createdAt: info.mtime.toISOString() }) };
}

/**
 * `stale` is computed, not stored: a source that last succeeded three weeks ago is stale
 * whether or not anything wrote that word into the file. Hard failures win over age —
 * a parse failure is a broken collector, not merely old news.
 */
export function effectiveHealth(entity: Entity, now: Date = new Date()): Health {
  if (entity.sources.length === 0) {
    return "unconfigured";
  }
  if (entity.health === "failed_fetch" || entity.health === "parse_failed") {
    return entity.health;
  }
  if (!entity.checkedAt) {
    return "stale";
  }
  const age = now.getTime() - new Date(entity.checkedAt).getTime();
  return Number.isFinite(age) && age > STALE_AFTER_DAYS * 86_400_000 ? "stale" : "fresh";
}

export function summarize(entity: Entity, now: Date = new Date()): EntitySummary {
  const { body: _body, evidence: _evidence, ...rest } = entity;
  return {
    ...rest,
    health: effectiveHealth(entity, now),
    unread: Boolean(entity.changeAt) && (!entity.seenAt || entity.changeAt > entity.seenAt),
    // Counted, never stored: the count is always whatever the rows say right now.
    unmet: entity.params.filter((param) => param.status === "unmet").length,
  };
}

async function listIn(dir: string, now: Date): Promise<EntitySummary[]> {
  const files = await listDir(dir);
  const loaded = await Promise.all(
    files.map((file) => {
      const name = file.slice(0, -3);
      return isSafeName(name) ? readEntityAt(join(dir, file), name) : Promise.resolve(null);
    })
  );
  return loaded
    .filter((entity): entity is Entity => entity !== null)
    .map((entity) => summarize(entity, now))
    // Fixed order, never by recency: a board people scan daily must keep its shape
    // or they lose the ability to find a card by where it sits (EV §3).
    .sort((a, b) => ENTITY_KINDS.indexOf(a.kind) - ENTITY_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
}

export async function listEntities(root: string = ENTITIES_ROOT, now: Date = new Date()): Promise<EntitySummary[]> {
  return listIn(root, now);
}

export async function listPendingEntities(root: string = ENTITIES_ROOT, now: Date = new Date()): Promise<EntitySummary[]> {
  return listIn(join(root, PENDING_DIR), now);
}

export async function readEntity(name: string, root: string = ENTITIES_ROOT): Promise<Entity | null> {
  if (!isSafeName(name)) {
    return null;
  }
  return readEntityAt(entityPath(root, name), name);
}

// ---------------------------------------------------------------- write

export type SaveEntityInput = {
  kind: EntityKind;
  title: string;
  summary?: string;
  capacity?: string;
  nextLabel?: string;
  nextDate?: string;
  sources?: string[];
  body?: string;
  /** Model-proposed entities land in `pending/` and never show on the board until adopted. */
  pending?: boolean;
  preferredName?: string;
  now?: () => Date;
};

async function uniqueName(dir: string, base: string): Promise<string> {
  const taken = new Set((await listDir(dir)).map((file) => file.slice(0, -3)));
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, MAX_NAME_CHARS - 4)}-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new EntityError("同名实体过多", 409);
}

export async function saveEntity(input: SaveEntityInput, root: string = ENTITIES_ROOT): Promise<EntitySummary> {
  if (!isEntityKind(input.kind)) {
    throw new EntityError(`未知的实体类型「${String(input.kind)}」`, 400);
  }
  const title = (input.title ?? "").trim();
  if (!title) {
    throw new EntityError("实体缺少名称，未保存。", 400);
  }
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (Buffer.byteLength(body, "utf8") > MAX_ENTITY_BYTES) {
    throw new EntityError(`实体正文超过 ${Math.floor(MAX_ENTITY_BYTES / 1024)}KB，未保存。`, 413);
  }
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const dir = input.pending ? join(root, PENDING_DIR) : root;
  await mkdir(dir, { recursive: true });
  const base = slugifyEntityName(input.preferredName || title) || `entity-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
  const name = await uniqueName(dir, base);
  const sources = (input.sources ?? []).map((url) => url.trim()).filter(Boolean);
  const entity: Omit<Entity, "name"> = {
    params: [],
    kind: input.kind,
    title: title.slice(0, MAX_TITLE_CHARS),
    summary: (input.summary ?? "").trim(),
    capacity: (input.capacity ?? "").trim(),
    nextLabel: (input.nextLabel ?? "").trim(),
    nextDate: (input.nextDate ?? "").trim(),
    health: sources.length > 0 ? "stale" : "unconfigured",
    checkedAt: "",
    change: "",
    changeAt: "",
    seenAt: "",
    sources,
    evidence: [],
    createdAt,
    body,
  };
  await writeFile(entityPath(root, name, input.pending), renderEntityFile(entity), { encoding: "utf8", flag: "wx" });
  return summarize({ name, ...entity }, new Date(createdAt));
}

/** Fields a proposal or a collector may change. Everything else needs a file edit. */
export const UPDATABLE_FIELDS = ["summary", "capacity", "nextLabel", "nextDate", "change", "health", "checkedAt"] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export type UpdateEntityInput = {
  field: UpdatableField;
  value: string;
  /** Required for any second-hand value; the UI and the tools both enforce it. */
  evidence?: Omit<Evidence, "field">;
  now?: () => Date;
};

/**
 * Apply one field change to an entity on disk.
 *
 * `change` also stamps `change_at`, which is what makes the card read as unread. The
 * caller decides whether a change is allowed to land directly or has to go through the
 * pending queue — this function does not: putting that judgement here would let a model
 * that claims a source is official write straight into the base (EV §6).
 */
export async function updateEntity(name: string, input: UpdateEntityInput, root: string = ENTITIES_ROOT): Promise<EntitySummary | null> {
  const entity = await readEntity(name, root);
  if (!entity) {
    return null;
  }
  if (!(UPDATABLE_FIELDS as readonly string[]).includes(input.field)) {
    throw new EntityError(`字段「${input.field}」不可更新`, 400);
  }
  const at = (input.now ?? (() => new Date()))().toISOString();
  const next: Entity = { ...entity };
  if (input.field === "health") {
    next.health = asHealth(input.value);
  } else {
    (next as unknown as Record<string, string>)[input.field] = input.value.trim();
  }
  if (input.field === "change") {
    next.changeAt = at;
  }
  if (input.evidence) {
    next.evidence = [
      ...next.evidence.filter((e) => e.field !== input.field),
      { field: input.field, url: input.evidence.url, at: input.evidence.at || at, locator: input.evidence.locator },
    ];
  }
  const { name: _n, ...rest } = next;
  await writeFile(entityPath(root, name), renderEntityFile(rest), "utf8");
  return summarize(next, new Date(at));
}

export type SetParamInput = {
  name: string;
  value: string;
  /**
   * Omitted keeps whatever the row already says, and a new row starts at `unknown`.
   * Only a person may pass this; `entity-tools` never does (see PARAM_STATES).
   */
  status?: ParamState;
  /** Same rule as a field: a second-hand value must say where it came from. */
  evidence?: Omit<Evidence, "field">;
  now?: () => Date;
};

/**
 * Write one named technical parameter (CR-20260912-technical-spine).
 *
 * Matching is by name, so writing the same name twice UPDATES rather than appends — a
 * requirement that gets restated in a newer document should not turn into two rows
 * saying different numbers. Evidence is keyed by the parameter name, which means the
 * latest write replaces the citation for that parameter and older citations do not
 * accumulate into a pile nobody reads.
 */
export async function setParam(entityName: string, input: SetParamInput, root: string = ENTITIES_ROOT): Promise<EntitySummary | null> {
  const entity = await readEntity(entityName, root);
  if (!entity) {
    return null;
  }
  const paramName = normalizeParamName(input.name);
  if (!paramName) {
    throw new EntityError("参数名不能为空。", 400);
  }
  const value = input.value.replace(/[|\r\n]/g, " ").trim().slice(0, MAX_LINE_CHARS);
  const at = (input.now ?? (() => new Date()))().toISOString();

  const existing = entity.params.find((param) => param.name === paramName);
  if (!existing && entity.params.length >= MAX_PARAMS) {
    throw new EntityError(`一个对象最多 ${MAX_PARAMS} 条参数，请先清理。`, 409);
  }
  const status = input.status ?? existing?.status ?? "unknown";
  const params = existing
    ? entity.params.map((param) => (param.name === paramName ? { name: paramName, value, status } : param))
    : [...entity.params, { name: paramName, value, status }];

  const next: Entity = { ...entity, params };
  if (input.evidence) {
    next.evidence = [
      ...next.evidence.filter((e) => e.field !== paramName),
      { field: paramName, url: input.evidence.url, at: input.evidence.at || at, locator: input.evidence.locator },
    ];
  }
  const { name: _n, ...rest } = next;
  await writeFile(entityPath(root, entityName), renderEntityFile(rest), "utf8");
  return summarize(next, new Date(at));
}

/** Removing a parameter takes its citation with it; a citation for nothing is litter. */
export async function removeParam(entityName: string, paramName: string, root: string = ENTITIES_ROOT): Promise<EntitySummary | null> {
  const entity = await readEntity(entityName, root);
  if (!entity) {
    return null;
  }
  const target = normalizeParamName(paramName);
  const next: Entity = {
    ...entity,
    params: entity.params.filter((param) => param.name !== target),
    evidence: entity.evidence.filter((e) => e.field !== target),
  };
  const { name: _n, ...rest } = next;
  await writeFile(entityPath(root, entityName), renderEntityFile(rest), "utf8");
  return summarize(next);
}

/** Opening the entity's message list is what marks it read (user ruling, 2026-09-11). */
export async function markSeen(name: string, root: string = ENTITIES_ROOT, now: Date = new Date()): Promise<EntitySummary | null> {
  const entity = await readEntity(name, root);
  if (!entity) {
    return null;
  }
  const next: Entity = { ...entity, seenAt: now.toISOString() };
  const { name: _n, ...rest } = next;
  await writeFile(entityPath(root, name), renderEntityFile(rest), "utf8");
  return summarize(next, now);
}

export async function addSource(name: string, url: string, root: string = ENTITIES_ROOT): Promise<EntitySummary | null> {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new EntityError("不是合法的 URL。", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new EntityError("仅支持 http/https。", 400);
  }
  if (parsed.username || parsed.password) {
    throw new EntityError("URL 不得包含用户名或密码。", 400);
  }
  const entity = await readEntity(name, root);
  if (!entity) {
    return null;
  }
  if (entity.sources.includes(trimmed)) {
    throw new EntityError("该源已存在。", 409);
  }
  const next: Entity = { ...entity, sources: [...entity.sources, trimmed] };
  if (next.health === "unconfigured") {
    // It has a source now but has never been collected from: stale, not fresh.
    next.health = "stale";
  }
  const { name: _n, ...rest } = next;
  await writeFile(entityPath(root, name), renderEntityFile(rest), "utf8");
  return summarize(next);
}

export async function removeSource(name: string, url: string, root: string = ENTITIES_ROOT): Promise<EntitySummary | null> {
  const entity = await readEntity(name, root);
  if (!entity) {
    return null;
  }
  const sources = entity.sources.filter((item) => item !== url);
  const next: Entity = { ...entity, sources, health: sources.length === 0 ? "unconfigured" : entity.health };
  const { name: _n, ...rest } = next;
  await writeFile(entityPath(root, name), renderEntityFile(rest), "utf8");
  return summarize(next);
}

export async function deleteEntity(name: string, root: string = ENTITIES_ROOT): Promise<boolean> {
  if (!isSafeName(name)) {
    return false;
  }
  try {
    await rm(entityPath(root, name));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function adoptPendingEntity(name: string, root: string = ENTITIES_ROOT): Promise<EntitySummary | null> {
  if (!isSafeName(name)) {
    return null;
  }
  const from = entityPath(root, name, true);
  const entity = await readEntityAt(from, name);
  if (!entity) {
    return null;
  }
  await mkdir(root, { recursive: true });
  const target = await uniqueName(root, name);
  await rename(from, entityPath(root, target));
  return summarize({ ...entity, name: target });
}

export async function discardPendingEntity(name: string, root: string = ENTITIES_ROOT): Promise<boolean> {
  if (!isSafeName(name)) {
    return false;
  }
  try {
    await rm(entityPath(root, name, true));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
