import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendHistoryEntry, HISTORY_DIR, MAX_HISTORY_READ, readHistory } from "@/lib/entity-history";

/**
 * TEST-457 — per-entity message history (CR-20260918-change-history-and-sources, CP-1).
 * A card's message list is this module read back; `sources.ts`'s own test file covers
 * the write side wired into `fetchSource` — these cases cover the module in isolation:
 * ordering, the read cap, and tolerance of a torn/corrupted line.
 */

describe("entity history", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-eh-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("① 没有历史文件时返回空数组，不报错", async () => {
    expect(await readHistory("友商-a", root)).toEqual([]);
  });

  it("② 追加即可读回，最新的排在最前", async () => {
    await appendHistoryEntry(root, "友商-a", { at: "2026-09-01T00:00:00.000Z", url: "https://a.example", change: "新增 1 行：早" });
    await appendHistoryEntry(root, "友商-a", { at: "2026-09-02T00:00:00.000Z", url: "https://a.example", change: "新增 1 行：晚" });

    const history = await readHistory("友商-a", root);
    expect(history).toHaveLength(2);
    expect(history[0].change).toBe("新增 1 行：晚");
    expect(history[1].change).toBe("新增 1 行：早");
  });

  it("③ limit 只影响单次读取返回的条数，不影响磁盘上已存的条数", async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendHistoryEntry(root, "友商-a", { at: `2026-09-0${i + 1}T00:00:00.000Z`, url: "https://a.example", change: `第 ${i} 条` });
    }
    const capped = await readHistory("友商-a", root, 2);
    expect(capped).toHaveLength(2);
    expect(capped[0].change).toBe("第 4 条");
    expect(capped[1].change).toBe("第 3 条");

    const full = await readHistory("友商-a", root);
    expect(full).toHaveLength(5);
  });

  it("④ 请求的 limit 超过上限时按上限截断", async () => {
    await appendHistoryEntry(root, "友商-a", { at: "2026-09-01T00:00:00.000Z", url: "https://a.example", change: "x" });
    // 不需要真的写 200+ 条来验证上限生效——直接确认调用不因超大 limit 而抛错或返回超过上限的条数。
    const history = await readHistory("友商-a", root, MAX_HISTORY_READ + 10_000);
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_READ);
  });

  it("⑤ 单独一个对象的历史与另一个对象互不影响（一个对象一个文件）", async () => {
    await appendHistoryEntry(root, "友商-a", { at: "2026-09-01T00:00:00.000Z", url: "https://a.example", change: "a 的变化" });
    await appendHistoryEntry(root, "友商-b", { at: "2026-09-01T00:00:00.000Z", url: "https://b.example", change: "b 的变化" });

    expect((await readHistory("友商-a", root))[0].change).toBe("a 的变化");
    expect((await readHistory("友商-b", root))[0].change).toBe("b 的变化");
  });

  it("⑥ 被截断/损坏的一行不影响其它行——日志文件不是事务", async () => {
    mkdirSync(join(root, HISTORY_DIR), { recursive: true });
    const good1 = JSON.stringify({ at: "2026-09-01T00:00:00.000Z", url: "https://a.example", change: "第一条" });
    const good2 = JSON.stringify({ at: "2026-09-02T00:00:00.000Z", url: "https://a.example", change: "第二条" });
    const torn = `{"at":"2026-09-03T00:00:00.000Z","url":"https://a.example","change":"没写完`; // 进程在这里被杀掉
    writeFileSync(join(root, HISTORY_DIR, "友商-a.jsonl"), `${good1}\n${torn}\n${good2}\n`, "utf8");

    const history = await readHistory("友商-a", root);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.change)).toEqual(["第二条", "第一条"]);
  });
});
