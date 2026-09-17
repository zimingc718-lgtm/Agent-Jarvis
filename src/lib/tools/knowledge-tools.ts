import { ENTITIES_ROOT, listEntities } from "../entities";
import {
  KNOWLEDGE_ROOT,
  KnowledgeError,
  listKnowledge,
  MAX_ENTRY_BYTES,
  readKnowledge,
  recordSearchMiss,
  saveKnowledge,
  searchKnowledge,
  setDocType,
} from "../knowledge";
import { ingestUrl } from "../ingest";
import { truncateToTokens } from "./budget";
import { TOOL_PRIORITY, type ToolDescriptor } from "./registry";

/**
 * Knowledge as tools (REQ-F-045, REQ-F-046 ③; TASK-083).
 *
 * `search_knowledge` and `read_knowledge` are read-only and register only when the base
 * has at least one entry, so an empty base costs no prompt budget (REQ-NF-008 ④).
 *
 * `save_knowledge` is the first write-class tool in Jarvis. The A-phase ruling was
 * "read-only tools need no approval; a write tool needs an approval mechanism first".
 * The mechanism here is deliberately minimal: the tool can only *propose* — the entry
 * lands in `pending/`, is invisible to retrieval, and enters the base only when the
 * user adopts it in the ☰ 知识库 list. Nothing the model writes can influence a later
 * turn without a human click in between.
 */

const SEARCH_RESULT_TOKEN_CAP = 2_000;
const READ_RESULT_TOKEN_CAP = 6_000;

/**
 * The one attribution that is not a tracked object (REQ-F-170 ②③).
 *
 * `entity` is required so the base stops growing new orphans, but a note like 「我方产能
 * 约束」 belongs to no competitor, customer or authority. Without an explicit home for it
 * the model would be pushed into inventing an object — so there is one, and the board
 * shows it as a real group rather than folding it into 未分类.
 */
export const GENERAL_ENTITY = "__通用__";

/** A listing has to fit a tool result; past this only the per-object counts are returned. */
const LIST_PAGE_SIZE = 30;

export type KnowledgeToolDeps = { root?: string; entitiesRoot?: string };

export function createKnowledgeTools(deps: KnowledgeToolDeps = {}): ToolDescriptor[] {
  const root = deps.root ?? KNOWLEDGE_ROOT;
  const entitiesRoot = deps.entitiesRoot ?? ENTITIES_ROOT;

  const search: ToolDescriptor = {
    name: "search_knowledge",
    priority: TOOL_PRIORITY.essential,
    description: "在本地知识库中按关键词检索，返回最相关条目的名称、标题与片段。需要全文时再调 read_knowledge。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词或一句话" },
        limit: { type: "integer", description: "最多返回几条（默认 5，上限 20）" },
      },
      required: ["query"],
    },
    available: (context) => context.knowledgeCount > 0,
    async execute(args) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { ok: false, content: "缺少参数 query。", summary: "参数缺失" };
      }
      const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : 5;
      const hits = await searchKnowledge(query, limit, root);
      if (hits.length === 0) {
        // A miss is the gap signal the board shows; record it before answering.
        await recordSearchMiss(query, root);
        return { ok: true, content: `知识库中没有与「${query}」相关的条目。`, summary: `知识检索无结果：${query}` };
      }
      // Each hit says whose it is (REQ-F-170 ⑤): grouping hits by object is what the list
      // is for, and the absolute URL can wait for `read_knowledge` — five hits carrying a
      // full metadata header each would be five times the cost for one useful field.
      const lines = hits.map(
        (hit) => `- ${hit.name}｜${hit.title}｜归属 ${hit.entity || "（无）"}：${hit.snippet}`
      );
      const { text, truncated } = truncateToTokens(lines.join("\n"), SEARCH_RESULT_TOKEN_CAP);
      return {
        ok: true,
        content: text,
        summary: `知识检索到 ${hits.length} 条${truncated ? "（已截断）" : ""}`,
      };
    },
  };

  const read: ToolDescriptor = {
    name: "read_knowledge",
    priority: TOOL_PRIORITY.essential,
    description: "读取知识库中一个条目的全文。参数 name 为 search_knowledge 返回的条目名称。",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "条目名称" } },
      required: ["name"],
    },
    available: (context) => context.knowledgeCount > 0,
    async execute(args) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) {
        return { ok: false, content: "缺少参数 name。", summary: "参数缺失" };
      }
      const entry = await readKnowledge(name, root);
      if (!entry) {
        return {
          ok: false,
          content: `知识库中没有名为「${name}」的条目。可先用 search_knowledge 检索。`,
          summary: `知识条目不存在：${name}`,
        };
      }
      // The metadata leads (REQ-F-170 ④). It was stored all along and returned to nobody,
      // so the model reported an attributed entry as 「未归属」 and quoted a relative link
      // out of the page body as its source.
      const header = [
        `归属：${entry.entity || "（无）"}`,
        `类型：${entry.docType || "（无）"}`,
        `来源：${entry.sourceUrl || "（无）"}`,
      ].join("\n");
      const { text, truncated } = truncateToTokens(
        `# ${entry.title}\n\n${header}\n\n---\n\n${entry.content}`,
        READ_RESULT_TOKEN_CAP
      );
      return { ok: true, content: text, summary: `读取知识 ${entry.title}${truncated ? "（已截断）" : ""}` };
    },
  };

  const save: ToolDescriptor = {
    name: "save_knowledge",
    priority: TOOL_PRIORITY.management,
    description: "把值得长期记住的内容提议存入本地知识库（决定、偏好、事实）。进入待采纳区，用户采纳后才可被检索。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "条目标题，一句话" },
        content: { type: "string", description: "条目正文，Markdown" },
        entity: { type: "string", description: `归属对象名（来自 list_entities）；不属于任何对象时填 ${GENERAL_ENTITY}` },
        source_url: { type: "string", description: "该内容的原始链接" },
        doc_type: { type: "string", description: "厂商新闻稿 / 标准说明书 / 技术论文 等" },
      },
      required: ["title", "content", "entity"],
    },
    available: () => true,
    async execute(args) {
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const content = typeof args.content === "string" ? args.content : "";
      const entity = typeof args.entity === "string" ? args.entity.trim() : "";
      const sourceUrl = typeof args.source_url === "string" ? args.source_url.trim() : "";
      const docType = typeof args.doc_type === "string" ? args.doc_type.trim() : "";

      // Required, and checked against the real objects (REQ-F-170 ②). Optional attribution
      // does not stop new orphans from appearing, and orphans are what made the board's
      // per-object counts structurally empty.
      if (!entity) {
        const known = (await listEntities(entitiesRoot)).map((item) => item.name);
        return {
          ok: false,
          content: `entity 是必填：请给出归属对象，或填 ${GENERAL_ENTITY} 表示不属于任何对象。现有对象：${known.join("、") || "（还没有）"}。`,
          summary: "缺少归属对象",
        };
      }
      if (entity !== GENERAL_ENTITY) {
        const known = (await listEntities(entitiesRoot)).map((item) => item.name);
        if (!known.includes(entity)) {
          return {
            ok: false,
            content: `没有名为「${entity}」的跟踪对象。现有对象：${known.join("、") || "（还没有）"}；不属于任何对象时填 ${GENERAL_ENTITY}。`,
            summary: `对象不存在：${entity}`,
          };
        }
      }

      try {
        const saved = await saveKnowledge(
          { title, content, source: "model", pending: true, entity, sourceUrl, docType },
          root
        );
        return {
          ok: true,
          content: `已提议知识条目「${saved.title}」（${saved.name}），放入待采纳区；用户在 ☰ 菜单「知识库」中采纳后才会被检索到。`,
          summary: `提议知识：${saved.title}`,
          events: [{ type: "knowledge_pending", name: saved.name, title: saved.title }],
        };
      } catch (error) {
        if (error instanceof KnowledgeError) {
          return { ok: false, content: error.message, summary: "知识未保存" };
        }
        return {
          ok: false,
          content: `知识保存失败：${error instanceof Error ? error.message : "未知错误"}（上限 ${Math.floor(MAX_ENTRY_BYTES / 1024)}KB）`,
          summary: "知识保存失败",
        };
      }
    },
  };

  const ingest: ToolDescriptor = {
    name: "ingest_url",
    priority: TOOL_PRIORITY.management,
    description: "把一个网页抓下来存成知识条目：只存正文与原链接，不存原件。参数 url，可选 entity 与 doc_type。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "网页链接" },
        entity: { type: "string", description: "归属的跟踪对象名称，留空则进无归属桶" },
        doc_type: { type: "string", description: "产品规格书 / 标准说明书 / 技术论文 等" },
      },
      required: ["url"],
    },
    // Outbound, so it follows the same switch as the other web tools (REQ-F-038 ④).
    available: (context) => context.webEnabled,
    async execute(args, context) {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!url) {
        return { ok: false, content: "缺少参数 url。", summary: "参数缺失" };
      }
      const outcome = await ingestUrl(url, {
        knowledgeRoot: root,
        entity: typeof args.entity === "string" ? args.entity : "",
        docType: typeof args.doc_type === "string" ? args.doc_type : "",
        signal: context.signal,
      });
      if (!outcome.ok) {
        // The reason travels to the step row too (CR-20260912-ingest-extract-chain);
        // 「未入库」 on its own is what the model had to guess around.
        return { ok: false, content: outcome.reason, summary: `未入库：${outcome.reason.split(/[。；]/u)[0] ?? ""}` };
      }
      return {
        ok: true,
        content: `已存为知识条目「${outcome.entry.title}」（${outcome.entry.name}，正文 ${outcome.chars} 字）。${outcome.reason}`,
        summary: outcome.pending ? `待采纳：${outcome.entry.title}` : `已入库：${outcome.entry.title}`,
        sources: [{ url, title: outcome.entry.title }],
      };
    },
  };

  const list: ToolDescriptor = {
    name: "list_knowledge",
    // Without it the model can only guess keywords — a silent degradation, which is
    // exactly what `essential` is for (CR-20260912-tool-budget).
    priority: TOOL_PRIORITY.essential,
    description: "列出知识库里有什么：按归属对象分组计数，并返回条目名称、标题与类型。可用 entity 过滤。",
    parameters: {
      type: "object",
      properties: {
        entity: { type: "string", description: "只看某个归属对象，留空为全部" },
        offset: { type: "integer", description: "从第几条开始（默认 0）" },
      },
    },
    // Registers even at zero entries (REQ-F-171 ④), unlike the other read tools: the model
    // has to be able to answer 「库是空的」 and say what to do about it. Taking stock of an
    // empty base by keyword guessing was measured at 15 fruitless searches.
    available: () => true,
    async execute(args) {
      const wanted = typeof args.entity === "string" ? args.entity.trim() : "";
      const offset = Number.isInteger(args.offset) ? Math.max(0, args.offset as number) : 0;
      const all = await listKnowledge(root);
      if (all.length === 0) {
        return {
          ok: true,
          content: "知识库还是空的。可以用 ingest_url 把一个网页存进来，或让用户拖入文件；存入时要给出归属对象。",
          summary: "知识库为空",
        };
      }

      const counts = new Map<string, number>();
      for (const entry of all) {
        const key = entry.entity || "（无归属）";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const grouped = [...counts.entries()].map(([name, count]) => `${name} ${count} 条`).join("；");

      const rows = wanted ? all.filter((entry) => entry.entity === wanted) : all;
      const page = rows.slice(offset, offset + LIST_PAGE_SIZE);
      const lines = page.map(
        (entry) => `- ${entry.name}｜${entry.title}｜归属 ${entry.entity || "（无）"}｜类型 ${entry.docType || "（无）"}`
      );
      const more = rows.length > offset + page.length ? `\n（还有 ${rows.length - offset - page.length} 条，可用 offset 继续）` : "";
      const { text, truncated } = truncateToTokens(
        `共 ${all.length} 条，按归属：${grouped}\n\n${lines.join("\n")}${more}`,
        SEARCH_RESULT_TOKEN_CAP
      );
      return { ok: true, content: text, summary: `知识库 ${all.length} 条${truncated ? "（已截断）" : ""}` };
    },
  };

  const classify: ToolDescriptor = {
    name: "classify_knowledge",
    priority: TOOL_PRIORITY.management,
    description:
      "修改一条已入库知识条目的类型（如「厂商新闻稿」「标准说明书」）。直接生效，不进待采纳区——这是整理分类，不是改一个需要来源佐证的事实。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "条目名称，来自 list_knowledge / search_knowledge" },
        doc_type: { type: "string", description: "新的类型" },
      },
      required: ["name", "doc_type"],
    },
    // 只对已有条目生效（REQ-F-046 见 CR-20260915-knowledge-library-merge），库为空时必然
    // 找不到条目，和 search/read 一样按 knowledgeCount 收起，不学 save/list 常驻。
    available: (context) => context.knowledgeCount > 0,
    async execute(args) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const docType = typeof args.doc_type === "string" ? args.doc_type.trim() : "";
      if (!name || !docType) {
        return { ok: false, content: "name 与 doc_type 都是必填。", summary: "参数缺失" };
      }
      const updated = await setDocType(name, docType, root);
      if (!updated) {
        return {
          ok: false,
          content: `知识库中没有名为「${name}」的条目。可先用 list_knowledge / search_knowledge 确认名称。`,
          summary: `条目不存在：${name}`,
        };
      }
      return { ok: true, content: `已把「${updated.title}」的类型改为「${docType}」。`, summary: `重新分类：${updated.title}` };
    },
  };

  return [search, read, save, ingest, list, classify];
}
