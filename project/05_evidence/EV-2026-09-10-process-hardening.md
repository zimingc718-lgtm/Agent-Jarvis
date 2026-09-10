# EV-2026-09-10-process-hardening

- 证据 ID: EV-2026-09-10-process-hardening
- 来源类型: 会话内实测摩擦点 + 文档结构盘点 + R1 四角色 ReAct 评审
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`；`tools/governance.py`；四本说明书；`project/06_changes/CR-*.md`
- 采集时间: 2026-09-10
- 采集者: Claude Code session（Opus 5）
- 支撑对象: CR-20260910-process-hardening；TASK-044..047；TEST-051..054

## 1. 触发

用户：「1. 理解流程。进一步优化流程，并把流程固化为可执行脚本，并提高效率。2. 理解项目，重新梳理各个环节的说明书，保持一致与每个环节的说明书格式。评审放在 CR 变更里。」

## 2. 实测证据（先证据后归因，原则 9）

### 2.1 门禁摩擦（实际发生，非推测）

```
# 收口 CR-20260910-skill-intake 时：
gate g3  → FAIL G3_BLOCKED missing PASS evidence for: TEST-047, TEST-048, TEST-049, TEST-050
```

TEST-047..050 属 `REQ-NF-006` / CR-20260910-ui-foundation（并行会话，R4 已过、未实施）。**g3 对测试说明书全部 required TEST 求交集，没有 CR 粒度** → 任何「R4 已过、P3 未做」的在途 CR 都会让 g3 对所有 CR 变红。

### 2.2 基线抖动（本会话踩两次）

Next 每次 `build` / `dev` 把当前 `NEXT_DIST_DIR` 写进 `tsconfig.json` 的 `include`。跑完 `ui-contract --live` 后：

```
verify → FAIL BASELINE_CHANGED tsconfig.json
```

需手动 `git checkout -- tsconfig.json` 再 snapshot。`next-env.d.ts` 已有同类忽略先例，`tsconfig.json` 漏了。

### 2.3 文档结构盘点

| 说明书 | 行数 | CR 小节数 | 评审节名约定 |
|---|---|---|---|
| 产品需求说明书 | 235 | 5 澄清 + 6 评审 | `## 多角色评审` + `### <CR> 评审` |
| 架构设计说明书 | 592 | 5 方案 + 6 评审 | 同上，但 ui-foundation 改用 `### R2 四角色审查`（嵌在自己的 `##` 节内）|
| 模块任务开发说明书 | 414 | 4 影响矩阵 + 4 技术设计 + 8 评审/复盘 | `## 复盘迭代（X）` 与 `## X 评审（R3，…）` 混用 |
| 测试说明书 | 422 | 5 派生矩阵 + 5 测试设计 + 8 复盘/评审 | 同上；**CR 小节顺序完全交错**（collapsible-panel 的测试设计在 minimal-floating-chat 的复盘之前）|

合计 **1663 行、约 40 个 CR 小节、5 种评审节名约定**。

### 2.4 评审重复性核查（决定「移走是否丢信息」的关键）

```
CR                              R2矩阵 R3矩阵 R4矩阵
CR-20260909-skills                 1      1      1
CR-20260909-display-screen         1      1      1
CR-20260910-skill-intake           1      1      1
CR-20260910-ui-foundation          1      1      1
```

**每个 CP-model CR 本就自带完整的 R2/R3/R4 逐 CP 矩阵。** 说明书里的评审表是重复的第二份。但其**文字意见**（4 行角色表，含理由）比矩阵格更详细 —— 因此定为**迁入 CR**，不是删除。

### 2.5 其余摩擦点

- CR 13 个必填标签手写：早前两次因 `- 评审记录（…）:` 用全角括号而非冒号，被 `check-changes` 判 `CHANGE_RECORD_INCOMPLETE`。
- 矩阵手敲：skill-intake 的 R2/R3/R4 = 15 CP × 4 角色 × 3 门 = **180 格**。
- 收口要跑 12 条命令：`verify`/`g1`/`g2`/`g3`/`g3.5`/`g4`/`check-changes`/`ui` + `review r1..r4`。

## 3. R1 四角色 ReAct 评审

### 3.1 产品 owner
- Thought：流程 CR 最容易被误读成「功能有变」，必须显式声明零产品需求变更。
- Action：核查「评审移出说明书」是否丢信息 → §2.4 证明每个 CR 自带矩阵，说明书那份是重复。
- Observation：但文字意见比矩阵格详细，删了会丢理由。
- 裁决：**APPROVED**。条件转处理：定为「迁入 CR」，验收加「信息不丢」条款。

### 3.2 架构角色
- Thought：迁移改的正是 `review r2/r3/r4` 判定覆盖所依赖的节标题 —— 这是本 CR 唯一能把在途 CR 搞坏的地方。
- Action：读 `check_review` / `_cr_scoped_text` —— 它按「`##`/`###` 标题**含 CR 名**」取节，取到下一个同级或更高级标题为止。
- Observation：新节名 `## 变更响应 · CR-<name>` **仍含 CR 名**，且子节用 `###` 会被一并纳入 → 覆盖检查**零改动**即兼容。
- 裁决：**CONDITIONAL** → ①先证明向后兼容再动手；②`--cr` 不得削弱现有全量门禁。
- 处理 → **APPROVED**：验收加「向后兼容硬门」（四个在途 CR 迁移后 `review r1..r4` 必须仍全 PASS）；`--cr` 定为可选参数、缺省即现行全量语义（CP-5）。

### 3.3 模块开发角色
- Thought：1663 行、40 个小节的重排，手改必错。
- 裁决：**CONDITIONAL** → ①脚本迁移且留档；②不开第二个 CLI 入口。
- 处理 → **APPROVED**：CP-8（`tools/migrate_specs.py` 幂等 + 留档）、CP-9（全部挂 `governance.py`，`package.json` 只加一条聚合脚本）。

### 3.4 测试角色
- Thought：本项目刚吃过「写进任务描述却没实现、无人发现」的亏（TASK-033 Ⅰ 的 `<input webkitdirectory>`）。
- 裁决：**APPROVED**。条件即 TEST-051..054：每个新子命令有单测；向后兼容是硬断言不是目测；说明书结构契约本身机器可查（`check-specs`），否则下个 CR 会长出第 6 种节名约定。

### 3.5 汇总

产品 / 测试 R1 即 APPROVED；架构 / 模块 R1 CONDITIONAL → **1 轮闭环** → APPROVED。**四角色全 APPROVED，无 REJECTED、无遗留 CONDITIONAL。**

## 4. R1 人工终裁

**待用户拍板**。需确认：CP-1..CP-12、说明书两段式目标结构与固定小节白名单、评审去重归位到 CR、`--cr` 缺省全量语义、四条新命令（`new-cr` / `matrix` / `check <stage>` / `check-specs`）。

## 5. 本证据边界

R1 只锁定摩擦点与 CP 登记。命令的具体参数面、小节白名单的确切取值、迁移脚本的分步策略在 P2 各层说明书产出。`review r2|r3|r4` 在 P2 成文前预期报 `COVERAGE_GAP` —— R1 阶段的正确状态。
