# EV-2026-09-09-consensus-review-gates

- 证据 ID: EV-2026-09-09-consensus-review-gates
- 来源类型: 用户治理模型讨论 + 实现验证
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`；`docs/WORKFLOW.md`、`docs/CONTROLS.md`、`docs/AI_STANDARD.md`、`tools/governance.py`（`check_review` 等）
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-consensus-review-gates；TASK-032、TEST-033；`AI_STANDARD` §8 + 原则 17

## 1. 触发

用户："门控制改为：需求&产品说明书评审，模块开发说明书评审，测试评审…每个环节评审都需要角色参与，并达成一致方可通过？否则将意见反馈到该环节的负责人，继续修改。"

诊断出的真实缺口：`governance.py` 的 g1/g2 是**机器结构检查**，从不强制"四角色评审过并一致""每个变化点在每层都有响应"。本会话连起 5 个 CR 都手搓这套，但无门禁强制。

## 2. 决策链（用户逐轮精化，A–I）

| 项 | 决定 |
|---|---|
| 架构层 | **单列一门**（4 设计门 R1/R2/R3/R4，不与模块合并）—— 选项 b |
| R1 | 角色 Agent 出意见 → **人拍板**（唯一人工门） |
| R2/R3/R4 | **机器终止**：CP 全覆盖 + 评审矩阵结构合规 |
| G3/G3.5/G4 | 保留为机器证据门 |
| 每层逐一响应上层每个变化点 | 是 —— `{全部 CP} ⊆ {该层响应}`，机器查 `COVERAGE_GAP` |
| 角色 CP | 任何角色任何门可派生，追加进**同一张** `变化点登记` 表（加"来源角色"列）—— 决策 8 |
| 角色常驻关切清单 | 进 **`docs/AI_STANDARD.md §8`** —— 决策 7 |
| 评审矩阵参与角色 | **全部 4 角色** —— 决策 9 |
| 各角色也判断别层方案是否满足自己的关切 | 是 —— 常驻清单 + 该 CR 角色 CP 逐条核 |
| 角色 Agent 结构 | **ReAct + 4 护栏**（客观终止 / 有界工具 / CP 检查前置 / 结构化裁决） |
| Agent 形态 | 默认一个 Agent 顺序换视角；L3 变更 spawn 独立子 Agent |
| ReAct 轮次上限 | 3 轮不收敛 → 升级给人 |
| CP 声明格式 | CR 内 `## 变化点登记` markdown 表 —— 默认① |
| 反馈日志 | `project/06_changes/CR-<name>.feedback.jsonl` —— 默认② |
| 门通过语义 | 无 REJECTED + 无空 + CONDITIONAL 带条件即过；不搞"对 CONDITIONAL 再全体同意" —— 默认④ |
| 机器检查（verify/check-changes/g1 结构项） | 保留为评审前置 —— 默认④ |
| 存量 9 CR | 各加一行「pre-R1234 model」，不追溯 —— 默认⑤ |
| 本 CR 自身 | 走**旧模型**（g1-g4），安装新模型 |

## 3. 实现（TASK-032）

`tools/governance.py`：
- `parse_cp_registry(cr_text)` —— 解析 CR 的 `## 变化点登记` 表 → `[{cp, role}]`（无表 = pre-model，返回空）。
- `_section` / `_table_rows` 通用 markdown 小工具。
- `check_review(root, level)`：
  - 收集所有含 CP 表的 CR。**一个都没有 → 空过**（`REVIEW_R{n}_PASS no change record uses the CP-registry model yet`）。
  - `r1`：每个 CP 有 `来源角色`；CR 含 R1 拍板痕迹（`R1[^\n]*(拍板|终裁|人工确认)`）。
  - `r2/r3/r4`：① 对应层说明书含 `CR-<name>` 节 + 每个 CP id 在该说明书出现（否则 `COVERAGE_GAP`）；② CR 含 `## R{n} 评审矩阵`，表头有全部 4 角色列，每个 CP 有行，每格非空、含 APPROVED/CONDITIONAL/REJECTED、无 REJECTED、CONDITIONAL 带条件文本（否则 `MATRIX_INVALID` / `BLOCKED`）。
- `build_parser` / `run` 加 `review` 子命令派发。

`docs/AI_STANDARD.md`：新增 **§8 角色常驻关切清单**（产品/架构/模块/测试 4 张）+ **原则 17 共识门禁原则**。
`docs/WORKFLOW.md` / `docs/CONTROLS.md`：门禁表、标准循环、验证命令更新为 R1–R4 + G3/G3.5/G4；g1/g2 降为结构前置。
9 个既有 CR：各加 `- 评审模型: pre-R1234 …` 行。

## 4. 验证

| 命令 | 结果 | 摘要 |
|---|---|---|
| `python tools/governance.py review r1\|r2\|r3\|r4` | 全 OK | 空过（尚无 CR 用 CP 格式；本 CR 走旧模型） |
| `python -m unittest tests.test_governance` | PASS | **22** 用例（新增 5 个 review 用例：覆盖过 / `COVERAGE_GAP` / `REJECTED` 阻断 / r1 无拍板 / 空过） |
| `python tools/governance.py verify \| gate g1 \| gate g2 \| gate g3 \| gate g3.5 \| gate g4 \| check-changes \| ui` | 全 PASS | 本 CR 走旧模型，全绿 |
| `npx tsc --noEmit` / `npm test` | PASS | `src/` 未改动，124 测试不回归 |

## 5. 本证据边界

新模型**从下一个 CR 起生效**。本 CR 只安装机制 + 空过验证；机制在真实 CR 上的行为待下一个 CR 产生首个 `## 变化点登记` 表时验证，届时补 EV。
