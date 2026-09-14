import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DocumentPathError } from "@/lib/documents";
import {
  archiveInsight,
  freePath,
  htmlToMarkdown,
  resolveArchiveDir,
  slugify,
  titleOf,
} from "@/lib/insight-export";

/**
 * TEST-320 — 洞察双产物与归档（REQ-F-190，DEC-230）。
 *
 * 用户 2026-09-13：「两个都要，而且支持保存到系统的本地文档库」。两件事要分别守住：
 * 转换不能丢字，写盘不能越界、不能覆盖。
 */
describe("htmlToMarkdown (REQ-F-190 ①⑥)", () => {
  it("标题、段落、强调、链接、代码各转成对应的 Markdown", () => {
    const md = htmlToMarkdown(
      '<h2>800VDC 母线</h2><p>母线<strong>已定型</strong>，见 <a href="https://x.example/a">原文</a>。</p>' +
        "<p>命令 <code>npm run dev</code>。</p>"
    );
    expect(md).toContain("## 800VDC 母线");
    expect(md).toContain("**已定型**");
    expect(md).toContain("[原文](https://x.example/a)");
    expect(md).toContain("`npm run dev`");
  });

  it("认不出的标签只脱壳，不丢字——转换可以丢格式，不能丢内容", () => {
    const md = htmlToMarkdown("<p>前 <mark>关键结论</mark> 后</p><custom-widget>里面这句话</custom-widget>");
    expect(md).toContain("关键结论");
    expect(md).toContain("里面这句话");
    expect(md).not.toContain("<mark>");
    expect(md).not.toContain("custom-widget");
  });

  it("表格单元格里的竖线被转义——否则一行会被读成多列", () => {
    const md = htmlToMarkdown("<table><tr><th>取值</th></tr><tr><td>user|isolated</td></tr></table>");
    const row = md.split("\n").find((line) => line.includes("isolated")) ?? "";
    expect(row).toContain("user\\|isolated");
    // 按**未转义**的竖线切，才是 Markdown 读到的列数：前后各一个边界，中间一格。
    expect(row.split(/(?<!\\)\|/).length).toBe(3);
  });

  it("有序列表用真实序号，代码块保留原样不被行内规则啃掉", () => {
    const md = htmlToMarkdown("<ol><li>先</li><li>后</li></ol><pre><code>a &lt; b &amp;&amp; c</code></pre>");
    expect(md).toContain("1. 先");
    expect(md).toContain("2. 后");
    expect(md).toContain("a < b && c");
  });

  it("脚本与样式整段丢掉——归档的是报告正文，不是它的实现", () => {
    const md = htmlToMarkdown("<style>.x{color:red}</style><script>alert(1)</script><p>正文</p>");
    expect(md).toBe("正文");
  });

  it("实体解码的次序：`&amp;lt;` 是字面量 `&lt;`，不是 `<`", () => {
    expect(htmlToMarkdown("<p>&amp;lt;</p>")).toBe("&lt;");
  });
});

describe("titleOf / slugify (REQ-F-190 ⑤)", () => {
  it("标题取第一个 h1–h3；没有标题时退回正文首行", () => {
    expect(titleOf("<h1>母线试点</h1><p>正文</p>", "兜底")).toBe("母线试点");
    expect(titleOf("<p>只有正文</p>", "兜底")).toBe("只有正文");
    expect(titleOf("", "兜底")).toBe("兜底");
  });

  it("文件名剔掉路径与保留字符——归档写的是真实文件，不能让标题决定它落在哪", () => {
    expect(slugify('../../etc/passwd', "x")).not.toContain("/");
    expect(slugify('a:b*c?d"e<f>g|h', "x")).not.toMatch(/[:*?"<>|]/);
    expect(slugify("   ", "兜底")).toBe("兜底");
  });
});

describe("归档目录的边界 (REQ-F-190 ③)", () => {
  async function roots() {
    const base = await mkdtemp(join(tmpdir(), "jarvis-archive-"));
    const docs = resolve(base, "docs");
    await mkdir(docs, { recursive: true });
    return { base, docs, raw: JSON.stringify([{ label: "资料", path: docs }]) };
  }

  it("未配置文档目录时，说的是下一步该做什么，不是「未配置」三个字", async () => {
    await expect(resolveArchiveDir("", null)).rejects.toThrowError(/本地文档/);
  });

  it("未设置归档目录时列出现有文档目录名", async () => {
    const { raw } = await roots();
    await expect(resolveArchiveDir("", raw)).rejects.toThrowError(/资料/);
  });

  it("归档目录必须落在已配置的文档目录之内——写的范围不比读更大", async () => {
    const { base, raw } = await roots();
    const outside = resolve(base, "outside");
    await mkdir(outside, { recursive: true });
    await expect(resolveArchiveDir(outside, raw)).rejects.toBeInstanceOf(DocumentPathError);
  });

  it("根之内的子目录可以是还不存在的——第一次归档时建出来", async () => {
    const { docs, raw } = await roots();
    const target = await resolveArchiveDir(resolve(docs, "报告"), raw);
    expect(target.root.label).toBe("资料");
  });

  it("相对路径被拒", async () => {
    const { raw } = await roots();
    await expect(resolveArchiveDir("报告", raw)).rejects.toThrowError(/绝对路径/);
  });
});

describe("archiveInsight (REQ-F-190 ②④⑤)", () => {
  async function fixture() {
    const base = await mkdtemp(join(tmpdir(), "jarvis-archive-"));
    const docs = resolve(base, "docs");
    await mkdir(docs, { recursive: true });
    const archive = resolve(docs, "报告");
    return {
      docs,
      archive,
      input: {
        insightId: "ins-1",
        conversationId: "conv-1",
        html: "<h1>母线试点</h1><p>结论</p>",
        createdAt: "2026-09-14T00:00:00.000Z",
        format: "md" as const,
        archiveSetting: archive,
        rootsSetting: JSON.stringify([{ label: "资料", path: docs }]),
        now: () => new Date("2026-09-14T01:02:03.000Z"),
      },
    };
  }

  it("写出带 front-matter 的 Markdown，并返回文档库里的 id", async () => {
    const { input } = await fixture();
    const result = await archiveInsight(input);

    expect(result.id.startsWith("资料/报告/")).toBe(true);
    expect(result.format).toBe("md");
    const text = await readFile(result.absPath, "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain('insight_id: "ins-1"');
    expect(text).toContain('source: "jarvis://insight/ins-1"');
    expect(text).toContain("# 母线试点");
  });

  it("同名不覆盖，换一个名字——用户目录里的文件不会被悄悄盖掉", async () => {
    const { input } = await fixture();
    const first = await archiveInsight(input);
    const second = await archiveInsight(input);
    expect(second.absPath).not.toBe(first.absPath);
    expect(await readFile(first.absPath, "utf8")).toContain("# 母线试点");
    expect(await readFile(second.absPath, "utf8")).toContain("# 母线试点");
  });

  it("format=html 时原样写出，不做转换", async () => {
    const { input } = await fixture();
    const result = await archiveInsight({ ...input, format: "html" });
    expect(result.absPath.endsWith(".html")).toBe(true);
    expect(await readFile(result.absPath, "utf8")).toBe(input.html);
  });

  it("超过归档上限时拒绝，并说出实际大小", async () => {
    const { input } = await fixture();
    const huge = `<p>${"字".repeat(400_000)}</p>`;
    await expect(archiveInsight({ ...input, html: huge })).rejects.toThrowError(/KB/);
  });

  it("freePath 在目录里已有同名文件时给出带序号的名字", async () => {
    const { docs } = await fixture();
    await writeFile(resolve(docs, "a.md"), "x", "utf8");
    const next = await freePath(docs, "a", "md");
    expect(next.endsWith("a-2.md")).toBe(true);
  });
});
