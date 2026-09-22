#!/usr/bin/env python3
"""PDF/DOCX -> Markdown/HTML for document display.

Three modes, all structural (no LLM here — the optional model pass lives in
src/lib/document-format.ts, CR-20260921-format-skill):

    python3 scripts/documents_to_html.py <path>
        markitdown structure extraction, then python-markdown -> HTML
        (CR-20260921-markitdown-display, DEC-390). Default.

    python3 scripts/documents_to_html.py --markdown <path>
        markitdown extraction only; raw Markdown on stdout. Input to the
        model formatting pass.

    python3 scripts/documents_to_html.py --render
        Markdown on stdin -> HTML on stdout. Renders the model's formatted
        Markdown with the same tables/fenced_code/extra/nl2br pipeline, so the
        two display paths never drift apart in rendering.

Output is raw UTF-8 bytes on stdout, exit 0. On failure: message on stderr,
exit 1 — the Node caller decides how to present it; this never prints
partial/best-effort output on error.
"""
import sys

EXTENSIONS = ["tables", "fenced_code", "extra"]


def _write(text: str) -> None:
    # Raw UTF-8 bytes rather than sys.stdout.write(): on Windows the console codepage
    # (e.g. GBK) can't encode arbitrary Unicode, and the caller always decodes as UTF-8.
    sys.stdout.buffer.write(text.encode("utf-8"))


def _markdown_module():
    try:
        import markdown  # noqa: WPS433
    except ImportError:
        print("markdown not installed", file=sys.stderr)
        return None
    return markdown


def _extract(path: str):
    try:
        from markitdown import MarkItDown
    except ImportError:
        print("markitdown not installed", file=sys.stderr)
        return None
    try:
        result = MarkItDown().convert(path)
    except Exception as exc:  # noqa: BLE001 - report whatever markitdown raised
        print(f"markitdown conversion failed: {exc}", file=sys.stderr)
        return None
    text = (result.text_content or "").strip()
    if not text:
        print("empty conversion result", file=sys.stderr)
        return None
    return text


def main() -> int:
    args = sys.argv[1:]

    if args == ["--render"]:
        markdown = _markdown_module()
        if markdown is None:
            return 1
        source = sys.stdin.buffer.read().decode("utf-8", errors="replace").strip()
        if not source:
            print("empty markdown input", file=sys.stderr)
            return 1
        _write(markdown.markdown(source, extensions=EXTENSIONS))
        return 0

    if len(args) == 2 and args[0] == "--markdown":
        text = _extract(args[1])
        if text is None:
            return 1
        _write(text)
        return 0

    if len(args) == 1:
        markdown = _markdown_module()
        if markdown is None:
            return 1
        text = _extract(args[0])
        if text is None:
            return 1
        _write(markdown.markdown(text, extensions=EXTENSIONS))
        return 0

    print("usage: documents_to_html.py <path> | --markdown <path> | --render < markdown", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
