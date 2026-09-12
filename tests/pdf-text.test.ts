import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractPdfText, looksLikePdf, parseCMap } from "@/lib/pdf-text";

/**
 * TEST-097 — zero-dependency PDF text extraction (REQ-F-055; DEC-033 ②; TASK-093).
 * CR-20260911-web-reading.
 *
 * Fixtures are built here rather than checked in: a real PDF is a binary blob nobody can
 * review in a diff, and the cases that matter (kerning, CID fonts, encryption, scans) are
 * each a handful of bytes to construct.
 */

/** Assemble a minimal PDF whose single content stream holds `content`. */
function pdfWithStreams(streams: string[], extra = ""): Uint8Array {
  const parts: Buffer[] = [Buffer.from(`%PDF-1.7\n${extra}`, "latin1")];
  streams.forEach((content, index) => {
    const body = deflateSync(Buffer.from(content, "latin1"));
    parts.push(Buffer.from(`\n${index + 1} 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n`, "latin1"));
    parts.push(body);
    parts.push(Buffer.from("\nendstream\nendobj\n", "latin1"));
  });
  parts.push(Buffer.from("trailer\n<< >>\n%%EOF\n", "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

describe("TEST-097 PDF 文本提取 (REQ-F-055)", () => {
  it("① 识别 PDF，并从压缩内容流中取出文字", () => {
    const pdf = pdfWithStreams(["BT /F1 12 Tf (Hello world) Tj ET"]);
    expect(looksLikePdf(pdf)).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html></html>"))).toBe(false);
    const result = extractPdfText(pdf);
    expect(result.text).toContain("Hello world");
    expect(result.streams).toBe(1);
    expect(result.encrypted).toBe(false);
  });

  it("② TJ 数组按字距判定：小字距不拆词，大负值才是空格", () => {
    // The real regression: "High-Efficiency" arrived as "High-E fficiency" because every
    // kerning pair was treated as a space.
    const pdf = pdfWithStreams(["BT [(High-E) -20 (fficiency) -400 (Scale)] TJ ET"]);
    const { text } = extractPdfText(pdf);
    expect(text).toContain("High-Efficiency");
    expect(text).toContain("High-Efficiency Scale");
  });

  it("③ 转义与十六进制字符串都能解码", () => {
    const pdf = pdfWithStreams(["BT (a\\(b\\)c) Tj (\\101\\102) Tj <48656C6C6F> Tj ET"]);
    const { text } = extractPdfText(pdf);
    expect(text).toContain("a(b)c");
    expect(text).toContain("AB");
    expect(text).toContain("Hello");
  });

  it("④ CID 字体经 ToUnicode 映射还原为中文", () => {
    // What an Identity-H subset font looks like: 2-byte glyph indices plus the document's
    // own map from index to character. Without the map this is the "ªÎÞª¾êÞ" noise.
    const cmap = [
      "begincmap",
      "2 beginbfchar",
      "<0003> <4E2D>", // 中
      "<0004> <6587>", // 文
      "endbfchar",
      // Array form, because 报 (U+62A5) and 告 (U+544A) are not adjacent code points —
      // the range form maps consecutive codes to consecutive characters.
      "1 beginbfrange",
      "<0005> <0006> [<62A5> <544A>]",
      "endbfrange",
      "endcmap",
    ].join("\n");
    const shown = "\\000\\003\\000\\004\\000\\005\\000\\006";
    const pdf = pdfWithStreams([cmap, `BT /F1 12 Tf (${shown}) Tj ET`]);
    const { text } = extractPdfText(pdf);
    expect(text).toContain("中文报告");
  });

  it("④ 未被映射覆盖的 CID 串被丢弃，而不是当成乱码输出", () => {
    const cmap = ["begincmap", "1 beginbfchar", "<0003> <4E2D>", "endbfchar", "endcmap"].join("\n");
    // Second string belongs to a font we have no map for: raw bytes are unreadable.
    const pdf = pdfWithStreams([cmap, "BT (\\000\\003) Tj (\\252\\316\\336\\252) Tj ET"]);
    const { text } = extractPdfText(pdf);
    expect(text).toContain("中");
    expect(text).not.toContain("ªÎÞª");
  });

  it("⑤ 加密文档如实报告，不返回噪音", () => {
    const pdf = pdfWithStreams(["BT (secret) Tj ET"], "/Encrypt 9 0 R\n");
    const result = extractPdfText(pdf);
    expect(result.encrypted).toBe(true);
    expect(result.text).toBe("");
  });

  it("⑥ 只有图片的扫描件提取为空——由调用方报为失败，而不是空的成功", () => {
    // No text operators at all: an image XObject stream.
    const pdf = pdfWithStreams(["/Im0 Do"]);
    const result = extractPdfText(pdf);
    expect(result.text).toBe("");
    expect(result.streams).toBe(0);
  });

  it("parseCMap 支持 bfrange 的数组形式", () => {
    const map = new Map<number, string>();
    parseCMap("beginbfrange\n<0010> <0012> [<0041> <0042> <0043>]\nendbfrange", map);
    expect(map.get(0x10)).toBe("A");
    expect(map.get(0x12)).toBe("C");
  });
});
