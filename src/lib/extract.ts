import {
  ENTITIES_ROOT,
  isReservedParamName,
  MAX_PARAM_NAME_CHARS,
  normalizeParamName,
  readEntity,
  UPDATABLE_FIELDS,
} from "./entities";
import { proposeEntityUpdate } from "./entity-proposals";
import { KNOWLEDGE_ROOT, readKnowledge } from "./knowledge";

/**
 * Filing a field value that came out of a stored document
 * (CR-20260911-home-dashboard, 出口义务 5 的第三步).
 *
 * EV §12.3 names the risk plainly: a wrong capacity number looks exactly like a right
 * one on the board, and the evidence chain is the only backstop. So this module is
 * built around one idea — the extraction itself must come from the model, but the
 * EVIDENCE for it can be machine-checked, and here it is:
 *
 *   ① the entry has to exist locally (the value came from something we actually store),
 *   ② the quote has to appear VERBATIM in that entry's text, and
 *   ③ the value has to appear INSIDE the quote.
 *
 * ② stops a fabricated citation: a model cannot supply a sentence the document does not
 * contain. ③ stops the subtler failure, where the quote is real but the number drifted
 * away from it on the way out. Neither check can tell whether the model READ the number
 * correctly in context — that stays a human matter — but together they mean every field
 * on the board can be traced to text that is on this machine.
 *
 * 参数即主轴（CR-20260912-technical-spine）：七个固定字段之外的名字一律按**具名技术参数**
 * 写入。参数只带「值 + 证据」，**不带我方是否满足**——那是关于我们自己的判断，任何来源
 * 页面里都没有，只有人能填。
 *
 * Whether a verified claim lands directly or waits follows the same rule as everywhere
 * else: the entry's own source link, compared against the entity's registered sources.
 * The judgement stays at the tool boundary; this module is handed `trustedHost` logic
 * only through `readEntity`, exactly as `propose_entity_update` does it.
 */

/** Per call. A model filing twenty fields at once is not reading carefully. */
export const MAX_CLAIMS = 8;
/** A quote is a sentence or a table row, not a section. */
export const MAX_QUOTE_CHARS = 400;

export type FieldClaim = { field: string; value: string; quote: string };

export type ClaimOutcome = {
  field: string;
  /** `field` for one of the seven housekeeping fields, `param` for a named requirement. */
  kind: "field" | "param";
  value: string;
  /** `applied` went straight onto the entity; `queued` is waiting for the user. */
  status: "applied" | "queued" | "rejected";
  reason: string;
};

export type ExtractOutcome =
  | { ok: false; reason: string }
  | { ok: true; entity: string; entryName: string; sourceUrl: string; results: ClaimOutcome[] };

export type ExtractDeps = {
  entitiesRoot?: string;
  knowledgeRoot?: string;
  now?: () => Date;
};

/**
 * Whitespace is the only thing normalised before comparing — and it is removed, not
 * collapsed.
 *
 * Extracted page text carries line breaks and runs of spaces wherever the original
 * markup had them, and a model quoting a sentence will not reproduce them. Collapsing
 * runs to a single space is not enough: a line break inside a CJK sentence collapses to
 * a space that the original, which had none, does not contain, so a perfectly honest
 * quote reads as fabricated. Dropping whitespace entirely is the comparison that matches
 * what is actually being asserted — this text is in that document.
 *
 * Everything else — digits, units, wording — still has to match character for character,
 * because that is precisely what is being checked. Case is folded for Latin only in
 * effect; CJK has no case.
 */
function normalize(text: string): string {
  return text.replace(/\s+/gu, "").toLowerCase();
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

export async function extractFields(
  input: { entity: string; entryName: string; claims: FieldClaim[] },
  deps: ExtractDeps = {}
): Promise<ExtractOutcome> {
  const entitiesRoot = deps.entitiesRoot ?? ENTITIES_ROOT;
  const knowledgeRoot = deps.knowledgeRoot ?? KNOWLEDGE_ROOT;
  const entityName = input.entity.trim();
  const entryName = input.entryName.trim();

  if (!entityName || !entryName) {
    return { ok: false, reason: "entity 与 entry 都是必填。" };
  }
  if (input.claims.length === 0) {
    return { ok: false, reason: "没有要写入的字段。" };
  }
  if (input.claims.length > MAX_CLAIMS) {
    return { ok: false, reason: `一次最多 ${MAX_CLAIMS} 个字段，请分批并逐条给出原文。` };
  }

  const entity = await readEntity(entityName, entitiesRoot);
  if (!entity) {
    return { ok: false, reason: `没有名为「${entityName}」的跟踪对象。` };
  }
  const entry = await readKnowledge(entryName, knowledgeRoot);
  if (!entry) {
    return { ok: false, reason: `知识库里没有名为「${entryName}」的条目。只能从已入库的材料里抽字段。` };
  }
  if (!entry.sourceUrl) {
    return { ok: false, reason: `条目「${entry.title}」没有原始链接，抽出来的值无处溯源，不写入。` };
  }

  // Trust is a property of where the DOCUMENT came from, not of what the model says
  // about it — the same rule `propose_entity_update` applies to a bare URL.
  const trusted = entity.sources.some((registered) => sameHost(registered, entry.sourceUrl));
  const haystack = normalize(entry.content);
  const now = deps.now ?? (() => new Date());

  const results: ClaimOutcome[] = [];
  for (const claim of input.claims) {
    const field = claim.field.trim();
    const value = claim.value.trim();
    const quote = claim.quote.trim();

    // Anything outside the seven housekeeping fields is a NAMED TECHNICAL PARAMETER
    // (CR-20260912-technical-spine). That is the board's spine, so the common case has
    // to be the easy one: the model writes 「LVRT 持续时间」 and it lands as a
    // requirement, with no second argument to get wrong.
    const isField = (UPDATABLE_FIELDS as readonly string[]).includes(field);
    const kind: "field" | "param" = isField ? "field" : "param";

    if (!field || !value || !quote) {
      results.push({ field, kind, value, status: "rejected", reason: "field、value、quote 都是必填，缺一不写。" });
      continue;
    }
    if (!isField && isReservedParamName(field)) {
      results.push({
        field,
        kind,
        value,
        status: "rejected",
        reason: `「${field}」是对象自身的结构字段，不能当作技术参数。可用字段：${UPDATABLE_FIELDS.join("、")}。`,
      });
      continue;
    }
    if (!isField && normalizeParamName(field) !== field) {
      results.push({
        field,
        kind,
        value,
        status: "rejected",
        reason: `参数名需为单行、不含「|」、不超过 ${MAX_PARAM_NAME_CHARS} 字。`,
      });
      continue;
    }
    if (quote.length > MAX_QUOTE_CHARS) {
      results.push({ field, kind, value, status: "rejected", reason: `原文超过 ${MAX_QUOTE_CHARS} 字，请只引与该值相关的一句或一行。` });
      continue;
    }
    if (!haystack.includes(normalize(quote))) {
      results.push({ field, kind, value, status: "rejected", reason: "这句原文不在该条目里。不能凭记忆引用，只能引条目中确实存在的文字。" });
      continue;
    }
    if (!normalize(quote).includes(normalize(value))) {
      results.push({ field, kind, value, status: "rejected", reason: "值没有出现在所引原文里。值必须能在原文中逐字找到。" });
      continue;
    }

    const record = await proposeEntityUpdate(
      {
        name: entityName,
        kind,
        field,
        value,
        evidence: { url: entry.sourceUrl, at: "", locator: `条目 ${entry.name}：${quote}` },
      },
      { root: entitiesRoot, autoApply: trusted, now }
    );
    results.push({
      field,
      kind,
      value,
      status: record.applied ? "applied" : "queued",
      reason: record.applied
        ? "原文核对通过，来源在该对象已登记的采集源内，已直接生效。"
        : "原文核对通过；来源不在该对象已登记的采集源内，待你在看板上采纳。",
    });
  }

  return { ok: true, entity: entityName, entryName: entry.name, sourceUrl: entry.sourceUrl, results };
}
