import { Fragment, type ReactElement, type ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown renderer for assistant chat replies.
 *
 * Renders to React elements (never dangerouslySetInnerHTML), so text is escaped
 * by React and there is no HTML-injection surface. Supports the constructs LLM
 * output actually uses: fenced code blocks (tolerant of an unclosed fence while
 * streaming), inline code, bold, italic, safe links, ordered/unordered lists,
 * headings (rendered h3-h5 so a chat bubble never introduces an h1/h2), soft line
 * breaks and blank-line paragraphs. Anything else falls through as literal text.
 */

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/;

type Block =
  | { type: "code"; content: string }
  | { type: "heading"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isBlockStart = (line: string) =>
    /^```/.test(line) || /^#{1,3}\s+/.test(line) || /^\s*([-*]|\d+\.)\s+/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```[\w-]*\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence; tolerant of EOF (unclosed while streaming)
      blocks.push({ type: "code", content: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  return blocks;
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let k = 0;
  const emit = (node: ReactNode) => nodes.push(<Fragment key={`${keyBase}-${k++}`}>{node}</Fragment>);

  while (rest.length > 0) {
    const match = rest.match(INLINE);
    if (!match || match.index === undefined) {
      emit(rest);
      break;
    }
    if (match.index > 0) emit(rest.slice(0, match.index));

    const token = match[0];
    if (token.startsWith("`")) {
      emit(<code>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link && SAFE_URL.test(link[2])) {
        emit(
          <a href={link[2]} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>
        );
      } else {
        emit(token);
      }
    } else if (token.startsWith("**")) {
      emit(<strong>{token.slice(2, -2)}</strong>);
    } else {
      emit(<em>{token.slice(1, -1)}</em>);
    }
    rest = rest.slice(match.index + token.length);
  }

  return nodes;
}

export function Markdown({ text }: { text: string }): ReactElement {
  const blocks = parseBlocks(text);
  return (
    <div className="md flex flex-col gap-2 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        if (block.type === "code") {
          return (
            <pre className="md__code overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs" key={key}>
              <code>{block.content}</code>
            </pre>
          );
        }
        if (block.type === "heading") {
          const Tag = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5";
          return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
        }
        if (block.type === "ul") {
          return (
            <ul key={key}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={key}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        const softLines = block.text.split("\n");
        return (
          <p key={key}>
            {softLines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {renderInline(line, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
