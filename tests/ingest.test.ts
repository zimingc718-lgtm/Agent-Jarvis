import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSource, saveEntity } from "@/lib/entities";
import { ingestUrl } from "@/lib/ingest";
import { listKnowledge, listPending, readKnowledge, searchKnowledge } from "@/lib/knowledge";

/**
 * TEST-126 — turning a link into a knowledge entry (CR-20260911-home-dashboard, 出口义务 5).
 *
 * Two things are being pinned here. The storage shape: extracted text plus the original
 * link, and no original file. And the trust gate: the model does not get to walk an
 * unattributed page into the searchable base, while the user pasting a link does.
 */

const BODY =
  "<p>公司公告：本季度产品线更新说明，包含固件版本、接口变更与兼容性提示，正文长度足以被当作可读内容处理。</p>";
const resolver = async () => ["93.184.216.34"];

function page(body = BODY, title = "更新公告"): Response {
  return new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("ingestUrl", () => {
  let entitiesRoot: string;
  let knowledgeRoot: string;
  const base = () => ({ entitiesRoot, knowledgeRoot, resolver });

  beforeEach(async () => {
    entitiesRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-ing-e-"));
    knowledgeRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-ing-k-"));
    await saveEntity({ kind: "competitor", title: "友商 A" }, entitiesRoot);
    await addSource("友商-a", "https://a.example/news", entitiesRoot);
  });
  afterEach(() => {
    rmSync(entitiesRoot, { recursive: true, force: true });
    rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  it("① 存正文 + 存原链接 + 不存原件；标题取自页面 title", async () => {
    const fetcher = vi.fn(async () => page());
    const outcome = await ingestUrl("https://a.example/news/2026", { ...base(), fetcher, entity: "友商-a", docType: "产品规格书" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.entry).toMatchObject({ title: "更新公告", entity: "友商-a", docType: "产品规格书" });
    expect(outcome.entry.sourceUrl).toBe("https://a.example/news/2026");

    const raw = readFileSync(join(knowledgeRoot, `${outcome.entry.name}.md`), "utf8");
    expect(raw).toContain("url: https://a.example/news/2026");
    expect(raw).toContain("entity: 友商-a");
    // The text, not the page: no markup is carried into the base.
    expect(raw).toContain("本季度产品线更新说明");
    expect(raw).not.toContain("<p>");
  });

  it("② 来源与该对象已登记的源同域 → 直接入库，立刻可检索", async () => {
    const fetcher = vi.fn(async () => page());
    const outcome = await ingestUrl("https://a.example/news/2026", { ...base(), fetcher, entity: "友商-a" });
    expect(outcome.ok && outcome.pending).toBe(false);
    expect((await listKnowledge(knowledgeRoot)).map((e) => e.entity)).toEqual(["友商-a"]);
    expect((await searchKnowledge("固件版本", 5, knowledgeRoot)).length).toBeGreaterThan(0);
  });

  it("③ 来源不在已登记源内 → 进待采纳区，采纳前检索不到", async () => {
    const fetcher = vi.fn(async () => page());
    const outcome = await ingestUrl("https://random-blog.example/post", { ...base(), fetcher, entity: "友商-a" });
    expect(outcome.ok && outcome.pending).toBe(true);
    if (outcome.ok) {
      expect(outcome.reason).toContain("不在「友商-a」已登记的采集源内");
    }
    expect(await listKnowledge(knowledgeRoot)).toEqual([]);
    expect((await listPending(knowledgeRoot)).length).toBe(1);
    expect(await searchKnowledge("固件版本", 5, knowledgeRoot)).toEqual([]);
  });

  it("④ 未指定归属对象 → 也进待采纳区", async () => {
    const fetcher = vi.fn(async () => page());
    const outcome = await ingestUrl("https://a.example/news/2026", { ...base(), fetcher });
    expect(outcome.ok && outcome.pending).toBe(true);
    if (outcome.ok) {
      expect(outcome.reason).toContain("未指定归属对象");
    }
  });

  it("⑤ 用户自己贴的链接不受来源白名单限制", async () => {
    const fetcher = vi.fn(async () => page());
    const outcome = await ingestUrl("https://random-blog.example/post", { ...base(), fetcher, trustCaller: true });
    expect(outcome.ok && outcome.pending).toBe(false);
    if (outcome.ok) {
      expect(outcome.reason).toBe("由你直接添加，已入库。");
    }
    expect((await listKnowledge(knowledgeRoot)).length).toBe(1);
  });

  it("⑥ 模型路径可强制进待采纳区，即便来源可信", async () => {
    const fetcher = vi.fn(async () => page());
    const outcome = await ingestUrl("https://a.example/news/2026", {
      ...base(),
      fetcher,
      entity: "友商-a",
      alwaysPending: true,
    });
    expect(outcome.ok && outcome.pending).toBe(true);
  });

  it("⑦ 非法链接、未知对象、抓取与解析失败都作失败返回，不入库", async () => {
    const fetcher = vi.fn(async () => page());
    expect(await ingestUrl("不是链接", { ...base(), fetcher })).toMatchObject({ ok: false, reason: "不是合法的 URL。" });
    expect(await ingestUrl("ftp://a.example/x", { ...base(), fetcher })).toMatchObject({ ok: false });
    expect(await ingestUrl("https://a.example/x", { ...base(), fetcher, entity: "missing" })).toMatchObject({ ok: false });
    // Trust is resolved before the request, so an unknown entity costs no traffic.
    expect(fetcher).not.toHaveBeenCalled();

    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await ingestUrl("https://a.example/x", { ...base(), fetcher: down })).toMatchObject({ ok: false });

    const empty = vi.fn(async () => new Response("<html><body></body></html>", { status: 200 }));
    const parseFail = await ingestUrl("https://a.example/x", { ...base(), fetcher: empty });
    expect(parseFail.ok).toBe(false);
    if (!parseFail.ok) {
      expect(parseFail.reason).toContain("取不出正文");
    }
    expect(await listKnowledge(knowledgeRoot)).toEqual([]);
    expect(await listPending(knowledgeRoot)).toEqual([]);
  });

  it("⑧ 正文超过条目上限时拒绝，并提示改为摘录", async () => {
    const huge = `<p>${"字".repeat(30_000)}</p>`;
    const fetcher = vi.fn(async () => page(huge));
    const outcome = await ingestUrl("https://a.example/x", { ...base(), fetcher, trustCaller: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("摘录");
    }
  });

  it("⑨ 无标题的页面退回用主机名，条目仍可读回", async () => {
    const fetcher = vi.fn(async () => new Response(`<html><body>${BODY}</body></html>`, { status: 200 }));
    const outcome = await ingestUrl("https://a.example/news/x", { ...base(), fetcher, trustCaller: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.entry.title).toBe("a.example");
    expect((await readKnowledge(outcome.entry.name, knowledgeRoot))?.sourceUrl).toBe("https://a.example/news/x");
  });
});
