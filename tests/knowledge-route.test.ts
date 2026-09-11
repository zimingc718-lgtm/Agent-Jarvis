import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-kb-route-"));
process.env.JARVIS_DB_PATH = join(dir, "k.sqlite");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const listRoute = await import("@/app/api/knowledge/route");
const entryRoute = await import("@/app/api/knowledge/[name]/route");
const pendingRoute = await import("@/app/api/knowledge/pending/[name]/route");
const { KNOWLEDGE_ROOT, saveKnowledge } = await import("@/lib/knowledge");
const { getStore } = await import("@/lib/store-singleton");

/** TEST-087 — the knowledge API (REQ-F-044 ③④, REQ-F-046 ①②③; TASK-084). */

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}

const params = (name: string) => ({ params: Promise.resolve({ name }) });

function jsonPost(body: unknown): Request {
  return new Request("http://test/api/knowledge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function filePost(name: string, content: string): Request {
  const form = new FormData();
  form.set("file", new File([content], name, { type: "text/plain" }), name);
  return new Request("http://test/api/knowledge", { method: "POST", body: form });
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/knowledge", () => {
  beforeEach(() => rmSync(KNOWLEDGE_ROOT, { recursive: true, force: true }));

  it("401s an unauthenticated caller on every verb", async () => {
    as(null);
    expect((await listRoute.GET()).status).toBe(401);
    expect((await listRoute.POST(jsonPost({ content: "x" }))).status).toBe(401);
    expect((await entryRoute.DELETE(new Request("http://test"), params("x"))).status).toBe(401);
    expect((await pendingRoute.POST(new Request("http://test"), params("x"))).status).toBe(401);
  });

  it("② JSON body from the 存入知识库 button lands directly in the base with source=conversation", async () => {
    as("owner@example.com");
    const created = await listRoute.POST(jsonPost({ content: "回答：部署端口是 8443。", source: "conversation" }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.entry).toMatchObject({ title: "回答：部署端口是 8443。", source: "conversation" });

    const listed = await (await listRoute.GET()).json();
    expect(listed.entries).toHaveLength(1);
    expect(listed.pending).toEqual([]);
    expect(readdirSync(KNOWLEDGE_ROOT)).toEqual([`${body.entry.name}.md`]);
  });

  it("① a dropped .md becomes an entry titled from its heading; a .pdf is refused; oversize is 413", async () => {
    as("owner@example.com");
    const ok = await listRoute.POST(filePost("周会.md", "# 周会纪要\n\n决定先做 C 期。"));
    expect(ok.status).toBe(201);
    expect((await ok.json()).entry).toMatchObject({ name: "周会", title: "周会纪要", source: "file" });

    const pdf = await listRoute.POST(filePost("a.pdf", "%PDF"));
    expect(pdf.status).toBe(400);
    expect((await pdf.json()).message).toContain("不是文本笔记");

    const huge = await listRoute.POST(filePost("big.txt", "x".repeat(70_000)));
    expect(huge.status).toBe(413);
  });

  it("empty content is a 400 with the reason", async () => {
    as("owner@example.com");
    const response = await listRoute.POST(jsonPost({ content: "   " }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("为空");
  });

  it("④ GET /[name] reads one entry; DELETE removes it and 404s afterwards", async () => {
    as("owner@example.com");
    await saveKnowledge({ title: "部署", content: "端口 8443", source: "manual" }, KNOWLEDGE_ROOT);
    const read = await entryRoute.GET(new Request("http://test"), params("部署"));
    expect(read.status).toBe(200);
    expect((await read.json()).entry.content).toBe("端口 8443");

    expect((await entryRoute.DELETE(new Request("http://test"), params("部署"))).status).toBe(200);
    expect((await entryRoute.DELETE(new Request("http://test"), params("部署"))).status).toBe(404);
    expect((await entryRoute.GET(new Request("http://test"), params("部署"))).status).toBe(404);
    // A traversal-shaped name is just "not found", never a filesystem walk.
    expect((await entryRoute.DELETE(new Request("http://test"), params("../evil"))).status).toBe(404);
  });

  it("③ pending: listed separately, POST adopts into entries, DELETE discards, 404 otherwise", async () => {
    as("owner@example.com");
    await saveKnowledge({ title: "用户偏好", content: "偏好中文", source: "model", pending: true }, KNOWLEDGE_ROOT);
    await saveKnowledge({ title: "另一个", content: "x", source: "model", pending: true }, KNOWLEDGE_ROOT);

    let listed = await (await listRoute.GET()).json();
    expect(listed.entries).toEqual([]);
    expect(listed.pending.map((entry: { name: string }) => entry.name).sort()).toEqual(["另一个", "用户偏好"]);

    const adopted = await pendingRoute.POST(new Request("http://test"), params("用户偏好"));
    expect(adopted.status).toBe(200);
    expect((await adopted.json()).entry.name).toBe("用户偏好");

    expect((await pendingRoute.DELETE(new Request("http://test"), params("另一个"))).status).toBe(200);
    expect((await pendingRoute.DELETE(new Request("http://test"), params("另一个"))).status).toBe(404);
    expect((await pendingRoute.POST(new Request("http://test"), params("nope"))).status).toBe(404);

    listed = await (await listRoute.GET()).json();
    expect(listed.entries.map((entry: { name: string }) => entry.name)).toEqual(["用户偏好"]);
    expect(listed.pending).toEqual([]);
  });
});
