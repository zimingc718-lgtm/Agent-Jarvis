# SPEC_DRAFT — CR-20260918-competitor-board

本文件是四份受控说明书的**待落笔内容**，供协调会话在合并阶段手工落进对应文件——本 CR 按 fork 边界不直接编辑
`产品需求说明书.md` / `架构设计说明书.md` / `模块任务开发说明书.md` / `测试说明书.md` / `docs/INDEX.md`。

每节标题标明目标文件、目标位置、插入方式；表格新增行直接摹本四份文档现有的表头列序，插入前请先 `check-ids`
核对彼时的最大编号，确认 DEC-349 / TASK-456 / TEST-456 / REQ-F-243 仍未被其它三条并行 CR 占用。

---

## 目标文件一：`project/01_specification/产品需求说明书.md`

### 1a. `## 功能需求` 表新增一行（表头：`| ID | 名称 | 优先级 | 描述 | 验收标准 | 状态 |`）

```
| REQ-F-243 | 友商对比看板 | MUST | 已跟踪的友商，其产品参数/规格按维度对齐显示在同一张表格里，支持对话唤起；逐维度的评价由模型在对话中现场给出，不在表格里预置或持久化一份写死的结论。 | ①存在一个可由对话唤起的展示屏视图，列出全部已跟踪的 `kind=competitor` 对象；②对比维度取自各友商已登记的技术参数（`params`）名称并集，缺该维度的友商显示占位符而非报错或留空；③视图不提供参数的增删改入口——参数仍只能通过知识看板既有入口维护；④视图不预置或持久化任何"评价总结"字段，用户询问某维度谁更优时由模型基于当下的 `params` 数据现场作答。 | APPROVED（CR-20260918-competitor-board，R1 已终裁：INPUT-2026-09-18-001 第 7 条 + INPUT-2026-09-18-002 确认与第 1 条的行业硬核指标对比页不是同一个） |
```

### 1b. 新增小节 `## 变更响应 · CR-20260918-competitor-board`

锚点：插在既有最后一个 `## 变更响应 · CR-*` 小节之后、`## 批准状态` 之前（用 `re.search(r"(?m)^## 批准状态$")` 定位，不要用字符串 `.replace`——正文里「`## 批准状态` 节」这类引用会撞上，参见 `CLAUDE.md` 第四节的既有教训）。

```markdown
## 变更响应 · CR-20260918-competitor-board

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 友商看板 | REQ-F-243（新增） | 新增 | 新增 REQ-F-243 |

**为什么是新增 REQ 而不是并进已有条目**：已跟踪对象的展示（REQ-F-070，看板三条泳道）与洞察报告展示（REQ-F-032）都描述的是"某一类内容怎么呈现"，但都不是"多个对象的同一批字段互相对齐比较"这件事——后者是一种新的呈现形态（表格式跨对象对比），没有已有条文可以自然容纳，故独立成条而不是给某个既有 REQ 加子款。
```

### 1c. `## 批准状态` 节追加一行（`## 批准状态` 是本文件全局唯一标题，直接在该节末尾追加，无需担心误锚）

```
- 用户确认：2026-09-18，CR-20260918-competitor-board（L2）R1：用户在 INPUT-2026-09-18-001 第 7 条要求"新增一页友商看板，支持将友商的产品参数，规格，放在同一个表格上进行对比分析，并每个维度给出评价总结。同样支持对话控制"，并在 INPUT-2026-09-18-002 中确认该页与第 1 条的行业硬核指标对比页不是同一个；该确认即为本 CR 的推进授权。新增 **REQ-F-243**。逐 CP 方案见「变更响应 · CR-20260918-competitor-board」。
```

---

## 目标文件二：`project/02_solution/架构设计说明书.md`

### 2a. DEC 表新增一行（表头 7 列：`DEC-ID | 关联需求 | 决策正文 | 否决方案 | 否决理由 | 代价/残留风险 | 批准状态`，紧接在 DEC-348 之后——若届时 DEC-347/348 已被另外两条并行 CR 占用则顺接在实际最大编号之后，DEC-349 本身的号不变）

```
| DEC-349 | REQ-F-243 | **友商对比表复用既有 `params`，展示屏切换沿用会话态 `stage` 而非持久化 `display_state`**（CR-20260918-competitor-board）：①新组件 `CompetitorBoard.tsx` 读 `GET /api/entities`（已有路由，零新增接口），筛 `kind === "competitor"` 的对象，按各自 `params` 名称并集列维度、每个友商一列，不提供任何写入口；②`DisplayStage`（`src/lib/ui-events.ts`）与 `ChatDelta` 的 `display_stage` 变体并列新增 `"competitor-board"` 一项——两处字面量联合类型历来独立声明、必须同步改，是本仓库已知的重复声明反模式；③新增工具 `show_competitor_board`，与既有 `show_board` 同形：先 `store.setDisplayState({kind:"home", refId:null})` 清掉可能残留的持久态洞察，再发 `{type:"display_stage", stage:"competitor-board"}` 事件触发切换，不写数据库；④逐维度"评价总结"不设新字段、不持久化——模型已有 `list_entities`/`read_entity` 可读同一份 `params`，评价属于判断而非事实，交给对话现场作答，避免"表格里的结论与最新参数不同步"这一后患无穷的一致性问题。 | A. 新起一套独立的"产品规格"数据模型存友商参数——否决：`params` 已是跟踪对象的技术脊梁（`entities.ts` 明确写着用户 2026-09-12"我是技术方，不是市场方"），另起一份等于让同一份事实有两个可能不一致的副本；B. 评价总结落一个新字段持久化——否决：需要回答"谁写的、何时过期、要不要跟参数变化自动失效"，而模型已能看到同一份数据，落库只会制造"表格结论与最新参数脱节"的隐患；C. 展示屏切换新增第四个持久化 `display_state.kind` 值——否决：与 `CR-20260912-display-stage` 否决"把 board 做成持久态"的理由完全一致，一个常驻的友商看板会和 `show_home`/`show_insight` 的持久态互相打架。 | 见决策正文内各方案否决理由。 | ①`CompetitorBoard` 是纯读取组件，`params` 的写入路径（增删改）不变，不新增攻击面；②`stage` 联合类型的双处声明若未来只改一处会漂移，已在两处代码注释里互相点名；③会话态 `stage` 不跨会话持久，用户刷新页面或换标签页后友商看板需要重新由对话唤起，这是延续 `show_board` 的既有行为，不是本 CR 引入的新限制。 | APPROVED（R1 已终裁；INPUT-2026-09-18-001 第 7 条 + INPUT-2026-09-18-002） |
```

### 2b. 新增小节 `## 变更响应 · CR-20260918-competitor-board`（锚点同 1b，插在最后一个既有 `## 变更响应 · CR-*` 之后、`## 批准状态` 之前）

```markdown
## 变更响应 · CR-20260918-competitor-board

快车道（DEC-021 ①）：唯一 CP 双向门且有机器检查。**无 schema 变更、零新增运行依赖、无新增出网面**——用的是既有的 `GET /api/entities`。

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 友商看板 | DEC-349 | 新增 | 新增 DEC-349 |
```

### 2c. `## 批准状态` 节追加一行

```
- CR-20260918-competitor-board（R2，快车道）：新增 **DEC-349**（友商对比表复用既有 `params`；展示屏切换沿用会话态 `stage`；评价总结不持久化）。逐 CP 方案见「变更响应 · CR-20260918-competitor-board」。
```

---

## 目标文件三：`project/03_modules/模块任务开发说明书.md`

### 3a. 任务总览表新增一行（表头 7 列：`任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试`）

```
| TASK-456 | MOD-DISPLAY / MOD-TOOLS | **友商看板**（DEC-349，CP-1）：新增 `src/components/CompetitorBoard.tsx`（读 `/api/entities`，按 `kind==="competitor"` 过滤，`params` 名称并集排维度行，缺值占位符）；`src/lib/tools/display-tools.ts` 新增 `show_competitor_board` 工具（`show_board` 同形：清持久态 + 发 `display_stage` 事件）；`src/lib/ui-events.ts` 的 `DisplayStage` 与 `src/lib/types.ts` 的 `ChatDelta.display_stage` 并列新增 `"competitor-board"`；`src/components/DisplayScreen.tsx` 新增对应渲染分支，`stage` 事件监听收纳该取值。 | DONE | 无 | REQ-F-243, DEC-349 | TEST-456 |
```

### 3b. 新增小节 `## 变更响应 · CR-20260918-competitor-board`（锚点同上）

```markdown
## 变更响应 · CR-20260918-competitor-board

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 友商看板 | TASK-456 | 新增 | 新增 TASK-456 |
```

### 3c. `## 批准状态`（或本文件等价的登记节，命名请以合并时刻的实际标题为准）追加一行

```
- CR-20260918-competitor-board（R3）：新增 **TASK-456**（友商看板：对比组件 + 唤起工具 + 展示屏接线）。逐 CP 方案见「变更响应 · CR-20260918-competitor-board」。
```

---

## 目标文件四：`project/04_tests/测试说明书.md`

### 4a. 测试矩阵新增一行（表头 7 列：`测试 ID | 类型 | 覆盖需求 | 覆盖模块/任务 | 断言目标 | 命令 | 必选`）

```
| TEST-456 | Unit + Component（含机器（UI）） | REQ-F-243 | MOD-DISPLAY / TASK-456 | ①`show_competitor_board` 执行后返回 `events:[{type:"display_stage",stage:"competitor-board"}]`、且 `store.getDisplayState().kind` 仍为 `"home"`（不新增持久态，`tests/tool-suites.test.ts`）；②`DisplayScreen` 收到 `competitor-board` 阶段事件后渲染 `.display-screen--competitor-board`，收到 `opening` 能退回标题页（非单程票），持久化的 `insight` 仍压过该阶段（`tests/stage-reach.test.tsx` ⑥，`fireEvent`/`dispatchEvent` 驱动）；③`CompetitorBoard` 组件：多友商按参数名并集排维度行、逐家一列、缺值显占位符；零友商与"友商都没登记参数"两种空态各自给出说明文字而非空白；读取失败给出 `role="alert"` 提示（`tests/competitor-board.test.tsx`，4 例）。 | `npx vitest run tests/tool-suites.test.ts tests/stage-reach.test.tsx tests/competitor-board.test.tsx` | 是 |
```

### 4b. 新增小节 `## 变更响应 · CR-20260918-competitor-board`（锚点同上）

```markdown
## 变更响应 · CR-20260918-competitor-board

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 友商看板 | TEST-456 | 新增 | 新增 TEST-456 |

**真实入口**：`scripts/probe-competitor-board.mjs`（已写好，本 CR 按 fork 边界未执行——不得触碰共享的 3000 端口生产服务）。核对三件事：真实模型调用 `show_competitor_board` 后动态屏能否切到友商看板；表格列头是否与 `/api/entities` 当下的真实友商标题一致；若真实数据里恰好有两家以上友商共享同一参数名，该维度行两边的值是否都对得上源数据（没有真实的共享维度则如实跳过，不伪造场景）。留给合并会话或用户在 `build:local`/`serve:local` 上执行。
```

### 4c. `## 批准状态`（或本文件等价的登记节）追加一行

```
- CR-20260918-competitor-board（R4）：新增 **TEST-456**（友商看板：工具事件 + 展示屏阶段可达性 + 组件渲染四态；真实入口探针已写未跑）。逐 CP 方案见「变更响应 · CR-20260918-competitor-board」。
```

---

## 落笔前后的核对清单（给合并会话）

1. 落笔前对四份文档各跑一次 `python tools/governance.py check-tables`，确认插入行的单元格数与表头一致（本草稿的列数已经按现有表头核对过，但合并时若与另外三条并行 CR 的插入顺序交叠，建议插入后再跑一次）。
2. 四份文档落完之后跑 `python tools/governance.py check-ids`，确认 REQ-F-243 / DEC-349 / TASK-456 / TEST-456 与另外三条并行 CR 声明的区间不重叠。
3. 落完 `## 变更响应` 小节后，别忘记 DEC-270 守的那件事——四份文档各自的登记节（`## 批准状态`，模块/测试说明书里可能是同名或等价小节，请核对实际标题）都要有一行指向新小节，否则 `check-approval-log` FAIL。
4. `docs/INDEX.md` 由 `npm run docs:index` 生成，不要手工誊抄本文件的内容进去——落完四份说明书后重新生成一次即可。
5. `project/05_evidence/EV-2026-09-18-competitor-board.md`（已随本 CR 一起提交在 worktree 里，非共享文档，不受本文件约束）已记录本 fork 内的类型检查与测试结果；合并后请补一次 `gate g3`/`g3.5` 全量结果。
