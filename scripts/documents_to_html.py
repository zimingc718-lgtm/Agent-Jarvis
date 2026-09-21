#!/usr/bin/env python3
"""PDF/DOCX -> HTML for document display (CR-20260921-markitdown-display).

Two-stage, both structural (no LLM, no content rewriting — DEC-390):
  1. markitdown extracts structure (headings/lists/tables) as Markdown.
  2. python-markdown renders that Markdown to HTML (tables/fenced_code/extra
     extensions), since the app's own chat Markdown renderer has no table
     support and this content is table-heavy engineering documents.

Invoked as `python3 -m scripts.documents_to_html <path>` is NOT how this is
called (no package __init__); it is run directly:
    python3 scripts/documents_to_html.py <path>
HTML on stdout, exit 0, on success. On failure: message on stderr, exit 1 —
the caller (src/lib/markitdown.ts) decides how to present that to a user, so
this never prints partial/best-effort HTML on error.
"""
import sys

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: documents_to_html.py <path>", file=sys.stderr)
        return 2
    path = sys.argv[1]

    try:
        from markitdown import MarkItDown
    except ImportError:
        print("markitdown not installed", file=sys.stderr)
        return 1
    try:
        import markdown
    except ImportError:
        print("markdown not installed", file=sys.stderr)
        return 1

    try:
        result = MarkItDown().convert(path)
    except Exception as exc:  # noqa: BLE001 - report whatever markitdown raised, don't guess the type
        print(f"markitdown conversion failed: {exc}", file=sys.stderr)
        return 1

    text = (result.text_content or "").strip()
    if not text:
        print("empty conversion result", file=sys.stderr)
        return 1

    html = markdown.markdown(text, extensions=["tables", "fenced_code", "extra"])
    # Write raw UTF-8 bytes rather than sys.stdout.write(): on Windows the console
    # codepage (e.g. GBK) can't encode arbitrary Unicode (bullets, CJK punctuation),
    # and the caller always decodes the subprocess's stdout as UTF-8 regardless of platform.
    sys.stdout.buffer.write(html.encode("utf-8"))
    return 0

if __name__ == "__main__":
    sys.exit(main())
