import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tools import governance


REQUIRED_TEXT = {
    "AGENTS.md": "# AGENTS.md\n",
    "tools/__init__.py": '"""Project-local governance tooling."""\n',
    "tools/governance.py": "# governance script placeholder\n",
    "tests/test_governance.py": "# governance tests placeholder\n",
    "docs/AI_STANDARD.md": "# Agent-Jarvis AI 规范控制\n",
    "docs/WORKFLOW.md": "# Agent-Jarvis 执行流程控制\n",
    "docs/CONTROLS.md": "# Agent-Jarvis 门禁与流程控制\n",
    "docs/UI_STANDARD.md": (
        "# Agent-Jarvis UI 开发规范\n\n"
        "UI-GOV-001\n"
        "Design Tokens\n"
        "WCAG 2.2 AA\n"
        "WAI-ARIA Authoring Practices\n"
        "Component-Driven Development\n"
        "Testing Library\n"
        "Playwright\n"
        "real-entry\n"
        "third-party provider authorization\n"
    ),
    "package.json": json.dumps(
        {
            "scripts": {
                "test:auth-ui": "vitest run tests/auth-actions.test.tsx tests/floating-chat.test.tsx tests/settings-models.test.tsx",
                "test:visual": "vitest run tests/visual.test.ts",
                "test:e2e": "node scripts/run-e2e.mjs",
                "test:ui-contract": "node scripts/ui-contract.mjs",
                "governance:ui": "python tools/governance.py ui",
            }
        }
    ),
    "project/00_input/需求输入.md": (
        "# 需求输入\n\n"
        "## 原始输入记录\n\n"
        "用户确认建立一个受控项目，先通过需求说明书、架构说明书、模块任务和测试说明书进行流程管控。\n"
    ),
    "project/01_specification/产品需求说明书.md": (
        "# 产品需求说明书\n\n"
        "## 批准状态\n\n"
        "- 当前状态：APPROVED\n"
        "- 用户确认：2026-09-08\n\n"
        "## 需求表\n\n"
        "| ID | 名称 | 优先级 | 描述 | 验收标准 | 状态 |\n"
        "|---|---|---|---|---|---|\n"
        "| REQ-F-001 | 已确认需求 | MUST | 已确认的测试需求 | 可验证验收标准 | APPROVED |\n"
    ),
    "project/02_solution/架构设计说明书.md": (
        "# 架构设计说明书\n\n"
        "## 批准状态\n\n- 当前状态：APPROVED\n\nREQ-F-001\n"
    ),
    "project/03_modules/模块任务开发说明书.md": (
        "# 模块任务开发说明书\n\n"
        "| 任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试 |\n"
        "|---|---|---|---|---|---|---|\n"
        "| TASK-001 | MOD-001 | 实现已确认需求 | DONE | 无 | REQ-F-001 | TEST-001 |\n"
    ),
    "project/04_tests/测试说明书.md": (
        "# 测试说明书\n\n"
        "| 测试 ID | 类型 | 覆盖需求 | 覆盖模块/任务 | 断言目标 | 命令 | 必选 |\n"
        "|---|---|---|---|---|---|---|\n"
        "| TEST-001 | 文档 | REQ-F-001 | MOD-001 / TASK-001 | 验收标准可观察 | echo pass | 是 |\n"
    ),
    "project/05_evidence/README.md": "# 证据记录\n",
    "project/06_changes/README.md": "# 变更记录\n",
    "project/07_releases/版本发布控制说明书.md": (
        "# 版本发布控制说明书\n\n"
        "## 当前状态\n\n- 当前状态：APPROVED\n\n## 回滚要求\n\n- 回滚方式\n"
    ),
}


def write_project(root: Path, overrides: dict[str, str] | None = None) -> None:
    files = dict(REQUIRED_TEXT)
    if overrides:
        files.update(overrides)
    for rel_path, text in files.items():
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


class GovernanceCliTests(unittest.TestCase):
    def test_verify_requires_governance_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            code, output = governance.run(["verify", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("MISSING_REQUIRED_FILE", output)
        self.assertIn("docs/AI_STANDARD.md", output)

    def test_g1_blocks_unapproved_product_requirements(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(
                root,
                {
                    "project/01_specification/产品需求说明书.md": (
                        "# 产品需求说明书\n\n"
                        "## 当前状态\n\n产品功能需求尚未与用户确认。\n"
                    )
                },
            )
            code, output = governance.run(["gate", "g1", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("G1_BLOCKED", output)
        self.assertIn("用户确认", output)

    def test_g1_passes_confirmed_requirements_with_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            write_project(Path(directory))
            code, output = governance.run(["gate", "g1", "--root", directory])

        self.assertEqual(code, 0)
        self.assertIn("G1_PASS", output)

    def test_snapshot_and_verify_detects_changed_controlled_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)

            snapshot_code, snapshot_output = governance.run(
                ["snapshot", "--root", directory, "--actor", "tester"]
            )
            self.assertEqual(snapshot_code, 0, snapshot_output)

            verify_code, verify_output = governance.run(["verify", "--root", directory])
            self.assertEqual(verify_code, 0, verify_output)

            (root / "docs/AI_STANDARD.md").write_text("# changed\n", encoding="utf-8")
            changed_code, changed_output = governance.run(["verify", "--root", directory])

        self.assertEqual(changed_code, 1)
        self.assertIn("BASELINE_CHANGED", changed_output)
        self.assertIn("docs/AI_STANDARD.md", changed_output)

    def test_verify_detects_unbaselined_project_file_after_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)

            snapshot_code, snapshot_output = governance.run(
                ["snapshot", "--root", directory, "--actor", "tester"]
            )
            self.assertEqual(snapshot_code, 0, snapshot_output)

            app_file = root / "src/app/page.tsx"
            app_file.parent.mkdir(parents=True)
            app_file.write_text("export default function Page() { return null; }\n", encoding="utf-8")

            code, output = governance.run(["verify", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("UNBASELINED_FILE", output)
        self.assertIn("src/app/page.tsx", output)

    def test_check_changes_rejects_incomplete_change_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            change_path = root / "project/06_changes/CR-20260908-incomplete.md"
            change_path.write_text("# CR-20260908-incomplete\n\n- 级别：L2\n", encoding="utf-8")

            code, output = governance.run(["check-changes", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("CHANGE_RECORD_INCOMPLETE", output)
        self.assertIn("CR-20260908-incomplete.md", output)

    def test_verify_requires_ui_standard_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            (root / "docs/UI_STANDARD.md").unlink()

            code, output = governance.run(["verify", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("MISSING_REQUIRED_FILE", output)
        self.assertIn("docs/UI_STANDARD.md", output)

    def test_verify_rejects_incomplete_ui_standard(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root, {"docs/UI_STANDARD.md": "# UI\n\nDesign Tokens\n"})

            code, output = governance.run(["verify", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("UI_STANDARD_INCOMPLETE", output)
        self.assertIn("WCAG 2.2 AA", output)

    def test_ui_command_requires_ui_test_scripts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(
                root,
                {
                    "package.json": json.dumps(
                        {
                            "scripts": {
                                "test:auth-ui": "vitest run tests/auth-actions.test.tsx",
                                "governance:ui": "python tools/governance.py ui",
                            }
                        }
                    )
                },
            )

            code, output = governance.run(["ui", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("UI_SCRIPT_MISSING", output)
        self.assertIn("test:e2e", output)
        self.assertIn("test:visual", output)

    def test_ui_command_passes_when_standard_and_scripts_exist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)

            code, output = governance.run(["ui", "--root", directory])

        self.assertEqual(code, 0, output)
        self.assertIn("UI_CONTROL_PASS", output)

    def test_ui_command_requires_the_executable_ui_contract_when_tsx_source_exists(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(
                root,
                {
                    "src/app/page.tsx": "export default function Page() { return null; }\n",
                    "tests/floating-chat.test.tsx": "// component test placeholder\n",
                    "tests/e2e/human-workflow.spec.ts": "// e2e placeholder\n",
                },
            )

            missing_code, missing_output = governance.run(["ui", "--root", directory])
            self.assertEqual(missing_code, 1)
            self.assertIn("UI_CONTRACT_SCRIPT_MISSING", missing_output)

            (root / "scripts").mkdir(parents=True, exist_ok=True)
            (root / "scripts/ui-contract.mjs").write_text("// contract\n", encoding="utf-8")
            ok_code, ok_output = governance.run(["ui", "--root", directory])

        self.assertEqual(ok_code, 0, ok_output)
        self.assertIn("UI_CONTROL_PASS", ok_output)

    def test_snapshot_writes_hash_chained_ledger_event(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            code, output = governance.run(["snapshot", "--root", directory, "--actor", "tester"])
            self.assertEqual(code, 0, output)

            ledger_path = root / "project/.governance/ledger.jsonl"
            events = [
                json.loads(line)
                for line in ledger_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["seq"], 1)
        self.assertEqual(events[0]["actor"], "tester")
        self.assertEqual(events[0]["prev_hash"], "GENESIS")
        self.assertRegex(events[0]["hash"], r"^[0-9a-f]{64}$")

    def test_g3_g35_and_g4_pass_with_current_test_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            evidence_path = root / "project/05_evidence/test-results.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "tests": [
                            {"id": "TEST-001", "result": "PASS", "real_entry": False},
                            {"id": "TEST-013", "result": "PASS", "real_entry": True},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            g3_code, g3_output = governance.run(["gate", "g3", "--root", directory])
            g35_code, g35_output = governance.run(["gate", "g3.5", "--root", directory])
            g4_code, g4_output = governance.run(["gate", "g4", "--root", directory])

        self.assertEqual(g3_code, 0, g3_output)
        self.assertIn("G3_PASS", g3_output)
        self.assertEqual(g35_code, 0, g35_output)
        self.assertIn("G3_5_PASS", g35_output)
        self.assertEqual(g4_code, 0, g4_output)
        self.assertIn("G4_PASS", g4_output)

    def _project_with_manual_test(self, root: Path, entry: dict[str, object]) -> None:
        write_project(
            root,
            {
                "project/04_tests/测试说明书.md": (
                    "# 测试说明书\n\n"
                    "| 测试 ID | 覆盖需求 | 命令 | 必选 |\n"
                    "|---|---|---|---|\n"
                    "| TEST-001 | REQ-F-001 | npm test | 是 |\n"
                    "| TEST-013 | REQ-F-001 | npm run test:smoke | 是 |\n"
                    "| TEST-022 | REQ-F-001 | 人工验证 | 是 |\n"
                )
            },
        )
        (root / "project/05_evidence/test-results.json").write_text(
            json.dumps(
                {
                    "tests": [
                        {"id": "TEST-001", "result": "PASS"},
                        {"id": "TEST-013", "result": "PASS", "real_entry": True},
                        entry,
                    ]
                }
            ),
            encoding="utf-8",
        )

    def test_g3_blocks_while_a_manual_verification_is_pending(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_manual_test(
                root, {"id": "TEST-022", "result": "PENDING", "verification": "manual"}
            )

            code, output = governance.run(["gate", "g3", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("G3_BLOCKED", output)
        self.assertIn("manual verification pending", output)
        self.assertIn("TEST-022", output)

    def test_g3_rejects_a_manual_pass_without_attribution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_manual_test(
                root, {"id": "TEST-022", "result": "PASS", "verification": "manual"}
            )

            code, output = governance.run(["gate", "g3", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("without verified_by/verified_at", output)
        self.assertIn("TEST-022", output)

    def test_g3_accepts_a_manual_pass_with_attribution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_manual_test(
                root,
                {
                    "id": "TEST-022",
                    "result": "PASS",
                    "verification": "manual",
                    "verified_by": "product owner",
                    "verified_at": "2026-09-09",
                },
            )

            code, output = governance.run(["gate", "g3", "--root", directory])

        self.assertEqual(code, 0, output)
        self.assertIn("G3_PASS", output)

    # CR-20260909-consensus-review-gates — TEST-033
    def _project_with_cp_cr(self, root: Path, cr_body: str) -> None:
        write_project(root, {"project/06_changes/CR-2099-demo.md": cr_body})

    _CP_REGISTRY = (
        "# CR-2099-demo\n\n"
        "## 变化点登记\n\n"
        "| CP | 来源角色 | 一句话 | 关联 ID | 类型 |\n"
        "|---|---|---|---|---|\n"
        "| CP-1 | 产品 | demo change | REQ-F-001 | 修改 |\n"
        "| CP-2 | 测试 | derived concern | REQ-F-001 | 派生 |\n\n"
    )

    _GOOD_MATRIX = (
        "## R2 评审矩阵\n\n"
        "| CP | 产品 | 架构 | 模块 | 测试 |\n"
        "|---|---|---|---|---|\n"
        "| CP-1 | APPROVED ev1 | APPROVED ev2 | CONDITIONAL 须补迁移 ev3 | APPROVED ev4 |\n"
        "| CP-2 | APPROVED ev5 | APPROVED ev6 | APPROVED ev7 | APPROVED ev8 |\n\n"
    )

    def test_review_passes_when_cps_are_covered_and_the_matrix_is_clean(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_cp_cr(root, self._CP_REGISTRY + self._GOOD_MATRIX)
            # The architecture doc must mention the CR and both CP ids.
            (root / "project/02_solution/架构设计说明书.md").write_text(
                "# 架构设计说明书\n\n## 批准状态\n\n- 当前状态：APPROVED\n\nREQ-F-001\n\n"
                "## CR-2099-demo 方案\n\nCP-1 和 CP-2 都在此响应。\n",
                encoding="utf-8",
            )
            code, output = governance.run(["review", "r2", "--root", directory])

        self.assertEqual(code, 0, output)
        self.assertIn("REVIEW_R2_PASS", output)

    def test_review_flags_a_change_point_missing_from_the_layer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_cp_cr(root, self._CP_REGISTRY + self._GOOD_MATRIX)
            (root / "project/02_solution/架构设计说明书.md").write_text(
                "# 架构设计说明书\n\n## 批准状态\n\n- 当前状态：APPROVED\n\n"
                "## CR-2099-demo 方案\n\n只响应了 CP-1。\n",
                encoding="utf-8",
            )
            code, output = governance.run(["review", "r2", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("REVIEW_R2_COVERAGE_GAP", output)
        self.assertIn("CP-2", output)

    def test_review_coverage_is_scoped_to_the_crs_own_section(self) -> None:
        # A sibling CR's section mentions CP-2; the target CR's own section does not.
        # Coverage must still flag CP-2 as a gap (no cross-CR CP-id borrowing).
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_cp_cr(root, self._CP_REGISTRY + self._GOOD_MATRIX)
            (root / "project/02_solution/架构设计说明书.md").write_text(
                "# 架构设计说明书\n\n"
                "## CR-2099-other 方案\n\n处理了 CP-1 和 CP-2。\n\n"
                "## CR-2099-demo 方案\n\n只响应了 CP-1。\n",
                encoding="utf-8",
            )
            code, output = governance.run(["review", "r2", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("REVIEW_R2_COVERAGE_GAP", output)
        self.assertIn("CP-2", output)

    def test_review_blocks_on_a_rejected_verdict(self) -> None:
        rejected = self._GOOD_MATRIX.replace("APPROVED ev4", "REJECTED 不可测")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_cp_cr(root, self._CP_REGISTRY + rejected)
            (root / "project/02_solution/架构设计说明书.md").write_text(
                "# 架构设计说明书\n\n## CR-2099-demo 方案\n\nCP-1 CP-2\n", encoding="utf-8"
            )
            code, output = governance.run(["review", "r2", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("REVIEW_R2_BLOCKED", output)
        self.assertIn("REJECTED", output)

    def test_review_r1_requires_a_human_sign_off(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_cp_cr(root, self._CP_REGISTRY)  # no R1 marker
            code, output = governance.run(["review", "r1", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("REVIEW_R1_BLOCKED", output)
        self.assertIn("sign-off", output)

    def test_review_passes_vacuously_without_the_cp_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            code, output = governance.run(["review", "r2", "--root", directory])

        self.assertEqual(code, 0, output)
        self.assertIn("no change record uses the CP-registry model", output)

    def test_g3_passes_but_reports_a_deferred_test(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_manual_test(
                root, {"id": "TEST-022", "result": "DEFERRED", "verification": "manual"}
            )

            code, output = governance.run(["gate", "g3", "--root", directory])

        self.assertEqual(code, 0, output)
        self.assertIn("G3_PASS", output)
        self.assertIn("deferred", output)
        self.assertIn("TEST-022", output)

    # CR-20260910-agent-tooling CP-37: a test whose behaviour an approved CR deleted
    # cannot produce PASS evidence, and demanding it would demand a lie. SUPERSEDED
    # skips it — but only when the row names the CR that replaced it, so the status
    # cannot be used to quietly silence a genuinely failing test.
    def test_g3_passes_but_reports_a_superseded_test(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_manual_test(
                root,
                {
                    "id": "TEST-022",
                    "result": "SUPERSEDED",
                    "notes": "CR-20260910-agent-tooling：routeTurn 删除，由 TEST-069 取代",
                },
            )

            code, output = governance.run(["gate", "g3", "--root", directory])

        self.assertEqual(code, 0, output)
        self.assertIn("G3_PASS", output)
        self.assertIn("superseded", output)
        self.assertIn("TEST-022", output)

    def test_g3_rejects_a_supersede_that_names_no_cr(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._project_with_manual_test(
                root, {"id": "TEST-022", "result": "SUPERSEDED", "notes": "not needed any more"}
            )

            code, output = governance.run(["gate", "g3", "--root", directory])

        self.assertEqual(code, 1, output)
        self.assertIn("G3_BLOCKED", output)
        self.assertIn("SUPERSEDED", output)


# --- CR-20260910-process-hardening: TEST-051..054 --------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent

# Every change record that uses the CP-registry model. TEST-054 judges all of them.
CP_MODEL_CRS = [
    "CR-20260909-skills",
    "CR-20260909-display-screen",
    "CR-20260910-skill-intake",
    "CR-20260910-ui-foundation",
    "CR-20260910-process-hardening",
]


class ChangePointReviewFixtures:
    """Shared CP fixtures - the scoping tests need the same shapes the R2 tests use."""

    CP_REGISTRY = (
        "# CR-2099-demo\n\n"
        "## 变化点登记\n\n"
        "| CP | 来源角色 | 一句话 | 关联 ID | 类型 |\n"
        "|---|---|---|---|---|\n"
        "| CP-1 | 产品 | demo change | REQ-F-001 | 修改 |\n"
        "| CP-2 | 测试 | derived concern | REQ-F-001 | 派生 |\n\n"
    )

    GOOD_MATRIX = (
        "## R2 评审矩阵\n\n"
        "| CP | 产品 | 架构 | 模块 | 测试 |\n"
        "|---|---|---|---|---|\n"
        "| CP-1 | APPROVED ev1 | APPROVED ev2 | APPROVED ev3 | APPROVED ev4 |\n"
        "| CP-2 | APPROVED ev5 | APPROVED ev6 | APPROVED ev7 | APPROVED ev8 |\n\n"
    )


def _cr_with_labels(name: str, tests: str) -> str:
    """A change record complete enough for check-changes, carrying an 影响测试 label.

    L1 because it carries no CP registry: since DEC-021 ⑤ a record that skips the
    CP chain must be an L1 change, and `review` blocks anything else rather than
    passing over it in silence. The level is incidental to what these tests probe
    (`--cr` scoping and stage aggregation).
    """
    return (
        "# " + name + "\n\n"
        "- 级别: L1\n"
        "- 提出人: tester\n"
        "- 状态: R1 已人工终裁\n"
        "- 影响需求: REQ-F-001\n"
        "- 影响模块: MOD-001\n"
        "- 影响任务: TASK-001\n"
        "- 影响测试: " + tests + "\n"
        "- 当前证据: `project/05_evidence/EV-x.md`\n"
        "- 方案选项:\n  - A. 否决\n  - B. **选中**\n"
        "- 选择理由: 证据\n"
        "- 回滚方式: 文档回滚\n"
        "- 验收条件:\n  - R1: 人工终裁\n"
        "- 评审记录: R1 四角色独立评审。**R1 人工终裁**：用户已拍板。\n\n"
    )


class ScopeAndStageTests(unittest.TestCase):
    """TEST-051 - --cr scoping, stage aggregation, tsconfig normalisation."""

    def _two_cr_project(self, root: Path) -> None:
        write_project(
            root,
            {
                "project/04_tests/测试说明书.md": (
                    "# 测试说明书\n\n"
                    "| 测试 ID | 覆盖需求 | 命令 | 必选 |\n"
                    "|---|---|---|---|\n"
                    "| TEST-001 | REQ-F-001 | npm test | 是 |\n"
                    "| TEST-013 | REQ-F-001 | npm run test:smoke | 是 |\n"
                    "| TEST-090 | REQ-F-001 | npm test | 是 |\n"
                ),
                "project/06_changes/CR-2099-mine.md": _cr_with_labels(
                    "CR-2099-mine", "TEST-001, TEST-013"
                ),
                "project/06_changes/CR-2099-theirs.md": _cr_with_labels(
                    "CR-2099-theirs", "TEST-090"
                ),
            },
        )
        # TEST-090 (the *other* CR's work) has no evidence at all.
        (root / "project/05_evidence/test-results.json").write_text(
            json.dumps(
                {
                    "tests": [
                        {"id": "TEST-001", "result": "PASS"},
                        {"id": "TEST-013", "result": "PASS", "real_entry": True},
                    ]
                }
            ),
            encoding="utf-8",
        )

    def test_051_1_cr_scope_passes_while_the_default_still_fails(self) -> None:
        # The whole point of CP-5: a narrowing view must not weaken the default.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._two_cr_project(root)

            scoped_code, scoped_output = governance.run(
                ["gate", "g3", "--root", directory, "--cr", "CR-2099-mine"]
            )
            default_code, default_output = governance.run(["gate", "g3", "--root", directory])

        self.assertEqual(scoped_code, 0, scoped_output)
        self.assertIn("G3_PASS", scoped_output)
        self.assertEqual(default_code, 1, default_output)
        self.assertIn("TEST-090", default_output)

    def test_051_1b_cr_scope_rejects_an_unknown_change_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._two_cr_project(root)
            code, output = governance.run(
                ["gate", "g3", "--root", directory, "--cr", "CR-2099-nope"]
            )

        self.assertEqual(code, 1)
        self.assertIn("unknown change record", output)

    def test_051_2_review_cr_scope_judges_only_that_change_record(self) -> None:
        good = ChangePointReviewFixtures.CP_REGISTRY.replace("CR-2099-demo", "CR-2099-good")
        bad = ChangePointReviewFixtures.CP_REGISTRY.replace("CR-2099-demo", "CR-2099-bad")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(
                root,
                {
                    "project/06_changes/CR-2099-good.md": good
                    + ChangePointReviewFixtures.GOOD_MATRIX,
                    "project/06_changes/CR-2099-bad.md": bad
                    + ChangePointReviewFixtures.GOOD_MATRIX.replace(
                        "APPROVED ev4", "REJECTED 不可测"
                    ),
                    "project/02_solution/架构设计说明书.md": (
                        "# 架构设计说明书\n\n"
                        "## CR-2099-good 方案\n\nCP-1 CP-2 均已响应。\n\n"
                        "## CR-2099-bad 方案\n\nCP-1 CP-2 均已响应。\n"
                    ),
                },
            )

            scoped_code, scoped_output = governance.run(
                ["review", "r2", "--root", directory, "--cr", "CR-2099-good"]
            )
            default_code, default_output = governance.run(["review", "r2", "--root", directory])

        self.assertEqual(scoped_code, 0, scoped_output)
        self.assertIn("REVIEW_R2_PASS", scoped_output)
        self.assertEqual(default_code, 1, default_output)
        self.assertIn("REJECTED", default_output)

    def test_051_3_g4_and_release_refuse_a_narrowing_scope(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._two_cr_project(root)

            g4_code, g4_output = governance.run(
                ["gate", "g4", "--root", directory, "--cr", "CR-2099-mine"]
            )
            release_code, release_output = governance.run(
                ["check", "release", "--root", directory, "--cr", "CR-2099-mine"]
            )

        self.assertEqual(g4_code, 1)
        self.assertIn("--cr is not accepted", g4_output)
        self.assertEqual(release_code, 1)
        self.assertIn("--cr is not accepted", release_output)

    def test_051_4_check_stage_runs_its_gate_set_and_fails_with_any_sub_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._two_cr_project(root)

            # p1 needs neither test evidence nor the spec structure contract.
            p1_code, p1_output = governance.run(["check", "p1", "--root", directory])
            # p3 does - and TEST-090 has none, so the aggregate must fail and say which step.
            p3_code, p3_output = governance.run(["check", "p3", "--root", directory])

        self.assertEqual(p1_code, 0, p1_output)
        self.assertIn("STAGE_P1_PASS", p1_output)
        self.assertEqual(p3_code, 1, p3_output)
        self.assertIn("[gate g3]", p3_output)

    def test_051_4b_a_narrowed_stage_passes_where_the_full_scope_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._two_cr_project(root)
            # p2 also runs check-specs, so the specs must satisfy the structure contract.
            (root / "project/01_specification/产品需求说明书.md").write_text(
                "# 产品需求说明书\n\n## 功能需求\n\n"
                "| ID | 名称 | 优先级 | 描述 | 验收标准 | 状态 |\n"
                "|---|---|---|---|---|---|\n"
                "| REQ-F-001 | 已确认需求 | MUST | 已确认的测试需求 | 可验证验收标准 | APPROVED |\n\n"
                "## 批准状态\n\n- 当前状态：APPROVED\n- 用户确认：2026-09-08\n",
                encoding="utf-8",
            )
            (root / "project/02_solution/架构设计说明书.md").write_text(
                "# 架构设计说明书\n\n## 批准状态\n\n- 当前状态：APPROVED\n\nREQ-F-001\n",
                encoding="utf-8",
            )
            (root / "project/03_modules/模块任务开发说明书.md").write_text(
                "# 模块任务开发说明书\n\n## 模块任务总览\n\n"
                "| 任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试 |\n"
                "|---|---|---|---|---|---|---|\n"
                "| TASK-001 | MOD-001 | 实现已确认需求 | DONE | 无 | REQ-F-001 | TEST-001 |\n",
                encoding="utf-8",
            )
            (root / "project/04_tests/测试说明书.md").write_text(
                "# 测试说明书\n\n## 测试矩阵\n\n"
                "| 测试 ID | 覆盖需求 | 命令 | 必选 |\n"
                "|---|---|---|---|\n"
                "| TEST-001 | REQ-F-001 | npm test | 是 |\n"
                "| TEST-013 | REQ-F-001 | npm run test:smoke | 是 |\n"
                "| TEST-090 | REQ-F-001 | npm test | 是 |\n",
                encoding="utf-8",
            )

            scoped_code, scoped_output = governance.run(
                ["check", "p2", "--root", directory, "--cr", "CR-2099-mine"]
            )

        self.assertEqual(scoped_code, 0, scoped_output)
        self.assertIn("STAGE_P2_PASS", scoped_output)
        self.assertIn("CR-2099-mine", scoped_output)

    def test_051_5_tsconfig_build_dir_churn_is_normalised_but_real_edits_are_not(self) -> None:
        base = {
            "compilerOptions": {"strict": True},
            "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            tsconfig = root / "tsconfig.json"
            tsconfig.write_text(json.dumps(base, indent=2) + "\n", encoding="utf-8")

            snapshot_code, snapshot_output = governance.run(
                ["snapshot", "--root", directory, "--actor", "tester"]
            )
            self.assertEqual(snapshot_code, 0, snapshot_output)

            # What Next.js does on every build: append its own build-dir type glob.
            churned = dict(base)
            churned["include"] = base["include"] + [
                ".next-verify/types/**/*.ts",
                ".next/types/**/*.ts",
            ]
            tsconfig.write_text(json.dumps(churned, indent=2) + "\n", encoding="utf-8")
            churn_code, churn_output = governance.run(["verify", "--root", directory])

            # A genuine edit to any other field must still be caught.
            real_edit = dict(base)
            real_edit["compilerOptions"] = {"strict": False}
            tsconfig.write_text(json.dumps(real_edit, indent=2) + "\n", encoding="utf-8")
            edit_code, edit_output = governance.run(["verify", "--root", directory])

        self.assertEqual(churn_code, 0, churn_output)
        self.assertNotIn("tsconfig.json", churn_output)
        self.assertEqual(edit_code, 1, edit_output)
        self.assertIn("BASELINE_CHANGED", edit_output)
        self.assertIn("tsconfig.json", edit_output)


class ScaffoldingTests(unittest.TestCase):
    """TEST-052 - new-cr and matrix produce artefacts that pass the gates."""

    def test_052_1_new_cr_output_passes_check_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            create_code, create_output = governance.run(
                ["new-cr", "CR-2099-scaffold", "--root", directory]
            )
            self.assertEqual(create_code, 0, create_output)

            text = (root / "project/06_changes/CR-2099-scaffold.md").read_text(encoding="utf-8")
            check_code, check_output = governance.run(["check-changes", "--root", directory])

        self.assertEqual(check_code, 0, check_output)
        # Half-width colons on every label - the full-width variant was a recurring accident.
        for label in governance.CHANGE_REQUIRED_LABELS:
            self.assertIn("- " + label + ":", text, label)

    def test_052_2_new_cr_refuses_to_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            path = root / "project/06_changes/CR-2099-scaffold.md"
            path.write_text("# hand written\n", encoding="utf-8")

            code, output = governance.run(["new-cr", "CR-2099-scaffold", "--root", directory])
            untouched = path.read_text(encoding="utf-8")

        self.assertEqual(code, 1)
        self.assertIn("NEW_CR_EXISTS", output)
        self.assertEqual(untouched, "# hand written\n")

    def test_052_3_matrix_mirrors_the_cp_registry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(
                root,
                {"project/06_changes/CR-2099-demo.md": ChangePointReviewFixtures.CP_REGISTRY},
            )
            code, output = governance.run(["matrix", "CR-2099-demo", "--root", directory])
            self.assertEqual(code, 0, output)
            text = (root / "project/06_changes/CR-2099-demo.md").read_text(encoding="utf-8")

        for level in ("2", "3", "4"):
            self.assertIn("## R" + level + " 评审矩阵", text)
        for role in governance.REVIEW_ROLES:
            self.assertIn("| " + role + " ", text)
        # One row per CP, per matrix - three matrices over two CPs.
        self.assertEqual(text.count("| TODO | TODO | TODO | TODO |"), 6)

    def test_052_4_an_unfilled_matrix_is_rejected_by_review(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(
                root,
                {
                    "project/06_changes/CR-2099-demo.md": ChangePointReviewFixtures.CP_REGISTRY,
                    "project/02_solution/架构设计说明书.md": (
                        "# 架构设计说明书\n\n## CR-2099-demo 方案\n\nCP-1 CP-2\n"
                    ),
                },
            )
            build_code, build_output = governance.run(
                ["matrix", "CR-2099-demo", "--root", directory]
            )
            self.assertEqual(build_code, 0, build_output)

            code, output = governance.run(["review", "r2", "--root", directory])

        self.assertEqual(code, 1, output)
        self.assertIn("MATRIX_INVALID", output)

    def test_052_5_matrix_skips_existing_unless_forced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(
                root,
                {
                    "project/06_changes/CR-2099-demo.md": ChangePointReviewFixtures.CP_REGISTRY
                    + ChangePointReviewFixtures.GOOD_MATRIX
                },
            )
            skip_code, skip_output = governance.run(["matrix", "CR-2099-demo", "--root", directory])
            after_skip = (root / "project/06_changes/CR-2099-demo.md").read_text(encoding="utf-8")

            force_code, force_output = governance.run(
                ["matrix", "CR-2099-demo", "--root", directory, "--force"]
            )
            after_force = (root / "project/06_changes/CR-2099-demo.md").read_text(encoding="utf-8")

        self.assertEqual(skip_code, 0, skip_output)
        self.assertIn("skipped R2", skip_output)
        self.assertIn("APPROVED ev1", after_skip)  # the filled verdicts survive
        self.assertEqual(force_code, 0, force_output)
        self.assertIn("TODO", after_force)


class SpecStructureTests(unittest.TestCase):
    """TEST-053 - the spec structure contract and the migration's idempotency."""

    SPEC = "project/01_specification/产品需求说明书.md"

    def _spec_project(self, root: Path, product_doc: str) -> None:
        write_project(
            root,
            {
                self.SPEC: product_doc,
                "project/02_solution/架构设计说明书.md": (
                    "# 架构设计说明书\n\n## 批准状态\n\nAPPROVED\n"
                ),
                "project/03_modules/模块任务开发说明书.md": (
                    "# 模块任务开发说明书\n\n## 批准状态\n\nAPPROVED\n"
                ),
                "project/04_tests/测试说明书.md": (
                    "# 测试说明书\n\n## 批准状态\n\nAPPROVED\n"
                ),
            },
        )

    def test_053_1_a_conforming_set_of_specs_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._spec_project(
                root,
                "# 产品需求说明书\n\n## 产品目标\n\nx\n\n"
                "## 变更响应 · CR-2099-demo\n\n### 验收澄清\n\ny\n\n"
                "## 批准状态\n\nAPPROVED\n",
            )
            code, output = governance.run(["check-specs", "--root", directory])

        self.assertEqual(code, 0, output)
        self.assertIn("SPECS_PASS", output)

    def test_053_2_an_unknown_section_name_is_named_in_the_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._spec_project(
                root,
                "# 产品需求说明书\n\n## 产品目标\n\nx\n\n"
                "## 我随手起的节名\n\ny\n\n## 批准状态\n\nAPPROVED\n",
            )
            code, output = governance.run(["check-specs", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("SPECS_UNKNOWN_SECTION", output)
        self.assertIn("我随手起的节名", output)

    def test_053_3_a_duplicated_change_response_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._spec_project(
                root,
                "# 产品需求说明书\n\n## 产品目标\n\nx\n\n"
                "## 变更响应 · CR-2099-demo\n\na\n\n"
                "## 变更响应 · CR-2099-demo\n\nb\n\n"
                "## 批准状态\n\nAPPROVED\n",
            )
            code, output = governance.run(["check-specs", "--root", directory])

        self.assertEqual(code, 1)
        self.assertIn("SPECS_DUPLICATE_RESPONSE", output)
        self.assertIn("CR-2099-demo", output)

    def test_053_4_every_historical_review_heading_shape_is_rejected(self) -> None:
        # The five shapes the specs actually grew over five CRs (CP-2).
        headings = [
            "## 多角色评审",
            "## 复盘迭代",
            "## 评审（R2）",
            "## R2 四角色审查",
            "## CR-2099-demo 评审",
        ]
        for heading in headings:
            with self.subTest(heading=heading), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self._spec_project(
                    root,
                    "# 产品需求说明书\n\n## 产品目标\n\nx\n\n"
                    + heading
                    + "\n\n评审意见。\n\n## 批准状态\n\nAPPROVED\n",
                )
                code, output = governance.run(["check-specs", "--root", directory])

                self.assertEqual(code, 1, output)
                self.assertIn("SPECS_REVIEW_IN_SPEC", output)

    def test_053_5_the_migration_is_idempotent_on_the_real_specs(self) -> None:
        # The specs are already migrated, so a real run must be a no-op - asserted
        # against the working tree because that is where a re-run would do damage.
        # The child writes spec paths, which are Chinese, and a piped Python
        # process encodes stdout with the machine locale (GBK here), not UTF-8.
        # Reading that as strict UTF-8 kills the reader thread in the background:
        # run() still returns 0 and stdout comes back as None, so a real "the
        # specs drifted" failure surfaces as an unrelated TypeError. Pin the
        # child's encoding so both ends agree; errors="replace" and the None
        # check keep any future mismatch a legible failure rather than a crash
        # in the assertion (CR-20260910-test-subprocess-encoding).
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        result = subprocess.run(
            [sys.executable, "tools/migrate_specs.py", "--dry-run"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNotNone(result.stdout, result.stderr)
        self.assertIn("already migrated", result.stdout)


class MigrationCompatibilityTests(unittest.TestCase):
    """TEST-054 (hard gate) - the migration did not break any in-flight change record."""

    def test_054_1_every_cp_model_cr_still_passes_r1_to_r4(self) -> None:
        for cr in CP_MODEL_CRS:
            for level in ("r1", "r2", "r3", "r4"):
                with self.subTest(cr=cr, level=level):
                    code, output = governance.run(
                        ["review", level, "--root", str(REPO_ROOT), "--cr", cr]
                    )
                    self.assertEqual(code, 0, output)
                    self.assertIn("REVIEW_" + level.upper() + "_PASS", output)

    def test_054_2_the_real_specs_satisfy_the_structure_contract(self) -> None:
        code, output = governance.run(["check-specs", "--root", str(REPO_ROOT)])
        self.assertEqual(code, 0, output)

    def test_054_3_moved_reviews_are_findable_in_their_change_record(self) -> None:
        # Every review the migration moved carries a provenance marker naming the
        # spec it came from, under an `## R{n} 评审意见` heading in that CR.
        changes = sorted((REPO_ROOT / "project/06_changes").glob("CR-*.md"))
        moved = [path for path in changes if "（迁移自 `" in path.read_text(encoding="utf-8")]
        self.assertGreaterEqual(len(moved), 8, "the migration moved reviews into too few CRs")

        for path in moved:
            text = path.read_text(encoding="utf-8")
            self.assertRegex(text, r"(?m)^## R[1-4] 评审意见$", str(path))

    def test_054_4_no_spec_still_carries_a_review_section(self) -> None:
        for rel_path in governance.SPEC_BASELINE_SECTIONS:
            text = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
            for line in text.splitlines():
                if not line.startswith("#"):
                    continue
                title = line.lstrip("#").strip()
                for pattern in governance.REVIEW_HEADING_PATTERNS:
                    self.assertIsNone(pattern.search(title), rel_path + ": " + line)

def _cr(name: str, *, level: str = "L3", rows: str, rollback: str = "文档回滚 + 运行回滚，重跑 verify 与 review 后重新 snapshot", reserve: str | None = None) -> str:
    """A change record carrying a CP registry, for the door/id checks."""
    head = [
        f"# {name}",
        "",
        f"- 级别: {level}",
        "- 提出人: user",
        "- 状态: APPROVED",
    ]
    if reserve is not None:
        head.append(f"- 占用 ID: {reserve}")
    head += [
        "- 影响需求: 无",
        "- 影响模块: 无",
        "- 影响任务: 无",
        "- 影响测试: 无",
        "- 当前证据: `project/05_evidence/EV.md`",
        "- 方案选项:",
        "  - A. 否决项",
        "  - B. **选中项**",
        "- 选择理由: 证据",
        f"- 回滚方式: {rollback}",
        "- 验收条件:",
        "  - R1: 有 CP 表与人工终裁痕迹。",
        "- 评审记录: R1 四角色。**R1 终裁**：用户已拍板。",
        "",
        "## 变化点登记",
        "",
    ]
    return "\n".join(head) + rows + "\n"


DOOR_HEADER = (
    "| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |\n"
    "|---|---|---|---|---|---|---|\n"
)


class DoorClassificationTests(unittest.TestCase):
    """TEST-055 - every change point declares a door and a detection route."""

    def test_055_1_the_real_repository_passes(self) -> None:
        code, output = governance.run(["check-doors", "--root", str(REPO_ROOT)])
        self.assertEqual(code, 0, output)
        self.assertIn("CHECK_DOORS_PASS", output)

    def _run(self, rows: str, **kwargs) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            (root / "project/06_changes/CR-2099-demo.md").write_text(
                _cr("CR-2099-demo", rows=rows, **kwargs), encoding="utf-8"
            )
            return governance.run(["check-doors", "--root", str(root)])

    def test_055_2_undetectable_may_not_be_called_a_two_way_door(self) -> None:
        # The whole point of the column: if nobody would notice the mistake, the
        # change cannot be reversed, whatever `git revert` can do.
        code, output = self._run(
            DOOR_HEADER + "| CP-1 | 产品 | 改动 | REQ-F-001 | 新增 | 双向 | 发现不了 |\n"
        )
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_DOORS_UNDETECTABLE_TWO_WAY", output)
        self.assertIn("CP-1", output)

    def test_055_3_a_one_way_door_needs_a_substantive_rollback(self) -> None:
        code, output = self._run(
            DOOR_HEADER + "| CP-1 | 架构 | 引入外部依赖 | DEC-001 | 新增 | 单向 | 机器：check-ids |\n",
            rollback="<待填>",
        )
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_DOORS_MISSING_ROLLBACK", output)

    def test_055_4_the_door_value_is_constrained(self) -> None:
        code, output = self._run(
            DOOR_HEADER + "| CP-1 | 产品 | 改动 | REQ-F-001 | 新增 | 也许 | 机器：check-doors |\n"
        )
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_DOORS_BAD_VALUE", output)

    def test_055_5_a_missing_detection_column_blocks(self) -> None:
        code, output = self._run(
            DOOR_HEADER + "| CP-1 | 产品 | 改动 | REQ-F-001 | 新增 | 双向 |  |\n"
        )
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_DOORS_MISSING_COLUMN", output)

    def test_055_6_an_escaped_pipe_does_not_shift_the_columns(self) -> None:
        # Regression: `check p1\|p2` inside a cell used to split into extra cells,
        # so the 门 column read whatever happened to land at index 5.
        code, output = self._run(
            DOOR_HEADER
            + "| CP-1 | 产品 | 一条命令跑完 `check p1\\|p2\\|p3\\|release` | REQ-F-001 | 新增 | 双向 | 机器：check-doors |\n"
        )
        self.assertEqual(code, 0, output)


class IdReservationTests(unittest.TestCase):
    """TEST-056 - ids are reserved at draft time and cannot collide."""

    def test_056_1_the_real_repository_passes(self) -> None:
        code, output = governance.run(["check-ids", "--root", str(REPO_ROOT)])
        self.assertEqual(code, 0, output)
        self.assertIn("CHECK_IDS_PASS", output)

    def test_056_2_two_records_claiming_the_same_range_is_blocked(self) -> None:
        # The 2026-09-10 accident, reproduced: CR-20260910-ui-foundation and
        # CR-20260910-process-hardening both claimed TASK-044..047 while drafted
        # in parallel, and every gate passed.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            tasks = "\n".join(
                f"| TASK-{n:03d} | MOD-001 | 任务 | DONE | 无 | REQ-F-001 | TEST-001 |"
                for n in range(44, 48)
            )
            (root / "project/03_modules/模块任务开发说明书.md").write_text(
                "# 模块任务开发说明书\n\n## 模块任务总览\n\n"
                "| 任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试 |\n"
                "|---|---|---|---|---|---|---|\n" + tasks + "\n",
                encoding="utf-8",
            )
            for name in ("CR-2099-alpha", "CR-2099-beta"):
                (root / f"project/06_changes/{name}.md").write_text(
                    _cr(name, rows=DOOR_HEADER, reserve="TASK-044..047"), encoding="utf-8"
                )
            code, output = governance.run(["check-ids", "--root", str(root)])

        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_IDS_OVERLAP", output)
        self.assertIn("TASK-044", output)

    def test_056_3_claiming_an_id_nothing_defines_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            (root / "project/06_changes/CR-2099-demo.md").write_text(
                _cr("CR-2099-demo", rows=DOOR_HEADER, reserve="TASK-999"), encoding="utf-8"
            )
            code, output = governance.run(["check-ids", "--root", str(root)])

        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_IDS_DANGLING", output)
        self.assertIn("TASK-999", output)

    def test_056_4_two_definition_rows_for_one_id_are_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            row = "| TASK-001 | MOD-001 | 任务 | DONE | 无 | REQ-F-001 | TEST-001 |"
            (root / "project/03_modules/模块任务开发说明书.md").write_text(
                "# 模块任务开发说明书\n\n## 模块任务总览\n\n"
                "| 任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试 |\n"
                "|---|---|---|---|---|---|---|\n" + row + "\n" + row + "\n",
                encoding="utf-8",
            )
            code, output = governance.run(["check-ids", "--root", str(root)])

        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_IDS_DUPLICATE", output)

    def test_056_5_a_design_table_repeating_an_id_is_not_a_duplicate(self) -> None:
        # TASK-044 legitimately appears twice in the real spec: once in the task
        # register, once in a change-response 技术设计 table. Only the register defines.
        counts = governance._definition_rows(REPO_ROOT, "TASK")
        self.assertEqual(counts.get("TASK-044"), 1, counts.get("TASK-044"))

    def test_056_6_the_backfill_left_every_review_gate_untouched(self) -> None:
        # Invariant the module role attached in R1: reserving ids across the existing
        # records must not move any R1..R4 verdict.
        #
        # Originally asserted as the literal "8 change record(s)". That froze a count
        # every later CR legitimately changes (CR-20260910-agent-tooling made it 9), so
        # the literal was failing for a reason the invariant does not care about. What
        # the invariant actually claims is that all four gates pass and agree on the
        # same set — which is what is asserted now.
        counts = set()
        for level in ("r1", "r2", "r3", "r4"):
            code, output = governance.run(["review", level, "--root", str(REPO_ROOT)])
            self.assertEqual(code, 0, output)
            match = re.search(r"(\d+) change record\(s\) satisfy", output)
            self.assertIsNotNone(match, output)
            counts.add(int(match.group(1)))
        self.assertEqual(len(counts), 1, f"R1..R4 disagree on how many records they judged: {counts}")
        self.assertGreaterEqual(counts.pop(), 8)


class KnownWarningTests(unittest.TestCase):
    """TEST-057 - a warning may not assert something the tools contradict."""

    def test_057_1_the_real_repository_passes(self) -> None:
        code, output = governance.run(["check-warnings", "--root", str(REPO_ROOT)])
        self.assertEqual(code, 0, output)
        self.assertIn("CHECK_WARNINGS_PASS", output)

    def _with_warnings(self, warnings: list) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            (root / "package.json").write_text(
                json.dumps({"name": "fixture", "devDependencies": {"axe-core": "4.11.0"}}),
                encoding="utf-8",
            )
            (root / "project/05_evidence/test-results.json").write_text(
                json.dumps({"tests": [], "known_warnings": warnings}, ensure_ascii=False),
                encoding="utf-8",
            )
            return governance.run(["check-warnings", "--root", str(root)])

    def test_057_2_claiming_a_gate_is_red_while_it_passes_is_blocked(self) -> None:
        # The 2026-09-10 accident: "gate g3 is intentionally red until TEST-022"
        # stayed in the file long after g3 went green, and nothing re-checked it.
        code, output = self._with_warnings(
            [{"text": "gate g1 is intentionally red", "check": "gate_red:g1"}]
        )
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_WARNINGS_STALE", output)

    def test_057_3_claiming_a_present_dependency_is_absent_is_blocked(self) -> None:
        # The other half of the same accident: LV-AXE "skipped, axe-core is not a
        # dependency" while axe-core sat in devDependencies.
        code, output = self._with_warnings(
            [{"text": "axe-core is not a dependency", "check": "dep_absent:axe-core"}]
        )
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_WARNINGS_STALE", output)
        self.assertIn("axe-core", output)

    def test_057_4_a_manual_warning_expires(self) -> None:
        stale = (dt.date.today() - dt.timedelta(days=governance.WARNING_MAX_AGE_DAYS + 1)).isoformat()
        code, output = self._with_warnings(
            [{"text": "standing caveat", "check": "manual", "reviewed_at": stale}]
        )
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_WARNINGS_STALE", output)

        code, output = self._with_warnings(
            [{"text": "standing caveat", "check": "manual", "reviewed_at": dt.date.today().isoformat()}]
        )
        self.assertEqual(code, 0, output)

    def test_057_5_free_text_is_reported_unverifiable_but_does_not_block(self) -> None:
        code, output = self._with_warnings(["a legacy free-text caveat"])
        self.assertEqual(code, 0, output)
        self.assertIn("UNVERIFIABLE", output)

    def test_057_6_an_unknown_predicate_is_blocked(self) -> None:
        code, output = self._with_warnings([{"text": "x", "check": "vibes:good"}])
        self.assertEqual(code, 1, output)
        self.assertIn("CHECK_WARNINGS_BAD_CHECK", output)


class CanonicalSpecTests(unittest.TestCase):
    """TEST-059 - one implementation of the structure contract, not two."""

    def test_059_1_the_real_specs_are_canonical(self) -> None:
        code, output = governance.run(["check-specs", "--root", str(REPO_ROOT)])
        self.assertEqual(code, 0, output)

    def test_059_2_a_misplaced_change_response_section_is_blocked(self) -> None:
        # Reproduces 2026-09-10: a 变更响应 section written just above 批准状态
        # passed check-specs while migrate_specs.py judged the file needed a rewrite.
        import shutil

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for rel in ("docs", "project", "tools", "tests"):
                shutil.copytree(REPO_ROOT / rel, root / rel, dirs_exist_ok=True)
            for name in ("AGENTS.md", "package.json"):
                shutil.copy2(REPO_ROOT / name, root / name)

            path = root / "project/04_tests/测试说明书.md"
            text = path.read_text(encoding="utf-8")
            section = "\n## 变更响应 · CR-20260910-record-accuracy\n"
            start = text.index(section)
            end = text.index("\n## ", start + len(section))
            block, text = text[start:end], text[:start] + text[end:]
            text = text.replace("\n## 批准状态", block + "\n## 批准状态", 1)
            path.write_text(text, encoding="utf-8")

            code, output = governance.run(["check-specs", "--root", str(root)])

        self.assertEqual(code, 1, output)
        self.assertIn("SPECS_NOT_CANONICAL", output)


class ReviewReportingTests(unittest.TestCase):
    """TEST-060 - a skipped record is named, never silent."""

    def test_060_1_records_without_a_cp_chain_are_named(self) -> None:
        code, output = governance.run(["review", "r1", "--root", str(REPO_ROOT)])
        self.assertEqual(code, 0, output)
        self.assertIn("SKIPPED_BY_LEVEL", output)
        self.assertIn("CR-20260909-corner-menu", output)

    def test_060_2_skipping_is_only_legitimate_for_an_l1_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            (root / "project/06_changes/CR-2099-sneaky.md").write_text(
                _cr("CR-2099-sneaky", level="L3", rows="").replace("## 变化点登记\n", ""),
                encoding="utf-8",
            )
            code, output = governance.run(["review", "r1", "--root", str(root)])

        self.assertEqual(code, 1, output)
        self.assertIn("REVIEW_R1_BLOCKED", output)
        self.assertIn("CR-2099-sneaky", output)

    def test_060_3_an_l1_record_may_legitimately_carry_no_cp_chain(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_project(root)
            (root / "project/06_changes/CR-2099-small.md").write_text(
                _cr("CR-2099-small", level="L1", rows="").replace("## 变化点登记\n", ""),
                encoding="utf-8",
            )
            code, output = governance.run(["review", "r1", "--root", str(root)])

        self.assertEqual(code, 0, output)
        self.assertIn("SKIPPED_BY_LEVEL", output)

if __name__ == "__main__":
    unittest.main()
