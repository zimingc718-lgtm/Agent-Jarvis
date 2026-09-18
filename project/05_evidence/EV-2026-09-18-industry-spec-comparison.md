# EV-2026-09-18-industry-spec-comparison

- 来源: 用户 2026-09-18，INPUT-2026-09-18-001 第 1 条 + INPUT-2026-09-18-002 澄清答复①②
- 时间: 2026-09-18
- 采集者: 助手（claude-sonnet-5，隔离 worktree fork），在 `cr/20260918-industry-spec-comparison` 分支上执行；未接触共享 3000 端口服务
- 支撑对象: `CR-20260918-industry-spec-comparison` CP-1
- 可定位路径: 本文件；`src/lib/entities.ts`、`src/components/IndustrySpecComparison.tsx`、`src/components/DisplayScreen.tsx`、`src/lib/tools/display-tools.ts`、`tests/industry-spec-comparison.test.tsx`、`tests/tool-suites.test.ts`、`tests/stage-reach.test.tsx`、`scripts/probe-industry-spec-comparison.mjs`

## 1. 投入实现前的代码核对：`params` 是否三类实体共享

`src/lib/entities.ts:124-154` 的 `Entity` 类型定义里，`params: Param[]` 与 `kind: EntityKind` 是同一层级的字段，不按 `kind` 分叉；`ENTITY_KINDS = ["competitor", "authority", "customer"]`（第 23 行）三类实体读写的是同一个 `parseEntityFile`/`renderEntityFile`，`param` 这一行的 frontmatter 语法（`name | value | status`）对三类实体完全相同。`CR-20260918-competitor-board` 已经验证"友商的技术参数复用 `params`、不新起数据模型"这条路可行；本次核对确认这一结论对规则与准入方、客户同样成立——三者的差异只在各自的"状态模型"字段（`capacity`/`nextLabel`/`nextDate`/`health`），不在参数怎么存。

`Param.status: ParamState`（第 83-89 行，`unknown`/`meets`/`unmet`）的语义在第 74-82 行的注释里写得很清楚："whether our own product meets it is a judgement about us, which no source page contains. A model that could write `meets` would be inventing the one thing the board exists to tell the truth about." ——这是一个已存在、有意不可由模型写入的判断字段，不是本 CR 要新增的东西；是否在对比表里显示它，是本 CR 如实标注为开放问题的地方（见 CR 文档「非目标 / 开放问题」），不是代码核对能替用户拍板的事。

结论：不新增数据模型，`GET /api/entities`（已有路由）足以支撑本 CR 的全部数据需求。

## 2. 机器证据

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| ①-④ | `tests/industry-spec-comparison.test.tsx` | 4 | ①三类实体同表、按维度并集对齐、列头标注 `kind`、缺值占位符；②零实体时如实说明；③有实体但零参数时如实说明；④读取失败给出 `role="alert"` |
| ⑥ | `tests/tool-suites.test.ts` | 1 | `show_industry_spec_comparison` 返回 `events:[{type:"display_stage",stage:"industry-spec-comparison"}]`，且不改变持久态 `display_state.kind`（仍为 `home`） |
| ⑥ | `tests/stage-reach.test.tsx` | 1 | 展示屏收到该阶段事件后渲染 `.display-screen--industry-spec-comparison`；收到 `opening` 能退回标题页；持久化的 `insight` 仍压过该阶段 |

`npx tsc --noEmit -p .`：0 错误（两次运行，加代码后与加测试后各一次）。

`npx vitest run tests/industry-spec-comparison.test.tsx tests/tool-suites.test.ts tests/stage-reach.test.tsx`：**3 个文件、23 个用例全绿**（2026-09-18，本机）。

`npx vitest run`（全量）：**91 个测试文件、838 个用例全绿**（2026-09-18，本机），无回归、无争用超时。

`node scripts/ui-contract.mjs`：**53 项全过，0 失败**。

`node scripts/check-module-graph.mjs`：113 文件扫描，0 环、0 分层违规、0 客户端/服务端违规。

## 3. 真实入口（本 CR 交付时未执行，留给编排会话）

`scripts/probe-industry-spec-comparison.mjs` 已写好、`node --check` 语法核对通过，但本 fork 按边界不得触碰共享的生产服务器。该探针会：在真实对话里要求"拉一下行业技术指标对比表"，等待流式结束，核对展示屏是否切到 `.display-screen--industry-spec-comparison`，若渲染出表格则进一步核对表头是否出现 `kind` 标签（友商/规则与准入方/客户）——信息性输出，不强求真实数据里三类对象都已登记，那取决于用户实际登记了什么。

**这是本 CR 唯一尚未闭环的部分**：机制本身（组件渲染、工具事件、展示屏阶段接线）已经由代码核对与既有测试确认，真实模型会不会在被这样问的时候正确调用这个工具，只有真实入口能回答。收口本 CR 时需要在用户自己那台（`npm run build:local && npm run serve:local`）实际跑一次这个探针，并把结果补进本证据文件。

## 4. 局限（如实登记）

- 三类实体是否都应该出现在这张表里，只有"客户"一项经过用户逐字确认（INPUT-2026-09-18-002 答复 2）；"规则与准入方"是本 CR 依据第 1 条原文的分组做出的推断，不是用户被直接问到并确认过的事实，已在 CR 文档「问题经过」如实标注这一步是推断而非确认。
- `Param.status` 是否应该显示在对比表里，本 CR 判定为需要用户决定的开放问题，未构建、未隐藏式地做出选择，如实登记在 CR 文档，不在此处重复。
- 若真实入口探针显示模型不会主动调用这个工具，或表格在真实数据规模下难以阅读，需要重新评估，处理方式是另立后续 CR，不在本 CR 范围内补救。
