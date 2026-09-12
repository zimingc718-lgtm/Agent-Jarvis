import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ENTITIES_ROOT, EntityError, setParam, updateEntity, type EntitySummary, type UpdatableField } from "./entities";

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
   * technical requirement (CR-20260912-technical-spine). Records written before that CR
   * carry no `kind` and are read as `field` — the same tolerance the entity files get.
   */
  kind: "field" | "param";
  /** An `UpdatableField` when `kind` is `field`, otherwise the parameter's name. */
  field: string;
  value: string;
  url: string;
  locator: string;
  createdAt: string;
};

export type ProposalOutcome = {
  applied: boolean;
  proposal: EntityUpdateProposal;
  entity?: EntitySummary | null;
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

export type ProposeInput = {
  name: string;
  /** Omitted means a housekeeping field, for callers written before the spine change. */
  kind?: "field" | "param";
  /** An `UpdatableField`, or a parameter name when `kind` is `param`. */
  field: UpdatableField | string;
  value: string;
  evidence: { url: string; at: string; locator: string };
};

/** One write, routed by kind. Both paths take the same evidence; neither sets a status. */
async function applyProposal(
  proposal: Pick<EntityUpdateProposal, "entity" | "kind" | "field" | "value" | "url" | "locator">,
  at: string,
  root: string
): Promise<EntitySummary | null> {
  const evidence = { url: proposal.url, at, locator: proposal.locator };
  return proposal.kind === "param"
    ? setParam(proposal.entity, { name: proposal.field, value: proposal.value, evidence, now: () => new Date(at) }, root)
    : updateEntity(
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
    // A parameter name may be Chinese; the id keeps only characters a filename likes,
    // and the timestamp keeps two proposals for the same parameter apart.
    id: `${input.name}-${input.field}-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`
      .toLowerCase()
      .replace(/[^0-9a-z-]/g, "-")
      .replace(/-{2,}/g, "-"),
    entity: input.name,
    kind: input.kind ?? "field",
    field: input.field,
    value: input.value,
    url: input.evidence.url,
    locator: input.evidence.locator,
    createdAt,
  };

  if (opts.autoApply) {
    const entity = await applyProposal(proposal, createdAt, root);
    return { applied: true, proposal, entity };
  }

  const dir = proposalsDir(root);
  await mkdir(dir, { recursive: true });
  const existing = await listProposalFiles(dir);
  if (existing.length >= MAX_PROPOSALS) {
    throw new EntityError("待采纳的字段提议过多，请先处理。", 409);
  }
  await writeFile(join(dir, `${proposal.id}.json`), JSON.stringify(proposal, null, 2) + "\n", "utf8");
  return { applied: false, proposal };
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
    { ...proposal, kind: proposal.kind === "param" ? "param" : "field" },
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
