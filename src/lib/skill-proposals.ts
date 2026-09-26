import { registerSkill, SKILLS_ROOT, type RegisterSkillResult } from "./skills";
import { SkillNameConflictError, type SkillProposalRecord, type Store } from "./store";

/**
 * The approval step for model-proposed skills (REQ-F-320 ①, DEC-430 ②;
 * CR-20260925-write-approval-action-log).
 *
 * `register_skill` files a proposal; nothing reaches `.data/skills/` or the `skills` table
 * until the user clicks 采纳 — in the transcript card or in ☰「技能」. Adoption runs the very
 * same `registerSkill()` the drag-and-drop intake uses, so an adopted skill is
 * indistinguishable from an uploaded one and a name conflict is refused by the same rule.
 * Mirrors `entity-proposals.ts`, which does this for field changes; the trust rule lives
 * here, at the boundary, not in the tool the model calls.
 */

/** Exactly the SKILL.md adoption writes — one builder, so the size check and the file agree. */
export function buildSkillDoc(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

export type SkillProposalDecision =
  | { ok: true; skill: RegisterSkillResult; proposal: SkillProposalRecord }
  | { ok: false; status: 404 | 409 | 500; message: string };

export async function adoptSkillProposal(store: Store, userId: string, id: string): Promise<SkillProposalDecision> {
  const proposal = store.getSkillProposal(userId, id);
  if (!proposal || proposal.status !== "pending") {
    return { ok: false, status: 404, message: `没有编号为「${id}」的待确认技能提议，或它已被处理。` };
  }
  try {
    // `complete: null` — an authored SKILL.md with frontmatter never needs generation
    // (CR-20260911-skill-doc-preserved), so adoption makes no model call.
    const skill = await registerSkill({
      store,
      userId,
      folderName: proposal.name,
      files: [{ path: "SKILL.md", content: buildSkillDoc(proposal.name, proposal.description, proposal.body) }],
      skillsRoot: SKILLS_ROOT,
      complete: null,
    });
    const decided = store.decideSkillProposal(userId, id, "adopted") ?? proposal;
    return { ok: true, skill, proposal: decided };
  } catch (error) {
    if (error instanceof SkillNameConflictError) {
      // Left pending on purpose: rename or delete the old skill in ☰「技能」, then adopt again.
      return {
        ok: false,
        status: 409,
        message: `已存在同名技能「${proposal.name}」，未注册。请先在 ☰ →「技能」里删除/改名旧的那个，再采纳。`,
      };
    }
    return { ok: false, status: 500, message: "注册技能失败，未写入。" };
  }
}

/** Drops a pending proposal; null when there was nothing pending under that id for this user. */
export function discardSkillProposal(store: Store, userId: string, id: string): SkillProposalRecord | null {
  return store.decideSkillProposal(userId, id, "discarded");
}
