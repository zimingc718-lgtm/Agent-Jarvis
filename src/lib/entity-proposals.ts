import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ENTITIES_ROOT, EntityError, setParam, setPerson, updateEntity, type EntitySummary, type UpdatableField } from "./entities";

/**
 * The approval queue for field changes (EV-2026-09-11-home-dashboard §6).
 *
 * A proposed entity is a whole file in `entities/pending/`; a proposed FIELD change is
 * much smaller and has to point at an entity that already exists, so it gets its own
 * queue of small JSON records under `entities/proposals/`.
 *
 * `autoApply` is decided by the CALLER, and only ever from the entity's own registered
 * sources. This module deliberately does not look at the URL: keeping the trust rule in
 * one place, at the tool boundary, is what stops a model from talking its way into a
 * direct write.
 */

export const PROPOSALS_DIR = "proposals";
const MAX_PROPOSALS = 200;

export type EntityUpdateProposal = {
  id: string;
  entity: string;
  /**
   * `field` writes one of the seven housekeeping fields; `param` writes a named
   * technical requirement (CR-20260912-technical-spine); `person` writes one org-chart
   * entry (CR-20260918-org-chart-board). Records written before `param` existed carry
   * no `kind` and are read as `field` — the same tolerance the entity files get.
   */
  kind: "field" | "param" | "person";
  /** An `UpdatableField` when `kind` is `field`, a parameter name, or a person's name. */
  field: string;
  /** A `person` record's `value` is `JSON.stringify({title, team, avatarUrl, bio})` — the one field here that is not a single scalar. */
  value: string;
  url: string;
  locator: string;
  createdAt: string;
  /**
   * How the evidence was established (CR-20260912-ingest-extract-chain).
   *
   * `quoted` means a stored entry was named and the quote was found in it verbatim;
   * `inferred` means everything else. The classification is a RESULT of that check, never
   * something the caller declares — a model that could pick its own class would simply
   * file fabrications as conclusions, which is the loophole this closes.
   *
   * The CR calls this «kind=推断»; the field is named `basis` because `kind` was already
   * taken by the field/param axis. Records written before this change carry no `basis`
   * and are read as `inferred`: nothing verified them, so nothing may claim they were.
   */
  basis?: "quoted" | "inferred";
};

export type ProposalOutcome = {
  applied: boolean;
  proposal: EntityUpdateProposal;
  entity?: EntitySummary | null;
  /**
   * Whether this write replaced an existing proposal file rather than adding one
   * (CR-20260912-proposal-id-collision). Callers that report a count must not count an
   * overwrite as a new record: reporting attempts instead of records is exactly how
   * «写入 4 个字段» came out of a call that landed two.
   */
  overwrote: boolean;
};

function proposalsDir(root: string): string {
  const dir = join(root, PROPOSALS_DIR);
  const rootAbs = resolve(root);
  if (!resolve(dir).startsWith(rootAbs + sep)) {
    throw new EntityError("提议目录越界", 400);
  }
  return dir;
}

function isSafeId(id: string): boolean {
  return /^[0-9a-z-]{1,80}$/.test(id);
}

/** Longest readable prefix kept in an id; the rest of the budget belongs to the parts that make it unique. */
const ID_PREFIX_CHARS = 30;

/**
 * A filename-safe id that is unique per (entity, field, millisecond)
 * (CR-20260912-proposal-id-collision).
 *
 * The previous form was `<entity>-<field>-<second>` run through
 * `replace(/[^0-9a-z-]/g, "-")`. Chinese survives none of that: `维谛技术-vertiv` became
 * `-vertiv` and a field named 「液冷方案形态」 became nothing at all, so four proposals
 * filed in the same second shared one id and silently overwrote each other — while the
 * tool reported all four as written. Chinese field names are this product's normal case,
 * so the failure was not an edge.
 *
 * Uniqueness now comes from a content hash rather than from betting that two writes never
 * land in the same instant. The readable prefix stays because that is what let anyone spot
 * the collision in the first place; `\u0000` separates the two inputs so that
 * ("ab", "c") and ("a", "bc") cannot hash alike.
 */
export function proposalId(entity: string, field: string, createdAt: string): string {
  const prefix =
    entity
      .toLowerCase()
      .replace(/[^0-9a-z-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, ID_PREFIX_CHARS)
      .replace(/-+$/, "") || "x";
  const fingerprint = createHash("sha1").update(`${entity}\u0000${field}`).digest("hex").slice(0, 8);
  // Full millisecond precision: the old id stopped at seconds (`slice(0, 14)`).
  const stamp = createdAt.replace(/[^0-9]/g, "");
  return `${prefix}-${fingerprint}-${stamp}`;
}

export type ProposeInput = {
  name: string;
  /** Omitted means a housekeeping field, for callers written before the spine change. */
  kind?: "field" | "param" | "person";
  /** An `UpdatableField`, a parameter name, or a person's name. */
  field: UpdatableField | string;
  value: string;
  evidence: { url: string; at: string; locator: string };
  /** Set by the caller that ran the quote check; omitted means nothing verified this. */
  basis?: "quoted" | "inferred";
};

/** One write, routed by kind. All three paths take the same evidence; none sets a status. */
async function applyProposal(
  proposal: Pick<EntityUpdateProposal, "entity" | "kind" | "field" | "value" | "url" | "locator" | "basis">,
  at: string,
  root: string
): Promise<EntitySummary | null> {
  // The class travels with the evidence (REQ-F-180 ⑥). Dropping it here is what made the
  // tool's own sentence — 「看板上不会与有据可查的字段同等显示」 — untrue.
  const evidence = { url: proposal.url, at, locator: proposal.locator, basis: proposal.basis ?? "inferred" };
  if (proposal.kind === "param") {
    return setParam(proposal.entity, { name: proposal.field, value: proposal.value, evidence, now: () => new Date(at) }, root);
  }
  if (proposal.kind === "person") {
    let parsed: { title?: string; team?: string; avatarUrl?: string; bio?: string };
    try {
      parsed = JSON.parse(proposal.value) as typeof parsed;
    } catch {
      parsed = {};
    }
    return setPerson(
      proposal.entity,
      { name: proposal.field, title: parsed.title ?? "", team: parsed.team, avatarUrl: parsed.avatarUrl, bio: parsed.bio, evidence, now: () => new Date(at) },
      root
    );
  }
  return updateEntity(
    proposal.entity,
    { field: proposal.field as UpdatableField, value: proposal.value, evidence, now: () => new Date(at) },
    root
  );
}

export async function proposeEntityUpdate(
  input: ProposeInput,
  opts: { root?: string; autoApply?: boolean; now?: () => Date } = {}
): Promise<ProposalOutcome> {
  const root = opts.root ?? ENTITIES_ROOT;
  const createdAt = (opts.now ?? (() => new Date()))().toISOString();
  const proposal: EntityUpdateProposal = {
    id: proposalId(input.name, input.field, createdAt),
    entity: input.name,
    kind: input.kind ?? "field",
    field: input.field,
    value: input.value,
    url: input.evidence.url,
    locator: input.evidence.locator,
    createdAt,
    basis: input.basis ?? "inferred",
  };

  if (opts.autoApply) {
    const entity = await applyProposal(proposal, createdAt, root);
    return { applied: true, proposal, entity, overwrote: false };
  }

  const dir = proposalsDir(root);
  await mkdir(dir, { recursive: true });
  const existing = await listProposalFiles(dir);
  if (existing.length >= MAX_PROPOSALS) {
    throw new EntityError("待采纳的字段提议过多，请先处理。", 409);
  }
  const path = join(dir, `${proposal.id}.json`);
  // Report replacement rather than let a caller count it as a new record.
  const overwrote = await stat(path).then(
    () => true,
    () => false
  );
  await writeFile(path, JSON.stringify(proposal, null, 2) + "\n", "utf8");
  return { applied: false, proposal, overwrote };
}

async function listProposalFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function listProposals(root: string = ENTITIES_ROOT): Promise<EntityUpdateProposal[]> {
  const dir = proposalsDir(root);
  const files = await listProposalFiles(dir);
  const loaded = await Promise.all(
    files.map(async (file) => {
      try {
        const parsed = JSON.parse(await readFile(join(dir, file), "utf8")) as EntityUpdateProposal;
        return parsed && typeof parsed.entity === "string" ? parsed : null;
      } catch {
        return null;
      }
    })
  );
  return loaded.filter((item): item is EntityUpdateProposal => item !== null);
}

export async function adoptProposal(id: string, root: string = ENTITIES_ROOT): Promise<EntitySummary | null> {
  if (!isSafeId(id)) {
    return null;
  }
  const dir = proposalsDir(root);
  let proposal: EntityUpdateProposal;
  try {
    proposal = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")) as EntityUpdateProposal;
  } catch {
    return null;
  }
  const entity = await applyProposal(
    { ...proposal, kind: proposal.kind === "param" || proposal.kind === "person" ? proposal.kind : "field" },
    proposal.createdAt,
    root
  );
  // Drop the record either way: a proposal pointing at a deleted entity is not something
  // to keep re-offering.
  await rm(join(dir, `${id}.json`), { force: true });
  return entity;
}

export async function discardProposal(id: string, root: string = ENTITIES_ROOT): Promise<boolean> {
  if (!isSafeId(id)) {
    return false;
  }
  const path = join(proposalsDir(root), `${id}.json`);
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
