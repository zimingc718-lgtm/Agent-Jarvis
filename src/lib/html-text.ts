/**
 * HTML → Markdown（纯函数，无 I/O）。
 *
 * 原本长在 `insight-export.ts` 里，只为洞察归档服务。资料库进来之后第二个用户出现了：
 * `documents.ts` 要读 139 份网页存档（CR-20260915-library-adoption CP-6），而
 * `insight-export.ts` 自己 import `documents.ts`——直接引会成环。所以把这段搬到两边都能
 * 引的地方，而不是抄一份：抄出来的两份迟早对不上。
 */

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "header", "footer", "main", "figure", "figcaption"]);

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // `&amp;` 必须最后解，否则 `&amp;lt;` 会被解成 `<`。
    .replace(/&amp;/g, "&");
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return decodeEntities(match?.[2] ?? match?.[3] ?? "");
}

/** 行内标签 → Markdown。表格单元格与标题都要用它，所以单独拆出来。 */
export function inlineToMarkdown(html: string): string {
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, "  \n");
  text = text.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_m, inner) => `**${inlineToMarkdown(inner).trim()}**`);
  text = text.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_m, inner) => `*${inlineToMarkdown(inner).trim()}*`);
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => `\`${decodeEntities(inner.replace(/<[^>]+>/g, "")).trim()}\``);
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const href = attribute(`<a ${attrs}>`, "href");
    const label = inlineToMarkdown(inner).trim();
    return href ? `[${label || href}](${href})` : label;
  });
  text = text.replace(/<img\b([^>]*)\/?>/gi, (_m, attrs: string) => {
    const tag = `<img ${attrs}>`;
    const src = attribute(tag, "src");
    const alt = attribute(tag, "alt");
    return src ? `![${alt}](${src})` : alt;
  });
  // 认不出的行内标签**只脱壳，不丢字**：宁可留下没有格式的句子，也不能少一个词。
  text = text.replace(/<[^>]+>/g, "");
  return decodeEntities(text);
}

function listToMarkdown(inner: string, ordered: boolean): string {
  const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1] ?? "");
  return items
    .map((item, index) => {
      const body = inlineToMarkdown(item).replace(/\s+/g, " ").trim();
      return `${ordered ? `${index + 1}.` : "-"} ${body}`;
    })
    .join("\n");
}

function tableToMarkdown(inner: string): string {
  const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? "");
  if (rows.length === 0) {
    return "";
  }
  const cellsOf = (row: string) =>
    [...row.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) =>
      // 单元格里的竖线要转义，否则一行表格会被读成多列——说明书里刚栽过同一个跟头。
      inlineToMarkdown(match[2] ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")
    );
  const header = cellsOf(rows[0]!);
  const body = rows.slice(1).map(cellsOf);
  const width = Math.max(header.length, ...body.map((row) => row.length), 1);
  const pad = (cells: string[]) => {
    const filled = [...cells];
    while (filled.length < width) {
      filled.push("");
    }
    return `| ${filled.join(" | ")} |`;
  };
  return [pad(header), `|${" --- |".repeat(width)}`, ...body.map(pad)].join("\n");
}

/**
 * 把洞察 HTML 转成 Markdown。
 *
 * 覆盖的是模型实际会写出来的那一小撮标签，不是整个 HTML。原则只有一条：**认不出的标签
 * 保留其文字内容**——转换可以丢格式，不能丢字。
 */
export function htmlToMarkdown(html: string): string {
  let text = html;
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const body = decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/^\n+|\n+$/g, "");
    return `\n\n\`\`\`\n${body}\n\`\`\`\n\n`;
  });
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const body = inlineToMarkdown(inner).trim().split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
    return `\n\n${body}\n\n`;
  });
  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const body = inlineToMarkdown(inner).replace(/\s+/g, " ").trim();
    return `\n\n${"#".repeat(Number(level))} ${body}\n\n`;
  });
  text = text.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => `\n\n${tableToMarkdown(inner)}\n\n`);
  text = text.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => `\n\n${listToMarkdown(inner, false)}\n\n`);
  text = text.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => `\n\n${listToMarkdown(inner, true)}\n\n`);
  text = text.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  for (const tag of BLOCK_TAGS) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"), (_m, inner: string) => `\n\n${inner}\n\n`);
  }
  text = inlineToMarkdown(text);
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 从正文里挑一个标题：第一个 h1–h3，没有就用第一行文字。 */
