import {
  KNOWLEDGE_ROOT,
  KnowledgeError,
  MAX_ENTRY_BYTES,
  readKnowledge,
  recordSearchMiss,
  saveKnowledge,
  searchKnowledge,
} from "../knowledge";
import { truncateToTokens } from "./budget";
import type { ToolDescriptor } from "./registry";

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

export type KnowledgeToolDeps = { root?: string };

export function createKnowledgeTools(deps: KnowledgeToolDeps = {}): ToolDescriptor[] {
  const root = deps.root ?? KNOWLEDGE_ROOT;

  const search: ToolDescriptor = {
    name: "search_knowledge",
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
      const lines = hits.map((hit) => `- ${hit.name}｜${hit.title}：${hit.snippet}`);
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
      // One read must not eat the turn (REQ-NF-013 ③, mirroring read_skill).
      const { text, truncated } = truncateToTokens(`# ${entry.title}\n\n${entry.content}`, READ_RESULT_TOKEN_CAP);
      return { ok: true, content: text, summary: `读取知识 ${entry.title}${truncated ? "（已截断）" : ""}` };
    },
  };

  const save: ToolDescriptor = {
    name: "save_knowledge",
    description: "把值得长期记住的内容提议存入本地知识库（决定、偏好、事实）。进入待采纳区，用户采纳后才可被检索。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "条目标题，一句话" },
        content: { type: "string", description: "条目正文，Markdown" },
      },
      required: ["title", "content"],
    },
    available: () => true,
    async execute(args) {
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const content = typeof args.content === "string" ? args.content : "";
      try {
        const saved = await saveKnowledge({ title, content, source: "model", pending: true }, root);
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

  return [search, read, save];
}
