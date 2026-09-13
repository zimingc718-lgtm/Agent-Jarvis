"""把既有变更记录的 R1 签置改写成结构化行（DEC-190，CR-20260912-r1-signoff-marker）。

旧判据是「正文里同一行出现 R1 与拍板/终裁/人工确认」。它防得住「漏写签置」，防不住
「签置还没发生」——2026-09-12 有四条 CR 靠一句「R1 时一并终裁」全部报绿，而用户一次板
都还没拍；另有一条记录匹配到的是「选择理由」里顺带提到 R1 的散文。

新格式是一条明确断言过去事实的行：

    - R1 终裁: 已完成 | 用户 | 2026-09-10

本脚本只做机械改写，且遵守三条：

① **不造日期。** 只有当记录里某一行同时出现签置措辞与日期时才写日期，否则只写到签置人
   为止。宁可少一个字段，也不要一个看起来精确、其实是从文件名猜出来的日期。
② **不动原有散文。** 结构化行是新增的一行，原来那句话原样留着——它往往带着用户的原话，
   而那比任何结构化字段都更有价值。
③ **跳过 DRAFT。** 一条还在讨论的记录本来就没签过字，替它写「已完成」就是伪造。

幂等：已有结构化行的记录不再改动。

用法：
    python tools/migrate_r1_signoff.py --dry-run     # 只报告，不写
    python tools/migrate_r1_signoff.py               # 执行
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

CHANGES_DIR = Path("project/06_changes")

SIGNOFF_LINE = re.compile(r"^-\s*R1\s*终裁:\s*已完成\s*\|", re.M)
STATUS_LINE = re.compile(r"^-\s*状态:\s*(.+)$", re.M)
REVIEW_LINE = re.compile(r"^-\s*评审记录:.*$", re.M)
FIRST_HEADING = re.compile(r"^##\s", re.M)
DATE = re.compile(r"(20\d\d)[-年](\d{1,2})[-月](\d{1,2})")
# 措辞出现过的全部形态，取自实际记录，不是想象出来的
SIGNOFF_WORDS = ("拍板", "终裁", "人工确认", "确认，开始执行")


def has_cp_table(text: str) -> bool:
    return "## 变化点登记" in text


def is_draft(text: str) -> bool:
    match = STATUS_LINE.search(text)
    return bool(match) and match.group(1).strip().upper().startswith("DRAFT")


def discover_date(text: str) -> str | None:
    """只取与签置措辞同处一行的日期；找不到就返回 None，不退而求其次。"""
    for line in text.splitlines():
        if any(word in line for word in SIGNOFF_WORDS):
            found = DATE.search(line)
            if found:
                return f"{found.group(1)}-{int(found.group(2)):02d}-{int(found.group(3)):02d}"
    return None


def build_line(text: str) -> str:
    when = discover_date(text)
    return f"- R1 终裁: 已完成 | 用户 | {when}" if when else "- R1 终裁: 已完成 | 用户"


def insert(text: str, line: str) -> str:
    """放在「评审记录」之后；没有该行时放在前置清单末尾（第一个二级标题之前）。"""
    review = REVIEW_LINE.search(text)
    if review:
        end = review.end()
        return text[:end] + "\n" + line + text[end:]
    heading = FIRST_HEADING.search(text)
    if heading:
        return text[: heading.start()] + line + "\n\n" + text[heading.start() :]
    return text.rstrip() + "\n" + line + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()

    root = Path(args.root)
    changed: list[str] = []
    skipped_draft: list[str] = []
    already: list[str] = []
    no_date: list[str] = []

    for path in sorted((root / CHANGES_DIR).glob("CR-*.md")):
        text = path.read_text(encoding="utf-8")
        if not has_cp_table(text):
            continue
        if is_draft(text):
            skipped_draft.append(path.stem)
            continue
        if SIGNOFF_LINE.search(text):
            already.append(path.stem)
            continue
        line = build_line(text)
        if line.count("|") == 1:
            no_date.append(path.stem)
        if not args.dry_run:
            path.write_text(insert(text, line), encoding="utf-8", newline="")
        changed.append(f"{path.stem}  →  {line}")

    print(f"改写 {len(changed)} 条；已有结构化行 {len(already)} 条；DRAFT 跳过 {len(skipped_draft)} 条")
    if no_date:
        print(f"其中 {len(no_date)} 条记录里找不到与签置同行的日期，只写到签置人为止（按纪律①，不造日期）")
    for item in changed:
        print("  " + item)
    if skipped_draft:
        print("  DRAFT 跳过: " + ", ".join(skipped_draft))
    return 0


if __name__ == "__main__":
    sys.exit(main())
