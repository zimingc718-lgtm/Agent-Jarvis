import type { Store } from "../store";
import {
  DocumentPathError,
  extractDocumentText,
  listDocuments,
  parseRoots,
  resolveWithinRoots,
  searchDocuments,
  SETTING_DOCUMENT_ROOTS,
  type DocumentRoot,
} from "../documents";
import { libraryRoot, LIBRARY_LABEL, readLedger } from "../library";
import { BUDGET_SHARES, budgetTokens, truncateToTokens } from "./budget";
import { describeArgsProblem, TOOL_PRIORITY, type ToolContext, type ToolDescriptor } from "./registry";

/**
 * Reading the user's own documents where they lie (REQ-F-110, DEC-090, TASK-170).
 *
 * These three register **unconditionally**, including when no folder is configured yet.
 * That is deliberate and it is the lesson from `search_knowledge`: gating a tool on
 * "is there anything to find" made the capability invisible to the model, so it could not
 * even tell the user that a folder had never been set up — it simply answered from memory
 * and nobody could tell (EV-2026-09-12-local-documents §2). It also keeps the stable
 * prefix from changing the moment the first document appears (REQ-NF-008 ①).
 */

const NOT_CONFIGURED =
  "尚未配置本地文档目录，所以我读不到你机器上的原文档。请在 ☰ 菜单「本地文档」中添加一个文件夹（例如放规格书、标准、论文的那个目录），之后我就能检索和阅读其中的原件。";

/**
 * 用户配置的文档根，**外加**资料库（CR-20260915-library-adoption CP-5）。
 *
 * 资料库在仓库里、随版本走，不该要求用户再去「本地文档」里手工添加一遍——那是一步只会
 * 被忘掉的配置。它与用户自己配的目录有一处不同：里面的文件默认**不可见**，见下面的闸。
 */
/** Exported so `/api/documents/raw` (CR-20260915-document-display) resolves the exact same
 * root set the model's own tools see — a raw-byte route computing its own roots would risk
 * silently drifting from what search_documents/read_document consider reachable. */
export function rootsOf(store: Store): DocumentRoot[] {
  const configured = parseRoots(store.getSetting(SETTING_DOCUMENT_ROOTS));
  const library = libraryRoot();
  if (!library || configured.some((root) => root.label === library.label || root.path === library.path)) {
    return configured;
  }
  return [...configured, library];
}

/**
 * 采纳闸（CP-4）：资料库里只有**已采纳**的文件能被对话看见。
 *
 * 被挡住的**要报数**，不能静默过滤——「没有结果」和「有 12 条但还没审」对用户是两件完全
 * 不同的事，而只有后者是他动动手就能解决的。这与知识库 `pending/` 的口径一致
 * （REQ-F-046 ③），也是本项目对「看不见的能力等于不存在」的一贯处理。
 */
async function adoptionGate(): Promise<{
  visible: <T extends { root: string; relPath: string }>(items: T[]) => { kept: T[]; blocked: number };
  blockedNote: (blocked: number) => string;
}> {
  const ledger = await readLedger();
  return {
    visible(items) {
      let blocked = 0;
      const kept = items.filter((item) => {
        if (item.root !== LIBRARY_LABEL) {
          return true;
        }
        if (ledger[item.relPath]?.status === "adopted") {
          return true;
        }
        blocked += 1;
        return false;
      });
      return { kept, blocked };
    },
    blockedNote(blocked) {
      return blocked > 0
        ? `\n\n（资料库里另有 ${blocked} 份相关资料还没审批，未展示。要用的话，在动态屏的「资料库」面板里通过它们。）`
        : "";
    },
  };
}

function capFor(context: ToolContext): number {
  return budgetTokens(context.contextWindow, BUDGET_SHARES.singleToolResult);
}

export function createDocumentTools(store: Store): ToolDescriptor[] {
  const search: ToolDescriptor = {
    name: "search_documents",
    // Without this the model answers from memory and nobody can tell it never looked.
    priority: TOOL_PRIORITY.essential,
    description:
      "在用户本机的原文档里按关键词检索（PDF、Word、Markdown、文本）。返回文档标识、文件名与命中片段。需要全文时再调 read_document。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词或一句话" },
        limit: { type: "integer", description: "最多返回几条（默认 5，上限 20）" },
      },
      required: ["query"],
    },
    available: () => true,
    async execute(args, context, raw) {
      const roots = rootsOf(store);
      if (roots.length === 0) {
        return { ok: false, content: NOT_CONFIGURED, summary: "未配置文档目录" };
      }
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        const problem = describeArgsProblem(raw ?? "", args, ["query"]) ?? "缺少参数 query。";
        return { ok: false, content: problem, summary: "参数缺失" };
      }
      const limit = typeof args.limit === "number" ? args.limit : 5;
      const gate = await adoptionGate();
      // 多要一些再过闸，否则闸挡掉几条就只剩零星结果。
      const raw_ = await searchDocuments(roots, query, Math.min(limit * 4, 80));
      const { kept, blocked } = gate.visible(raw_.hits);
      const { scanned, pending } = raw_;
      const hits = kept.slice(0, limit);
      if (scanned === 0) {
        return {
          ok: true,
          content: `已配置的文档目录里没有可读的文件。支持的格式：PDF、.docx、Markdown、纯文本、CSV、JSON。（旧的 .doc 二进制格式和扫描件 PDF 读不了。）`,
          summary: "文档目录为空",
        };
      }
      if (hits.length === 0) {
        return {
          ok: true,
          content: `在 ${scanned} 份本地文档里没有检索到「${query}」。可以换个说法，或用 list_documents 看看都有哪些文件。${gate.blockedNote(blocked)}`,
          summary: `本地文档无结果：${query}`,
        };
      }
      const lines = hits.map(
        (hit, index) =>
          `${index + 1}. ${hit.id}\n   ${hit.name}（${hit.ext.slice(1).toUpperCase()}，${Math.round(hit.bytes / 1024)} KB，改于 ${hit.modifiedAt.slice(0, 10)}，命中：${hit.matched === "content" ? "正文" : "文件名"}）\n   ${hit.snippet}`
      );
      const note =
        (pending > 0 ? `\n\n（本次只索引了一部分，还有 ${pending} 份较大的文件未读入；再检索一次会继续补上。）` : "") +
        gate.blockedNote(blocked);
      const { text } = truncateToTokens(
        `在 ${scanned} 份本地文档中命中 ${hits.length} 份：\n${lines.join("\n")}${note}`,
        capFor(context)
      );
      return {
        ok: true,
        content: text,
        summary: `本地文档命中 ${hits.length} 份`,
      };
    },
  };

  const read: ToolDescriptor = {
    name: "read_document",
    priority: TOOL_PRIORITY.essential,
    description: "读取一份本机原文档的正文。参数 id 为 search_documents / list_documents 返回的文档标识，形如「目录名/子目录/文件.pdf」。",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "文档标识" } },
      required: ["id"],
    },
    available: () => true,
    async execute(args, context, raw) {
      const roots = rootsOf(store);
      if (roots.length === 0) {
        return { ok: false, content: NOT_CONFIGURED, summary: "未配置文档目录" };
      }
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) {
        const problem = describeArgsProblem(raw ?? "", args, ["id"]) ?? "缺少参数 id。";
        return { ok: false, content: problem, summary: "参数缺失" };
      }
      try {
        const { absPath, relPath, root } = await resolveWithinRoots(id, roots);
        if (root.label === LIBRARY_LABEL) {
          const ledger = await readLedger();
          if (ledger[relPath]?.status !== "adopted") {
            const state = ledger[relPath]?.status === "rejected" ? "已被拒绝" : "还在待采纳区";
            return {
              ok: false,
              content: `「${relPath}」${state}，按约定审批通过后才能查阅。你可以在动态屏的「资料库」面板里处理它。`,
              summary: "资料库：未采纳",
            };
          }
        }
        const { stat } = await import("node:fs/promises");
        const info = await stat(absPath);
        const extracted = await extractDocumentText(absPath, info.size);
        const { text, truncated } = truncateToTokens(extracted.text, capFor(context));
        const note = truncated || extracted.truncated ? "\n\n（正文较长，已按本轮预算截断。需要其它部分可以说明要找什么，我再检索。）" : "";
        return {
          ok: true,
          content: `# ${relPath}\n（来自本机目录「${root.label}」，只读）\n\n${text}${note}`,
          summary: `读取本地文档：${relPath}`,
          // Not a `sources` entry: these are local files, and a citation the user cannot
          // click is worse than none. The path is already in the content above.
        };
      } catch (error) {
        if (error instanceof DocumentPathError) {
          return { ok: false, content: error.message, summary: "文档不可读" };
        }
        return {
          ok: false,
          content: `读取「${id}」失败：${error instanceof Error ? error.message : "未知错误"}。`,
          summary: "文档读取失败",
        };
      }
    },
  };

  const list: ToolDescriptor = {
    name: "list_documents",
    priority: TOOL_PRIORITY.normal,
    description: "列出用户本机文档目录里有哪些可读文件（按修改时间倒序）。用于了解手头有什么资料；找具体内容请用 search_documents。",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", description: "最多列出几条（默认 30，上限 100）" } },
    },
    available: () => true,
    async execute(args, context) {
      const roots = rootsOf(store);
      if (roots.length === 0) {
        return { ok: false, content: NOT_CONFIGURED, summary: "未配置文档目录" };
      }
      const limit = Math.max(1, Math.min(typeof args.limit === "number" ? args.limit : 30, 100));
      const gate = await adoptionGate();
      const listed = gate.visible(await listDocuments(roots));
      const metas = listed.kept;
      if (metas.length === 0) {
        return {
          ok: true,
          content: `已配置的文档目录里没有可读的文件。支持 PDF、.docx、网页存档、Markdown、纯文本、CSV、JSON。${gate.blockedNote(listed.blocked)}`,
          summary: "文档目录为空",
        };
      }
      const shown = metas.slice(0, limit);
      const lines = shown.map(
        (meta) => `- ${meta.id}（${Math.round(meta.bytes / 1024)} KB，改于 ${meta.modifiedAt.slice(0, 10)}）`
      );
      const more =
        (metas.length > shown.length ? `\n（另有 ${metas.length - shown.length} 份未列出，用 search_documents 按关键词找。）` : "") +
        gate.blockedNote(listed.blocked);
      const { text } = truncateToTokens(`本机共 ${metas.length} 份可读文档：\n${lines.join("\n")}${more}`, capFor(context));
      return { ok: true, content: text, summary: `列出 ${shown.length}/${metas.length} 份本地文档` };
    },
  };

  const show: ToolDescriptor = {
    name: "show_document",
    priority: TOOL_PRIORITY.normal,
    description:
      "把展示屏切到一份本机原文档（资料库或本地文档目录），展示屏渲染的是原件而不是提取出来的文本。参数 id 为 search_documents / list_documents 返回的文档标识。",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "文档标识" } },
      required: ["id"],
    },
    available: () => true,
    async execute(args, _context, raw) {
      const roots = rootsOf(store);
      if (roots.length === 0) {
        return { ok: false, content: NOT_CONFIGURED, summary: "未配置文档目录" };
      }
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) {
        const problem = describeArgsProblem(raw ?? "", args, ["id"]) ?? "缺少参数 id。";
        return { ok: false, content: problem, summary: "参数缺失" };
      }
      try {
        // 存在性、越界、目录-vs-文件全部由它一次判完——与 read_document 同一条校验路径，
        // 不能展示的和不能读的是同一批文件。
        const { relPath, root } = await resolveWithinRoots(id, roots);
        if (root.label === LIBRARY_LABEL) {
          const ledger = await readLedger();
          if (ledger[relPath]?.status !== "adopted") {
            const state = ledger[relPath]?.status === "rejected" ? "已被拒绝" : "还在待采纳区";
            return {
              ok: false,
              content: `「${relPath}」${state}，按约定审批通过后才能展示。你可以在动态屏的「资料库」面板里处理它。`,
              summary: "资料库：未采纳",
            };
          }
        }
        store.setDisplayState({ kind: "document", refId: id });
        return {
          ok: true,
          content: `展示屏已切到「${relPath}」。`,
          summary: `展示屏 → 文档：${relPath}`,
        };
      } catch (error) {
        if (error instanceof DocumentPathError) {
          return { ok: false, content: error.message, summary: "文档不可展示" };
        }
        return {
          ok: false,
          content: `展示「${id}」失败：${error instanceof Error ? error.message : "未知错误"}。`,
          summary: "展示失败",
        };
      }
    },
  };

  return [search, read, list, show];
}
