import type { Store } from "../store";
import { DocumentPathError, SETTING_DOCUMENT_ROOTS } from "../documents";
import { archiveInsight, SETTING_ARCHIVE_DIR, type ArchiveFormat } from "../insight-export";
import { describeArgsProblem, TOOL_PRIORITY, type ToolDescriptor } from "./registry";

/** Hard cap on one insight's body (REQ-F-050 ②). Appending past it is refused, not clipped. */
export const MAX_INSIGHT_BYTES = 512 * 1024;

/** Rough section count for the progress line the model gets back after an append. */
function countSections(html: string): number {
  return (html.match(/<h[12][\s>]/gi) ?? []).length;
}

/**
 * Display-screen control as tools (REQ-F-032, REQ-F-023 rewritten; TASK-068).
 *
 * These replace two mechanisms at once: the routing call's `display` field (which lost
 * its host when the router was deleted) and the "last ```html fence of a skill turn"
 * capture (which lost its trigger when "skill turn" stopped being a concept). Both now
 * happen because the model asked, and both take effect **mid-loop** rather than in the
 * post-persist `onFinal` hook — DEC-017 ⑤ as revised.
 */

/** Cheap structural check: enough to reject a stream that was cut mid-tag. */
export function looksLikeCompleteHtml(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const opens = (trimmed.match(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g) ?? []).length;
  const closes = (trimmed.match(/<\/[a-zA-Z][\w-]*>/g) ?? []).length;
  const selfClosing = (trimmed.match(/<[a-zA-Z][\w-]*(\s[^>]*)?\/>/g) ?? []).length;
  if (opens === 0) {
    return false;
  }
  // A trailing `<` or an unterminated tag is the usual shape of a truncated stream.
  if (/<[^>]*$/.test(trimmed)) {
    return false;
  }
  return closes + selfClosing >= Math.max(1, Math.floor((opens - selfClosing) * 0.5));
}

export function createDisplayTools(store: Store): ToolDescriptor[] {
  const home: ToolDescriptor = {
    name: "show_home",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切回标题视图（首页，带开场动画）。用户说「回到首页」「显示标题」时调用。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      store.setDisplayState({ kind: "home", refId: null });
      // REQ-F-102 ①. Clearing the persisted state is not enough on its own: the board is a
      // session stage held in the component, and it outranks `home` when rendering. Without
      // this event the tool reported success while the user went on seeing the board — the
      // regression e2e caught (EV-2026-09-12-stage-reach §1).
      return {
        ok: true,
        content: "展示屏已切回首页。",
        summary: "展示屏 → 首页",
        events: [{ type: "display_stage", stage: "opening" }],
      };
    },
  };

  const board: ToolDescriptor = {
    name: "show_board",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切到知识看板（跟踪对象与知识库总览）。用户说「打开看板」「看一下跟踪对象」时调用。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      // The board sits below a persisted insight, so an insight left on screen would cover
      // it. Clearing to `home` first is what makes the stage visible (REQ-F-102 ②).
      store.setDisplayState({ kind: "home", refId: null });
      return {
        ok: true,
        content: "展示屏已切到知识看板。看板上的内容由用户采纳的条目构成，我不能绕过用户直接改动它。",
        summary: "展示屏 → 知识看板",
        events: [{ type: "display_stage", stage: "board" }],
      };
    },
  };

  const orgChartBoard: ToolDescriptor = {
    name: "show_org_chart_board",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切到组织架构/研发阵型看板（已登记对象的人员：姓名、岗位、团队、简介）。用户说「看一下某公司的组织架构」「研发阵型」时调用。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      // 与 show_board/show_competitor_board 同一条理由：会话态而非持久态，先清到 home
      // 再靠 display_stage 事件切换，避免和 show_home/show_insight 的持久 display_state
      // 打架（CR-20260912-display-stage 已经否决过把它做成第四个 display_state 值）。
      store.setDisplayState({ kind: "home", refId: null });
      return {
        ok: true,
        content: "展示屏已切到组织架构看板。人员信息需要来源链接才能写入——没有来源的名字、岗位不会出现在看板上。",
        summary: "展示屏 → 组织架构看板",
        events: [{ type: "display_stage", stage: "org-chart-board" }],
      };
    },
  };

  const industrySpecComparison: ToolDescriptor = {
    name: "show_industry_spec_comparison",
    priority: TOOL_PRIORITY.normal,
    description:
      "把展示屏切到行业技术指标对比页——横向比较全部已跟踪的友商/规则与准入方/客户三类对象的技术参数。用户说「行业指标对比」「拉个技术指标对比表」「不同厂家的指标放一起看」时调用。与 show_competitor_board 不同：那个只看友商，这个覆盖全部三类跟踪对象。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      // 同 show_board 的道理：先清掉可能残留的持久态洞察，这个阶段才会真的显现出来
      // （REQ-F-102 ②）。
      store.setDisplayState({ kind: "home", refId: null });
      return {
        ok: true,
        content:
          "展示屏已切到行业技术指标对比。对比维度取自各对象已登记的技术参数，逐维度谁更优这类判断请直接问我，不会预先写死在表格里。",
        summary: "展示屏 → 行业技术指标对比",
        events: [{ type: "display_stage", stage: "industry-spec-comparison" }],
      };
    },
  };

  const competitorBoard: ToolDescriptor = {
    name: "show_competitor_board",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切到友商看板（已登记友商的技术参数横向对比表）。用户说「对比一下友商」「友商看板」时调用。",
    parameters: { type: "object", properties: {} },
    available: () => true,
    async execute() {
      // 与 show_board 同一条理由：会话态而非持久态，先清到 home 再靠 display_stage 事件
      // 切换，避免和 show_home/show_insight 的持久 display_state 打架（CR-20260912-
      // display-stage 已经否决过把它做成第四个 display_state 值）。
      store.setDisplayState({ kind: "home", refId: null });
      return {
        ok: true,
        content:
          "展示屏已切到友商看板。表格只列已登记的参数原文，逐维度谁更好由你现在问我——我会读这张表现场判断，不会替你把结论写进表格。",
        summary: "展示屏 → 友商看板",
        events: [{ type: "display_stage", stage: "competitor-board" }],
      };
    },
  };

  const insight: ToolDescriptor = {
    name: "show_insight",
    priority: TOOL_PRIORITY.normal,
    description: "把展示屏切到一份已存在的洞察报告。参数 insightId 为该报告的 id。",
    parameters: {
      type: "object",
      properties: { insightId: { type: "string", description: "洞察 id" } },
      required: ["insightId"],
    },
    available: () => true,
    async execute(args, context, raw) {
      const insightId = typeof args.insightId === "string" ? args.insightId.trim() : "";
      if (!insightId) {
        const problem = describeArgsProblem(raw ?? "", args, ["insightId"]) ?? "缺少参数 insightId。";
        return { ok: false, content: problem, summary: "参数缺失" };
      }
      const record = store.getInsight(insightId);
      // `insights` has no `user_id`; ownership comes from the conversation it hangs off
      // (CP-43). Without this a guessed id would put another conversation's HTML on screen.
      const owner = record ? store.getConversationForUser(context.userId, record.conversationId) : null;
      if (!record || !owner) {
        return {
          ok: false,
          content: `找不到 id 为 ${insightId} 的洞察，或它不属于当前用户。`,
          summary: `洞察不可用：${insightId}`,
        };
      }
      store.setDisplayState({ kind: "insight", refId: insightId });
      return { ok: true, content: "展示屏已切到该洞察。", summary: "展示屏 → 洞察" };
    },
  };

  const save: ToolDescriptor = {
    name: "save_insight",
    priority: TOOL_PRIORITY.management,
    description:
      "把 HTML 报告保存为洞察并显示在展示屏上。长报告分块：首块不带 insightId 新建，后续块带 insightId 追加。发现结构写错要整篇重写时，带 insightId 并置 mode=replace。",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "本块的 HTML 片段（标签须闭合）" },
        insightId: { type: "string", description: "可选。已有洞察 id：默认把本块追加到它的末尾，而不是新建" },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "对已有洞察的写法：append 追加到末尾（默认），replace 用本次 html 整篇覆盖。顺序写错了用 replace 重发全文，不要把开头追加到结尾。",
        },
      },
      required: ["html"],
    },
    available: () => true,
    async execute(args, context, raw) {
      const html = typeof args.html === "string" ? args.html : "";
      if (!html) {
        // REQ-F-050 ⑤: say what arrived, not just "empty" — the 63-byte probe that was
        // rejected for a wrapper key is the case this fixes.
        const problem = describeArgsProblem(raw ?? "", args, ["html"]) ?? "缺少参数 html。";
        return { ok: false, content: `${problem} 未保存。`, summary: "参数缺失，未保存" };
      }
      if (!looksLikeCompleteHtml(html)) {
        const noTags = !/<[a-zA-Z]/.test(html);
        return {
          ok: false,
          content: noTags
            ? "html 里没有任何 HTML 标签，未保存。请给出 HTML 片段。"
            : `HTML 疑似被截断（末尾：${JSON.stringify(html.trim().slice(-40))}），未保存。请缩短本块，或分成更小的块用 insightId 追加。`,
          summary: noTags ? "不是 HTML，未保存" : "HTML 疑似截断，未保存",
        };
      }

      const insightId = typeof args.insightId === "string" ? args.insightId.trim() : "";
      const mode = args.mode === "replace" ? "replace" : "append";
      if (mode === "replace" && !insightId) {
        return {
          ok: false,
          content: "mode=replace 需要同时给出要重写的 insightId；不带 id 就是新建，用不着 replace。",
          summary: "replace 缺少 insightId",
        };
      }
      if (insightId) {
        // REQ-F-050 ①: append to an existing insight. Same ownership check as show_insight.
        const existing = store.getInsight(insightId);
        const owner = existing ? store.getConversationForUser(context.userId, existing.conversationId) : null;
        if (!existing || !owner) {
          return {
            ok: false,
            content: `找不到 id 为 ${insightId} 的洞察，或它不属于当前用户；本块未保存。不带 insightId 可新建。`,
            summary: `洞察不可用：${insightId}`,
          };
        }
        // REQ-F-140 ②: replace exists so a mis-ordered report can be fixed in place.
        // Without it the only repair was appending the missing opening to the end.
        if (mode === "replace") {
          const rewritten = store.replaceInsightHtml(insightId, html);
          if (!rewritten) {
            return { ok: false, content: `重写失败：洞察 ${insightId} 已不存在。`, summary: "重写失败" };
          }
          store.setDisplayState({ kind: "insight", refId: insightId });
          return {
            ok: true,
            content: `已整篇重写洞察 ${insightId}：现为 ${rewritten.html.length} 字符、${countSections(rewritten.html)} 个章节标题，展示屏已刷新。`,
            summary: "已重写洞察",
            events: [{ type: "insight", insightId }],
          };
        }

        const nextBytes = Buffer.byteLength(existing.html, "utf8") + Buffer.byteLength(html, "utf8");
        if (nextBytes > MAX_INSIGHT_BYTES) {
          return {
            ok: false,
            content: `追加后将达 ${nextBytes} 字节，超过单份洞察上限 ${MAX_INSIGHT_BYTES} 字节；本块未保存。请精简内容。`,
            summary: "洞察超出上限，未追加",
          };
        }
        const updated = store.appendInsightHtml(insightId, `\n${html}`);
        if (!updated) {
          return { ok: false, content: `追加失败：洞察 ${insightId} 已不存在。`, summary: "追加失败" };
        }
        // Re-pointing (even to the same id) refreshes updated_at, so the screen refetches.
        store.setDisplayState({ kind: "insight", refId: insightId });
        return {
          ok: true,
          content: `已追加到洞察 ${insightId}：累计 ${updated.html.length} 字符、${countSections(updated.html)} 个章节标题，展示屏已刷新。继续追加请仍带此 insightId。`,
          summary: "已追加洞察",
          events: [{ type: "insight", insightId }],
        };
      }

      if (Buffer.byteLength(html, "utf8") > MAX_INSIGHT_BYTES) {
        return {
          ok: false,
          content: `HTML 有 ${Buffer.byteLength(html, "utf8")} 字节，超过单份洞察上限 ${MAX_INSIGHT_BYTES} 字节；未保存。`,
          summary: "洞察超出上限，未保存",
        };
      }
      // REQ-F-140 ③: starting a second report in one conversation is almost always a
      // mistake — it splits one document in two and the screen then shows only the newer
      // half. The model had no way to know, so it was told nothing; now it is.
      const existing = store.listInsightsForConversation(context.conversationId);
      const record = store.insertInsight({ conversationId: context.conversationId, kind: "skill", html });
      store.setDisplayState({ kind: "insight", refId: record.id });
      const warning =
        existing.length > 0
          ? `
注意：本会话此前已有 ${existing.length} 份洞察，最近一份是 ${existing[0]!.id}（${existing[0]!.html.length} 字符）。` +
            `如果这是同一份报告的后续，应当带上那个 insightId 追加或 replace，而不是新建——新建会把一份报告拆成两份，展示屏只显示较新的一份。`
          : "";
      return {
        ok: true,
        content:
          `洞察已保存（id ${record.id}，${html.length} 字符）并显示在展示屏上。` +
          `要继续补充请带 insightId ${record.id}；要整篇重写请带该 id 并置 mode=replace。${warning}`,
        summary: "已生成洞察",
        // REQ-F-140 ④: this delta type existed in `ChatDelta` and was handled by the
        // console, but nothing ever emitted it — a leftover of the pre-tool skill-turn path.
        // So the「已生成洞察」notice never appeared either. Emitting it fixes both.
        events: [{ type: "insight", insightId: record.id }],
      };
    },
  };

  const archive: ToolDescriptor = {
    name: "archive_insight",
    priority: TOOL_PRIORITY.normal,
    description:
      "把一份洞察报告归档进本地文档库。参数 insightId 为报告 id，format 可选 md（默认，正文转 Markdown 并带元数据头）或 html（原样）。" +
      "归档后的文件立刻可被 search_documents / read_document 读到。",
    parameters: {
      type: "object",
      properties: {
        insightId: { type: "string", description: "洞察 id" },
        format: { type: "string", enum: ["md", "html"], description: "归档格式，默认 md" },
      },
      required: ["insightId"],
    },
    // 归档目录没配就不注册：一个注册了却每次都失败的工具，比不注册更浪费一轮（REQ-NF-008 ④）。
    available: () => Boolean((store.getSetting(SETTING_ARCHIVE_DIR) ?? "").trim()),
    async execute(args, context, raw) {
      const insightId = typeof args.insightId === "string" ? args.insightId.trim() : "";
      if (!insightId) {
        const problem = describeArgsProblem(raw ?? "", args, ["insightId"]) ?? "缺少参数 insightId。";
        return { ok: false, content: problem, summary: "参数缺失" };
      }
      const format: ArchiveFormat = args.format === "html" ? "html" : "md";
      const record = store.getInsight(insightId);
      // 与 show_insight 同一条归属判定：insights 表没有 user_id，所有权来自它挂的会话。
      const owner = record ? store.getConversationForUser(context.userId, record.conversationId) : null;
      if (!record || !owner) {
        return {
          ok: false,
          content: `找不到 id 为 ${insightId} 的洞察，或它不属于当前用户。`,
          summary: `洞察不可用：${insightId}`,
        };
      }
      try {
        const result = await archiveInsight({
          insightId: record.id,
          conversationId: record.conversationId,
          html: record.html,
          createdAt: record.createdAt,
          format,
          archiveSetting: store.getSetting(SETTING_ARCHIVE_DIR),
          rootsSetting: store.getSetting(SETTING_DOCUMENT_ROOTS),
        });
        return {
          ok: true,
          content: `已归档为 ${result.id}（${Math.max(1, Math.round(result.bytes / 1024))} KB，${result.format}）。` +
            `它现在是本地文档库里的一份文件，可用 read_document 以该标识读回。`,
          summary: `已归档：${result.id}`,
        };
      } catch (error) {
        // 失败必须说清下一步怎么做（REQ-F-180 ③）：归档失败几乎总是「目录没配好」，
        // 而「未写入」三个字帮不了任何人。
        const message = error instanceof DocumentPathError ? error.message : "归档失败。";
        return { ok: false, content: message, summary: "归档失败" };
      }
    },
  };

  return [home, board, competitorBoard, industrySpecComparison, orgChartBoard, insight, save, archive];
}
