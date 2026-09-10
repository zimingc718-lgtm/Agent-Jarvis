# CR-20260909-corner-menu

- 级别: L2
- 提出人: user（"配置，账号登录两个入口放在左下角的悬浮选项" → 参考 Next dev 浮层 → 决策：☰ 触发器、主题内联、dev 指示器挪右、混合菜单 → 角色评审 → 决策：「配置」改名「模型」、Next 指示器挪 bottom-right、浮层机制留 P3 → "评审意见一致后，开始按流程执行开发"）
- 状态: CLOSED（P1-P4 完成：TASK-031 DONE、TEST-032 PASS、g1-g4 全绿、TEST-019/021 + appearance/account e2e 回归通过）
- 占用 ID: TASK-031, TEST-032 （由 CR-20260910-risk-scaled-gates 回填，只登记本 CR **创建**的 ID，不含其引用或修订的既有 ID；DEC-001..014 的创建归属无法从现有记录复原，故未登记。）
- 评审模型: pre-R1234（旧 G0/G1/G2/G3/G3.5/G4；CR-20260909-consensus-review-gates 起改为 R1–R4 + G3/G3.5/G4，不追溯本 CR）
- 影响需求: REQ-F-015（验收重写：header 两按钮 → 左下角 ☰ 菜单）、REQ-F-014（新控件视觉约束）；REQ-F-015 澄清「主题开关位于弹窗外观分区」作废
- 影响模块: MOD-SETTINGS-UI（新增 `CornerMenu`、`ThemeToggle` 迁宿主、`SettingsDialog` 瘦身）
- 影响任务: 新增 TASK-031
- 影响测试: 新增 TEST-032；TEST-019（主题持久化）、TEST-021（首页布局 + 弹窗）、appearance e2e 需重写为回归门；e2e `saveProviderThroughSettingsDialog` / account 流程改为经 ☰
- 当前证据: `project/05_evidence/EV-2026-09-09-corner-menu-requirements.md`（需求讨论 + 角色评审）、`project/05_evidence/EV-2026-09-09-corner-menu-impl.md`（三角色逐 CP 方案 + P3/P4 验证）
- 方案选项:
  - A. 左下角散放两个按钮
  - B. 左下角 ☰ 触发器 + 浮层菜单（主题内联，模型/账号启动弹窗）
  - C. 保留 header，两按钮改图标
- 选择理由: 选 B。用户明确要「像 Next dev 左下角浮层那样」的收纳形态；单个 ☰ + 浮层比两个散按钮的底部冲突小得多。主题（浅色/深色）内联进浮层——高频操作从「翻 2 层弹窗」变「1 下」；「模型」（原「配置」）与「账号登录」仍开各自弹窗（表单较大）。header 只剩标题。dev 模式把 Next 指示器挪 `bottom-right`（`next.config.mjs devIndicators`），不在应用组件里做 `NODE_ENV` 分支。可发现性非惯例（设置惯例在右上），鉴于单一本地管理员（配一次），成本可接受——记为有意取舍。
- 回滚方式:
  - 文档回滚：还原 `产品需求说明书.md`（REQ-F-015 验收、恢复「外观分区」澄清、删 corner-menu 澄清与评审行、还原 REQ-F-014）、`架构设计说明书.md`（删 DEC-014、还原 DEC-005 与 MOD-SETTINGS-UI 职责、方案表）、`模块任务开发说明书.md`（删 TASK-031 与技术设计表、评审行）、`测试说明书.md`（删 TEST-032 与测试设计表，还原 TEST-019/021 说明）、删 `EV-2026-09-09-corner-menu-*.md`、`test-results.json` 去本 CR 条目。
  - 运行回滚（P3 后）：删 `src/components/CornerMenu.tsx`；`SettingsDialog` 恢复「外观」分区 + `ThemeToggle` 导入 + 按钮文案「模型」→「配置」；`page.tsx` 恢复 `home__actions`；`globals.css` 删 `.corner-menu*`；`next.config.mjs` 删 `devIndicators`；`ui-contract.mjs` 删新规则。无 API/schema/依赖变更。
  - 回滚后重跑 `python tools/governance.py verify|gate g1|gate g2|check-changes|ui` 并重新 `snapshot`。
- 验收条件:
  - P1/P2（本 CR 范围）：四本说明书一致，`gate g1`/`g2`/`check-changes`/`verify`/`ui` 全部通过；REQ-F-015 验收改写为用户确认变更；REQ-F-014 覆盖 ☰ 菜单控件。
  - P3/P4（后续实现）：`CornerMenu` 组件（☰ `<button aria-haspopup aria-expanded>` + 浮层，Esc 关 + 焦点回触发器 + light-dismiss；机制 P3 定）；`ThemeToggle` 内联进浮层；`SettingsDialog` 删「外观」分区、按钮文案「模型」；`page.tsx` header 只剩标题；`next.config.mjs` `devIndicators: { position: "bottom-right" }`；☰ z-index > 对话框（20），折叠/展开都可点；ui-contract 新增 corner-menu 规则、仍 0 FAIL 0 WARN；TEST-032 PASS；TEST-019/021 + appearance e2e 回归重写并通过。
- 评审记录: 各角色以本职说明书 + 行业惯例独立评审，允许 CONDITIONAL / 反对。
  - **产品 owner**：①REQ-F-015「两个弹窗按钮」验收须作为用户确认变更改写。②主题开关移出「配置」外观分区（APPROVED 澄清作废）——净收益真实（1 下 vs 翻 2 层），且「配置」弹窗此后只剩 Provider 设置，与 `/settings/models` 深链对齐。**「配置」→「模型」**。③可发现性非惯例，记为已接受取舍（单一本地管理员）。④占位账号入口进菜单 = 弱化死入口，是改进。⑤首页仍算极简（静息可见控件更少）。结论：**APPROVED**。
  - **架构角色**：①零部署/后端/数据库变更。②☰ 菜单 + `ThemeToggle` 迁移归 **MOD-SETTINGS-UI**（已负责 Provider + 外观开关），`ThemeToggle` 组件仅换宿主。③**DEC-005 修订** + 新增 **DEC-014**（☰ 菜单 + z-index 刻度 + `devIndicators` 配置）。④**反对组件里按 `NODE_ENV` 偏移**——改 `next.config.mjs devIndicators` 把 Next 指示器挪 `bottom-right`，一处配置、组件无环境分支（用户已采纳）。⑤浮层机制（原生 `popover` vs 自写 disclosure）留 P3。结论：**APPROVED**。
  - **模块开发角色**：①**不是「加个菜单」**——含 `CornerMenu` 新组件 + `ThemeToggle` 迁宿主 + `SettingsDialog` 删「外观」分区（变薄）+ `page.tsx` 删 `home__actions` + CSS + `next.config.mjs`。②`SettingsDialog`/`AccountDialog` 整体渲染进 `CornerMenu` 浮层作 children，弹窗逻辑不动；`ThemeToggle` 内联。③`SettingsDialog` 保留为「弹窗外壳 + `ModelSettings`」薄壳，复用点还在。④测试返工是硬活（TEST-019/021 断言反转、appearance e2e 流程变）。⑤按 2 子项提交：Ⅰ `CornerMenu` + `ThemeToggle` 迁移 + `page.tsx` + `next.config.mjs`；Ⅱ `SettingsDialog` 瘦身 + 测试返工。结论：**CONDITIONAL**（条件并入 TASK-031 描述）。
  - **测试角色**：①TEST-021「首页仅标题 + 配置/账号两按钮」断言**反转**（标题 + ☰，无 header 按钮）——作回归门重写，须真覆盖新结构。TEST-019（主题位置）同理。②新增断言（原则 15）：首页有 ☰ 无 header 按钮；点 ☰ 开浮层 / Esc 关 / 焦点回 ☰；浮层含 浅色/深色（内联）+ 模型 + 账号登录；浮层里切主题**不开弹窗**且刷新保持（**真实浏览器**，原则 12）；点「模型」开 ModelSettings 弹窗、点「账号登录」开账号弹窗；对话框展开时 ☰ 仍可点（z-index，**真实浏览器**）；☰ 有 `aria-haspopup` + `aria-expanded`。③`devIndicators` 是 Next shadow DOM，Playwright 难断言，接受为无断言 dev 便利，顶多静态查 `next.config.mjs` 含 `devIndicators` 键。④ui-contract 加一条 corner-menu 规则（类比折叠控件 LB-07）。结论：**APPROVED**（条件：TEST-019/021 + appearance e2e 作回归门；新增 TEST-032）。
- 评审结论汇总: 产品 owner / 架构 / 测试 APPROVED；模块 CONDITIONAL（2 子项提交 + SettingsDialog 瘦身 + 测试返工，已并入 TASK-031）。用户决策：「配置」→「模型」、Next 指示器挪 `bottom-right`、浮层机制留 P3。

## 各流程变化点（CP-1..CP-6）

- **CP-1** REQ-F-015 验收重写：header 两按钮 → 左下角 ☰ 菜单
- **CP-2** 「配置」→「模型」重命名
- **CP-3** 主题开关移出「配置」弹窗外观分区 → 内联进 ☰ 浮层（`ThemeToggle` 迁宿主）
- **CP-4** `CornerMenu` 新组件（☰ 触发器 + 浮层 + Esc/焦点/light-dismiss；机制 P3）
- **CP-5** `next.config.mjs` `devIndicators: { position: "bottom-right" }`
- **CP-6** TEST-019/021 + appearance e2e 回归重写；`saveProviderThroughSettingsDialog` / account e2e 流程经 ☰

架构 / 模块 / 测试 三角色逐 CP 方案见 `架构设计说明书 · CR-20260909-corner-menu 方案` / `模块任务开发说明书 · 技术设计` / `测试说明书 · 测试设计` 三表。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ

## R1 评审意见

**CR-20260909-corner-menu 评审**（迁移自 `产品需求说明书.md`）

各角色以本职说明书 + 行业惯例独立评审。完整评审见 `project/06_changes/CR-20260909-corner-menu.md`。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 产品 owner | ①REQ-F-015「两个弹窗按钮」是 MUST 验收改写，须记为用户确认变更。②主题开关移出「配置」外观分区（APPROVED 澄清作废）——净收益真实；「配置」弹窗此后只剩 Provider 设置，与 `/settings/models` 深链对齐。③设置放左下角非惯例，记为已接受取舍（单一本地管理员）。 | REQ-F-015 改写；「配置」→「模型」；澄清小节记外观分区移除 + 可发现性取舍 | APPROVED |
| 架构角色 | ①零部署/后端/数据库变更。②☰ 菜单 + `ThemeToggle` 迁移归 MOD-SETTINGS-UI。③**反对组件里按 `NODE_ENV` 偏移**——改 `next.config.mjs devIndicators` 把 Next 指示器挪 `bottom-right`。 | 新增 DEC-014（☰ 菜单 + z-index 刻度 + `devIndicators`）；DEC-005 修订；用户采纳 `bottom-right` | APPROVED |
| 模块开发角色 | **不是「加个菜单」**——含 `CornerMenu` 新组件 + `ThemeToggle` 迁宿主 + `SettingsDialog` 删外观分区 + `page.tsx` 删 `home__actions` + `next.config.mjs`；测试返工是硬活。 | TASK-031 含全部；按 2 子项提交 | CONDITIONAL（条件并入 TASK-031） |
| 测试角色 | TEST-021「首页仅标题 + 两按钮」断言**反转**、TEST-019（主题位置）须作回归门重写；主题持久化走真实浏览器；对话展开时 ☰ 可点须真实浏览器。 | 新增 TEST-032；TEST-019/021 + appearance e2e 回归门 | APPROVED |

## R2 评审意见

**CR-20260909-corner-menu 评审**（迁移自 `架构设计说明书.md`）

| 角色 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|
| 架构角色 | ☰ 菜单是首页 chrome，需明确模块归属、z-index 层级、dev 指示器处理方式 | DEC-014：`CornerMenu` 归 MOD-SETTINGS-UI；z-index 刻度成文（对话 20 / ☰+浮层 30 / 模态 top-layer）；`next.config.mjs devIndicators` 而非组件 `NODE_ENV` 分支 | APPROVED |
| 模块开发角色 | `CornerMenu` 应与业务解耦 | `page.tsx` 把三个组件作 `children` 传入，`CornerMenu` 不感知 props | APPROVED |
| 产品 owner | 「配置」弹窗删外观分区后是否还成立 | 与 `/settings/models` 深链（本就只有 ModelSettings）对齐，更一致 | APPROVED |
| 测试角色 | 浮层是新交互模式 | 需 `aria-haspopup`/`aria-expanded` + Esc + 焦点回归断言（TEST-032）；机制留 P3 不影响验收面 | APPROVED |

## R3 评审意见

**复盘迭代（CR-20260909-corner-menu）**（迁移自 `模块任务开发说明书.md`）

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 模块开发角色 | 影响矩阵：REQ-F-015 = **大改**（header 重构 + 新组件）；「配置」→「模型」= 小改（字面量）；主题内联 = 小改（`ThemeToggle` 换宿主）。**任务须含 SettingsDialog 删外观分区 + 测试返工**，不是「加个菜单」 | TASK-031 描述含全部 6 项；按 2 子项提交（Ⅰ 组件/接线/config，Ⅱ 瘦身/返工） | APPROVED |
| 模块开发角色 | `CornerMenu` 与业务耦合风险 | `page.tsx` 用 `children` 传三个组件，`CornerMenu` 零 import 业务 | APPROVED |
| 测试角色 | TEST-019/021 断言反转是行为回归 | TEST-032 承载菜单行为；测试说明书点名 TEST-019/021 + appearance/account e2e 作回归门 | APPROVED |
| 架构角色 | dev 指示器方案 | `next.config.mjs devIndicators` 而非组件 `NODE_ENV` 分支（DEC-014） | APPROVED |

## R4 评审意见

**复盘迭代（CR-20260909-corner-menu）**（迁移自 `测试说明书.md`）

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 测试角色 | TEST-021「首页仅标题 + 两按钮」、TEST-019「主题在弹窗外观分区」断言**反转**——是行为回归，须作回归门重写，不能删了旧断言就算 | TEST-021/019 改写（覆盖新结构）；TEST-032 新增（菜单行为）；appearance/account e2e 经 ☰ | APPROVED |
| 测试角色 | 主题内联「不打开弹窗」如何断言 | TEST-032 断言④：点「深色」后 `document.querySelector("dialog[open]")` 为 null | APPROVED |
| 架构角色 | dev 指示器位置的可测性 | Next shadow DOM，Playwright 不断言；顶多静态查 `next.config.mjs` 键——接受 | APPROVED |
| 产品 owner | 「模型」弹窗删外观分区后覆盖是否有缺口 | ModelSettings 的 Provider 断言不变（TEST-010/016/025）；外观移到 TEST-032/019 | APPROVED |
