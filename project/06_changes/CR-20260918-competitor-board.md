# CR-20260918-competitor-board

- 级别: L2（单一 CP，双向门，机器检查发现——快车道）
- 提出人: 用户，INPUT-2026-09-18-001 第 7 条（"新增一页友商看板，支持将友商的产品参数，规格，放在同一个表格上进行对比分析，并每个维度给出评价总结。同样支持对话控制。"），范围经 INPUT-2026-09-18-002 确认与第 1 条的延后页面不是同一个（本 CR 限定为已跟踪友商的对比，不含更广的行业硬核指标对比）
- 状态: R1 待人工终裁（本 CR 在四条并行 Wave 1 CR 中实现，尚未合并，等待用户对四条 CR 的统一 snapshot/合并确认）
- 占用 ID: DEC-349, TASK-456, TEST-456
- 评审模型: 快车道（DEC-021 ①：单一 CP 双向门且有机器检查）
- 影响需求: **新增** REQ-F-243
- 影响模块: MOD-DISPLAY（`src/components/CompetitorBoard.tsx`、`src/components/DisplayScreen.tsx`）、MOD-TOOLS（`src/lib/tools/display-tools.ts`）
- 影响任务: **新增** TASK-456
- 影响测试: **新增** TEST-456
- 当前证据: `project/05_evidence/EV-2026-09-18-competitor-board.md`
- **已知红灯（如实登记，非缺陷）**：本分支上 `check-ids` 当前对 DEC-349/TASK-456/TEST-456 报 `CHECK_IDS_DANGLING`——按本 CR 的实施边界，四份受控说明书（含 DEC/TASK/TEST 表）不由本分支直接编辑，其待落笔内容全部写在 `SPEC_DRAFT.md`。这三个红灯会在协调会话把 `SPEC_DRAFT.md` 的内容落进对应说明书后自然转绿，不需要在本分支内做任何处理。
- 方案选项:
  - A. **新增一套独立的"产品规格"数据模型**，友商的技术参数单独存一份——否决。跟踪对象已经有 `params: Param[]`（看板的技术脊梁，`entities.ts` 明确写着"用户 2026-09-12：我是技术方，不是市场方"），友商的产品参数本来就该录在这里；另起一份等于让同一份事实有两个可能不一致的副本。
  - B. **复用既有 `params`，新增一个纯读取的对比表页面**（选中）：新组件 `CompetitorBoard.tsx` 读 `GET /api/entities`（已有路由，不新增接口），筛 `kind === "competitor"` 的对象，按各自 `params` 的名字并集列维度，每个友商一列。不新增任何写入口——参数的增删改仍走看板已有的入口。
  - C. **逐维度的"评价总结"落一个新字段持久化**——否决。评价是判断而不是事实：谁给出的、什么时候可能过期、要不要跟着参数变化自动失效，这些问题一旦落库就绕不开；而模型已经能通过 `list_entities`/`read_entity` 看到同一份 `params` 数据，用户想要评价时直接在对话里问，得到的永远是最新一次的判断，不会有一份写死在表格里、和最新参数对不上的旧结论晾在那里。
  - D. **展示屏切换沿用 `show_board` 的"会话态 stage 事件"模式，而不是持久化的 `display_state.kind`**（选中）：`DisplayStage` 类型新增 `"competitor-board"` 一项，`show_competitor_board` 工具发 `display_stage` 事件，不写数据库。理由与 `CR-20260912-display-stage` 否决"把 board 做成第四个 display_state 值"完全一致——一个常驻的友商看板会和 `show_home`/`show_insight` 的持久态打架。
- 选择理由: 选 B + D。①不新增存储、不新增写入口，风险面不扩大；②评价总结保持对话现场生成，避免"表格里的结论和最新参数脱节"这个后患无穷的一致性问题；③展示屏的会话态切换机制已经被 `show_board` 验证过，直接复用而不是重新发明。
- 回滚方式: `git revert` 本 CR 的提交。`DisplayStage`/`ChatDelta` 的 `stage` 联合类型多一个从未被写入 `display_state` 的取值，回退后模型再也调用不到 `show_competitor_board`（工具随组件一起被删），不影响任何既有数据。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵；三层说明书各含 `变更响应 · CR-20260918-competitor-board` 节落点。
  - P3/P4: TASK-456 DONE；TEST-456 PASS；`check-ui-route` 对本 CR 的 `机器（UI）` 路线 PASS（如适用——本 CR 的机器检查是 `fireEvent`/事件驱动的组件与工具测试，未必需要该标记，视最终测试文件里是否含 `fireEvent`/`userEvent` 而定，由收口时统一核对）。
  - **真实入口**：用户自己那台（`npm run build:local && npm run serve:local`，端口 3000）——① 真实模型调用 `show_competitor_board` 后，展示屏切到友商看板，能看到已跟踪友商的参数对比表；② 对已跟踪的至少两个友商各自登记至少一个同名参数后，两者在同一维度行里各自显示自己的值；③ 没有登记任何参数的友商，列出但显示"未登记"，不报错、不留白。
- 评审记录: 快车道。唯一 CP 可由单测（组件渲染 + 工具事件断言）+ 真实入口直接核验。
- R1 终裁: 已完成 | 用户 | 2026-09-18

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签置行匹配）：协调会话在本 CR 实现完成、并行的 `industry-spec-comparison` 明确复用本 CR 的方案模式提请确认之后，单独就本 CR 三个关键决策（复用既有 `params`、会话态展示屏切换、评价总结不持久化）向用户确认，用户选择「Approve as-is」。

## 问题经过

用户在 INPUT-2026-09-18-001 第 7 条要求新增"友商看板"页：把多个友商的产品参数/规格放同一张表对比，逐维度给评价总结，支持对话控制。

投入实现前的代码核对发现：跟踪对象（`entities.ts`）已经有 `params: Param[]` 字段，且明确是"看板的技术脊梁"（用户 2026-09-12 原话"我是技术方，不是市场方"）——本 CR 要对比的产品参数/规格，正是这份已经存在的数据，不需要新的数据模型。展示屏的"会话态切换而非持久化"机制（`show_board`/`DisplayStage`）也已有先例可循。真正新增的只是：一个读取多个对象 `params` 并按维度对齐成表格的展示组件，和一个把展示屏切过去的工具。

"评价总结"是本 CR 唯一需要做出取舍的地方：写死在表格里意味着要解决"谁写的、何时过期"的问题，而模型已经能看到同一份数据，选择让评价始终在对话现场生成（见「方案选项」C 的否决记录）。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **友商看板**：新增 `CompetitorBoard.tsx` 组件，读取已跟踪友商的 `params` 按维度对齐成对比表；新增 `show_competitor_board` 工具，通过既有的会话态 `display_stage` 机制把展示屏切过去；评价总结不持久化，由对话现场生成 | REQ-F-243, DEC-349, TASK-456, TEST-456 | 新增 | 双向 | 机器：`tests/competitor-board.test.tsx`（组件渲染 4 例）+ `tests/tool-suites.test.ts`（工具事件断言）+ `tests/stage-reach.test.tsx`（展示屏阶段切换，含洞察优先级不变的回归） |

## 非目标（如实登记）

- 不做"行业硬核指标对比"（INPUT-2026-09-18-001 第 1 条的延后页面）——经 INPUT-2026-09-18-002 确认二者不是同一个页面，那一页范围更广（不限于已跟踪对象）、需要更严谨的量化数据集，留给独立的 CR。
- 不新增参数的增删改入口——友商的 `params` 仍然只能通过知识看板既有的入口维护，本 CR 是纯读取的对比视图。
- 不把"评价总结"持久化——理由见「方案选项」C。

## 并行事项说明（如实登记）

本 CR 与 `CR-20260918-unified-floating-console`、`CR-20260918-library-in-board`、`CR-20260918-conference-preview-insight` 在四个独立的 git worktree 中并行实现，均从同一个 `main` 基点分支。本 CR 触碰的 `DisplayScreen.tsx` 改动集中在：新增 import、`stage` 类型从 `useState<"opening" | "board">` 改为 `useState<DisplayStage>`、事件处理分支增加 `competitor-board` 判断、新增一段独立的 `if (stage === "competitor-board")` 渲染分支——与 `unified-floating-console` 预期会改的"各视图容器的 `bottom` 布局样式"是不同的代码区域，理论上合并顺序不敏感，但需要协调会话在实际合并时确认 diff 不冲突。四条 CR 共享的治理文档（产品需求说明书等四份 + `docs/INDEX.md` + `test-results.json`）均未在本次实现中触碰，交由协调会话在合并阶段统一处理，避免四份并行分支互相覆盖。
