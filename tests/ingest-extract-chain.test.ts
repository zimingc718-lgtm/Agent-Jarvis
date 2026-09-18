import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listEntities, readEntity, saveEntity } from "@/lib/entities";
import { extractFields } from "@/lib/extract";
import { adoptPending, saveKnowledge } from "@/lib/knowledge";
import { adoptProposal, listProposals } from "@/lib/entity-proposals";
import { createEntityTools } from "@/lib/tools/entity-tools";
import { type ToolContext } from "@/lib/tools/registry";
import { extractReadableText, extractTitle } from "@/lib/tools/web-tools";

/**
 * TEST-240 — 证据管线一轮内闭合（CR-20260912-ingest-extract-chain）。
 *
 * 实测的死锁：`ingest_url` 存进待采纳区，`extract_fields` 读不到待采纳条目，
 * 同一轮内连续失败两次且 summary 只有「未写入」三个字；手工采纳后重试立即成功。
 * 模型无法自救，转而编造失败原因（「页面需登录」——而同一轮它自己的 `read_url` 两次都成功），
 * 并把这句幻觉写进了实体提议的证据字段。
 */

const DOC = ["# 维谛技术产品公告", "", "液冷方案形态为冷板式。", "供电拓扑为 800VDC。"].join("\n");

describe("extract_fields 可读待采纳条目", () => {
  let entitiesRoot: string;
  let knowledgeRoot: string;
  let entryName: string;

  const claims = [{ field: "液冷方案形态", value: "冷板式", quote: "液冷方案形态为冷板式。" }];

  beforeEach(async () => {
    entitiesRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-iec-e-"));
    knowledgeRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-iec-k-"));
    await saveEntity({ kind: "competitor", title: "维谛技术 Vertiv" }, entitiesRoot);
    const entry = await saveKnowledge(
      {
        title: "维谛技术产品公告",
        content: DOC,
        source: "model",
        entity: "维谛技术-vertiv",
        sourceUrl: "https://vertiv.example/news/1",
        pending: true,
      },
      knowledgeRoot
    );
    entryName = entry.name;
  });

  afterEach(() => {
    rmSync(entitiesRoot, { recursive: true, force: true });
    rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  it("条目还在待采纳区时就能抽字段——这是死锁的正面用例", async () => {
    const outcome = await extractFields({ entity: "维谛技术-vertiv", entryName, claims }, { entitiesRoot, knowledgeRoot });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.results[0]?.status).toBe("queued");
  });

  it("采纳前后都成功——这条是回归锁，不得简化为只测采纳后", async () => {
    const before = await extractFields({ entity: "维谛技术-vertiv", entryName, claims }, { entitiesRoot, knowledgeRoot });
    expect(before.ok).toBe(true);

    await adoptPending(entryName, knowledgeRoot);

    const after = await extractFields({ entity: "维谛技术-vertiv", entryName, claims }, { entitiesRoot, knowledgeRoot });
    expect(after.ok).toBe(true);
  });

  it("对象不存在时，错误文本回列现有对象名，而不是让模型去猜", async () => {
    const outcome = await extractFields(
      { entity: "施耐德-schneider", entryName, claims },
      { entitiesRoot, knowledgeRoot }
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("维谛技术-vertiv");
  });

  it("条目确实不存在时说清楚它既不在正式库也不在待采纳区", async () => {
    const outcome = await extractFields(
      { entity: "维谛技术-vertiv", entryName: "根本没有这条", claims },
      { entitiesRoot, knowledgeRoot }
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("待采纳区");
  });
});

describe("入库正文去噪", () => {
  it("只含空格的行不再制造大段空白", () => {
    // 实测现场：页面里几十行只有一个空格。`[ \t]+ -> " "` 之后它们不是空行，
    // 所以 `\n{3,} -> \n\n` 永远匹配不上，空白就这么留在了条目里。
    const html = `<body><p>第一段</p>${"<div> </div>".repeat(20)}<p>第二段</p></body>`;
    const text = extractReadableText(html);

    expect(text).toContain("第一段");
    expect(text).toContain("第二段");
    expect(text).not.toMatch(/\n\s*\n\s*\n/);
  });

  it("正文开头的整行 JSON 对象被剔除", () => {
    // 实测现场：Vertiv 页面正文第一行是语言切换数据，模型据此把 UrlForCurrentLanguage
    // 当成了条目来源，看起来像「模型编造了相对路径」。
    const blob = '{"IsDifferent":true,"UrlForCurrentLanguage":"/en-ca/about/x","CountryCode":"USA"}';
    const html = `<body><div>${blob}</div><p>Vertiv 发布参考架构。</p></body>`;
    const text = extractReadableText(html);

    expect(text).not.toContain("UrlForCurrentLanguage");
    expect(text).toContain("Vertiv 发布参考架构。");
  });

  it("正文里合法出现的 JSON 片段不被误删", () => {
    const html = `<body><p>配置示例如下。</p><div>{"maxTokens":8192}</div><p>其余略。</p></body>`;
    const text = extractReadableText(html);

    expect(text).toContain("maxTokens");
  });

  it("标题优先取 og:title，避免站点自己截断的 <title> 残句", () => {
    const html = [
      "<head>",
      '<title>Vertiv develops energy-efficient cooling and power reference architecture, available</title>',
      '<meta property="og:title" content="Vertiv 为 NVIDIA GB300 NVL72 提供电力与散热参考架构" />',
      "</head>",
    ].join("");

    expect(extractTitle(html)).toBe("Vertiv 为 NVIDIA GB300 NVL72 提供电力与散热参考架构");
  });

  it("没有 og:title 时仍回退到 <title>", () => {
    expect(extractTitle("<head><title>只有标题</title></head>")).toBe("只有标题");
  });
});

describe("证据不可伪造：propose_entity_update 的两类字段", () => {
  let root: string;
  let knowledgeRoot: string;
  let entryName: string;

  const context: ToolContext = {
    userId: "u",
    conversationId: "c",
    skillCount: 0,
    webEnabled: false,
    searchConfigured: false,
    knowledgeCount: 1,
    contextWindow: 128_000,
  };

  const proposeUpdate = () => createEntityTools({ root, knowledgeRoot })[3];
  // Index 4 is now add_source (CR-20260918-change-history-and-sources) — extract_fields
  // shifted from 5 to 6. Indexed access is fragile exactly like this; left as-is rather
  // than refactored to by-name lookup, matching the file's existing style elsewhere.
  const extractTool = () => createEntityTools({ root, knowledgeRoot })[6];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-iec-t-"));
    knowledgeRoot = mkdtempSync(join(tmpdir(), "agent-jarvis-iec-tk-"));
    await saveEntity({ kind: "competitor", title: "维谛技术 Vertiv" }, root);
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
    rmSync(root, { recursive: true, force: true });
    rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  it("带条目且原文逐字命中 → 记为有据可查", async () => {
    const result = await proposeUpdate().execute(
      {
        name: "维谛技术-vertiv",
        field: "液冷方案形态",
        value: "冷板式",
        source_url: "https://vertiv.example/news/1",
        entry: entryName,
        quote: "液冷方案形态为冷板式。",
      },
      context
    );

    expect(result.ok).toBe(true);
    const [proposal] = await listProposals(root);
    expect(proposal?.basis).toBe("quoted");
  });

  it("没有原文的值一律落为推断——模型不能自称有据可查", async () => {
    const result = await proposeUpdate().execute(
      {
        name: "维谛技术-vertiv",
        field: "能力小结",
        value: "整体领先",
        source_url: "https://vertiv.example/news/1",
        locator: "页面需登录；仅标题与站内导航可见",
      },
      context
    );

    expect(result.ok).toBe(true);
    const [proposal] = await listProposals(root);
    expect(proposal?.basis).toBe("inferred");
    expect(result.content).toContain("推断");
  });

  it("原文对不上时不得降级成「有据可查」，只能记为推断", async () => {
    await proposeUpdate().execute(
      {
        name: "维谛技术-vertiv",
        field: "供电拓扑",
        value: "800VDC",
        source_url: "https://vertiv.example/news/1",
        entry: entryName,
        quote: "这句话条目里根本没有。",
      },
      context
    );

    const [proposal] = await listProposals(root);
    expect(proposal?.basis).toBe("inferred");
  });

  it("分类要走到实体文件：有据可查落 evidence_basis，推断不落（REQ-F-180 ⑥）", async () => {
    // 来源与该对象已登记的源同域 → 直写，走的正是把 basis 丢掉的那条路径。
    await proposeUpdate().execute(
      {
        name: "维谛技术-vertiv",
        field: "液冷方案形态",
        value: "冷板式",
        source_url: "https://vertiv.example/news/1",
        entry: entryName,
        quote: "液冷方案形态为冷板式。",
      },
      context
    );
    await proposeUpdate().execute(
      {
        name: "维谛技术-vertiv",
        field: "能力小结",
        value: "整体领先",
        source_url: "https://vertiv.example/news/1",
      },
      context
    );

    // 这两条都进了待采纳区（来源不在已登记源内），按用户采纳这条路落盘。
    for (const proposal of await listProposals(root)) {
      await adoptProposal(proposal.id, root);
    }

    const raw = readFileSync(join(root, "维谛技术-vertiv.md"), "utf8");
    expect(raw).toContain("evidence_basis: 液冷方案形态 | quoted");
    // 只写肯定的一侧：没有这行就是推断，旧文件因此天然读作推断。
    expect(raw).not.toContain("evidence_basis: 能力小结");

    const entity = await readEntity("维谛技术-vertiv", root);
    expect(entity?.evidence.find((e) => e.field === "液冷方案形态")?.basis).toBe("quoted");
    expect(entity?.evidence.find((e) => e.field === "能力小结")?.basis ?? "inferred").toBe("inferred");

    const [summary] = await listEntities(root);
    expect(summary.quoted).toContain("液冷方案形态");
    expect(summary.quoted).not.toContain("能力小结");
  });

  it("extract_fields 失败时的 summary 带得走原因，而不是三个字「未写入」", async () => {
    const result = await extractTool().execute(
      {
        name: "并不存在的对象",
        entry: entryName,
        fields: [{ field: "液冷方案形态", value: "冷板式", quote: "液冷方案形态为冷板式。" }],
      },
      context
    );

    expect(result.ok).toBe(false);
    expect(result.summary).not.toBe("未写入");
    expect(result.content).toContain("维谛技术-vertiv");
  });
});
