import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countByStatus,
  decideLibrary,
  INDEX_CARD_SOURCE,
  LibraryError,
  libraryRoot,
  listLibrary,
  parseManifest,
  readLedger,
  renderIndexCard,
} from "@/lib/library";

/**
 * TEST-390 — 资料库的采纳登记（REQ-F-220、DEC-310；CR-20260915-library-adoption CP-2、CP-5）。
 *
 * 用一个小夹具而不是仓库里那个真的 258 个文件的资料库：测试不该依赖内容目录的内容。
 */

const MANIFEST = `﻿报告,编号,层级,来源,标题,URL,原文文件,文本层文件,取回方式,备注
供电架构,P1,一手,Open Compute Project,"Diablo 400: Rack and Power, v0.5.2",https://example.org/diablo,P1_diablo.pdf,,wayback:20260823121750,
电网,G2,二手,某新闻站,数据中心与电网的十四点七赫兹振荡,https://example.org/osc,G2_osc.html,G2_osc.txt,直取,备注里有逗号, 但被引号包住
`;

let dir: string;
let root: string;
let stateDir: string;
let knowledgeRoot: string;

function options() {
  return { root, stateDir, knowledgeRoot };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-jarvis-library-"));
  root = join(dir, "资料库");
  stateDir = join(dir, "state");
  knowledgeRoot = join(dir, "knowledge");
  mkdirSync(join(root, "AIDC", "01_报告"), { recursive: true });
  mkdirSync(join(root, "AIDC", "02_原文"), { recursive: true });
  writeFileSync(join(root, "AIDC", "清单.csv"), MANIFEST, "utf8");
  writeFileSync(join(root, "AIDC", "01_报告", "报告.html"), "<h1>成品</h1>", "utf8");
  writeFileSync(join(root, "AIDC", "02_原文", "P1_diablo.pdf"), "%PDF-1.4 fake", "utf8");
  writeFileSync(join(root, "AIDC", "02_原文", "G2_osc.html"), "<p>振荡</p>", "utf8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TEST-390 资料库采纳登记 (REQ-F-220)", () => {
  it("① 清单按 BOM + 引号解析，编号与来源接回对应的文件", () => {
    const rows = parseManifest(MANIFEST);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.no).toBe("P1");
    // 标题里的逗号在引号内，不能把它当分隔符。
    expect(rows[0]!.title).toBe("Diablo 400: Rack and Power, v0.5.2");
    expect(rows[1]!.textFile).toBe("G2_osc.txt");
  });

  it("② 没有登记文件时，每一份都是待采纳——默认不是「已采纳」", async () => {
    const items = await listLibrary(options());
    expect(items.map((item) => item.id)).toEqual([
      "AIDC/01_报告/报告.html",
      "AIDC/02_原文/G2_osc.html",
      "AIDC/02_原文/P1_diablo.pdf",
      "AIDC/清单.csv",
    ]);
    expect(items.every((item) => item.status === "pending")).toBe(true);
    expect(countByStatus(items)).toEqual({ total: 4, pending: 4, adopted: 0, rejected: 0 });

    // 清单里有的，标题与来源接得上；清单里没有的（那份报告）如实留空，不猜。
    const pdf = items.find((item) => item.name === "P1_diablo.pdf")!;
    expect(pdf.title).toBe("Diablo 400: Rack and Power, v0.5.2");
    expect(pdf.org).toBe("Open Compute Project");
    expect(pdf.retrieval).toBe("wayback:20260823121750");
    expect(items.find((item) => item.name === "报告.html")!.title).toBe("");
  });

  it("③ 采纳写登记并在知识库里留一张索引卡；撤回判断把卡删掉", async () => {
    const id = "AIDC/02_原文/P1_diablo.pdf";
    const adopted = await decideLibrary([id], "adopted", options());
    expect(adopted.changed.map((item) => item.id)).toEqual([id]);

    const ledger = await readLedger(stateDir);
    expect(ledger[id]!.status).toBe("adopted");
    expect(ledger[id]!.at).not.toBe("");
    const card = ledger[id]!.card!;
    expect(card).toBeTruthy();

    const written = await readFile(join(knowledgeRoot, `${card}.md`), "utf8");
    expect(written).toContain(INDEX_CARD_SOURCE);
    // 卡片必须带 documentId，否则「链接起来」这句话不成立：模型命中卡片后无从取全文。
    expect(written).toContain("资料库/AIDC/02_原文/P1_diablo.pdf");
    expect(written).toContain("https://example.org/diablo");

    await decideLibrary([id], "pending", options());
    expect((await readLedger(stateDir))[id]!.status).toBe("pending");
    expect(await readdir(knowledgeRoot)).not.toContain(`${card}.md`);
  });

  it("④ 拒绝不写卡；重复裁定不算改动；不存在的 id 报 404", async () => {
    const id = "AIDC/02_原文/G2_osc.html";
    await decideLibrary([id], "rejected", options());
    expect(await readdir(knowledgeRoot).catch(() => [])).toHaveLength(0);

    const again = await decideLibrary([id], "rejected", options());
    expect(again.changed).toHaveLength(0);
    expect(again.unchanged).toEqual([id]);

    await expect(decideLibrary(["AIDC/不存在.pdf"], "adopted", options())).rejects.toBeInstanceOf(LibraryError);
  });

  it("⑤ 登记文件坏掉时退回「全部待采纳」，不是把没审过的当成审过的", async () => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "adoption.json"), "{ 这不是 JSON", "utf8");
    const items = await listLibrary(options());
    expect(items.every((item) => item.status === "pending")).toBe(true);
  });

  it("⑥ 目录不存在时 libraryRoot 返回 null，清单为空——不抛", async () => {
    expect(libraryRoot(join(dir, "没有"))).toBeNull();
    expect(libraryRoot(root)).toEqual({ label: "资料库", path: root });
    expect(await listLibrary({ root: join(dir, "没有"), stateDir })).toEqual([]);
  });

  it("⑦ 索引卡是目录卡不是副本：小、且指回原件", async () => {
    const items = await listLibrary(options());
    const card = renderIndexCard(items.find((item) => item.name === "P1_diablo.pdf")!);
    expect(Buffer.byteLength(card, "utf8")).toBeLessThan(2 * 1024);
    expect(card).toContain("read_document");
    // 登记落文件不落表（DEC-310）：写完之后盘上就是一个能直接读的 JSON。
    await decideLibrary(["AIDC/02_原文/P1_diablo.pdf"], "adopted", options());
    const raw = readFileSync(join(stateDir, "adoption.json"), "utf8");
    expect(JSON.parse(raw)["AIDC/02_原文/P1_diablo.pdf"].status).toBe("adopted");
  });
  it("⑧ 归档原件按字节保存：.gitattributes 里有 `资料库/** -text`（CP-1）", () => {
    // 这些不是本仓库写的文本：一部分经互联网档案馆的原始字节接口取回，文本层逐字核对过。
    // 让 `* text=auto eol=lf` 规范化它们，等于改写归档件本身。
    const attributes = readFileSync(join(process.cwd(), ".gitattributes"), "utf8");
    expect(attributes).toContain("资料库/** -text");
  });
});
