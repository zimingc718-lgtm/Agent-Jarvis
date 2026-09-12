import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSource, readEntity, saveEntity, STALE_AFTER_DAYS, listEntities } from "@/lib/entities";
import { describeChange, fetchSource, MIN_READABLE_CHARS, readSnapshot, SNAPSHOTS_DIR } from "@/lib/sources";

/**
 * TEST-125 — running a collection source (CR-20260911-home-dashboard, 出口义务 5).
 *
 * The point of these assertions is the health MAPPING, not the fetching. Each state has
 * a different meaning on the board and they must not collapse into each other:
 * unreachable is not the same as unreadable, and neither is the same as quiet.
 */

const URL = "https://src.example/news";
const resolver = async () => ["93.184.216.34"];

function page(body: string): Response {
  return new Response(`<html><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
}

describe("describeChange", () => {
  it("只数行、只引第一条新增，不编内容", () => {
    const before = "第一行\n第二行\n第三行";
    const after = "第一行\n第二行\n第三行\n新的一行内容";
    expect(describeChange(before, after)).toBe("新增 1 行：新的一行内容");
    expect(describeChange(before, "第一行\n第二行")).toBe("移除 1 行");
    expect(describeChange(before, before)).toBe("");
  });

  it("只调换顺序不算变化", () => {
    expect(describeChange("甲\n乙\n丙", "丙\n甲\n乙")).toBe("");
  });

  it("过长的新增行被截断", () => {
    const long = "长".repeat(120);
    expect(describeChange("旧", `旧\n${long}`)).toContain("…");
  });
});

describe("fetchSource", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-src-"));
    await saveEntity({ kind: "competitor", title: "友商 A" }, root);
    await addSource("友商-a", URL, root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("① 首次采集建立基线，不算变化，但健康度转为正常", async () => {
    const fetcher = vi.fn(async () => page("<p>公司公告：本季度产品线更新说明，包含固件版本、接口变更与兼容性提示，正文长度足以被当作可读内容处理。</p>"));
    const outcome = await fetchSource("友商-a", URL, { root, fetcher, resolver });
    expect(outcome).toMatchObject({ health: "fresh", changed: false, detail: "首次采集，已建立基线" });

    const entity = await readEntity("友商-a", root);
    expect(entity?.health).toBe("fresh");
    expect(entity?.checkedAt).not.toBe("");
    // A card must not light up merely because someone configured its source.
    expect(entity?.change).toBe("");
    expect(readdirSync(join(root, SNAPSHOTS_DIR))).toHaveLength(1);
  });

  it("② 内容不变 → 正常且无变更；内容变了 → 写入变更并附证据", async () => {
    const fetcher = vi.fn(async () => page("<p>公司公告：本季度产品线更新说明，包含固件版本、接口变更与兼容性提示，正文长度足以被当作可读内容处理。</p>"));
    await fetchSource("友商-a", URL, { root, fetcher, resolver });

    const same = await fetchSource("友商-a", URL, { root, fetcher, resolver });
    expect(same).toMatchObject({ changed: false, detail: "采集正常，页面无变化" });
    expect((await readEntity("友商-a", root))?.change).toBe("");

    const changedFetcher = vi.fn(async () => page("<p>公司公告：本季度产品线更新说明，包含固件版本、接口变更与兼容性提示，正文长度足以被当作可读内容处理。</p><p>新增一段公告：千兆型号价格调整。</p>"));
    const changed = await fetchSource("友商-a", URL, { root, fetcher: changedFetcher, resolver });
    expect(changed.changed).toBe(true);
    expect(changed.change).toContain("新增 1 行");

    const entity = await readEntity("友商-a", root);
    expect(entity?.change).toContain("新增一段公告");
    expect(entity?.evidence[0]).toMatchObject({ field: "change", url: URL, locator: "采集比对" });
    // Unread follows from the change timestamp, nothing else sets it.
    expect((await listEntities(root))[0].unread).toBe(true);
  });

  it("③ 抓不到 → failed_fetch，且不推进采集时间", async () => {
    const ok = vi.fn(async () => page("<p>公司公告：本季度产品线更新说明，包含固件版本、接口变更与兼容性提示，正文长度足以被当作可读内容处理。</p>"));
    await fetchSource("友商-a", URL, { root, fetcher: ok, resolver });
    const checkedBefore = (await readEntity("友商-a", root))?.checkedAt;

    const down = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const outcome = await fetchSource("友商-a", URL, { root, fetcher: down, resolver });
    expect(outcome.health).toBe("failed_fetch");
    expect(outcome.detail).toContain("ECONNREFUSED");

    const entity = await readEntity("友商-a", root);
    expect(entity?.health).toBe("failed_fetch");
    // Staleness measures the last time we LEARNED something, so a failure must not
    // advance it — otherwise a source that fails daily reads as perpetually fresh.
    expect(entity?.checkedAt).toBe(checkedBefore);
  });

  it("④ HTTP 错误也是 failed_fetch", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 503 }));
    const outcome = await fetchSource("友商-a", URL, { root, fetcher, resolver });
    expect(outcome).toMatchObject({ health: "failed_fetch" });
    expect(outcome.detail).toContain("HTTP 503");
  });

  it("⑤ 抓到了但取不出正文 → parse_failed，这是最危险的一种", async () => {
    const fetcher = vi.fn(async () => new Response("<html><body><script>var a=1</script></body></html>", { status: 200 }));
    const outcome = await fetchSource("友商-a", URL, { root, fetcher, resolver });
    expect(outcome.health).toBe("parse_failed");
    expect(outcome.detail).toContain("取不出正文");
    expect((await readEntity("友商-a", root))?.health).toBe("parse_failed");
    expect(MIN_READABLE_CHARS).toBeGreaterThan(0);
  });

  it("⑥ 解析失败压过时间：刚采集过也不会显示为正常", async () => {
    const ok = vi.fn(async () => page("<p>公司公告：本季度产品线更新说明，包含固件版本、接口变更与兼容性提示，正文长度足以被当作可读内容处理。</p>"));
    await fetchSource("友商-a", URL, { root, fetcher: ok, resolver });
    const broken = vi.fn(async () => new Response("<html><body></body></html>", { status: 200 }));
    await fetchSource("友商-a", URL, { root, fetcher: broken, resolver });
    expect((await listEntities(root))[0].health).toBe("parse_failed");
    expect(STALE_AFTER_DAYS).toBeGreaterThan(0);
  });

  it("⑦ 只采集已登记的源；对象不存在则报错", async () => {
    const fetcher = vi.fn(async () => page("<p>x</p>"));
    await expect(fetchSource("友商-a", "https://other.example/x", { root, fetcher, resolver })).rejects.toMatchObject({ status: 400 });
    await expect(fetchSource("missing", URL, { root, fetcher, resolver })).rejects.toMatchObject({ status: 404 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("⑧ 快照按对象与链接分开存，互不覆盖", async () => {
    const second = "https://src.example/pricing";
    await addSource("友商-a", second, root);
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      page(String(url).includes("pricing") ? "<p>定价页内容：各型号价格、阶梯折扣与渠道政策说明，含生效日期与适用范围，正文长度足以被当作可读内容处理。</p>" : "<p>新闻页内容：近期公告、发布记录与人事变动汇总，含时间线与相关链接，正文长度足以被当作可读内容处理。</p>")
    );
    await fetchSource("友商-a", URL, { root, fetcher, resolver });
    await fetchSource("友商-a", second, { root, fetcher, resolver });
    expect(readdirSync(join(root, SNAPSHOTS_DIR))).toHaveLength(2);
    expect((await readSnapshot(root, "友商-a", URL))?.text).toContain("新闻页");
    expect((await readSnapshot(root, "友商-a", second))?.text).toContain("定价页");
  });
});
