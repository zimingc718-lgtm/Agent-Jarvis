import { ENTITIES_ROOT, readEntity } from "./entities";
import { KNOWLEDGE_ROOT, MAX_ENTRY_BYTES, saveKnowledge, type KnowledgeSummary } from "./knowledge";
import { fetchReadable, type FetchSourceDeps } from "./sources";

/**
 * Turning a link into a knowledge entry (CR-20260911-home-dashboard, 出口义务 5).
 *
 * The agreed storage shape, and each third of it earns its place: keep the EXTRACTED
 * TEXT so retrieval has something to match on locally, keep the ORIGINAL LINK so the
 * entry stays checkable after the page changes, and keep NO original file — a PDF is
 * megabytes of bytes nobody searches. Saving space was never the reason; link rot and
 * un-searchable attachments were.
 *
 * Whether an ingested page lands in the base or in the pending queue follows the same
 * rule as a field update: a page from a source the user already registered on that
 * entity is trusted, anything else waits for a click. The model picks WHAT to ingest,
 * so unattributed pages do not get to walk straight in.
 */

export type IngestOutcome =
  | { ok: true; entry: KnowledgeSummary; pending: boolean; chars: number; reason: string }
  | { ok: false; reason: string };

export type IngestDeps = FetchSourceDeps & {
  entitiesRoot?: string;
  knowledgeRoot?: string;
  /** Which tracked entity this belongs to; empty lands it in the unowned bucket. */
  entity?: string;
  docType?: string;
  /** Overrides the page title when the caller knows better. */
  title?: string;
  /** Force the pending queue regardless of the source check (the model path uses this). */
  alwaysPending?: boolean;
  /**
   * The caller is the user acting directly, so the source whitelist does not apply.
   * That gate exists to stop the MODEL walking an unattributed page into the base;
   * a person pasting a link has already made the judgement it is checking for.
   */
  trustCaller?: boolean;
};

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

export async function ingestUrl(url: string, deps: IngestDeps = {}): Promise<IngestOutcome> {
  const entitiesRoot = deps.entitiesRoot ?? ENTITIES_ROOT;
  const knowledgeRoot = deps.knowledgeRoot ?? KNOWLEDGE_ROOT;
  const entityName = (deps.entity ?? "").trim();

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, reason: "不是合法的 URL。" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "仅支持 http/https。" };
  }

  // Resolve trust before fetching: an unknown entity name is a caller mistake, and
  // there is no point spending a request on it.
  let trusted = false;
  if (entityName) {
    const entity = await readEntity(entityName, entitiesRoot);
    if (!entity) {
      return { ok: false, reason: `没有名为「${entityName}」的跟踪对象。` };
    }
    trusted = entity.sources.some((registered) => sameHost(registered, url));
  }

  const readable = await fetchReadable(url, deps);
  if (!readable.ok) {
    return { ok: false, reason: readable.detail };
  }
  if (Buffer.byteLength(readable.text, "utf8") > MAX_ENTRY_BYTES) {
    return { ok: false, reason: `正文超过 ${Math.floor(MAX_ENTRY_BYTES / 1024)}KB，未入库。请改为摘录关键段落。` };
  }

  const pending = deps.alwaysPending === true || (deps.trustCaller !== true && !trusted);
  const title = (deps.title ?? readable.title ?? "").trim() || parsed.hostname;
  const entry = await saveKnowledge(
    {
      title,
      content: readable.text,
      source: "file",
      entity: entityName,
      docType: (deps.docType ?? "").trim(),
      sourceUrl: parsed.toString(),
      pending,
      preferredName: title,
    },
    knowledgeRoot
  );

  return {
    ok: true,
    entry,
    pending,
    chars: readable.text.length,
    reason: pending
      ? entityName
        ? `${parsed.host} 不在「${entityName}」已登记的采集源内，已放入待采纳区。`
        : "未指定归属对象，已放入待采纳区。"
      : trusted
        ? `来源在「${entityName}」已登记的采集源内，已直接入库。`
        : "由你直接添加，已入库。",
  };
}
