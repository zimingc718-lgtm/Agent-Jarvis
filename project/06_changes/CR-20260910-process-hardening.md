# CR-20260910-process-hardening

- 级别: L3（改治理模型本身：门禁作用域、说明书结构契约、新增可执行流程命令；触及 `tools/governance.py`、`docs/`、全部四本说明书）
- 提出人: user（「1. 理解流程。进一步优化流程，并把流程固化为可执行脚本，并提高效率。2. 理解项目，重新梳理各个环节的说明书，保持一致与每个环节的说明书格式。评审放在 CR 变更里。」）
- 状态: R1 人工终裁完成（用户 2026-09-10「好的。按你的建议来。」）；P2 完成、R2/R3/R4 四角色全 APPROVED；**P3/P4 完成**（TASK-049..052 DONE、TEST-051..054 PASS、出口义务 ①..⑥ 清零）
- 评审模型: R1–R4 + G3/G3.5/G4
- 影响需求: 无（不动任何产品需求；改的是流程控制层与文档结构契约）
- 影响模块: MOD-GOVERNANCE（本 CR 登记，零 `src/` 变更）。治理工具 `tools/governance.py`；文档 `docs/WORKFLOW.md`、`docs/CONTROLS.md`、`docs/AI_STANDARD.md`；四本说明书的**结构**（内容不减）
- 影响任务: 新增 TASK-049（门禁按 CR 切分 + 阶段聚合命令）、TASK-050（`new-cr` / `matrix` 脚手架）、TASK-051（说明书结构迁移脚本 + 结构检查 `check-specs`）、TASK-052（基线忽略 `tsconfig.json` include 抖动 + `verify:all` 聚合脚本）
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
  - R2/R3/R4（P2 产出，**已完成**）：三层说明书各含 `变更响应 · CR-20260910-process-hardening` 节逐一响应 CP-1..CP-12；本文件三张矩阵全 APPROVED；`review r1|r2|r3|r4` PASS。
  - P3/P4：TASK-049..047 DONE；TEST-051..054 PASS；`check-specs` 对四本说明书 0 FAIL。
  - **向后兼容硬门**：迁移后 `review r1|r2|r3|r4` 对**全部 4 个 CP-model CR**（skills / display-screen / skill-intake / ui-foundation）仍全 PASS —— 迁移不得破坏任何在途 CR。
  - **信息不丢**：迁移是**移动与去重**，不是删除；每份被移走的评审文字必须能在对应 CR 内找到。
- 评审记录: R1 四角色独立 ReAct 评审，架构与模块的 CONDITIONAL 经 1 轮反馈闭环转 APPROVED。**R1 人工终裁**：用户 2026-09-10「好的。按你的建议来。」—— 确认 CP-1..CP-12、两段式目标结构与小节白名单、评审归位 CR、`--cr` 缺省全量语义、四条新命令，并确认**迁移排在 CR-20260910-ui-foundation 实施之前**。
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

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260910-process-hardening` 节 + DEC-020。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 结构服务可读性 | APPROVED 白名单入 DEC-020 ①（自审） | APPROVED 脚本执行不手改 | APPROVED check-specs 可验 |
| CP-2 | APPROVED 迁入不删除，信息不丢 | APPROVED 评审矩阵本就在 CR 内被读取 | APPROVED 剪切+路由到对应 CR | APPROVED TEST-054 检索断言 |
| CP-3 | APPROVED 12 条命令降为 1 条 | APPROVED 纯编排，不新增判定 | APPROVED STAGE_GATES 表驱动 | APPROVED 任一子门 FAIL 即整体 FAIL 可断言 |
| CP-4 | APPROVED 消除格式事故 | APPROVED 产物须过 check-changes | APPROVED 模板字符串 + 拒绝覆盖 | APPROVED TEST-052 ①② |
| CP-5 | APPROVED 不改产品语义 | APPROVED **缺省语义不变**，g4/release 拒绝 --cr（自审） | APPROVED 在既有集合上加筛选层 | APPROVED TEST-051 ① 证明未削弱 |
| CP-6 | APPROVED 在途 CR 不受伤 | APPROVED _cr_scoped_text 天然兼容（自审） | APPROVED 无代码，纯约束 | APPROVED **TEST-054 硬门** |
| CP-7 | APPROVED 消除假告警 | APPROVED 归一化仅限 include 数组，其余仍受控（自审） | APPROVED 一个文件特例，边界清晰 | APPROVED TEST-051 ⑤ 双向断言 |
| CP-8 | APPROVED 1663 行手改必错 | APPROVED 脚本留档可复核可回滚 | APPROVED 幂等要求写进 TASK-051 | APPROVED TEST-053 ⑤ 幂等断言 |
| CP-9 | APPROVED 不增加要记的东西 | APPROVED 单一 CLI 入口 | APPROVED 全挂 governance.py（自审） | APPROVED package.json 只加一条可验 |
| CP-10 | APPROVED 人只填裁决 | APPROVED TODO 非法裁决 → 未填完必阻断 | APPROVED 复用 parse_cp_registry | APPROVED TEST-052 ④ |
| CP-11 | APPROVED 防「写了没实现」 | APPROVED 每子命令有断言 | APPROVED 落 tests/test_governance.py | APPROVED TEST-051..053（自审） |
| CP-12 | APPROVED 防第 6 种节名 | APPROVED 新增一条机器门 | APPROVED check_specs 纯解析 | APPROVED TEST-053 四类违规（自审） |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260910-process-hardening` 节 + TASK-049..047。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 无发散 | APPROVED 结构契约成文 | APPROVED TASK-051 ①（自审） | APPROVED TEST-053 |
| CP-2 | APPROVED 移动非删除 | APPROVED 路由到对应 CR | APPROVED TASK-051 ②（自审） | APPROVED TEST-054 信息不丢 |
| CP-3 | APPROVED | APPROVED 表驱动编排 | APPROVED TASK-049 ②（自审） | APPROVED TEST-051 ④ |
| CP-4 | APPROVED | APPROVED 半角冒号写进模板 | APPROVED TASK-050 ①（自审） | APPROVED TEST-052 ①② |
| CP-5 | APPROVED | APPROVED 缺省分支不变 | APPROVED TASK-049 ① 只加可选参数（自审） | APPROVED TEST-051 ①②③ |
| CP-6 | APPROVED | APPROVED 硬门写进验收 | APPROVED TASK-051 ④（自审） | APPROVED TEST-054 |
| CP-7 | APPROVED | APPROVED normalized_bytes 旁挂 sha256_file | APPROVED TASK-052 ①（自审） | APPROVED TEST-051 ⑤ |
| CP-8 | APPROVED | APPROVED 脚本非 CLI 子命令，边界清楚 | APPROVED TASK-051 ① 幂等（自审） | APPROVED TEST-053 ⑤ |
| CP-9 | APPROVED | APPROVED 无第二入口 | APPROVED TASK-052 ②（自审） | APPROVED package.json 可验 |
| CP-10 | APPROVED | APPROVED 骨架预填 TODO | APPROVED TASK-050 ②（自审） | APPROVED TEST-052 ③④⑤ |
| CP-11 | APPROVED | APPROVED | APPROVED 四子命令各绑断言（自审） | APPROVED TEST-051..053 |
| CP-12 | APPROVED | APPROVED | APPROVED TASK-051 ③（自审） | APPROVED TEST-053 |

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260910-process-hardening` 节 + TEST-051..054。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 结构可断言 | APPROVED check-specs 覆盖 | APPROVED TASK-051 ① 绑 TEST-053 | APPROVED TEST-053 ①②（自审） |
| CP-2 | APPROVED 信息不丢有断言 | APPROVED 文本检索断言 | APPROVED TASK-051 ② 绑 TEST-054 | APPROVED TEST-053 ④ + TEST-054（自审） |
| CP-3 | APPROVED | APPROVED 子门失败传播可断言 | APPROVED TASK-049 ② 绑 TEST-051 ④ | APPROVED TEST-051 ④（自审） |
| CP-4 | APPROVED | APPROVED 产物过 check-changes | APPROVED TASK-050 ① 绑 TEST-052 | APPROVED TEST-052 ①②（自审） |
| CP-5 | APPROVED | APPROVED **必须断言 --cr PASS 时缺省仍 FAIL** | APPROVED TASK-049 ① 绑 TEST-051 | APPROVED TEST-051 ①③ 已含该断言（自审） |
| CP-6 | APPROVED | APPROVED 迁移前后比对而非只跑一遍 | APPROVED TASK-051 ④ 绑 TEST-054 | APPROVED TEST-054 双断言（自审） |
| CP-7 | APPROVED | APPROVED 双向断言（该忽略的忽略、该报的仍报） | APPROVED TASK-052 ① 绑 TEST-051 ⑤ | APPROVED TEST-051 ⑤（自审） |
| CP-8 | APPROVED | APPROVED 幂等是硬要求 | APPROVED TASK-051 ① 绑 TEST-053 ⑤ | APPROVED TEST-053 ⑤（自审） |
| CP-9 | APPROVED | APPROVED | APPROVED 代码审查项 | APPROVED 测试设计 CP-9（自审） |
| CP-10 | APPROVED | APPROVED 未填完必阻断 | APPROVED TASK-050 ② 绑 TEST-052 | APPROVED TEST-052 ④（自审） |
| CP-11 | APPROVED | APPROVED | APPROVED 派生矩阵按子项列行 | APPROVED TEST-051..053（自审） |
| CP-12 | APPROVED | APPROVED | APPROVED TASK-051 ③ 绑 TEST-053 | APPROVED TEST-053 四类（自审） |

**R2/R3/R4 结果**：CP-1..CP-12 × 4 角色 **全 APPROVED，无 REJECTED、无遗留 CONDITIONAL**。R1 阶段架构的两条与模块的两条 CONDITIONAL 已在 P2 全部成文（DEC-020 ①②③、验收「向后兼容硬门」、CP-8 脚本留档、CP-9 单一入口）。

**P3 出口义务清单（实现前逐条清零）**：① `--cr` 缺省语义不得变——TEST-051 ① 必须断言「`--cr` 给 PASS 时缺省仍 FAIL」；② `gate g4` / `check release` 必须拒绝 `--cr`；③ 迁移**前后**跑 `review r1..r4` 结果比对，四个在途 CR 全 PASS（TEST-054 硬门）；④ 被移走的评审文字必须能在对应 CR 内检索到；⑤ `migrate_specs.py` 幂等（二次运行零 diff）；⑥ 迁移后全量回归 TEST-001..050。

## P3/P4 执行记录

**结论**：TASK-049..052 全部 DONE，TEST-051..054 全部 PASS，出口义务 ①..⑥ 逐条清零。

### 出口义务逐条销账

| # | 义务 | 证据 |
|---|---|---|
| ① | `--cr` 缺省语义不得变 | `test_051_1`：同一棵树上 `gate g3 --cr CR-2099-mine` PASS，而**缺省 `gate g3` 仍 FAIL** 并点名别的 CR 的 `TEST-090`。这条断言就是「未削弱」的证明本身 |
| ② | `gate g4` / `check release` 拒绝 `--cr` | `test_051_3`：两条命令都返回 `--cr is not accepted`，退出码 1 |
| ③ | 迁移前后 `review r1..r4` 比对 | 迁移**前**捕获 5 个 CP-model CR × 4 级 = 20 组结果全 PASS；迁移**后**重跑，归一化后 diff **为空**。renumber（见下）之后再跑一次，仍 20/20 一致 |
| ④ | 被移走的评审文字可检索 | 从 git HEAD 的迁移前说明书抽出全部评审正文行（长度 ≥ 12、非标题），逐行在全部变更记录里做忽略空白的检索：**250/250 命中** |
| ⑤ | `migrate_specs.py` 幂等 | 二次运行输出 `already migrated - nothing to do`，零 diff；该断言已固化为 `test_053_5`，对**工作树真实文档**跑 |
| ⑥ | 迁移后全量回归 | `tsc --noEmit` PASS；`vitest` 27 文件 / **194 测试** PASS；`test:visual` 3 PASS；`test:ui-contract` **49 passed · 0 failed**；`test:smoke` PASS；`python -m unittest tests.test_governance` **44 PASS** |

### 实现与设计的偏差（如实记录）

1. **`migrate_specs.py` 的容器节 bug（实现期发现并修）**。产品/架构说明书的 `## 多角色评审` 是**容器**，各 CR 的评审以 `###` 挂在它下面。首版脚本把整块当成一条塞进 fallback CR，等于把 7 个 CR 的评审全堆到 `CR-20260908-floating-llm-chat`。修法是遇到评审容器先按 `###` 拆开、逐条按标题路由到各自的 CR；命中不了 CR 名的子节退回 `<容器> / <子节>` 复合标题。修后 34 个评审块各回各家。

2. **TASK 编号撞车（实现期发现）**。并行会话的 `CR-20260910-ui-foundation`（`6408b56`，已批准未实施）**已经占用 TASK-044..048**，而本 CR 在 P2 同样声明了 TASK-044..047——两组完全不同的工作抢同一批 ID。ui-foundation 先落库且已批准，按先到先得保留其编号；本 CR 的四个任务整体改号为 **TASK-049..052**，改号范围严格限定在本 CR 自己的文件与各说明书里**本 CR 的变更响应节**，其余章节一个字节没动。

3. **本 CR 的任务此前没有总览表行**。P2 只把 TASK-044..047 写进了「变化点影响矩阵」，忘了往「模块任务总览」加行——`review r3` 查的是 CP 覆盖不是任务行，所以没拦住。P3 补齐 TASK-049..052 四行，并为此在架构说明书登记 **MOD-GOVERNANCE** 模块边界（零 `src/` 依赖、不参与产品运行）。覆盖需求列如实写「无（流程控制）」，不硬蹭一个不相干的 REQ。

4. **迁移暴露了 REQ-F-025 的假覆盖（重要）**。迁移后 `gate g2` 报 `REQ-F-025 missing test coverage`。查因：迁移前 REQ-F-025 在测试说明书里的**唯一**出现位置是一张**评审表的表格行**，而不是任何测试行——G2 的覆盖检查是全文扫 REQ id，于是一直被这条评审文字"喂饱"。评审归位把它带走，假覆盖就露了原形。**这不是迁移造成的回归，是迁移暴露的既有缺陷。**修法不是把评审塞回去，而是补真覆盖：`TEST-040 ②③` 本来就在断言「`<iframe>` 无 `sandbox` 属性」和「提示条无关闭途径、Esc 无效」——正是 REQ-F-025 验收标准 ①②，只是 TEST-040 的覆盖需求列漏写了 REQ-F-025。补进该列后 `gate g2` 恢复 `G2_PASS`。

   **流程教训**：CP 覆盖与 REQ 覆盖都是**全文关键字匹配**，评审文字里出现的 ID 会被算作覆盖。TEST-054 的硬门只比对了 `review r1..r4`，**没有比对 `gate g2`**，所以这条是靠迁移后跑全量门禁才发现的，不是硬门抓出来的。后续 CR 若再做文档结构迁移，前后比对集合应扩到 `check p3` 全量而不止 `review r*`。

### 门禁状态（如实）

- `check-specs`：`OK SPECS_PASS 4 spec(s)`。
- `check-changes`：`OK CHANGE_RECORDS_PASS validated 15 change record(s)`。
- `gate g1` / `gate g2`：PASS。
- `review r1..r4 --cr CR-20260910-process-hardening`：**全 PASS**。
- `gate g3`**全量仍 FAIL**：`missing PASS evidence for: TEST-047, TEST-048, TEST-049, TEST-050`。这四条属于 `CR-20260910-ui-foundation`（已批准、**未实施**），与本 CR 无关，本 CR 零 `src/` 变更。按 CP-5 的规矩，`--cr` 只是自查视角，**不作为交付凭证**——本 CR 的收口结论是「本 CR 范围内全绿，仓库全量 g3 因另一在途 CR 未实施而红」，不写成「g1-g4 全绿」。
