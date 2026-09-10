# CR-20260910-process-hardening

- 级别: L3（改治理模型本身：门禁作用域、说明书结构契约、新增可执行流程命令；触及 `tools/governance.py`、`docs/`、全部四本说明书）
- 提出人: user（「1. 理解流程。进一步优化流程，并把流程固化为可执行脚本，并提高效率。2. 理解项目，重新梳理各个环节的说明书，保持一致与每个环节的说明书格式。评审放在 CR 变更里。」）
- 状态: R1 待人工终裁（四角色评审已闭环至全 APPROVED）
- 评审模型: R1–R4 + G3/G3.5/G4
- 影响需求: 无（不动任何产品需求；改的是流程控制层与文档结构契约）
- 影响模块: 无 `src/` 变更。治理工具 `tools/governance.py`；文档 `docs/WORKFLOW.md`、`docs/CONTROLS.md`、`docs/AI_STANDARD.md`；四本说明书的**结构**（内容不减）
- 影响任务: 新增 TASK-044（门禁按 CR 切分 + 阶段聚合命令）、TASK-045（`new-cr` / `matrix` 脚手架）、TASK-046（说明书结构迁移脚本 + 结构检查 `check-specs`）、TASK-047（基线忽略 `tsconfig.json` include 抖动 + `verify:all` 聚合脚本）
- 影响测试: 新增 TEST-051（`--cr` 作用域与 `check <stage>`）、TEST-052（`new-cr` / `matrix` 脚手架产物合规）、TEST-053（`check-specs` 结构契约）、TEST-054（迁移向后兼容：四个 CP-model CR 的 `review r1..r4` 迁移后仍全 PASS）
- 当前证据: `project/05_evidence/EV-2026-09-10-process-hardening.md`（本会话实测到的 7 个摩擦点 + R1 四角色评审）
- 方案选项:
  - A. 只写文档规范、不写检查：过去两周已证明无效——`<input webkitdirectory>` 写进 TASK-033 Ⅰ 却没实现，无人发现
  - B. **把已被实测证伪的摩擦点逐条固化为命令与机器检查；说明书统一为「当前基线 + 变更响应」两段式，评审去重归位到 CR**
  - C. 换一套外部流程工具（如 Jira/ADR 工具链）：新增外部依赖与二套事实源，与本项目零依赖取向相悖
- 选择理由: 选 B。七个摩擦点全部是**本会话实际踩到**的，不是想象出来的：g3 被别的在途 CR 卡死、`tsconfig.json` 被 Next 改写造成假基线告警、13 个标签手写出过冒号错误、180 格矩阵手敲、8 个子命令逐个跑、说明书按 CR 无限追加且评审两处各存一份、测试说明书 CR 小节顺序交错。每条都能落成一个命令或一条机器检查。
- 回滚方式:
  - 工具回滚：还原 `tools/governance.py`（删 `new-cr`/`matrix`/`check`/`check-specs` 与 `--cr` 作用域参数）、`tests/test_governance.py`（删新增用例）、`package.json` 删 `verify:all`。
  - 文档回滚：`git revert` 迁移提交即可还原四本说明书旧结构——迁移由**幂等脚本**完成，`tools/migrate_specs.py` 保留在仓库内可复核。
  - 还原 `docs/WORKFLOW.md`、`docs/CONTROLS.md`、`docs/AI_STANDARD.md` 相应条款。无 `src/`、无 schema、无依赖变更。
  - 回滚后重跑 `verify | check-changes | ui | review r1..r4` 并重新 `snapshot`。
- 验收条件:
  - R1：本文件有 `## 变化点登记` 表（CP-1..CP-12，每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4（P2 产出）：三层说明书各含 `CR-20260910-process-hardening` 变更响应节逐一响应 CP-1..CP-12；本文件补三张评审矩阵；`review r2|r3|r4` PASS。
  - P3/P4：TASK-044..047 DONE；TEST-051..054 PASS；`check-specs` 对四本说明书 0 FAIL。
  - **向后兼容硬门**：迁移后 `review r1|r2|r3|r4` 对**全部 4 个 CP-model CR**（skills / display-screen / skill-intake / ui-foundation）仍全 PASS —— 迁移不得破坏任何在途 CR。
  - **信息不丢**：迁移是**移动与去重**，不是删除；每份被移走的评审文字必须能在对应 CR 内找到。
- 评审记录: R1 四角色独立 ReAct 评审，架构与模块的 CONDITIONAL 经 1 轮反馈闭环转 APPROVED。**R1 人工终裁**：待用户拍板。
  - **产品 owner**：①这是流程 CR，不动任何产品需求——必须显式声明，避免读者以为功能有变。②「评审归位到 CR」的前提是不丢信息：已核实**每个 CP-model CR 本就自带 R2/R3/R4 矩阵**，说明书里的评审表是纯重复；但表里的**文字意见**比矩阵格更详细，必须迁入 CR 而非删除。③统一格式的收益是可读性——说明书应回答「系统现在是什么样」，变更史归 CR。结论：**APPROVED**。
  - **架构角色（R1 → 闭环后 APPROVED）**：
    - R1 CONDITIONAL：①迁移会改动 `review r2/r3/r4` 赖以判定覆盖的节标题，**必须先证明向后兼容**再动手；②`--cr` 作用域不能削弱现有全量门禁——默认行为必须仍是全量，`--cr` 只是附加的收窄视图。
    - 处理：① `_cr_scoped_text` 按「标题含 CR 名」取节，新节名 `## 变更响应 · CR-<name>` 仍含 CR 名 → **覆盖检查零改动**；验收条件加「向后兼容硬门」，四个在途 CR 迁移后必须仍全 PASS。② `--cr` 定为可选参数，缺省即现行全量语义，写入 CP-5。
    - 结论：**APPROVED**。
  - **模块开发角色（R1 → 闭环后 APPROVED）**：
    - R1 CONDITIONAL：①四本说明书共 1663 行、约 40 个 CR 小节，**手改必错**，必须脚本迁移且脚本留档；②新命令不得开第二个 CLI 入口，否则又多一套要记的东西。
    - 处理：① CP-8 写明 `tools/migrate_specs.py` 幂等脚本 + 留档；② CP-9 写明全部新命令挂在既有 `tools/governance.py`，`package.json` 只加一条聚合脚本。
    - 结论：**APPROVED**。
  - **测试角色**：①每个新子命令要有治理单测，否则又是「写了没实现」的老问题（TASK-033 Ⅰ 前车之鉴）。②迁移的向后兼容必须是**硬断言**而非人工目测。③说明书结构契约本身要机器可查（`check-specs`），否则下个 CR 又会长出第 6 种节名约定。结论：**APPROVED**（条件即 TEST-051..054）。
- 评审结论汇总: **R1 四角色全部 APPROVED**（产品 / 测试 R1 即 APPROVED；架构 / 模块 R1 CONDITIONAL → 1 轮闭环 → APPROVED）。无 REJECTED，无遗留 CONDITIONAL。

## 背景：本会话实测到的 7 个摩擦点

| # | 摩擦点 | 实测证据 |
|---|---|---|
| 1 | **g3 跨 CR 阻塞** | 收口 skill-intake 时 `gate g3` 报 `missing PASS evidence for: TEST-047..050` —— 那是并行 CR ui-foundation 的测试（R4 已过、未实施）。g3 无 CR 粒度，别人的在途 CR 阻塞我的收口 |
| 2 | **`tsconfig.json` 假基线告警** | Next 每次 build 把当前 `NEXT_DIST_DIR` 写进 `include`，跑完 `--live` 检查后 `verify` 必报 `BASELINE_CHANGED`，需手动 `git checkout` 再 snapshot（本会话踩两次）|
| 3 | **CR 13 标签手写易错** | 早前出现 `- 评审记录（…）:` 用了全角括号导致 `check-changes` 报 `CHANGE_RECORD_INCOMPLETE`（两次）|
| 4 | **矩阵手敲** | skill-intake 的 R2/R3/R4 = 15 CP × 4 角色 × 3 门 = **180 格**全手写 |
| 5 | **8 个子命令逐个跑** | 每次收口要跑 `verify`/`g1`/`g2`/`g3`/`g3.5`/`g4`/`check-changes`/`ui` + `review r1..r4` = 12 条命令 |
| 6 | **说明书按 CR 无限追加，评审两处各存一份** | 四本共 1663 行、约 40 个 CR 小节；评审在说明书与 CR 内重复 |
| 7 | **节名 5 种约定、顺序交错** | `## 多角色评审`+`###`、`## 复盘迭代（X）`、`## X 评审（R3，…）`、`### R2 四角色审查`…；测试说明书里 CR 小节顺序完全交错 |

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 |
|---|---|---|---|---|
| CP-1 | 产品 | 四本说明书统一为「**当前基线** + **变更响应**」两段式；每 CR 在每层**恰好一个** `## 变更响应 · CR-<name>` 节，节内小节名取自固定白名单 | 摩擦 6/7 | 结构变更 |
| CP-2 | 产品 | 评审（逐 CP 矩阵 + 文字意见）**只存在于 CR**；说明书不再有评审/复盘表。文字意见**迁入** CR，不删除 | 摩擦 6 | 去重 |
| CP-3 | 产品 | 一条命令跑完一个阶段的全部门禁：`governance.py check p1\|p2\|p3\|release` | 摩擦 5 | 新增 |
| CP-4 | 产品 | `governance.py new-cr <name>` 生成合规骨架（13 标签 + CP 表 + 三张矩阵），消除手写格式错误 | 摩擦 3 | 新增 |
| CP-5 | 架构 | 门禁按 CR 切分：`gate g3 --cr <name>` / `review rN --cr <name>`。**缺省仍是全量语义**，`--cr` 只是附加的收窄视图，不削弱现有门禁 | 摩擦 1 | 新增 |
| CP-6 | 架构 | 迁移对机器门**向后兼容**：新节名仍含 CR 名，`_cr_scoped_text` 零改动；四个在途 CR 迁移后 `review r1..r4` 必须仍全 PASS（硬门） | 摩擦 6 | 约束 |
| CP-7 | 架构 | `tsconfig.json` 的 `include` 抖动纳入基线忽略（同 `next-env.d.ts` 既有先例），消除假 `BASELINE_CHANGED` | 摩擦 2 | 小改 |
| CP-8 | 模块 | 迁移由**幂等脚本** `tools/migrate_specs.py` 完成并留档，不手改 1663 行；可复核、可重跑 | 摩擦 6/7 | 新增 |
| CP-9 | 模块 | 新命令全部挂在既有 `tools/governance.py`，**不新增第二个 CLI 入口**；`package.json` 只加一条 `verify:all` 聚合脚本 | 摩擦 5 | 约束 |
| CP-10 | 模块 | `governance.py matrix <cr>` 从 CP 登记表生成三张矩阵骨架（行 = CP，列 = 4 角色，格预填 `TODO`），人只填裁决不搭结构 | 摩擦 4 | 新增 |
| CP-11 | 测试 | 每个新子命令有治理单测（`new-cr` / `matrix` / `--cr` 作用域 / `check <stage>` / `check-specs`） | — | 新增 |
| CP-12 | 测试 | 说明书结构契约本身机器可查：`governance.py check-specs` 断言每层每 CR 恰好一个变更响应节、节名在白名单内、说明书内无评审节 | 摩擦 7 | 新增 |

（产品 CP-1..CP-4 + 架构派生 CP-5..CP-7 + 模块派生 CP-8..CP-10 + 测试派生 CP-11/CP-12。R2/R3/R4 各层须逐一响应 CP-1..CP-12。）

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `CR-20260910-process-hardening` 变更响应节逐一响应 CP-1..CP-12 后，在此补三张矩阵，再跑 `review r2|r3|r4`。
