# Agent-Jarvis 执行流程控制

## 当前状态

产品需求尚未确认。本流程只规定从需求确认到开发、验证、发布的控制顺序，不定义任何具体产品功能。

## 阶段与责任

CR-20260909-consensus-review-gates 起：设计阶段门禁由 R1–R4 四门取代原 G1/G2；G3/G3.5/G4 证据门保留。

| 阶段 | 主责 | 必需输入 | 输出 | 退出条件 |
|---|---|---|---|---|
| P0 需求受理 | 产品 owner | 用户原始输入 | `project/00_input/需求输入.md` | 原文已保存，状态明确 |
| P1 产品定义 | 产品 owner | 已受理输入 | `产品需求说明书.md` + CR「变化点登记」表 | **R1 通过**（角色出意见 → 人拍板） |
| P2 架构规划 | 架构、开发、测试角色 | 已过 R1 的需求、CP 登记、现有代码事实、参考证据 | 架构、模块、测试说明书 + CR 的 R2/R3/R4 评审矩阵 | **R2、R3、R4 依次通过**（机器：CP 全覆盖 + 矩阵合规） |
| P3 开发验证 | 模块开发角色 | 已过 R4 的任务与测试、出口义务清单 | 实现、测试结果、证据 | G3 通过 |
| P4 集成冒烟 | 测试角色 | 可运行构建物 | 真实入口验证记录 | G3.5 通过 |
| P5 发布 | 发布 owner | 完整验证和关闭记录 | 发布清单、回滚说明 | G4 通过 |
| P6 运行反馈 | 产品、测试、质量角色 | 运行证据、用户反馈 | 新需求、变更或问题闭环 | 重要问题已处置 |

## R1–R4 评审门（共识门禁）

| 门 | 类型 | 负责人（反馈回给） | 通过条件 | 命令 |
|---|---|---|---|---|
| R1 需求评审 | 人工终止 | 产品 owner | 产品 / 架构 / 模块开发 / 测试 四角色 Agent 出 ReAct 结构化意见（模块开发角色在 R1 就做可实现性 / 无隐藏 scope 检查）→ 人拍板；CR 有「变化点登记」表 + R1 拍板痕迹 | `governance.py review r1` |
| R2 架构评审 | 机器终止 | 架构角色 | 每个 CP 在架构说明书 `CR-<name>` 节被引用 + `## R2 评审矩阵` 无 REJECTED / 无空 / CONDITIONAL 带条件 | `governance.py review r2` |
| R3 模块评审 | 机器终止 | 模块开发角色 | 同 R2，对模块说明书 | `governance.py review r3` |
| R4 测试评审 | 机器终止 | 测试角色 | 同 R2，对测试说明书 | `governance.py review r4` |

- **变化点（CP）链**：CR 内 `## 变化点登记` 表 `| CP | 来源角色 | 一句话 | 关联 ID | 类型 |`。产品 CP 在 R1 产出；角色派生 CP（来源角色 ≠ 产品）任何门可追加进同一张表。任何 CP 在任何层未被响应 → 该门 `COVERAGE_GAP`。
- **评审矩阵**：R2/R3/R4 每门在 CR 内一张 `## R{n} 评审矩阵`，行 = 全部 CP，列 = 产品/架构/模块/测试全部 4 角色，格 = 裁决（APPROVED/CONDITIONAL/REJECTED）+ ReAct 证据引用。
- **反馈闭环**：门不过 → 意见写入 `project/06_changes/CR-<name>.feedback.jsonl` → 反馈给该层负责人 → 修改 → 重审；同一门 3 轮不收敛 → 升级给人。
- **角色 Agent**：ReAct + 4 护栏（客观终止 / 有界工具 / CP 检查前置 / 结构化裁决）。默认一个 Agent 顺序换视角；L3 变更 spawn 独立子 Agent。
- 角色常驻关切清单见 `docs/AI_STANDARD.md §8`。

## 标准执行循环

1. 保存用户原始需求，不改写、不补充未经确认的产品定义。
2. 产品 owner 与用户确认目标、范围、非目标、优先级和验收标准。
3. 需求确认后，生成或更新产品需求说明书，并在 CR 内建「变化点登记」表；产品 / 架构 / 模块开发 / 测试四角色 Agent 出意见 → **人拍板（R1）**。
4. 架构角色基于已过 R1 的需求形成架构设计，逐一响应每个 CP，不从想象补充功能；填 CR 的 R2 评审矩阵 → **R2 机器门**。
5. 模块开发角色基于架构逐一响应每个架构 CP 拆解任务；填 R3 矩阵 → **R3 机器门**。
6. 测试角色在编码前逐一响应每个任务定义测试；填 R4 矩阵 → **R4 机器门**。
7. R1–R4 全过、出口义务清单清零后，进入实现。
8. 实现完成后运行必选测试，失败先回流到模块开发。
9. 若失败不是实现问题，再回流到模块、架构或需求修订（对应 R3/R2/R1 重审）。
10. 发布前启动真实构建物，通过主路径冒烟验证。
11. 发布后用运行证据和用户反馈创建新需求、变更或问题闭环。

## 变更分流

- L1 局部实现：不改变需求、架构、接口和测试基线的小修复。
- L2 设计变更：改变需求、架构、模块边界、接口、数据结构、测试标准或用户可观察行为。
- L3 重大变更：改变核心目标、技术路线、数据迁移、信任模型、权限模型、外部依赖或发布边界。

## 失败回流

```text
测试或运行证据
  -> 模块任务
  -> 架构设计
  -> 产品需求
  -> 用户确认
```

AI 不得用推测替代证据。无法定位证据的问题必须标记为证据缺口。

## 验证命令

项目技术栈尚未确认，产品测试命令暂不冻结。治理流程命令已经可执行：

**首选按阶段整体跑**，不要逐条敲门（CR-20260910-process-hardening CP-3）：

```powershell
python tools/governance.py check p1        # R1 阶段
python tools/governance.py check p2        # R2/R3/R4 阶段
python tools/governance.py check p3        # 实现验证阶段
python tools/governance.py check release   # 发布（拒绝 --cr）
npm run verify:all                         # 全量：类型 + 单测 + 治理单测 + 视觉 + UI 契约 + 冒烟 + check p3
```

单门仍可单独执行：

```powershell
python -m unittest tests.test_governance -v
python tools/governance.py verify
python tools/governance.py check-changes
python tools/governance.py check-specs
python tools/governance.py review r1|r2|r3|r4
python tools/governance.py gate g3|g3.5|g4
```

`gate g1` / `gate g2` 保留为结构前置检查（`review r*` 的前提），不再是设计阶段的终门。

### `--cr` 作用域（CP-5）

`gate g3|g3.5`、`review r1..r4`、`check p1|p2|p3` 都接受 `--cr <名称>`，把判定收窄到该变更记录 `- 影响测试:` 声明的 TEST 上。用途只有一个：**在途 CR 自查时不被别的 CR 的未完成工作挡住**。

三条不可突破的约束：

1. **缺省语义不变**——不带 `--cr` 时仍是全量判定，别的 CR 的欠账照样阻断。
2. **`gate g4` 与 `check release` 拒绝 `--cr`**——发布按定义就是全量判定，收窄视角不得放松发布门。
3. `--cr` 是**自查工具，不是交付凭证**。P3/P4 收口、快照、提交，一律以缺省全量结果为准；用 `--cr` 通过的 CR 必须在记录里如实写明全量为何仍红。

### 脚手架（CP-4 / CP-10）

```powershell
python tools/governance.py new-cr CR-<日期>-<slug>   # 13 个标签齐全的变更记录骨架
python tools/governance.py matrix CR-<日期>-<slug>   # 依 CP 登记表生成 R2/R3/R4 矩阵骨架
```

`matrix` 生成的格子填的是 `TODO`，而 `TODO` **不是合法裁决**——矩阵没填完跑 `review` 必报 `MATRIX_INVALID`，不会静默通过。已有矩阵默认跳过，`--force` 才重写。

技术栈确认后，产品实现相关命令必须写入 `project/04_tests/测试说明书.md`。

## UI 流程接入

UI 工作纳入现有 P1-P4 流程，不建立绕过需求确认的独立通道。

1. P1 产品定义：只记录用户已确认的 UI 目标、范围、非目标、优先级和验收标准。
2. P2 架构规划：UI 架构必须从 G1 通过的需求派生，并说明组件边界、状态流、鉴权边界、第三方模型授权边界和测试责任。
3. P3 开发验证：涉及用户交互的组件必须先有 Testing Library 组件测试，再实现行为。
4. P4 集成冒烟：必须用 Playwright 从真实浏览器入口验证主要操作流，并保存 real-entry 证据。

UI 相关流程命令：

`powershell
python tools/governance.py ui
npm run test:auth-ui
npm run test:visual
npm run test:e2e
`

## 说明书结构契约（DEC-020）

四本层级说明书（产品需求 / 架构设计 / 模块任务开发 / 测试）统一为**两段式**：

```
# <标题>
## <本层基线节>        ← 当前生效的事实，白名单节名，不按 CR 分叉
## 变更响应 · <CR>     ← 每个变更记录一节，节内用 ### 装白名单子节
## 批准状态
```

三条规则：

1. **说明书写「现在是什么」，变更记录写「为什么变成这样」。**评审意见、复盘、四角色裁决**一律不留在说明书里**，全部归位到对应 CR 的 `## R{n} 评审意见` / `## R{n} 评审矩阵`。
2. 同一个 CR 在同一层**只能有一节**变更响应，节名必须是 `变更响应 · <CR 全名>`。
3. 结构由 `python tools/governance.py check-specs` 机器校验，已接入 `check p2` / `check p3` / `check release`。

历史文档由 `python tools/migrate_specs.py` 一次性迁移（幂等，二次运行零 diff）；被移走的评审文字带 `（迁移自 \`<说明书>\`）` 溯源标记，可在 CR 内检索到，**不删除**。

## 构建目录隔离（DEC-009）

`next build` 与 `next dev` 默认共用 `.next/`。在交互式 `next dev` 运行时执行 `next build`，会覆盖运行中服务器的 webpack 运行时，使其之后重新编译的路由报 `Cannot find module './vendor-chunks/*.js'`（尤其 `/api/auth/[...nextauth]`）。

- `next.config.mjs` 从 `NEXT_DIST_DIR` 读取 `distDir`。
- 交互式开发用默认 `.next/`。
- `npm run test:smoke` → `.next-smoke/`；`npm run test:e2e` → `.next-e2e/`；`npm run build:verify` → `.next-verify/`。
- **禁止**在交互式 `next dev` 运行时直接 `next build`（会污染其 `.next/`）；验证构建一律用 `npm run build:verify`。
- `.next*` 已在 `.gitignore` 中；`npm run clean` 清除全部构建目录。

