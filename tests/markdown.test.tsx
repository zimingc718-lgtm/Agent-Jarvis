// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/lib/markdown";

function html(text: string): string {
  const { container } = render(<Markdown text={text} />);
  return container.innerHTML;
}

describe("Markdown", () => {
  it("renders paragraphs and soft line breaks", () => {
    const out = html("first line\nsecond line\n\nnew paragraph");
    expect(out).toContain("<br>");
    expect(render(<Markdown text="hello" />).container.querySelectorAll("p")).toHaveLength(1);
    expect(out).toContain("new paragraph");
  });

  it("renders fenced code blocks and tolerates an unclosed fence while streaming", () => {
    const closed = html("```js\nconst a = 1;\n```");
    expect(closed).toContain("<pre");
    expect(closed).toContain("const a = 1;");

    const streaming = html("```js\nconst a = 1;");
    expect(streaming).toContain("<pre");
    expect(streaming).toContain("const a = 1;");
  });

  it("renders inline code, bold and italic", () => {
    const out = html("use `npm test` with **bold** and *italic*");
    expect(out).toContain("<code>npm test</code>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
  });

  it("renders unordered and ordered lists", () => {
    const ul = render(<Markdown text={"- one\n- two"} />).container;
    expect(ul.querySelectorAll("ul li")).toHaveLength(2);

    const ol = render(<Markdown text={"1. one\n2. two"} />).container;
    expect(ol.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders headings as h3-h5 so a chat bubble never introduces an h1", () => {
    const out = html("# Title\n## Sub\n### Deep");
    expect(out).toContain("<h3>");
    expect(out).toContain("<h4>");
    expect(out).toContain("<h5>");
    expect(out).not.toContain("<h1>");
    expect(out).not.toContain("<h2>");
  });

  it("only links http/https/mailto and leaves other schemes as literal text", () => {
    render(<Markdown text="[docs](https://example.com/a)" />);
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute("href", "https://example.com/a");

    const unsafe = html("[click](javascript:alert(1))");
    expect(unsafe).not.toContain("<a");
    expect(unsafe).toContain("[click](javascript:alert(1))");
  });

  it("never emits raw HTML from the model", () => {
    const out = html('<img src=x onerror="alert(1)"> and <b>bold</b>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;img");
  });

  it("renders an empty string without crashing", () => {
    expect(() => html("")).not.toThrow();
  });
});
