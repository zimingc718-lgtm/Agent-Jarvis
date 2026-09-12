import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addSource,
  adoptPendingEntity,
  deleteEntity,
  discardPendingEntity,
  effectiveHealth,
  EntityError,
  isReservedParamName,
  listEntities,
  MAX_PARAMS,
  listPendingEntities,
  markSeen,
  parseEntityFile,
  readEntity,
  removeParam,
  removeSource,
  renderEntityFile,
  saveEntity,
  setParam,
  slugifyEntityName,
  STALE_AFTER_DAYS,
  updateEntity,
} from "@/lib/entities";

/**
 * TEST-120 — tracked entities: storage, the two independent indicators, and the
 * approval queue (CR-20260911-home-dashboard §3 §4 §6).
 */

const DAY = 86_400_000;

describe("entity storage", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-ent-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("① 保存即一个带 frontmatter 的 .md，读回字段一致", async () => {
    const saved = await saveEntity(
      {
        kind: "authority",
        title: "TSO A",
        summary: "北部电网运营商",
        capacity: "可用 1.2 GW",
        nextLabel: "意见截止",
        nextDate: "2026-10-15",
        sources: ["https://tso-a.example/rules"],
        now: () => new Date("2026-09-11T00:00:00Z"),
      },
      root
    );
    expect(saved.name).toBe("tso-a");
    expect(readdirSync(root)).toEqual(["tso-a.md"]);
    const raw = readFileSync(join(root, "tso-a.md"), "utf8");
    expect(raw.startsWith("---\nkind: authority\ntitle: TSO A\n")).toBe(true);
    expect(raw).toContain("source: https://tso-a.example/rules");

    const entity = await readEntity("tso-a", root);
    expect(entity).toMatchObject({
      kind: "authority",
      title: "TSO A",
      capacity: "可用 1.2 GW",
      nextDate: "2026-10-15",
      sources: ["https://tso-a.example/rules"],
    });
  });

  it("② 手写的最小文件也算实体，缺字段有兜底", async () => {
    writeFileSync(join(root, "hand.md"), "---\nkind: customer\n---\n\n# 手写客户\n\n备注。\n", "utf8");
    const entity = await readEntity("hand", root);
    expect(entity).toMatchObject({ kind: "customer", title: "手写客户" });
    // No source line at all means it has never been collected from.
    expect(entity && effectiveHealth(entity)).toBe("unconfigured");
    expect(parseEntityFile("", { name: "fallback", createdAt: "t" }).title).toBe("fallback");
    // An unknown kind falls back rather than throwing on read.
    expect(parseEntityFile("---\nkind: nope\n---\n", { name: "x", createdAt: "t" }).kind).toBe("competitor");
  });

  it("③ 非法 kind 与空名称拒绝；路径穿越在 slug 层消失", async () => {
    await expect(saveEntity({ kind: "nope" as never, title: "x" }, root)).rejects.toBeInstanceOf(EntityError);
    await expect(saveEntity({ kind: "competitor", title: "   " }, root)).rejects.toMatchObject({ status: 400 });
    expect(slugifyEntityName("../../etc/passwd")).toBe("etc-passwd");
    const saved = await saveEntity({ kind: "competitor", title: "x", preferredName: "../../evil" }, root);
    expect(saved.name).toBe("evil");
    expect(await readEntity("../evil", root)).toBeNull();
    expect(await deleteEntity("../evil", root)).toBe(false);
  });

  it("④ 同名自动加序号，不覆盖", async () => {
    const a = await saveEntity({ kind: "competitor", title: "友商 A" }, root);
    const b = await saveEntity({ kind: "competitor", title: "友商 A" }, root);
    expect(a.name).toBe("友商-a");
    expect(b.name).toBe("友商-a-2");
  });

  it("⑤ 顺序固定：按 kind 再按名称，不受修改时间影响", async () => {
    await saveEntity({ kind: "customer", title: "客户 Z" }, root);
    await saveEntity({ kind: "competitor", title: "友商 B" }, root);
    await saveEntity({ kind: "authority", title: "TSO C" }, root);
    await saveEntity({ kind: "competitor", title: "友商 A" }, root);
    // Touch the first one last; a recency sort would move it, this one must not.
    await updateEntity("客户-z", { field: "summary", value: "刚改过" }, root);
    expect((await listEntities(root)).map((e) => e.name)).toEqual(["友商-a", "友商-b", "tso-c", "客户-z"]);
  });
});

describe("采集健康度与未读，两个独立的指示", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-enth-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("① 没有源 → unconfigured；加了源但从未采集 → stale，不是 fresh", async () => {
    const saved = await saveEntity({ kind: "competitor", title: "友商 A" }, root);
    expect(saved.health).toBe("unconfigured");
    const withSource = await addSource(saved.name, "https://a.example/pricing", root);
    // The whole point: a configured but never-collected source is not "fine".
    expect(withSource?.health).toBe("stale");
  });

  it("② 采集时间决定 fresh / stale；硬失败压过时间", async () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const saved = await saveEntity({ kind: "competitor", title: "友商 B", sources: ["https://b.example"] }, root);
    await updateEntity(saved.name, { field: "checkedAt", value: new Date(now.getTime() - DAY).toISOString() }, root);
    await updateEntity(saved.name, { field: "health", value: "fresh" }, root);
    expect((await listEntities(root, now))[0].health).toBe("fresh");

    await updateEntity(saved.name, { field: "checkedAt", value: new Date(now.getTime() - (STALE_AFTER_DAYS + 1) * DAY).toISOString() }, root);
    expect((await listEntities(root, now))[0].health).toBe("stale");

    // Recent check but the parser broke: still broken, not fresh.
    await updateEntity(saved.name, { field: "checkedAt", value: new Date(now.getTime() - DAY).toISOString() }, root);
    await updateEntity(saved.name, { field: "health", value: "parse_failed" }, root);
    expect((await listEntities(root, now))[0].health).toBe("parse_failed");
  });

  it("③ 移除最后一个源 → 退回 unconfigured", async () => {
    const saved = await saveEntity({ kind: "competitor", title: "友商 C", sources: ["https://c.example"] }, root);
    const after = await removeSource(saved.name, "https://c.example", root);
    expect(after?.sources).toEqual([]);
    expect(after?.health).toBe("unconfigured");
  });

  it("④ 源必须是 http/https、不得带凭据、不得重复", async () => {
    const saved = await saveEntity({ kind: "competitor", title: "友商 D" }, root);
    await expect(addSource(saved.name, "不是链接", root)).rejects.toMatchObject({ status: 400 });
    await expect(addSource(saved.name, "ftp://x.example", root)).rejects.toMatchObject({ status: 400 });
    await expect(addSource(saved.name, "https://u:p@x.example", root)).rejects.toMatchObject({ status: 400 });
    await addSource(saved.name, "https://x.example", root);
    await expect(addSource(saved.name, "https://x.example", root)).rejects.toMatchObject({ status: 409 });
    expect(await addSource("missing", "https://x.example", root)).toBeNull();
  });

  it("⑤ 写入 change 会盖上时间戳，卡片因此变未读；点开（markSeen）后清除", async () => {
    const saved = await saveEntity({ kind: "competitor", title: "友商 E" }, root);
    expect(saved.unread).toBe(false);
    const changed = await updateEntity(saved.name, { field: "change", value: "定价页下调 12%" }, root);
    expect(changed?.unread).toBe(true);
    expect(changed?.changeAt).not.toBe("");

    const seen = await markSeen(saved.name, root, new Date(Date.now() + 1000));
    expect(seen?.unread).toBe(false);
    // The change text stays; only the receipt moved.
    expect(seen?.change).toBe("定价页下调 12%");
    expect(await markSeen("missing", root)).toBeNull();
  });

  it("⑥ 更新只接受白名单字段；证据按字段去重保存", async () => {
    const saved = await saveEntity({ kind: "authority", title: "TSO F" }, root);
    await expect(updateEntity(saved.name, { field: "title" as never, value: "x" }, root)).rejects.toBeInstanceOf(EntityError);

    await updateEntity(
      saved.name,
      { field: "capacity", value: "可用 1.0 GW", evidence: { url: "https://f.example/a", at: "", locator: "表 1" } },
      root
    );
    await updateEntity(
      saved.name,
      { field: "capacity", value: "可用 1.2 GW", evidence: { url: "https://f.example/b", at: "", locator: "表 2" } },
      root
    );
    const entity = await readEntity(saved.name, root);
    expect(entity?.capacity).toBe("可用 1.2 GW");
    expect(entity?.evidence).toHaveLength(1);
    expect(entity?.evidence[0]).toMatchObject({ field: "capacity", url: "https://f.example/b", locator: "表 2" });
    expect(await updateEntity("missing", { field: "capacity", value: "x" }, root)).toBeNull();
  });

  it("renderEntityFile 把换行折成空格，不破坏 frontmatter", () => {
    const raw = renderEntityFile({
      params: [],
      kind: "competitor",
      title: "两\n行",
      summary: "",
      capacity: "",
      nextLabel: "",
      nextDate: "",
      health: "unconfigured",
      checkedAt: "",
      change: "",
      changeAt: "",
      seenAt: "",
      sources: [],
      evidence: [],
      createdAt: "t",
      body: "",
    });
    expect(raw.split("\n")[2]).toBe("title: 两 行");
  });
});

describe("待采纳区", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-entp-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("① 提议不进看板，采纳后才进；忽略即删", async () => {
    const proposed = await saveEntity({ kind: "competitor", title: "友商 X", pending: true }, root);
    expect(await listEntities(root)).toEqual([]);
    expect((await listPendingEntities(root)).map((e) => e.name)).toEqual(["友商-x"]);

    const adopted = await adoptPendingEntity(proposed.name, root);
    expect(adopted?.name).toBe("友商-x");
    expect(await listPendingEntities(root)).toEqual([]);
    expect((await listEntities(root)).map((e) => e.name)).toEqual(["友商-x"]);

    const second = await saveEntity({ kind: "competitor", title: "友商 Y", pending: true }, root);
    expect(await discardPendingEntity(second.name, root)).toBe(true);
    expect(await listPendingEntities(root)).toEqual([]);
    expect(await adoptPendingEntity("missing", root)).toBeNull();
    expect(await discardPendingEntity("missing", root)).toBe(false);
  });

  it("② 采纳时与已有实体同名则加序号，不覆盖", async () => {
    await saveEntity({ kind: "competitor", title: "友商 Z" }, root);
    await updateEntity("友商-z", { field: "summary", value: "原有的" }, root);
    await saveEntity({ kind: "competitor", title: "友商 Z", pending: true }, root);
    const adopted = await adoptPendingEntity("友商-z", root);
    expect(adopted?.name).toBe("友商-z-2");
    expect((await readEntity("友商-z", root))?.summary).toBe("原有的");
  });
});

describe("具名技术参数（CR-20260912-technical-spine）", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-param-"));
    await saveEntity({ kind: "authority", title: "TSO P" }, root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("① 写入即落到 frontmatter 的 param 行，读回一致，默认未判定", async () => {
    const summary = await setParam("tso-p", { name: "LVRT 持续时间", value: "150 ms" }, root);
    expect(summary?.params).toEqual([{ name: "LVRT 持续时间", value: "150 ms", status: "unknown" }]);
    expect(readFileSync(join(root, "tso-p.md"), "utf8")).toContain("param: LVRT 持续时间 | 150 ms | unknown");
    expect((await readEntity("tso-p", root))?.params[0]).toMatchObject({ name: "LVRT 持续时间", value: "150 ms" });
  });

  it("② 同名再写是更新而不是追加——同一条要求不该变成两行互相打架的数字", async () => {
    await setParam("tso-p", { name: "效率", value: "98.0%" }, root);
    const summary = await setParam("tso-p", { name: "效率", value: "98.5%" }, root);
    expect(summary?.params).toHaveLength(1);
    expect(summary?.params[0].value).toBe("98.5%");
  });

  it("③ 状态只在显式给出时才变；不给就保留原状态", async () => {
    await setParam("tso-p", { name: "谐波", value: "3%", status: "unmet" }, root);
    const kept = await setParam("tso-p", { name: "谐波", value: "2%" }, root);
    expect(kept?.params[0]).toMatchObject({ value: "2%", status: "unmet" });
    const changed = await setParam("tso-p", { name: "谐波", value: "2%", status: "meets" }, root);
    expect(changed?.params[0].status).toBe("meets");
  });

  it("④ unmet 是数出来的，不是存下来的", async () => {
    await setParam("tso-p", { name: "a", value: "1", status: "unmet" }, root);
    await setParam("tso-p", { name: "b", value: "2", status: "unmet" }, root);
    await setParam("tso-p", { name: "c", value: "3", status: "meets" }, root);
    expect((await listEntities(root))[0].unmet).toBe(2);
    await setParam("tso-p", { name: "a", value: "1", status: "meets" }, root);
    expect((await listEntities(root))[0].unmet).toBe(1);
  });

  it("⑤ 证据按参数名归档；删参数把它的证据一并带走", async () => {
    await setParam(
      "tso-p",
      { name: "LVRT", value: "150 ms", evidence: { url: "https://tso.example/rule", at: "", locator: "第 4.2 节" } },
      root
    );
    expect((await readEntity("tso-p", root))?.evidence).toMatchObject([{ field: "LVRT", url: "https://tso.example/rule" }]);
    const after = await removeParam("tso-p", "LVRT", root);
    expect(after?.params).toEqual([]);
    expect((await readEntity("tso-p", root))?.evidence).toEqual([]);
  });

  it("⑥ 手写的半行也读得回来：只有名字和值，没有状态", async () => {
    writeFileSync(join(root, "手写.md"), "---\nkind: authority\ntitle: 手写\nparam: 只有名字\nparam: 有值 | 10 A\n---\n\n正文", "utf8");
    const entity = await readEntity("手写", root);
    expect(entity?.params).toEqual([
      { name: "只有名字", value: "", status: "unknown" },
      { name: "有值", value: "10 A", status: "unknown" },
    ]);
  });

  it("⑦ 参数名与条数都有上限，空名拒绝", async () => {
    await expect(setParam("tso-p", { name: "   ", value: "x" }, root)).rejects.toBeInstanceOf(EntityError);
    for (let index = 0; index < MAX_PARAMS; index += 1) {
      await setParam("tso-p", { name: `p${index}`, value: "1" }, root);
    }
    await expect(setParam("tso-p", { name: "再来一条", value: "1" }, root)).rejects.toBeInstanceOf(EntityError);
    // Updating one that already exists is still allowed at the ceiling.
    await expect(setParam("tso-p", { name: "p0", value: "2" }, root)).resolves.toBeTruthy();
  });

  it("⑧ 值里的分隔符被消掉，不会撑坏那一行", async () => {
    const summary = await setParam("tso-p", { name: "通信规约", value: "IEC 61850 | 私有\n扩展" }, root);
    expect(summary?.params[0].value).toBe("IEC 61850   私有 扩展");
    expect((await readEntity("tso-p", root))?.params).toHaveLength(1);
  });

  it("⑨ 对象自身的结构字段不能当参数名", () => {
    expect(isReservedParamName("title")).toBe(true);
    expect(isReservedParamName("Sources")).toBe(true);
    expect(isReservedParamName("LVRT 持续时间")).toBe(false);
  });
});
