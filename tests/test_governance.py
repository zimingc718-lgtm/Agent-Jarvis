import json
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


if __name__ == "__main__":
    unittest.main()
