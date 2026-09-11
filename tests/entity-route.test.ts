import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-ent-route-"));
process.env.JARVIS_DB_PATH = join(dir, "e.sqlite");
process.env.JARVIS_ENTITIES_PATH = join(dir, "entities");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const { getServerSession } = await import("next-auth");
const listRoute = await import("@/app/api/entities/route");
const oneRoute = await import("@/app/api/entities/[name]/route");
const pendingRoute = await import("@/app/api/entities/pending/[name]/route");
const proposalRoute = await import("@/app/api/entities/proposals/[id]/route");
const overviewRoute = await import("@/app/api/knowledge/overview/route");
const { ENTITIES_ROOT, saveEntity, addSource, readEntity } = await import("@/lib/entities");
const { proposeEntityUpdate, listProposals } = await import("@/lib/entity-proposals");
const { KNOWLEDGE_ROOT, saveKnowledge, recordSearchMiss } = await import("@/lib/knowledge");
const { getStore } = await import("@/lib/store-singleton");

/** TEST-122 — the board's API (CR-20260911-home-dashboard). */

function as(email: string | null) {
  vi.mocked(getServerSession).mockResolvedValue((email ? { user: { email } } : null) as never);
}
const params = (name: string) => ({ params: Promise.resolve({ name }) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://test/api/entities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = (body: unknown) =>
  new Request("http://test/api/entities/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("/api/entities", () => {
  beforeEach(() => {
    rmSync(ENTITIES_ROOT, { recursive: true, force: true });
    rmSync(KNOWLEDGE_ROOT, { recursive: true, force: true });
  });

  it("未登录时每个端点都 401", async () => {
    as(null);
    expect((await listRoute.GET()).status).toBe(401);
    expect((await listRoute.POST(post({ kind: "competitor", title: "x" }))).status).toBe(401);
    expect((await oneRoute.GET(new Request("http://test"), params("x"))).status).toBe(401);
    expect((await oneRoute.PATCH(patch({ action: "seen" }), params("x"))).status).toBe(401);
    expect((await pendingRoute.POST(new Request("http://test"), params("x"))).status).toBe(401);
    expect((await proposalRoute.POST(new Request("http://test"), idParams("x"))).status).toBe(401);
    expect((await overviewRoute.GET()).status).toBe(401);
  });

  it("① GET 一次返回三个队列：实体、待采纳实体、待采纳字段修改", async () => {
    as("owner@example.com");
    await saveEntity({ kind: "competitor", title: "友商 A" }, ENTITIES_ROOT);
    await saveEntity({ kind: "customer", title: "客户 P", pending: true }, ENTITIES_ROOT);
    await proposeEntityUpdate(
      { name: "友商-a", field: "capacity", value: "1 GW", evidence: { url: "https://x.example", at: "", locator: "" } },
      { root: ENTITIES_ROOT }
    );
    const body = await (await listRoute.GET()).json();
    expect(body.entities.map((e: { title: string }) => e.title)).toEqual(["友商 A"]);
    expect(body.pending.map((e: { title: string }) => e.title)).toEqual(["客户 P"]);
    expect(body.proposals).toHaveLength(1);
  });

  it("② POST 由用户直接建实体（不经待采纳区）；kind 非法 400", async () => {
    as("owner@example.com");
    expect((await listRoute.POST(post({ kind: "nope", title: "x" }))).status).toBe(400);
    const created = await listRoute.POST(post({ kind: "authority", title: "DSO B", capacity: "队列 37 位" }));
    expect(created.status).toBe(201);
    expect((await created.json()).entity).toMatchObject({ name: "dso-b", kind: "authority", capacity: "队列 37 位" });
    expect((await (await listRoute.GET()).json()).entities).toHaveLength(1);
  });

  it("③ PATCH seen 清未读；field 改值；addSource / removeSource 管源", async () => {
    as("owner@example.com");
    await saveEntity({ kind: "competitor", title: "友商 C" }, ENTITIES_ROOT);
    await oneRoute.PATCH(patch({ action: "field", field: "change", value: "有变化" }), params("友商-c"));
    expect((await (await oneRoute.GET(new Request("http://test"), params("友商-c"))).json()).summary.unread).toBe(true);

    await oneRoute.PATCH(patch({ action: "seen" }), params("友商-c"));
    expect((await (await oneRoute.GET(new Request("http://test"), params("友商-c"))).json()).summary.unread).toBe(false);

    const added = await oneRoute.PATCH(patch({ action: "addSource", url: "https://c.example" }), params("友商-c"));
    expect((await added.json()).entity.sources).toEqual(["https://c.example"]);
    const removed = await oneRoute.PATCH(patch({ action: "removeSource", url: "https://c.example" }), params("友商-c"));
    expect((await removed.json()).entity.health).toBe("unconfigured");

    expect((await oneRoute.PATCH(patch({ action: "nope" }), params("友商-c"))).status).toBe(400);
    expect((await oneRoute.PATCH(patch({ action: "field", field: "title", value: "x" }), params("友商-c"))).status).toBe(400);
    expect((await oneRoute.PATCH(patch({ action: "seen" }), params("missing"))).status).toBe(404);
    expect((await oneRoute.PATCH(patch({ action: "addSource", url: "不是链接" }), params("友商-c"))).status).toBe(400);
  });

  it("④ GET / DELETE 单个实体；穿越形名称按不存在处理", async () => {
    as("owner@example.com");
    await saveEntity({ kind: "competitor", title: "友商 D" }, ENTITIES_ROOT);
    expect((await oneRoute.GET(new Request("http://test"), params("友商-d"))).status).toBe(200);
    expect((await oneRoute.DELETE(new Request("http://test"), params("友商-d"))).status).toBe(200);
    expect((await oneRoute.DELETE(new Request("http://test"), params("友商-d"))).status).toBe(404);
    expect((await oneRoute.DELETE(new Request("http://test"), params("../evil"))).status).toBe(404);
  });

  it("⑤ 待采纳实体：POST 采纳进看板，DELETE 忽略，不存在 404", async () => {
    as("owner@example.com");
    await saveEntity({ kind: "competitor", title: "友商 E", pending: true }, ENTITIES_ROOT);
    expect((await pendingRoute.POST(new Request("http://test"), params("友商-e"))).status).toBe(200);
    expect((await (await listRoute.GET()).json()).entities).toHaveLength(1);
    await saveEntity({ kind: "competitor", title: "友商 F", pending: true }, ENTITIES_ROOT);
    expect((await pendingRoute.DELETE(new Request("http://test"), params("友商-f"))).status).toBe(200);
    expect((await pendingRoute.POST(new Request("http://test"), params("nope"))).status).toBe(404);
  });

  it("⑥ 待采纳的字段修改：采纳后写入实体并留证据，忽略则丢弃", async () => {
    as("owner@example.com");
    await saveEntity({ kind: "authority", title: "TSO G" }, ENTITIES_ROOT);
    const { proposal } = await proposeEntityUpdate(
      { name: "tso-g", field: "capacity", value: "可用 3 GW", evidence: { url: "https://g.example/cap", at: "", locator: "表 1" } },
      { root: ENTITIES_ROOT }
    );
    expect((await proposalRoute.POST(new Request("http://test"), idParams(proposal.id))).status).toBe(200);
    const entity = await readEntity("tso-g", ENTITIES_ROOT);
    expect(entity?.capacity).toBe("可用 3 GW");
    expect(entity?.evidence[0]).toMatchObject({ field: "capacity", url: "https://g.example/cap" });
    expect(await listProposals(ENTITIES_ROOT)).toEqual([]);

    const second = await proposeEntityUpdate(
      { name: "tso-g", field: "change", value: "x", evidence: { url: "https://g.example/n", at: "", locator: "" } },
      { root: ENTITIES_ROOT }
    );
    expect((await proposalRoute.DELETE(new Request("http://test"), idParams(second.proposal.id))).status).toBe(200);
    expect((await proposalRoute.POST(new Request("http://test"), idParams("nope"))).status).toBe(404);
  });

  it("⑦ 已登记源的写入直接生效，不进待采纳区", async () => {
    as("owner@example.com");
    await saveEntity({ kind: "authority", title: "TSO H" }, ENTITIES_ROOT);
    await addSource("tso-h", "https://h.example/rules", ENTITIES_ROOT);
    const outcome = await proposeEntityUpdate(
      { name: "tso-h", field: "capacity", value: "可用 5 GW", evidence: { url: "https://h.example/cap", at: "", locator: "" } },
      { root: ENTITIES_ROOT, autoApply: true }
    );
    expect(outcome.applied).toBe(true);
    expect((await readEntity("tso-h", ENTITIES_ROOT))?.capacity).toBe("可用 5 GW");
    expect(await listProposals(ENTITIES_ROOT)).toEqual([]);
  });

  it("⑧ 知识库总览：按实体、按类型、无归属数与搜索无结果", async () => {
    as("owner@example.com");
    await saveKnowledge({ title: "A 的规格书", content: "x", source: "manual", entity: "友商-a", docType: "产品规格书" }, KNOWLEDGE_ROOT);
    await saveKnowledge({ title: "A 的论文", content: "y", source: "manual", entity: "友商-a", docType: "技术论文" }, KNOWLEDGE_ROOT);
    await saveKnowledge({ title: "散装笔记", content: "z", source: "manual" }, KNOWLEDGE_ROOT);
    await recordSearchMiss("液冷选型对比", KNOWLEDGE_ROOT);
    await recordSearchMiss("液冷选型对比", KNOWLEDGE_ROOT);
    await recordSearchMiss("并网队列位置", KNOWLEDGE_ROOT);

    const body = await (await overviewRoute.GET()).json();
    expect(body.total).toBe(3);
    expect(body.byEntity["友商-a"]).toBe(2);
    expect(body.unowned).toBe(1);
    expect(body.byType["产品规格书"]).toBe(1);
    expect(body.byType["未分类"]).toBe(1);
    // Most-asked first: that ordering is what makes it a to-do list.
    expect(body.misses[0]).toMatchObject({ query: "液冷选型对比", count: 2 });
  });
});
