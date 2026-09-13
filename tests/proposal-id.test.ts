import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveEntity } from "@/lib/entities";
import { listProposals, proposeEntityUpdate } from "@/lib/entity-proposals";
import { extractFields } from "@/lib/extract";
import { saveKnowledge } from "@/lib/knowledge";

/**
 * TEST-260 — 实体提议 ID 去碰撞（CR-20260912-proposal-id-collision）。
 *
 * 这组用例防的是**静默丢数据**：旧实现把 id 归一成 `[0-9a-z-]` 再拼一个**秒级**时间戳，
 * 于是同一实体、同一秒、字段名均为纯中文的多条提议 id 完全相同、互相覆盖，
 * 而工具层报的是「写入 4 个字段」。实测 4 条入参只落盘 2 条，存活的正是唯一带 ASCII 的两个。
 *
 * 所以 ① 必须**同时**断言「id 互不相同」与「全部落盘」——只断言 id 不同的话，
 * 一个静默丢弃后来者的实现照样能过。
 */

const FIXED = new Date("2026-09-12T17:43:30.123Z");
const fixedNow = () => FIXED;

const CHINESE_FIELDS = ["液冷方案形态", "标准组织席位", "散热冗余设计", "供电拓扑"];

describe("提议 ID 不因中文字段名而碰撞", () => {
  let entitiesRoot: string;

  beforeEach(async () => {
    entitiesRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-pid-"));
    await saveEntity({ kind: "competitor", title: "维谛技术 Vertiv" }, entitiesRoot);
  });

  afterEach(() => {
    rmSync(entitiesRoot, { recursive: true, force: true });
  });

  const propose = (field: string, now = fixedNow) =>
    proposeEntityUpdate(
      {
        name: "维谛技术-vertiv",
        kind: "param",
        field,
        value: "待查",
        evidence: { url: "https://vertiv.example/a", at: "", locator: "条目 x：待查" },
      },
      { root: entitiesRoot, now }
    );

  it("同一实体、同一毫秒、多个纯中文字段名产生互不相同的 id，且四条全部落盘", async () => {
    const outcomes = [];
    for (const field of CHINESE_FIELDS) {
      outcomes.push(await propose(field));
    }

    const ids = outcomes.map((o) => o.proposal.id);
    expect(new Set(ids).size).toBe(CHINESE_FIELDS.length);

    // 落盘才算数——这一条是本用例的重点，不是 id 好看就行。
    const stored = await listProposals(entitiesRoot);
    expect(stored).toHaveLength(CHINESE_FIELDS.length);
    expect(stored.map((p) => p.field).sort()).toEqual([...CHINESE_FIELDS].sort());

    // 没有一条是覆盖出来的。
    expect(outcomes.every((o) => o.overwrote === false)).toBe(true);
  });

  it("id 仍是可读的：保留实体的 ASCII 前缀，便于从文件名认出是谁的哪个字段", async () => {
    const { proposal } = await propose("液冷方案形态");
    expect(proposal.id).toMatch(/^[0-9a-z-]{1,80}$/);
    expect(proposal.id).toContain("vertiv");
  });

  it("同一实体同一字段的两次提议仍可区分", async () => {
    const first = await propose("液冷方案形态");
    const later = await propose("液冷方案形态", () => new Date(FIXED.getTime() + 1));

    expect(first.proposal.id).not.toBe(later.proposal.id);
    expect(await listProposals(entitiesRoot)).toHaveLength(2);
  });

  it("同一实体、同一字段、同一毫秒的重复提交据实报告为覆盖", async () => {
    await propose("液冷方案形态");
    const second = await propose("液冷方案形态");

    expect(second.overwrote).toBe(true);
    expect(await listProposals(entitiesRoot)).toHaveLength(1);
  });
});

describe("extract_fields 的汇总取实际落盘条数", () => {
  let entitiesRoot: string;
  let knowledgeRoot: string;
  let entryName: string;

  const DOC = ["# 维谛技术产品公告", "", "液冷方案形态为冷板式。", "供电拓扑为 800VDC。"].join("\n");

  beforeEach(async () => {
    entitiesRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-pid-e-"));
    knowledgeRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-pid-k-"));
    await saveEntity({ kind: "competitor", title: "维谛技术 Vertiv" }, entitiesRoot);
    // 刻意不登记采集源：来源在已登记源内会走 autoApply 直接生效，绕开提议队列，
    // 而本用例要测的正是提议 id 的落盘。
    const entry = await saveKnowledge(
      {
        title: "维谛技术产品公告",
        content: DOC,
        source: "file",
        entity: "维谛技术-vertiv",
        sourceUrl: "https://vertiv.example/news/1",
      },
      knowledgeRoot
    );
    entryName = entry.name;
  });

  afterEach(() => {
    rmSync(entitiesRoot, { recursive: true, force: true });
    rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  it("两个纯中文字段名在同一毫秒提交时都落盘，不再互相覆盖", async () => {
    const outcome = await extractFields(
      {
        entity: "维谛技术-vertiv",
        entryName,
        claims: [
          { field: "液冷方案形态", value: "冷板式", quote: "液冷方案形态为冷板式。" },
          { field: "供电拓扑", value: "800VDC", quote: "供电拓扑为 800VDC。" },
        ],
      },
      { entitiesRoot, knowledgeRoot, now: fixedNow }
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.results.filter((r) => r.status !== "rejected")).toHaveLength(2);
    expect(outcome.results.every((r) => r.overwrote === false)).toBe(true);
    expect(await listProposals(entitiesRoot)).toHaveLength(2);
  });
});
