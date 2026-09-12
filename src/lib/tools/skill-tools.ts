import { resolveSkillForTurn } from "../skills";
import type { Store } from "../store";
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
    description: "读取一个技能的 SKILL.md 与其文件夹内的文本文件内容。参数 name 为技能名称。",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "技能名称" } },
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
      const body = await resolveSkillForTurn(skill.dirPath);
      // The 32 KB folder cap still applies at read time; this second cap keeps one
      // read from eating the whole turn budget (REQ-NF-007 ②).
      const { text, truncated } = truncateToTokens(body, SKILL_RESULT_TOKEN_CAP);
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

  return [listSkills, readSkill, searchSkills];
}
