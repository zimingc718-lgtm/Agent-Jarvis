import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-skills-route-"));
process.env.JARVIS_DB_PATH = join(dir, "s.sqlite");
process.env.JARVIS_SKILLS_PATH = join(dir, "skills");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const skillsRoute = await import("@/app/api/skills/route");
const { SKILLS_ROOT } = await import("@/lib/skills");
const { getStore } = await import("@/lib/store-singleton");

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

function upload(folderName: string, files: Array<[string, string]>): Request {
  const form = new FormData();
  form.set("folderName", folderName);
  for (const [path, content] of files) {
    form.append("file", new File([content], path, { type: "text/plain" }));
  }
  return new Request("http://test/api/skills", { method: "POST", body: form });
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(SKILLS_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("POST /api/skills (TASK-033)", () => {
  beforeEach(() => rmSync(SKILLS_ROOT, { recursive: true, force: true }));

  it("401s an unauthenticated caller", async () => {
    as(null);
    expect((await skillsRoute.POST(upload("x", [["a.md", "a"]]))).status).toBe(401);
  });

  it("registers a folder, stores it raw, and lists it via GET (no LLM available → fallback name)", async () => {
    as("owner@example.com");
    const created = await skillsRoute.POST(upload("Report Skill", [["SKILL-notes.md", "how to report"], ["data/x.json", "{}"]]));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.docGenerated).toBe(false);
    expect(body.name).toBe("report-skill");

    const [registered] = getStore().listSkills("owner@example.com");
    expect(readdirSync(registered.dirPath)).toEqual(expect.arrayContaining(["SKILL.md", "SKILL-notes.md", "data"]));

    as("owner@example.com");
    const listed = await (await skillsRoute.GET()).json();
    expect(listed.skills.map((s: { name: string }) => s.name)).toContain("report-skill");
  });

  it("409s a folder whose slug already exists", async () => {
    as("owner@example.com");
    await skillsRoute.POST(upload("dup skill", [["a.md", "a"]]));
    const again = await skillsRoute.POST(upload("Dup Skill", [["a.md", "a"]]));
    expect(again.status).toBe(409);
  });

  it("400s a folder with no readable text files (binary content is skipped)", async () => {
    as("owner@example.com");
    const form = new FormData();
    form.set("folderName", "binary-only");
    form.append("file", new File([new Uint8Array([1, 2, 0, 3, 0, 9])], "photo.png"));
    const res = await skillsRoute.POST(new Request("http://test/api/skills", { method: "POST", body: form }));
    expect(res.status).toBe(400);
  });

  it("ignores a file whose path tries to escape the folder", async () => {
    as("owner@example.com");
    const res = await skillsRoute.POST(upload("safe", [["../evil.md", "x"], ["ok.md", "ok"]]));
    // the ".." entry is dropped by the route; only ok.md remains, so registration still succeeds
    expect(res.status).toBe(201);
    const registered = getStore().listSkills("owner@example.com").at(-1)!;
    expect(readdirSync(registered.dirPath)).toEqual(expect.arrayContaining(["SKILL.md", "ok.md"]));
    expect(readdirSync(registered.dirPath)).not.toContain("evil.md");
  });
});
