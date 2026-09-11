import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSource, listEntities, listPendingEntities, readEntity, saveEntity } from "@/lib/entities";
import { listProposals } from "@/lib/entity-proposals";
import { createEntityTools } from "@/lib/tools/entity-tools";
import { ToolRegistry, type ToolContext } from "@/lib/tools/registry";

/**
 * TEST-121 — the entity tools, and above all the trust gate on direct writes
 * (CR-20260911-home-dashboard §6: 判据在工具里，不由模型自称).
 */

const context: ToolContext = {
  userId: "u",
  conversationId: "c",
  skillCount: 0,
  webEnabled: false,
  searchConfigured: false,
  knowledgeCount: 0,
};

describe("entity tools", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-et-"));
    await saveEntity(
      { kind: "authority", title: "TSO A", summary: "北部电网", capacity: "可用 1.2 GW", nextLabel: "意见截止", nextDate: "2026-10-15" },
      root
    );
    await addSource("tso-a", "https://tso-a.example/rules", root);
    await saveEntity({ kind: "competitor", title: "友商 B", summary: "价格战主力" }, root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const tools = () => {
    const [list, read, propose, proposeUpdate] = createEntityTools({ root });
    return { list, read, propose, proposeUpdate };
  };

  it("① 四个工具描述都在 200 字符内，可注册", () => {
    const registry = new ToolRegistry();
    for (const tool of createEntityTools({ root })) {
      expect(() => registry.register(tool)).not.toThrow();
    }
    expect(registry.availableFor(context).map((t) => t.name)).toEqual([
      "list_entities",
      "read_entity",
      "propose_entity",
      "propose_entity_update",
    ]);
  });

  it("② list_entities 每行都说出采集状态，并可按 kind 过滤", async () => {
    const { list } = tools();
    const all = await list.execute({}, context);
    expect(all.ok).toBe(true);
    // Silence is ambiguous unless the collection state is always printed.
    expect(all.content).toContain("采集：未配置采集源");
    expect(all.content).toContain("采集：信息陈旧");
    expect(all.content).toContain("TSO A");
    expect(all.content).toContain("友商 B");

    const only = await list.execute({ kind: "authority" }, context);
    expect(only.content).toContain("TSO A");
    expect(only.content).not.toContain("友商 B");
    expect((await list.execute({ kind: "nope" }, context)).ok).toBe(false);
  });

  it("③ read_entity 给出容量、下一步与采集源；未知名称失败并提示先列表", async () => {
    const { read } = tools();
    const hit = await read.execute({ name: "tso-a" }, context);
    expect(hit.content).toContain("容量：可用 1.2 GW");
    expect(hit.content).toContain("下一步：意见截止 2026-10-15");
    expect(hit.content).toContain("https://tso-a.example/rules");

    const missing = await read.execute({ name: "nope" }, context);
    expect(missing.ok).toBe(false);
    expect(missing.content).toContain("list_entities");
    expect((await read.execute({}, context)).ok).toBe(false);
  });

  it("④ propose_entity 只写待采纳区，看板上看不到", async () => {
    const { propose } = tools();
    const result = await propose.execute({ kind: "customer", title: "客户 C", summary: "需 200 MW" }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("提议对象：客户 C");
    expect((await listPendingEntities(root)).map((e) => e.title)).toEqual(["客户 C"]);
    expect((await listEntities(root)).map((e) => e.title)).not.toContain("客户 C");
    expect((await propose.execute({ kind: "nope", title: "x" }, context)).ok).toBe(false);
  });

  it("⑤ 没有 source_url 一律拒绝——没有来源的值不写入", async () => {
    const { proposeUpdate } = tools();
    const result = await proposeUpdate.execute({ name: "tso-a", field: "capacity", value: "可用 2 GW" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("没有来源的值不写入");
    expect((await readEntity("tso-a", root))?.capacity).toBe("可用 1.2 GW");
  });

  it("⑥ 来源不在该对象已登记的源内 → 进待采纳，实体不变", async () => {
    const { proposeUpdate } = tools();
    const result = await proposeUpdate.execute(
      { name: "tso-a", field: "capacity", value: "可用 9 GW", source_url: "https://random-blog.example/post", locator: "第 2 段" },
      context
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("不在该对象已登记的采集源内");
    // The board must not move on a claim the model made about an unregistered page.
    expect((await readEntity("tso-a", root))?.capacity).toBe("可用 1.2 GW");
    const queued = await listProposals(root);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entity: "tso-a", field: "capacity", value: "可用 9 GW" });
  });

  it("⑦ 来源与已登记的源同域 → 直接生效，并留下证据", async () => {
    const { proposeUpdate } = tools();
    const result = await proposeUpdate.execute(
      { name: "tso-a", field: "capacity", value: "可用 0.8 GW", source_url: "https://tso-a.example/capacity/2026", locator: "表 3" },
      context
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("直接生效");
    const entity = await readEntity("tso-a", root);
    expect(entity?.capacity).toBe("可用 0.8 GW");
    expect(entity?.evidence[0]).toMatchObject({ field: "capacity", url: "https://tso-a.example/capacity/2026", locator: "表 3" });
    expect(await listProposals(root)).toEqual([]);
  });

  it("⑧ 未登记任何源的对象，任何来源都不能直接写入", async () => {
    const { proposeUpdate } = tools();
    const result = await proposeUpdate.execute(
      { name: "友商-b", field: "change", value: "发布新固件", source_url: "https://b.example/news" },
      context
    );
    expect(result.content).toContain("不在该对象已登记的采集源内");
    expect((await readEntity("友商-b", root))?.change).toBe("");
    expect(await listProposals(root)).toHaveLength(1);
  });

  it("⑨ 字段不在白名单、对象不存在、链接非法都作失败回喂而非抛错", async () => {
    const { proposeUpdate } = tools();
    expect((await proposeUpdate.execute({ name: "tso-a", field: "title", value: "x", source_url: "https://tso-a.example" }, context)).ok).toBe(false);
    expect((await proposeUpdate.execute({ name: "nope", field: "capacity", value: "x", source_url: "https://tso-a.example" }, context)).ok).toBe(false);
    const bad = await proposeUpdate.execute({ name: "tso-a", field: "capacity", value: "x", source_url: "不是链接" }, context);
    expect(bad.ok).toBe(false);
    expect(bad.summary).toBe("来源非法");
  });
});
