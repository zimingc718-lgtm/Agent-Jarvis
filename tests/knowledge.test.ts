import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adoptPending,
  deleteKnowledge,
  discardPending,
  KnowledgeError,
  listKnowledge,
  listPending,
  MAX_ENTRY_BYTES,
  parseEntryFile,
  rankBm25,
  readKnowledge,
  renderEntryFile,
  saveKnowledge,
  searchKnowledge,
  slugifyKnowledgeName,
  snippetFor,
  tokenize,
} from "@/lib/knowledge";

/**
 * TEST-084 (storage: files, frontmatter, names, bounds, pending queue) and
 * TEST-085 (retrieval: tokenizer, BM25, snippets, folder search) — REQ-F-044/045/046, REQ-NF-013.
 */

describe("tokenize (REQ-F-045 ①)", () => {
  it("CJK 按字二元切分，拉丁按词切分，大小写与全角归一", () => {
    const tokens = tokenize("压缩方案用 BM25，Ｔｅｓｔ ok");
    expect(tokens).toEqual(expect.arrayContaining(["压缩", "缩方", "方案", "bm25", "test", "ok"]));
    expect(tokens).not.toContain("压缩方案");
  });

  it("孤立单字保留为一元，标点不产生 token", () => {
    expect(tokenize("好。")).toEqual(["好"]);
    expect(tokenize("，。！")).toEqual([]);
  });
});

describe("rankBm25 (REQ-F-045 ①)", () => {
  const docs = [
    { id: "deploy", tokens: tokenize("生产环境部署端口是 8443，反向代理用 Caddy") },
    { id: "style", tokens: tokenize("用户偏好中文回答，代码块用 TypeScript") },
    { id: "budget", tokens: tokenize("上下文预算 0.6，压缩阈值 0.8") },
  ];

  it("含查询词最多、最稀有的文档排第一；不含任何查询词的文档不出现", () => {
    const hits = rankBm25(docs, tokenize("部署端口"));
    expect(hits[0].id).toBe("deploy");
    expect(hits.map((hit) => hit.id)).not.toContain("style");
  });

  it("空查询或空文档集返回空", () => {
    expect(rankBm25(docs, [])).toEqual([]);
    expect(rankBm25([], tokenize("x"))).toEqual([]);
  });

  it("snippetFor 围绕首个命中词取窗口，命中不到时取开头", () => {
    const content = "前面是很长的一段说明。".repeat(20) + "生产环境部署端口是 8443。" + "后面还有很多。".repeat(20);
    const snippet = snippetFor(content, tokenize("部署端口"), 60);
    expect(snippet).toContain("8443");
    expect(snippet.length).toBeLessThanOrEqual(64);
    expect(snippetFor("短文", tokenize("无关"), 60)).toBe("短文");
  });
});

describe("knowledge files (REQ-F-044, REQ-NF-013)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-kb-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("① 保存即一个带 frontmatter 的 .md 文件；读回得到同样的标题、来源、正文", async () => {
    const saved = await saveKnowledge(
      { title: "部署说明", content: "生产环境部署端口是 8443。", source: "manual", now: () => new Date("2026-09-11T00:00:00Z") },
      root
    );
    expect(saved.name).toBe("部署说明");
    const files = readdirSync(root);
    expect(files).toEqual(["部署说明.md"]);
    const raw = readFileSync(join(root, "部署说明.md"), "utf8");
    expect(raw.startsWith("---\ntitle: 部署说明\nsource: manual\ncreated: 2026-09-11T00:00:00.000Z\n---\n")).toBe(true);

    const entry = await readKnowledge("部署说明", root);
    expect(entry).toMatchObject({ title: "部署说明", source: "manual", content: "生产环境部署端口是 8443。" });
    expect((await listKnowledge(root)).map((item) => item.name)).toEqual(["部署说明"]);
  });

  it("② 手写的无 frontmatter 文件也算条目：标题取首个标题行，来源记为 file", async () => {
    writeFileSync(join(root, "notes.md"), "# 周会纪要\n\n决定：先做 C 期。\n", "utf8");
    const entry = await readKnowledge("notes", root);
    expect(entry?.title).toBe("周会纪要");
    expect(entry?.source).toBe("file");
    expect(parseEntryFile("只有一行", { name: "x", createdAt: "t" }).title).toBe("只有一行");
    expect(parseEntryFile("", { name: "fallback", createdAt: "t" }).title).toBe("fallback");
  });

  it("③ 标题缺省取正文首行；同名条目自动加序号而不覆盖", async () => {
    const first = await saveKnowledge({ content: "# 同一标题\n正文一", source: "manual" }, root);
    const second = await saveKnowledge({ content: "# 同一标题\n正文二", source: "manual" }, root);
    expect(first.title).toBe("同一标题");
    expect(first.name).toBe("同一标题");
    expect(second.name).toBe("同一标题-2");
    expect((await readKnowledge("同一标题", root))?.content).toBe("# 同一标题\n正文一");
  });

  it("④ 边界：空内容拒绝（400）、超过 64KB 拒绝（413）", async () => {
    await expect(saveKnowledge({ content: "   \n", source: "manual" }, root)).rejects.toMatchObject({ status: 400 });
    const huge = "字".repeat(MAX_ENTRY_BYTES / 3 + 1);
    await expect(saveKnowledge({ content: huge, source: "manual" }, root)).rejects.toBeInstanceOf(KnowledgeError);
    await expect(saveKnowledge({ content: huge, source: "manual" }, root)).rejects.toMatchObject({ status: 413 });
  });

  it("⑤ 名称只能是字母/数字/-/_：路径穿越被 slug 消掉，非法名读写都拒绝", async () => {
    expect(slugifyKnowledgeName("../../etc/passwd")).toBe("etc-passwd");
    expect(slugifyKnowledgeName("  Hello, World!  ")).toBe("hello-world");
    const saved = await saveKnowledge({ content: "x", source: "manual", preferredName: "../../evil" }, root);
    expect(saved.name).toBe("evil");
    expect(readdirSync(root)).toEqual(["evil.md"]);
    expect(await readKnowledge("../evil", root)).toBeNull();
    expect(await deleteKnowledge("../evil", root)).toBe(false);
    expect(await readKnowledge("evil/../evil", root)).toBeNull();
  });

  it("⑥ 删除后不再列出；删除不存在的条目返回 false", async () => {
    await saveKnowledge({ title: "a", content: "a", source: "manual" }, root);
    expect(await deleteKnowledge("a", root)).toBe(true);
    expect(await listKnowledge(root)).toEqual([]);
    expect(await deleteKnowledge("a", root)).toBe(false);
  });

  it("⑦ 待采纳区：模型提议不进列表、不进检索；采纳后进入；忽略即删除", async () => {
    const proposal = await saveKnowledge({ title: "用户偏好", content: "偏好中文回答", source: "model", pending: true }, root);
    expect(await listKnowledge(root)).toEqual([]);
    expect((await listPending(root)).map((item) => item.name)).toEqual(["用户偏好"]);
    expect(await searchKnowledge("中文回答", 5, root)).toEqual([]);

    const adopted = await adoptPending(proposal.name, root);
    expect(adopted?.name).toBe("用户偏好");
    expect(await listPending(root)).toEqual([]);
    expect((await searchKnowledge("中文回答", 5, root))[0]?.name).toBe("用户偏好");

    const again = await saveKnowledge({ title: "再提议", content: "x", source: "model", pending: true }, root);
    expect(await discardPending(again.name, root)).toBe(true);
    expect(await listPending(root)).toEqual([]);
    expect(await adoptPending("missing", root)).toBeNull();
    expect(await discardPending("missing", root)).toBe(false);
  });

  it("⑧ 采纳时与已有条目同名则加序号，不覆盖", async () => {
    await saveKnowledge({ title: "偏好", content: "旧", source: "manual" }, root);
    await saveKnowledge({ title: "偏好", content: "新", source: "model", pending: true }, root);
    const adopted = await adoptPending("偏好", root);
    expect(adopted?.name).toBe("偏好-2");
    expect((await readKnowledge("偏好", root))?.content).toBe("旧");
  });

  it("renderEntryFile 把标题里的换行折成空格，避免破坏 frontmatter", () => {
    const raw = renderEntryFile({ title: "两\n行", source: "manual", createdAt: "t", content: "c" });
    expect(raw.split("\n")[1]).toBe("title: 两 行");
  });
});

describe("searchKnowledge over a folder (REQ-F-045 ②④)", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agent-jarvis-kbs-"));
    mkdirSync(root, { recursive: true });
    await saveKnowledge({ title: "部署说明", content: "生产环境部署端口是 8443，反向代理用 Caddy。", source: "manual" }, root);
    await saveKnowledge({ title: "回答风格", content: "用户偏好中文回答，代码块用 TypeScript。", source: "conversation" }, root);
    await saveKnowledge({ title: "预算", content: "上下文预算占窗口 0.6，压缩触发阈值 0.8。", source: "manual" }, root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("一句话查询命中正确条目并给出带命中词的片段", async () => {
    const hits = await searchKnowledge("生产环境的部署端口是多少", 5, root);
    expect(hits[0].name).toBe("部署说明");
    expect(hits[0].snippet).toContain("8443");
    expect(hits.every((hit) => hit.score > 0)).toBe(true);
  });

  it("limit 生效且上限 20；空查询返回空", async () => {
    expect((await searchKnowledge("预算 端口 回答", 1, root)).length).toBe(1);
    expect(await searchKnowledge("   ", 5, root)).toEqual([]);
  });

  it("索引随目录变化失效：新增文件后立刻可检索，删除后立刻消失", async () => {
    expect(await searchKnowledge("Playwright", 5, root)).toEqual([]);
    writeFileSync(join(root, "e2e.md"), "# 测试\nPlaywright 只跑一个 worker。", "utf8");
    expect((await searchKnowledge("Playwright", 5, root))[0]?.name).toBe("e2e");
    rmSync(join(root, "e2e.md"));
    expect(await searchKnowledge("Playwright", 5, root)).toEqual([]);
  });
});
