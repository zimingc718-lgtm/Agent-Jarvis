import {
  listSkillFiles,
  MAX_INJECTION_BYTES,
  readSkillDoc,
  readSkillFile,
  registerSkill,
  SkillFileError,
  SKILLS_ROOT,
} from "../skills";
import { SkillNameConflictError, type Store } from "../store";
import { truncateToTokens } from "./budget";
import { TOOL_PRIORITY, type ToolDescriptor } from "./registry";

/**
 * Skills as tools (REQ-F-030, TASK-067).
 *
 * Before this CR a skill's whole body — up to 32 KB — was pasted into the system prompt
 * of every turn that a separate routing model call had flagged. Two fixed costs per send,
 * paid whether or not the body mattered. Now the prefix carries only the catalogue and
 * the model calls `read_skill` when it actually wants one, which also makes skills
 * something the model can enumerate and search rather than something silently done to it.
 */

const SKILL_RESULT_TOKEN_CAP = 8_000;

/**
 * What this host can actually do with a report (REQ-F-140 ①, DEC-120 ①).
 *
 * Skills are dropped in as-is, and a good one is usually written for a different host.
 * `multi-agent-insight-reviewer` is the measured case: 167,755 characters across twenty
 * reference files, a full standalone HTML template, instructions to "generate or update the
 * final HTML or Word report artifact directly" — and **not one mention** of `save_insight`,
 * which is the only way anything reaches the screen here. The model had to improvise the
 * bridge, and what it produced was bare `<section>` fragments with none of the template's
 * styling (EV-2026-09-12-skill-report-bridge §1).
 *
 * Appended to every `read_skill` result rather than written into the user's skill files:
 * their folder is theirs, and re-installing the skill would wipe an edit of ours.
 */
export const HOST_OUTPUT_NOTE = [
  "=== 本机（Agent-Jarvis）的产出约定 ===",
  "以上技能可能是为别的宿主写的。在这里，报告的唯一出口是 save_insight 工具：",
  "1. 没有文件系统产出，不能写 .html / .docx 文件，也没有 Word。技能里关于「生成文件」「导出 Word」的说法在这里不适用。",
  "2. 首块调用 save_insight(html) 新建并返回 insightId；后续块带上该 id 追加。一个报告始终只用一个 insightId——同一会话里再新建会把报告拆成两份，展示屏只显示较新的那份。",
  "3. 写错了顺序或结构，带该 id 并置 mode=replace 整篇重发，不要把缺失的开头追加到结尾。",
  "4. **样式请一并写进第一块**：技能自带的 `<style>`（如 html-report-template.html 里的那套）会原样保留并优先于本机的基础样式。不带样式就只剩通用排版，技能的配色、表格、callout、置信度标记都不会出现。",
  "5. 片段即可，不必输出 <html>/<body> 骨架——展示屏会包一层带主题的文档外壳。",
  "6. 章节编号在整篇里保持一套，不要中文序号与阿拉伯数字混用。",
  "7. 本技能的参考文件不会一次性给你——上面只有 SKILL.md 与文件清单。动手前先按清单把与本次任务相关的文件用 read_skill(name, file) 读进来，不要凭技能名猜它的规范。",
].join("\n");

export function createSkillTools(store: Store): ToolDescriptor[] {
  const listSkills: ToolDescriptor = {
    name: "list_skills",
    priority: TOOL_PRIORITY.essential,
    description: "列出当前已注册的全部技能（名称与描述）。需要技能正文时再调 read_skill。",
    parameters: { type: "object", properties: {} },
    available: (context) => context.skillCount > 0,
    async execute(_args, context) {
      const skills = store.listSkills(context.userId);
      if (skills.length === 0) {
        return { ok: true, content: "当前没有已注册技能。", summary: "无技能" };
      }
      const lines = skills.map((skill) => `- ${skill.name}：${skill.description}`);
      return {
        ok: true,
        content: lines.join("\n"),
        summary: `列出 ${skills.length} 个技能`,
      };
    },
  };

  const readSkill: ToolDescriptor = {
    name: "read_skill",
    priority: TOOL_PRIORITY.essential,
    description:
      "读取技能。不带 file 返回 SKILL.md 与该技能的文件清单；带 file 返回清单里的某一个文件。大技能请按清单逐个读，不要指望一次拿到全部。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名称" },
        file: { type: "string", description: "可选。清单里的相对路径，例如 references/report-templates.md" },
      },
      required: ["name"],
    },
    available: (context) => context.skillCount > 0,
    async execute(args, context) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) {
        return { ok: false, content: "缺少参数 name。", summary: "参数缺失" };
      }
      const skill = store.listSkills(context.userId).find((entry) => entry.name === name);
      if (!skill) {
        return {
          ok: false,
          content: `没有名为「${name}」的技能。可用 list_skills 查看现有技能。`,
          summary: `技能不存在：${name}`,
        };
      }

      const wanted = typeof args.file === "string" ? args.file.trim() : "";
      if (wanted) {
        // REQ-F-150 ②: one file at a time, so a big skill is reachable in full instead of
        // arbitrarily cut off at the folder cap.
        try {
          const raw = await readSkillFile(skill.dirPath, wanted);
          const { text, truncated } = truncateToTokens(raw, SKILL_RESULT_TOKEN_CAP);
          return {
            ok: true,
            content: `=== ${name} / ${wanted} ===\n${text}`,
            summary: `读取 ${name}/${wanted}${truncated ? "（已截断）" : ""}`,
          };
        } catch (error) {
          return {
            ok: false,
            content: error instanceof SkillFileError ? error.message : `读取 ${wanted} 失败。`,
            summary: "技能文件不可读",
          };
        }
      }

      /**
       * REQ-F-150 ①. This used to concatenate SKILL.md with every text file in the folder
       * and cut the result at 32 KB, then again at 8,000 tokens. Measured on
       * `multi-agent-insight-reviewer` — 167,755 characters across twenty files — the model
       * saw roughly a fifth of its own instructions, and which fifth depended on alphabetical
       * order (EV-2026-09-12-skill-paging §1). A manifest plus on-demand reads makes the
       * whole skill reachable without ever spending more than one file's budget at a time.
       */
      const doc = await readSkillDoc(skill.dirPath);
      const files = await listSkillFiles(skill.dirPath);
      const manifest =
        files.length === 0
          ? "（该技能只有 SKILL.md，没有其它可读文件。）"
          : [
              `该技能另有 ${files.length} 个文件，合计 ${Math.round(files.reduce((sum, f) => sum + f.bytes, 0) / 1024)} KB。`,
              "需要哪个就用 read_skill 带上 file 参数单独读，**不要假设你已经看过它们**：",
              ...files.map((f) => `- ${f.path}（${Math.round(f.bytes / 1024)} KB）`),
            ].join("\n");
      const { text, truncated } = truncateToTokens(`${doc}\n\n=== 本技能的文件清单 ===\n${manifest}`, SKILL_RESULT_TOKEN_CAP);
      return {
        ok: true,
        // REQ-F-140 ①: the host note goes AFTER the skill text, so it is the last thing
        // read and cannot be pushed out by truncation.
        content: `${text}

${HOST_OUTPUT_NOTE}`,
        summary: `读取技能 ${name}${truncated ? "（已截断）" : ""}`,
      };
    },
  };

  const searchSkills: ToolDescriptor = {
    name: "search_skills",
    priority: TOOL_PRIORITY.normal,
    description: "按关键字在技能名称与描述中检索，用于技能很多、目录未全部列出时定位技能。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "关键字" } },
      required: ["query"],
    },
    available: (context) => context.skillCount > 0,
    async execute(args, context) {
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      if (!query) {
        return { ok: false, content: "缺少参数 query。", summary: "参数缺失" };
      }
      const hits = store
        .listSkills(context.userId)
        .filter(
          (skill) =>
            skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
        );
      if (hits.length === 0) {
        return { ok: true, content: `没有匹配「${query}」的技能。`, summary: `检索无结果：${query}` };
      }
      return {
        ok: true,
        content: hits.map((skill) => `- ${skill.name}：${skill.description}`).join("\n"),
        summary: `检索到 ${hits.length} 个技能`,
      };
    },
  };

  /**
   * The one write in this suite (REQ-F-300, DEC-410; CR-20260921-chat-skill-register).
   *
   * Conversation protocol, enforced two ways: the description tells the model to show
   * the full SKILL.md and wait for the user to say 注册; `confirmed` is the model's
   * attestation that it did, and without it the call is refused with the same
   * instruction. Registration is the SAME path the drag-and-drop intake uses
   * (`registerSkill`: slug, path-traversal guard, name conflict, write + insert), so a
   * skill born in chat is indistinguishable on disk and in the table from an uploaded
   * one — `read_skill`, the ☰ list, rename and delete all just apply.
   *
   * Available even with zero skills: the first skill is exactly what this creates.
   * Appended LAST — existing tests destructure the first three by position.
   */
  const registerSkillTool: ToolDescriptor = {
    name: "register_skill",
    priority: TOOL_PRIORITY.management,
    description:
      "把一份 SKILL.md 注册为技能。约定：先在回复里把完整的 SKILL.md（frontmatter 的 name/description + 正文）给用户看，" +
      "等用户明确说「注册」之后再调用本工具，并把 confirmed 置为 true；用户没说注册、或说还要改，就不要调用。" +
      "只注册这一份 SKILL.md，不能附带其它文件（需要附属文件请让用户走「技能」里的上传入口）。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名称（frontmatter 的 name），同时用作技能文件夹名" },
        description: { type: "string", description: "一句话描述（frontmatter 的 description）" },
        body: { type: "string", description: "SKILL.md 正文（frontmatter 之后的 Markdown 说明）" },
        confirmed: { type: "boolean", description: "用户已看过完整 SKILL.md 并明确说了「注册」时才为 true" },
      },
      required: ["name", "description", "body", "confirmed"],
    },
    available: () => true,
    async execute(args, context) {
      if (args.confirmed !== true) {
        return {
          ok: false,
          content: "未注册：请先把完整的 SKILL.md（name、description 与正文）在回复里给用户看，等用户明确说「注册」后再带 confirmed=true 调用。",
          summary: "等待用户确认",
        };
      }
      const name = typeof args.name === "string" ? args.name.replace(/[\r\n]+/g, " ").trim() : "";
      const description = typeof args.description === "string" ? args.description.replace(/[\r\n]+/g, " ").trim() : "";
      const body = typeof args.body === "string" ? args.body.trim() : "";
      if (!name || !description || !body) {
        return { ok: false, content: "缺少参数：name、description、body 都不能为空。", summary: "参数缺失" };
      }
      const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
      if (Buffer.byteLength(content, "utf8") > MAX_INJECTION_BYTES) {
        return {
          ok: false,
          content: `SKILL.md 超过 ${Math.round(MAX_INJECTION_BYTES / 1024)} KB 上限，请精简正文后再注册。`,
          summary: "正文过长",
        };
      }
      try {
        // `complete: null` — an authored SKILL.md with frontmatter never needs generation
        // (CR-20260911-skill-doc-preserved), so no model call happens here.
        const record = await registerSkill({
          store,
          userId: context.userId,
          folderName: name,
          files: [{ path: "SKILL.md", content }],
          skillsRoot: SKILLS_ROOT,
          complete: null,
        });
        return {
          ok: true,
          content: `已注册技能「${record.name}」：${record.description}。请提醒用户：可在 ☰ →「技能」里查看、改名或删除它；以后对话里用 read_skill 读取。`,
          summary: `注册技能 ${record.name}`,
        };
      } catch (error) {
        if (error instanceof SkillNameConflictError) {
          return {
            ok: false,
            content: `已存在同名技能「${name}」，未注册。请换一个名称，或让用户先在 ☰ →「技能」里删除/改名旧的那个。`,
            summary: `技能重名：${name}`,
          };
        }
        return { ok: false, content: "注册技能失败，未写入。", summary: "注册失败" };
      }
    },
  };

  return [listSkills, readSkill, searchSkills, registerSkillTool];
}
