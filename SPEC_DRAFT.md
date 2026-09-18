# SPEC_DRAFT — CR-20260918-industry-spec-comparison

本文件是四份受控说明书（+ test-results.json + docs/INDEX.md）的**待落笔内容**，供编排会话在合并阶段
手工落进对应文件。本 fork 按边界不直接编辑这些共享文件。落笔前先 `check-ids` 核对 REQ-F-250 /
DEC-360 / TASK-470 / TEST-470 仍未被其它并行 CR（含姊妹 Wave-2 分支 `CR-20260918-change-history-and-
sources`，占用 DEC-350+/TASK-457+/REQ-F-244+）占用。

---

## ① project/01_specification/产品需求说明书.md

**定位**：REQ-F-243（若 `CR-20260918-competitor-board` 已先落笔）或 REQ-F-242（若未落笔）所在行之后，
「功能需求」表末尾附近，按编号顺序追加一行。

```
| REQ-F-250 | 行业技术指标对比 | MUST | 友商、规则与准入方、客户三类跟踪对象的技术参数/门槛要求，按维度对齐显示在同一张表格里，支持对话唤起；与「友商看板」（REQ-F-243）不是同一个页面——这一页范围更广，不限于友商，且逐维度不预置评价。 | ①存在一个可由对话唤起的展示屏视图，列出全部已跟踪的 `kind∈{competitor,authority,customer}` 对象；②对比维度取自各对象已登记的技术参数（`params`）名称并集，缺该维度的对象显示占位符而非报错或留空；③列头标注每个对象的 `kind`，便于区分"产品规格"与"门槛要求"；④视图不提供参数的增删改入口；⑤视图不显示 `Param.status`（是否满足）——是否显示留作开放问题，见 CR 文档「非目标 / 开放问题」，本条验收不要求它出现，也不禁止未来的修订加上它。 | APPROVED（CR-20260918-industry-spec-comparison，R1 已终裁：INPUT-2026-09-18-001 第 1 条 + INPUT-2026-09-18-002 确认与第 7 条「友商看板」不是同一个页面、包含客户） |
```

### 1b. 新增小节 `## 变更响应 · CR-20260918-industry-spec-comparison`

锚点：插在既有最后一个 `## 变更响应 · CR-*` 小节之后、`## 批准状态` 之前（`re.search(r"(?m)^## 批准状态$")` 定位，不要用字符串 `.replace`）。

```markdown
## 变更响应 · CR-20260918-industry-spec-comparison

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 行业技术指标对比 | REQ-F-250（新增） | 新增 | 新增 REQ-F-250 |

**为什么是新增 REQ 而不是并进 REQ-F-243（友商看板）**：两者形态相似（都是跨对象的维度对齐对比表），但覆盖范围不同——REQ-F-243 限定已跟踪友商，REQ-F-250 覆盖三类跟踪对象且用户已明确两者"不是同一个页面"（INPUT-2026-09-18-002），把它们并成一条会掩盖这个明确的产品边界。
```

### 1c. `## 批准状态` 节追加一行

```
- 用户确认：2026-09-18，CR-20260918-industry-spec-comparison（L2）R1：用户在 INPUT-2026-09-18-001 第 1 条要求"友商/准入/客户卡片的技术指标移出，另立一页做行业技术指标对比"，并在 INPUT-2026-09-18-002 中确认该页与第 7 条"友商看板"不是同一个、包含客户。新增 **REQ-F-250**。逐 CP 方案见「变更响应 · CR-20260918-industry-spec-comparison」。
```

---

## ② project/02_solution/架构设计说明书.md

**2.1 决策日志新增一行**（定位：本 CR 落笔时刻的实际最大 DEC 编号之后追加，DEC-360 本身的号不变）：

```
| DEC-360 | REQ-F-250 | **行业技术指标对比复用既有 `params`，三类实体全纳入，展示屏切换沿用会话态 `stage`**（CR-20260918-industry-spec-comparison）：①新组件 `IndustrySpecComparison.tsx` 读 `GET /api/entities`（已有路由，零新增接口），不按单一 `kind` 过滤——`competitor`/`authority`/`customer` 三类都纳入，按各自 `params` 名称并集列维度，列头标注 `kind`，不提供任何写入口；②`DisplayStage`（`src/lib/ui-events.ts`）与 `ChatDelta` 的 `display_stage` 变体并列新增 `"industry-spec-comparison"` 一项；③新增工具 `show_industry_spec_comparison`，与既有 `show_board`/`show_competitor_board` 同形：先清空持久态、再发 `display_stage` 事件，不写数据库；④刻意不显示 `Param.status`（是否满足）——如实标注为产品呈现层面的开放问题而非代码限制，见「代价/残留风险」。 | A. 新起一套独立的"行业硬核指标"数据集，与 `params` 分开存 | 否决：`params` 已是三类实体共享的技术数据字段（`entities.ts` 里 `kind` 与 `params` 同层级，不分叉），另起一份会制造第二份可能与 `params` 不同步的副本，与 `CR-20260918-competitor-board`（DEC-349）否决同一类方案的理由完全一致 | ①范围问题：是否纳入"规则与准入方"未经用户逐字确认，是本 CR 依据 INPUT-2026-09-18-001 第 1 条原文分组做出的推断，如实登记，非独立确认；②`Param.status` 是否入表是留给用户的开放问题，当前默认不显示；③会话态 `stage` 不跨会话持久，用户刷新页面后该视图需要重新由对话唤起，延续 `show_board`/`show_competitor_board` 的既有行为。 | APPROVED（R1 已终裁；INPUT-2026-09-18-001 第 1 条 + INPUT-2026-09-18-002） |
```

### 2b. 新增小节 `## 变更响应 · CR-20260918-industry-spec-comparison`

```markdown
## 变更响应 · CR-20260918-industry-spec-comparison

快车道（DEC-021 ①）：唯一 CP 双向门且有机器检查。**无 schema 变更、零新增运行依赖、无新增出网面**——用的是既有的 `GET /api/entities`。

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 行业技术指标对比 | DEC-360 | 新增 | 新增 DEC-360 |
```

### 2c. `## 批准状态` 节追加一行

```
- CR-20260918-industry-spec-comparison（R2，快车道）：新增 **DEC-360**（行业技术指标对比复用既有 `params`；三类实体全纳入；`status` 是否入表留作开放问题）。逐 CP 方案见「变更响应 · CR-20260918-industry-spec-comparison」。
```

---

## ③ project/03_modules/模块任务开发说明书.md

**3.1 任务总览表新增一行**：

```
| TASK-470 | MOD-DISPLAY / MOD-TOOLS | **行业技术指标对比**（DEC-360，CP-1）：新增 `src/components/IndustrySpecComparison.tsx`（读 `/api/entities`，三类 `kind` 全纳入，`params` 名称并集排维度行，列头标注 `kind`，缺值占位符）；`src/lib/tools/display-tools.ts` 新增 `show_industry_spec_comparison` 工具（与 `show_board`/`show_competitor_board` 同形）；`src/lib/ui-events.ts` 的 `DisplayStage` 与 `src/lib/types.ts` 的 `ChatDelta.display_stage` 并列新增 `"industry-spec-comparison"`；`src/components/DisplayScreen.tsx` 新增对应渲染分支，`stage` 事件监听收纳该取值。 | DONE | 无 | REQ-F-250, DEC-360 | TEST-470 |
```

### 3b. 新增小节 `## 变更响应 · CR-20260918-industry-spec-comparison`

```markdown
## 变更响应 · CR-20260918-industry-spec-comparison

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 行业技术指标对比 | TASK-470 | 新增 | 新增 TASK-470 |
```

### 3c. `## 批准状态`（或本文件等价的登记节）追加一行

```
- CR-20260918-industry-spec-comparison（R3）：新增 **TASK-470**（行业技术指标对比：跨三类实体的对比组件 + 唤起工具 + 展示屏接线）。逐 CP 方案见「变更响应 · CR-20260918-industry-spec-comparison」。
```

---

## ④ project/04_tests/测试说明书.md

**4.1 测试矩阵新增一行**：

```
| TEST-470 | Unit + Component（含机器（UI）） | REQ-F-250 | MOD-DISPLAY / TASK-470 | ①`IndustrySpecComparison`：三类实体同表按维度并集对齐、列头标注 kind、缺值占位符；零实体/零参数两种空态各自给出说明文字；读取失败给出 `role="alert"`（`tests/industry-spec-comparison.test.tsx`，4 例）；②`show_industry_spec_comparison` 执行后返回 `events:[{type:"display_stage",stage:"industry-spec-comparison"}]`，且不改变持久态 `display_state.kind`（`tests/tool-suites.test.ts`）；③`DisplayScreen` 收到该阶段事件后渲染 `.display-screen--industry-spec-comparison`，收到 `opening` 能退回标题页，持久化的 `insight` 仍压过该阶段（`tests/stage-reach.test.tsx` ⑥）。 | `npx vitest run tests/industry-spec-comparison.test.tsx tests/tool-suites.test.ts tests/stage-reach.test.tsx` | 是 |
```

### 4b. 新增小节 `## 变更响应 · CR-20260918-industry-spec-comparison`

```markdown
## 变更响应 · CR-20260918-industry-spec-comparison

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 行业技术指标对比 | TEST-470 | 新增 | 新增 TEST-470 |

**真实入口**：`scripts/probe-industry-spec-comparison.mjs`（已写好，本 CR 按边界未执行——不得触碰共享的 3000 端口生产服务）。核对：真实模型调用 `show_industry_spec_comparison` 后动态屏能否切到对比页；渲染出表格时表头是否出现 kind 标签。留给编排会话或用户在 `build:local`/`serve:local` 上执行。
```

### 4c. `## 批准状态`（或本文件等价的登记节）追加一行

```
- CR-20260918-industry-spec-comparison（R4）：新增 **TEST-470**（行业技术指标对比：组件渲染四态 + 工具事件 + 展示屏阶段可达性；真实入口探针已写未跑）。逐 CP 方案见「变更响应 · CR-20260918-industry-spec-comparison」。
```

---

## ⑤ project/05_evidence/test-results.json

**5.1 `tests` 数组追加一条**（TEST-470，已实际跑过、真实 PASS）：

```json
{
  "id": "TEST-470",
  "result": "PASS",
  "command": "npx vitest run tests/industry-spec-comparison.test.tsx tests/tool-suites.test.ts tests/stage-reach.test.tsx",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "行业技术指标对比（REQ-F-250）。全量 91 个测试文件、838 个用例绿。真实入口（scripts/probe-industry-spec-comparison.mjs）已写好，按并行 CR 的编排边界未在本分支执行，见测试说明书「变更响应 · CR-20260918-industry-spec-comparison」。"
}
```

**5.2 `change_records` 数组追加一条字符串**：

```json
"CR-20260918-industry-spec-comparison"
```

**5.3 `executed_commands` 数组追加**：

```json
"npx tsc --noEmit -p .  (OK 0 错误)",
"npx vitest run  (OK 91 个测试文件、838 个用例全绿)",
"node scripts/ui-contract.mjs  (OK 53 项全过)",
"node scripts/check-module-graph.mjs  (OK 113 文件，0 环、0 分层违规)"
```

---

## ⑥ docs/INDEX.md

**不手写内容**——由 `npm run docs:index` 生成。待四份说明书全部落笔后统一重新生成一次。

---

## 落笔前后的核对清单（给编排会话）

1. `python tools/governance.py check-ids` —— 确认 REQ-F-250/DEC-360/TASK-470/TEST-470 与其它并行 CR（含姊妹 Wave-2 分支）的占用 ID 不重叠。
2. `python tools/governance.py check-tables` —— 各处表格改动列数与表头一致。
3. `python tools/governance.py check-specs` / `check-changes` / `check-doors`。
4. `npm run docs:index` 后 `python tools/governance.py check-index`。
5. **`DisplayScreen.tsx` 合并注意**：本 CR 新增的 `if (stage === "industry-spec-comparison")` 渲染分支沿用本分支基点当时的旧布局约定（`fixed inset-x-0 top-0` + `style bottom var(--jarvis-console-h)`）。若 `CR-20260918-unified-floating-console` 已落地（非首页视图全悬浮），编排会话需要像处理 `competitor-board` 的同名问题那样，把这里也手工改成 `fixed inset-0`、删掉 `style`，保持全站体验一致——这不是本 CR 的变化点，是合并期一致性维护。
6. 与姊妹 Wave-2 分支 `CR-20260918-change-history-and-sources` 的合并顺序不敏感——两者没有共同触碰的源文件（按各自的分工范围），但落笔到四份共享说明书时会互相追加相邻的表行，落笔顺序建议按分支就绪顺序，落完都跑一次 `check-tables`/`check-ids`。
