import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * TEST-551 (route half) — the approval click for model-proposed skills (REQ-F-320 ①,
 * DEC-430 ②; CR-20260925-write-approval-action-log). Nothing reaches `.data/skills/` or the
 * `skills` table until `POST /api/skills/proposals/[id]`; `DELETE` drops the proposal.
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-skill-proposals-route-"));
process.env.JARVIS_DB_PATH = join(dir, "p.sqlite");
process.env.JARVIS_SKILLS_PATH = join(dir, "skills");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const listRoute = await import("@/app/api/skills/proposals/route");
const decideRoute = await import("@/app/api/skills/proposals/[id]/route");
const { SKILLS_ROOT } = await import("@/lib/skills");
const { getStore } = await import("@/lib/store-singleton");

const OWNER = "owner@example.com";

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function propose(userId: string, name: string) {
  return getStore().insertSkillProposal({
    userId,
    conversationId: null,
    name,
    description: `${name}的描述`,
    body: `# ${name}\n\n正文。`,
  });
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/skills/proposals (TEST-551)", () => {
  it("401s an unauthenticated caller on every verb", async () => {
    as(null);
    expect((await listRoute.GET()).status).toBe(401);
    expect((await decideRoute.POST(new Request("http://test"), params("x"))).status).toBe(401);
    expect((await decideRoute.DELETE(new Request("http://test"), params("x"))).status).toBe(401);
  });

  it("GET lists only the caller's pending proposals", async () => {
    const mine = propose(OWNER, "会议纪要整理");
    propose("other@example.com", "别人的技能");
    as(OWNER);
    const body = (await (await listRoute.GET()).json()) as { proposals: Array<{ id: string; name: string }> };
    expect(body.proposals.map((p) => p.id)).toEqual([mine.id]);
    expect(body.proposals[0].name).toBe("会议纪要整理");
  });

  it("POST adopts: the skill is registered through registerSkill(), SKILL.md lands on disk, the proposal leaves the queue", async () => {
    const proposal = propose(OWNER, "报告校对");
    expect(getStore().listSkills(OWNER).some((skill) => skill.name === "报告校对")).toBe(false);

    as(OWNER);
    const response = await decideRoute.POST(new Request("http://test"), params(proposal.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; skill: { name: string } };
    expect(body.skill.name).toBe("报告校对");

    const registered = getStore().listSkills(OWNER).find((skill) => skill.name === "报告校对")!;
    expect(registered.dirPath.startsWith(SKILLS_ROOT)).toBe(true);
    expect(readdirSync(registered.dirPath)).toContain("SKILL.md");
    const doc = readFileSync(join(registered.dirPath, "SKILL.md"), "utf8");
    expect(doc.startsWith("---\nname: 报告校对\ndescription: 报告校对的描述\n---\n")).toBe(true);
    expect(doc).toContain("# 报告校对");
    expect(getStore().getSkillProposal(OWNER, proposal.id)?.status).toBe("adopted");

    const listed = (await (await listRoute.GET()).json()) as { proposals: Array<{ id: string }> };
    expect(listed.proposals.map((p) => p.id)).not.toContain(proposal.id);

    // Adopting twice is a 404: the proposal is no longer pending.
    expect((await decideRoute.POST(new Request("http://test"), params(proposal.id))).status).toBe(404);
  });

  it("DELETE discards without writing anything", async () => {
    const proposal = propose(OWNER, "不要的技能");
    as(OWNER);
    const response = await decideRoute.DELETE(new Request("http://test"), params(proposal.id));
    expect(response.status).toBe(200);
    expect(getStore().getSkillProposal(OWNER, proposal.id)?.status).toBe("discarded");
    expect(getStore().listSkills(OWNER).some((skill) => skill.name === "不要的技能")).toBe(false);
    expect(existsSync(join(SKILLS_ROOT, "不要的技能"))).toBe(false);
    expect((await decideRoute.DELETE(new Request("http://test"), params(proposal.id))).status).toBe(404);
  });

  it("404s an unknown id and refuses another user's proposal", async () => {
    const theirs = propose("other@example.com", "他们的");
    as(OWNER);
    expect((await decideRoute.POST(new Request("http://test"), params("no-such-id"))).status).toBe(404);
    expect((await decideRoute.POST(new Request("http://test"), params(theirs.id))).status).toBe(404);
    expect(getStore().getSkillProposal("other@example.com", theirs.id)?.status).toBe("pending");
  });

  it("409s when a skill with the proposed name already exists, and leaves the proposal pending", async () => {
    const first = propose(OWNER, "重名技能");
    as(OWNER);
    expect((await decideRoute.POST(new Request("http://test"), params(first.id))).status).toBe(200);

    const second = propose(OWNER, "重名技能");
    const response = await decideRoute.POST(new Request("http://test"), params(second.id));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).toContain("同名");
    expect(getStore().getSkillProposal(OWNER, second.id)?.status).toBe("pending");
  });
});
