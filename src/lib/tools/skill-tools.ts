import { resolveSkillForTurn } from "../skills";
import type { Store } from "../store";
import { truncateToTokens } from "./budget";
import type { ToolDescriptor } from "./registry";

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

export function createSkillTools(store: Store): ToolDescriptor[] {
  const listSkills: ToolDescriptor = {
    name: "list_skills",
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
        content: text,
        summary: `读取技能 ${name}${truncated ? "（已截断）" : ""}`,
      };
    },
  };

  const searchSkills: ToolDescriptor = {
    name: "search_skills",
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
