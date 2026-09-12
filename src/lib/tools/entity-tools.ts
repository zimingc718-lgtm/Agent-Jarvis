import {
  adoptPendingEntity as _adopt,
  ENTITIES_ROOT,
  EntityError,
  isEntityKind,
  KIND_LABEL,
  HEALTH_LABEL,
  listEntities,
  readEntity,
  saveEntity,
  UPDATABLE_FIELDS,
  type EntityKind,
  type UpdatableField,
} from "../entities";
import { fetchSource } from "../sources";
import { truncateToTokens } from "./budget";
import type { ToolDescriptor } from "./registry";

/**
 * Entity tools (EV-2026-09-11-home-dashboard §8; CR-20260911-home-dashboard).
 *
 * Read tools are plain reads. The two write tools can only PROPOSE: an entity or a
 * field change the model produces lands in `pending/` and is invisible to the board
 * until the user adopts it. That is the same approval mechanism C 期 established for
 * knowledge, applied to the thing the board is actually made of.
 *
 * The one judgement deliberately NOT left to the model is whether a source counts as
 * authoritative. A model that can declare "this is the official site" can write straight
 * into the base, and the user's rule — accuracy first, 没有就没有 — becomes decorative.
 * Direct writes are gated on the entity's registered source list, checked here.
 */

const LIST_TOKEN_CAP = 1_500;
const READ_TOKEN_CAP = 4_000;

export type EntityToolDeps = { root?: string; knowledgeRoot?: string };

function describe(kind: EntityKind): string {
  return KIND_LABEL[kind];
}

export function createEntityTools(deps: EntityToolDeps = {}): ToolDescriptor[] {
  const root = deps.root ?? ENTITIES_ROOT;
  const knowledgeRoot = deps.knowledgeRoot;

  const list: ToolDescriptor = {
    name: "list_entities",
    description: "列出看板跟踪的对象：友商、规则与准入方、客户。可用 kind 过滤。返回名称、标题、状态与采集健康度。",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", description: "competitor / authority / customer，留空为全部" } },
    },
    available: () => true,
    async execute(args) {
      const kind = typeof args.kind === "string" ? args.kind.trim() : "";
      if (kind && !isEntityKind(kind)) {
        return { ok: false, content: `未知的类型「${kind}」。可用：competitor、authority、customer。`, summary: "参数错误" };
      }
      const all = await listEntities(root);
      const rows = kind ? all.filter((entity) => entity.kind === kind) : all;
      if (rows.length === 0) {
        return { ok: true, content: "看板上还没有跟踪对象。", summary: "无跟踪对象" };
      }
      const lines = rows.map((entity) => {
        const bits = [
          `${entity.name}｜${describe(entity.kind)}｜${entity.title}`,
          entity.summary,
          entity.capacity ? `容量 ${entity.capacity}` : "",
          entity.nextDate ? `下一步 ${entity.nextLabel || "里程碑"} ${entity.nextDate}` : "",
          entity.unread ? `未读变更：${entity.change}` : "",
          // Always say the collection state: silence from an unconfigured source and
          // silence from a working one look identical without it.
          `采集：${HEALTH_LABEL[entity.health]}`,
        ].filter(Boolean);
        return `- ${bits.join("；")}`;
      });
      const { text, truncated } = truncateToTokens(lines.join("\n"), LIST_TOKEN_CAP);
      return { ok: true, content: text, summary: `列出 ${rows.length} 个对象${truncated ? "（已截断）" : ""}` };
    },
  };

  const read: ToolDescriptor = {
    name: "read_entity",
    description: "读取一个跟踪对象的全部内容：定位、容量、下一步、最新变更、采集源、证据与笔记。参数 name。",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "对象名称，来自 list_entities" } },
      required: ["name"],
    },
    available: () => true,
    async execute(args) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) {
        return { ok: false, content: "缺少参数 name。", summary: "参数缺失" };
      }
      const entity = await readEntity(name, root);
      if (!entity) {
        return { ok: false, content: `没有名为「${name}」的跟踪对象。可先用 list_entities 查看。`, summary: `对象不存在：${name}` };
      }
      const parts = [
        `# ${entity.title}（${describe(entity.kind)}）`,
        entity.summary,
        entity.capacity ? `容量：${entity.capacity}` : "",
        entity.nextDate ? `下一步：${entity.nextLabel || "里程碑"} ${entity.nextDate}` : "",
        entity.change ? `最新变更：${entity.change}（${entity.changeAt}）` : "最新变更：无",
        `采集源：${entity.sources.length > 0 ? entity.sources.join("、") : "未配置"}`,
        entity.evidence.length > 0
          ? `证据：\n${entity.evidence.map((e) => `- ${e.field} ← ${e.url} ${e.locator}`).join("\n")}`
          : "",
        entity.body ? `\n${entity.body}` : "",
      ].filter(Boolean);
      const { text, truncated } = truncateToTokens(parts.join("\n"), READ_TOKEN_CAP);
      return { ok: true, content: text, summary: `读取对象 ${entity.title}${truncated ? "（已截断）" : ""}` };
    },
  };

  const propose: ToolDescriptor = {
    name: "propose_entity",
    description: "提议把一个对象加入看板跟踪。进入待采纳区，用户采纳后才出现在看板上。参数 kind、title、summary。",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", description: "competitor / authority / customer" },
        title: { type: "string", description: "对象名称" },
        summary: { type: "string", description: "一句话定位" },
      },
      required: ["kind", "title"],
    },
    available: () => true,
    async execute(args) {
      const kind = typeof args.kind === "string" ? args.kind.trim() : "";
      if (!isEntityKind(kind)) {
        return { ok: false, content: "kind 必须是 competitor、authority 或 customer 之一。", summary: "参数错误" };
      }
      try {
        const saved = await saveEntity(
          {
            kind,
            title: typeof args.title === "string" ? args.title : "",
            summary: typeof args.summary === "string" ? args.summary : "",
            pending: true,
          },
          root
        );
        return {
          ok: true,
          content: `已提议跟踪对象「${saved.title}」（${saved.name}，${describe(kind)}），放入待采纳区；用户采纳后才会出现在看板上。`,
          summary: `提议对象：${saved.title}`,
        };
      } catch (error) {
        if (error instanceof EntityError) {
          return { ok: false, content: error.message, summary: "对象未保存" };
        }
        throw error;
      }
    },
  };

  const proposeUpdate: ToolDescriptor = {
    name: "propose_entity_update",
    description: "提议修改某个对象的一个字段，必须给出来源链接。来源不在该对象已登记的采集源内时进入待采纳区。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "对象名称" },
        field: { type: "string", description: UPDATABLE_FIELDS.join(" / ") },
        value: { type: "string", description: "新的值" },
        source_url: { type: "string", description: "该值的出处链接" },
        locator: { type: "string", description: "出处定位，如第 3 节表 2" },
      },
      required: ["name", "field", "value", "source_url"],
    },
    available: () => true,
    async execute(args) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const field = typeof args.field === "string" ? args.field.trim() : "";
      const value = typeof args.value === "string" ? args.value.trim() : "";
      const sourceUrl = typeof args.source_url === "string" ? args.source_url.trim() : "";
      const locator = typeof args.locator === "string" ? args.locator.trim() : "";

      if (!name || !field || !value || !sourceUrl) {
        return { ok: false, content: "name、field、value、source_url 都是必填。没有来源的值不写入。", summary: "参数缺失" };
      }
      if (!(UPDATABLE_FIELDS as readonly string[]).includes(field)) {
        return { ok: false, content: `字段「${field}」不可更新。可用：${UPDATABLE_FIELDS.join("、")}。`, summary: "字段不可更新" };
      }
      const entity = await readEntity(name, root);
      if (!entity) {
        return { ok: false, content: `没有名为「${name}」的跟踪对象。`, summary: `对象不存在：${name}` };
      }

      // The whitelist is the entity's own registered sources. The model does not get to
      // assert that a page is official; only a source the user already configured is.
      let host = "";
      try {
        host = new URL(sourceUrl).host;
      } catch {
        return { ok: false, content: "source_url 不是合法的链接。", summary: "来源非法" };
      }
      const trusted = entity.sources.some((registered) => {
        try {
          return new URL(registered).host === host;
        } catch {
          return false;
        }
      });

      const { proposeEntityUpdate } = await import("../entity-proposals");
      const record = await proposeEntityUpdate(
        { name, field: field as UpdatableField, value, evidence: { url: sourceUrl, at: "", locator } },
        { root, autoApply: trusted }
      );

      return {
        ok: true,
        content: record.applied
          ? `已更新「${entity.title}」的 ${field} 为「${value}」，来源在该对象已登记的采集源内，直接生效。`
          : `已提议把「${entity.title}」的 ${field} 改为「${value}」。来源 ${host} 不在该对象已登记的采集源内，需用户在看板上采纳后才生效。`,
        summary: record.applied ? `更新 ${entity.title}.${field}` : `提议更新 ${entity.title}.${field}`,
      };
    },
  };

  const collect: ToolDescriptor = {
    name: "fetch_source",
    description: "立即采集某个对象的一个已登记来源，返回是否有变化，并写回该对象的采集状态。参数 name 与 url。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "对象名称" },
        url: { type: "string", description: "该对象已登记的采集源链接" },
      },
      required: ["name", "url"],
    },
    // Outbound, so it follows the same switch as the other web tools (REQ-F-038 ④).
    available: (context) => context.webEnabled,
    async execute(args, context) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!name || !url) {
        return { ok: false, content: "name 与 url 都是必填。", summary: "参数缺失" };
      }
      try {
        const outcome = await fetchSource(name, url, { root, signal: context.signal });
        return {
          ok: outcome.health === "fresh",
          content: outcome.detail,
          summary: outcome.changed ? `采集到变化：${name}` : outcome.detail,
          sources: [{ url, title: name }],
        };
      } catch (error) {
        if (error instanceof EntityError) {
          return { ok: false, content: error.message, summary: "采集未执行" };
        }
        return { ok: false, content: `采集失败：${error instanceof Error ? error.message : "未知错误"}`, summary: "采集失败" };
      }
    },
  };

  const extract: ToolDescriptor = {
    name: "extract_fields",
    description: "从一条已入库的知识条目里把字段写到对象上。每个字段必须附原文，原文须在条目中逐字存在且包含该值，否则拒绝。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "对象名称" },
        entry: { type: "string", description: "知识条目名（search_knowledge / ingest_url 返回的那个）" },
        fields: {
          type: "array",
          description: "要写入的字段，每项含 field、value、quote 三个键",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: UPDATABLE_FIELDS.join(" / ") },
              value: { type: "string", description: "字段的值" },
              quote: { type: "string", description: "条目里包含该值的原文，逐字照抄" },
            },
            required: ["field", "value", "quote"],
          },
        },
      },
      required: ["name", "entry", "fields"],
    },
    available: () => true,
    async execute(args) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const entry = typeof args.entry === "string" ? args.entry.trim() : "";
      const raw = Array.isArray(args.fields) ? args.fields : [];
      const claims = raw
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => ({
          field: typeof item.field === "string" ? item.field : "",
          value: typeof item.value === "string" ? item.value : "",
          quote: typeof item.quote === "string" ? item.quote : "",
        }));
      if (!name || !entry || claims.length === 0) {
        return { ok: false, content: "name、entry、fields 都是必填，且每个字段都要带原文。", summary: "参数缺失" };
      }

      const { extractFields } = await import("../extract");
      const outcome = await extractFields({ entity: name, entryName: entry, claims }, { entitiesRoot: root, knowledgeRoot });
      if (!outcome.ok) {
        return { ok: false, content: outcome.reason, summary: "未写入" };
      }
      const lines = outcome.results.map((result) => {
        const label = result.status === "applied" ? "已生效" : result.status === "queued" ? "待采纳" : "已拒绝";
        return `${result.field} = ${result.value} —— ${label}：${result.reason}`;
      });
      const written = outcome.results.filter((result) => result.status !== "rejected").length;
      return {
        // A call where every claim failed its evidence check is a failed call: the model
        // must see that, not a cheerful summary of nothing happening.
        ok: written > 0,
        content: `条目「${outcome.entryName}」→ 对象「${name}」：\n${lines.join("\n")}`,
        summary: written > 0 ? `写入 ${written} 个字段：${name}` : `原文核对未通过：${name}`,
        sources: [{ url: outcome.sourceUrl, title: outcome.entryName }],
      };
    },
  };

  return [list, read, propose, proposeUpdate, collect, extract];
}
