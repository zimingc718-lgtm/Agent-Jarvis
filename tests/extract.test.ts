import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSource, readEntity, saveEntity } from "@/lib/entities";
import { listProposals } from "@/lib/entity-proposals";
import { extractFields, MAX_CLAIMS, MAX_QUOTE_CHARS } from "@/lib/extract";
import { saveKnowledge } from "@/lib/knowledge";

/**
 * TEST-127 — filing a field value that came out of a document
 * (CR-20260911-home-dashboard, 出口义务 5).
 *
 * The point of these cases is the evidence check, not the plumbing. EV §12.3: a wrong
 * capacity reads exactly like a right one on the board. So the assertions that matter
 * are the refusals — a quote the document does not contain, and a value that is not in
 * the quote it claims to come from.
 */

const DOC = [
  "# 并网容量公告",
  "",
  "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。",
  "下一里程碑：2026-12-31 完成二期验收。",
  "联系部门：接入服务处。",
].join("\n");

describe("extractFields", () => {
  let entitiesRoot: string;
  let knowledgeRoot: string;
  let entryName: string;
  const deps = () => ({ entitiesRoot, knowledgeRoot });

  beforeEach(async () => {
    entitiesRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-ext-e-"));
    knowledgeRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-ext-k-"));
    await saveEntity({ kind: "authority", title: "电网 A" }, entitiesRoot);
    await addSource("电网-a", "https://grid.example/notices", entitiesRoot);
    const entry = await saveKnowledge(
      { title: "并网容量公告", content: DOC, source: "file", entity: "电网-a", sourceUrl: "https://grid.example/notices/2026" },
      knowledgeRoot
    );
    entryName = entry.name;
  });
  afterEach(() => {
    rmSync(entitiesRoot, { recursive: true, force: true });
    rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  it("① 原文在条目里、值在原文里 → 核对通过；来源同域故直接生效，并留下证据", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        claims: [
          { field: "capacity", value: "1200 MW", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" },
          { field: "nextDate", value: "2026-12-31", quote: "下一里程碑：2026-12-31 完成二期验收。" },
        ],
      },
      deps()
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.results.map((r) => r.status)).toEqual(["applied", "applied"]);

    const entity = await readEntity("电网-a", entitiesRoot);
    expect(entity?.capacity).toBe("1200 MW");
    expect(entity?.nextDate).toBe("2026-12-31");
    // The evidence carries the link AND where in the document it came from.
    const capacityEvidence = entity?.evidence.find((item) => item.field === "capacity");
    expect(capacityEvidence?.url).toBe("https://grid.example/notices/2026");
    expect(capacityEvidence?.locator).toContain("本年度已核准并网容量为 1200 MW");
  });

  it("② 原文不在条目里 → 拒绝，不写入也不入队", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        claims: [{ field: "capacity", value: "1800 MW", quote: "本年度已核准并网容量为 1800 MW。" }],
      },
      deps()
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.results[0].status).toBe("rejected");
    expect(outcome.results[0].reason).toContain("不在该条目里");
    expect((await readEntity("电网-a", entitiesRoot))?.capacity).toBe("");
    expect(await listProposals(entitiesRoot)).toEqual([]);
  });

  it("③ 原文属实但值不在其中 → 同样拒绝，这是最容易漏的一种错", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        // The sentence is real; the number quietly drifted on the way out.
        claims: [{ field: "capacity", value: "2100 MW", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" }],
      },
      deps()
    );
    expect(outcome.ok && outcome.results[0].status).toBe("rejected");
    if (outcome.ok) {
      expect(outcome.results[0].reason).toContain("值没有出现在所引原文里");
    }
    expect((await readEntity("电网-a", entitiesRoot))?.capacity).toBe("");
  });

  it("④ 空白差异不算不一致：换行与多空格被归一后仍算逐字命中", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        claims: [{ field: "capacity", value: "1200 MW", quote: "本年度已核准并网容量为   1200 MW，\n较上年增加 300 MW。" }],
      },
      deps()
    );
    expect(outcome.ok && outcome.results[0].status).toBe("applied");
  });

  it("⑤ 条目来源不在该对象已登记源内 → 核对通过也只进待采纳区", async () => {
    const foreign = await saveKnowledge(
      { title: "第三方转载", content: DOC, source: "file", sourceUrl: "https://blog.example/repost" },
      knowledgeRoot
    );
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName: foreign.name,
        claims: [{ field: "capacity", value: "1200 MW", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" }],
      },
      deps()
    );
    expect(outcome.ok && outcome.results[0].status).toBe("queued");
    expect((await readEntity("电网-a", entitiesRoot))?.capacity).toBe("");
    const queued = await listProposals(entitiesRoot);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entity: "电网-a", field: "capacity", value: "1200 MW", url: "https://blog.example/repost" });
  });

  it("⑥ 一次调用里逐条判定：通过的写入，不合格的拒绝，互不牵连", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        claims: [
          { field: "capacity", value: "1200 MW", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" },
          { field: "summary", value: "编造的一句", quote: "这句话文档里没有。" },
          { field: "name", value: "改名", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" },
          { field: "nextLabel", value: "", quote: "下一里程碑：2026-12-31 完成二期验收。" },
        ],
      },
      deps()
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.results.map((r) => r.status)).toEqual(["applied", "rejected", "rejected", "rejected"]);
    // `name` is the entity's own structural field, so it cannot slip in as a parameter.
    expect(outcome.results[2].reason).toContain("结构字段");
    expect((await readEntity("电网-a", entitiesRoot))?.capacity).toBe("1200 MW");
  });

  it("⑦ 对象、条目、原始链接三者缺一不可，缺了整次调用就失败", async () => {
    const claims = [{ field: "capacity", value: "1200 MW", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" }];
    expect(await extractFields({ entity: "不存在", entryName, claims }, deps())).toMatchObject({ ok: false });
    expect(await extractFields({ entity: "电网-a", entryName: "no-such-entry", claims }, deps())).toMatchObject({ ok: false });

    // An entry with no original link cannot be traced back, so nothing from it is filed.
    const linkless = await saveKnowledge({ title: "手记", content: DOC, source: "manual" }, knowledgeRoot);
    const outcome = await extractFields({ entity: "电网-a", entryName: linkless.name, claims }, deps());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("没有原始链接");
    }
  });

  it("⑧ 批量与引文长度都有上限，超出即整次或逐条拒绝", async () => {
    const one = { field: "summary", value: "并网", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" };
    const tooMany = await extractFields(
      { entity: "电网-a", entryName, claims: Array.from({ length: MAX_CLAIMS + 1 }, () => one) },
      deps()
    );
    expect(tooMany.ok).toBe(false);

    const longQuote = await extractFields(
      { entity: "电网-a", entryName, claims: [{ field: "summary", value: "并网", quote: "并".repeat(MAX_QUOTE_CHARS + 1) }] },
      deps()
    );
    expect(longQuote.ok && longQuote.results[0].status).toBe("rejected");

    expect(await extractFields({ entity: "电网-a", entryName, claims: [] }, deps())).toMatchObject({ ok: false });
  });

  it("⑩ 白名单之外的名字按具名技术参数写入，状态一律「未判定」——是否满足只有人能填", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        claims: [{ field: "并网容量", value: "1200 MW", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" }],
      },
      deps()
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.results[0]).toMatchObject({ kind: "param", status: "applied" });

    const entity = await readEntity("电网-a", entitiesRoot);
    expect(entity?.params).toEqual([{ name: "并网容量", value: "1200 MW", status: "unknown" }]);
    // The citation is filed under the parameter's own name.
    expect(entity?.evidence.find((item) => item.field === "并网容量")?.url).toBe("https://grid.example/notices/2026");
    // Seven housekeeping fields still behave as fields.
    expect(entity?.capacity).toBe("");
  });

  it("⑪ 对象自身的结构字段名不能借道成为参数", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        claims: [{ field: "title", value: "1200 MW", quote: "本年度已核准并网容量为 1200 MW，较上年增加 300 MW。" }],
      },
      deps()
    );
    expect(outcome.ok && outcome.results[0].status).toBe("rejected");
    if (outcome.ok) {
      expect(outcome.results[0].reason).toContain("结构字段");
    }
    expect((await readEntity("电网-a", entitiesRoot))?.params).toEqual([]);
  });

  it("⑫ 参数的证据核对与字段一视同仁：编造的引用照样拒绝", async () => {
    const outcome = await extractFields(
      {
        entity: "电网-a",
        entryName,
        claims: [{ field: "谐波限值", value: "3%", quote: "本区域谐波限值为 3%。" }],
      },
      deps()
    );
    expect(outcome.ok && outcome.results[0]).toMatchObject({ kind: "param", status: "rejected" });
    expect((await readEntity("电网-a", entitiesRoot))?.params).toEqual([]);
  });
});
