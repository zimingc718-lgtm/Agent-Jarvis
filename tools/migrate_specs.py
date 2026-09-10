"""
One-shot, idempotent migration of the four layer specs to the DEC-020 structure
(CR-20260910-process-hardening, TASK-046).

Target shape for every spec:

    <H1 preamble>
    ## <baseline sections, in the layer's canonical order>
    ## 变更响应 · <CR>            (one per change record, sorted by CR name)
    ### <whitelisted subsection>
    ## 批准状态

Review content never stays in a spec: every review / retrospective section is
*moved* into its change record as `## R{n} 评审意见` — moved, not deleted, so no
reasoning is lost (CP-2, and the "信息不丢" acceptance clause).

Running this twice is a no-op: already-migrated documents contain no review
sections and their change-response headings are passed through untouched.

    python tools/migrate_specs.py [--root .] [--dry-run]
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

CHANGE_RESPONSE_PREFIX = "变更响应 · "
CHANGES_DIR = "project/06_changes"

# Review headings — these move to the change record.
REVIEW_PATTERNS = [
    re.compile(r"多角色评审"),
    re.compile(r"复盘迭代"),
    re.compile(r"评审（R[1-4]"),
    re.compile(r"R[1-4] 四角色审查"),
    re.compile(r"^CR-\S+\s*评审"),
]

# Per layer: which review level it feeds, its baseline section order, and how an
# old per-CR design heading maps onto a whitelisted subsection name.
LAYERS: dict[str, dict] = {
    "project/01_specification/产品需求说明书.md": {
        "level": "1",
        "baseline": ["产品目标", "用户范围", "功能需求", "非功能需求", "非目标"],
        "submap": [("澄清", "验收澄清")],
        "default_sub": "验收澄清",
    },
    "project/02_solution/架构设计说明书.md": {
        "level": "2",
        "baseline": [
            "设计目标", "架构角色定位与文档范围", "技术栈与部署形态", "总体架构",
            "架构决策", "模块边界", "接口契约", "外部 API 证据",
        ],
        "submap": [("变化点架构裁决", "逐变化点方案"), ("方案", "逐变化点方案")],
        "default_sub": "逐变化点方案",
    },
    "project/03_modules/模块任务开发说明书.md": {
        "level": "3",
        "baseline": ["模块任务总览", "关键接口"],
        "submap": [("变化点影响矩阵", "变化点影响矩阵"), ("技术设计", "技术设计")],
        "default_sub": "变化点影响矩阵",
    },
    "project/04_tests/测试说明书.md": {
        "level": "4",
        "baseline": ["制定依据", "测试矩阵", "真实入口冒烟"],
        "submap": [("任务→测试派生矩阵", "任务→测试派生矩阵"), ("测试设计", "测试设计")],
        "default_sub": "测试设计",
    },
}

# Headings that name a change record loosely (they predate the CP model).
CR_ALIASES = {"CR-20260909": "CR-20260909-minimal-floating-chat"}
# Reviews written before any per-CR review existed belong to the first change record.
FALLBACK_CR = "CR-20260908-floating-llm-chat"


def known_crs(root: Path) -> list[str]:
    """Change record stems, longest first so `CR-x-y` wins over `CR-x`."""
    names = [p.stem for p in (root / CHANGES_DIR).glob("CR-*.md")]
    return sorted(names, key=len, reverse=True)


def resolve_cr(title: str, crs: list[str]) -> str | None:
    for name in crs:
        if name in title:
            return name
    for alias, target in CR_ALIASES.items():
        if alias in title:
            return target
    return None


def is_review(title: str) -> bool:
    return any(pattern.search(title) for pattern in REVIEW_PATTERNS)


def split_sections(text: str, level: int) -> tuple[str, list[tuple[str, str]]]:
    """(preamble, [(title, body)]) split on headings of exactly `level`."""
    marker = "#" * level + " "
    lines = text.split("\n")
    preamble: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    for line in lines:
        if line.startswith(marker) and not line.startswith(marker + "#"):
            sections.append((line[len(marker):].strip(), []))
        elif sections:
            sections[-1][1].append(line)
        else:
            preamble.append(line)
    return "\n".join(preamble), [(title, "\n".join(body).strip("\n")) for title, body in sections]


def subsection_name(title: str, layer: dict) -> str:
    for needle, mapped in layer["submap"]:
        if needle in title:
            return mapped
    return layer["default_sub"]


def migrate_spec(root: Path, rel_path: str, layer: dict, crs: list[str]) -> tuple[str, dict[tuple[str, str], list[str]]]:
    """Return (new spec text, {(cr, level): [review chunks]})."""
    text = (root / rel_path).read_text(encoding="utf-8")
    preamble, blocks = split_sections(text, 2)

    baseline: dict[str, str] = {}
    responses: dict[str, list[str]] = {}
    approval = ""
    reviews: dict[tuple[str, str], list[str]] = {}
    level = layer["level"]

    def stash_review(title: str, body: str) -> None:
        cr = resolve_cr(title, crs) or FALLBACK_CR
        chunk = f"**{title}**（迁移自 `{Path(rel_path).name}`）\n\n{body}".rstrip()
        reviews.setdefault((cr, level), []).append(chunk)

    for title, body in blocks:
        if is_review(title):
            # `## 多角色评审` is a *container*: its `###` children are per-CR reviews and
            # must each be routed to their own change record, not lumped together.
            lead, subs = split_sections(body, 3)
            if lead.strip():
                stash_review(title, lead)
            for sub_title, sub_body in subs:
                stash_review(sub_title if resolve_cr(sub_title, crs) else f"{title} / {sub_title}", sub_body)
            if not subs and not lead.strip():
                stash_review(title, body)
            continue

        # A design block may still carry review subsections (### R2 四角色审查 …).
        lead, subs = split_sections(body, 3)
        kept: list[str] = []
        for sub_title, sub_body in subs:
            if is_review(sub_title):
                stash_review(sub_title, sub_body)
            else:
                kept.append(f"### {sub_title}\n\n{sub_body}".rstrip())
        body = "\n\n".join(part for part in [lead.strip("\n")] + kept if part.strip())

        if title == "批准状态":
            approval = body
        elif title in layer["baseline"]:
            baseline[title] = body
        elif title.startswith(CHANGE_RESPONSE_PREFIX):
            # Already migrated — pass through untouched (idempotency).
            responses.setdefault(title[len(CHANGE_RESPONSE_PREFIX):].strip(), []).append(body)
        else:
            cr = resolve_cr(title, crs)
            if cr is None:
                raise SystemExit(f"{rel_path}: cannot classify section '{title}'")
            responses.setdefault(cr, []).append(f"### {subsection_name(title, layer)}\n\n{body}".rstrip())

    out = [preamble.rstrip("\n")]
    for name in layer["baseline"]:
        if name in baseline:
            out.append(f"## {name}\n\n{baseline[name]}")
    for cr in sorted(responses):
        out.append(f"## {CHANGE_RESPONSE_PREFIX}{cr}\n\n" + "\n\n".join(responses[cr]))
    if approval:
        out.append(f"## 批准状态\n\n{approval}")
    return "\n\n".join(part.strip("\n") for part in out if part.strip()) + "\n", reviews


def append_reviews(root: Path, reviews: dict[tuple[str, str], list[str]], dry_run: bool) -> list[str]:
    notes: list[str] = []
    for (cr, level), chunks in sorted(reviews.items()):
        path = root / CHANGES_DIR / f"{cr}.md"
        if not path.exists():
            raise SystemExit(f"review destined for a missing change record: {cr}")
        text = path.read_text(encoding="utf-8")
        heading = f"## R{level} 评审意见"
        block = f"{heading}\n\n" + "\n\n".join(chunks)
        text = text.rstrip("\n") + "\n\n" + block + "\n"
        if not dry_run:
            path.write_text(text, encoding="utf-8", newline="")
        notes.append(f"{cr}: +{heading} ({len(chunks)} chunk(s))")
    return notes


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate the four layer specs to the DEC-020 structure")
    parser.add_argument("--root", default=".")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    crs = known_crs(root)

    all_reviews: dict[tuple[str, str], list[str]] = {}
    rewritten: list[str] = []
    for rel_path, layer in LAYERS.items():
        new_text, reviews = migrate_spec(root, rel_path, layer, crs)
        old_text = (root / rel_path).read_text(encoding="utf-8")
        for key, chunks in reviews.items():
            all_reviews.setdefault(key, []).extend(chunks)
        if new_text != old_text:
            if not args.dry_run:
                (root / rel_path).write_text(new_text, encoding="utf-8", newline="")
            rewritten.append(rel_path)

    notes = append_reviews(root, all_reviews, args.dry_run)
    prefix = "[dry-run] " if args.dry_run else ""
    if not rewritten and not notes:
        print(f"{prefix}already migrated - nothing to do")
        return 0
    for rel_path in rewritten:
        print(f"{prefix}rewrote {rel_path}")
    for note in notes:
        print(f"{prefix}moved review -> {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
