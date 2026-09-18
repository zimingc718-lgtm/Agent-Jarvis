# SPEC_DRAFT — CR-20260918-org-chart-board

本文件是四份受控说明书（+ test-results.json + docs/INDEX.md）的**待落笔内容**，供协调会话在合并阶段
手工落进对应文件——本 CR 按 fork 边界不直接编辑这些共享文件。插入前请先 `check-ids` 核对
REQ-F-260 / DEC-370 / TASK-480 / TEST-480 届时仍未被其它并行 CR（`change-history-and-sources`、
`industry-spec-comparison`）占用——三者分配的号段本就互不重叠（260/370/480 系列 vs 244+/350+/457+
vs 250+/360+/470+），仅作双重确认。

---

## 目标文件一：`project/01_specification/产品需求说明书.md`

### 1a. `## 功能需求` 表新增一行（表头：`| ID | 名称 | 优先级 | 描述 | 验收标准 | 状态 |`）

```
| REQ-F-260 | 组织架构/研发阵型看板 | MUST | 已跟踪对象（公司）下的人员——姓名、岗位、团队/阵型、简介、头像——可结构化登记并按公司/团队分组显示在一个可由对话唤起的展示屏视图里；数据随时间动态更新，不是一次性静态洞察。 | ①存在一个可由对话唤起的展示屏视图，按公司分区、同公司内按团队/阵型分组显示已登记人员；没有任何数据时如实显示空态说明，不报错、不留白；②人员信息的写入必须附来源链接，来源不在该公司已登记采集源之列时进入待采纳区，用户采纳后才生效——与技术参数（REQ-F-072）同一条证据纪律；③头像以外部链接形式显示，链接缺失或加载失败时以姓名首字兜底，不留破图标；④"对话创建一份公司洞察、固化显示在动态屏"由既有 `save_insight`/`show_insight`（REQ-F-032）机制覆盖，本条不重复规定。 | APPROVED（CR-20260918-org-chart-board，R1 已终裁：INPUT-2026-09-18-001 第 8 条 + INPUT-2026-09-18-002 第④点确认为结构化、可动态跟踪的数据） |
```

### 1b. 新增小节 `## 变更响应 · CR-20260918-org-chart-board`

锚点：插在既有最后一个 `## 变更响应 · CR-*` 小节之后、`## 批准状态` 之前（用
`re.search(r"(?m)^## 批准状态$")` 定位，不要用字符串 `.replace`）。

```markdown
## 变更响应 · CR-20260918-org-chart-board

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 组织架构数据模型 | REQ-F-260（新增） | 新增 | 新增 REQ-F-260 |
| CP-2 组织架构看板 | REQ-F-260（新增） | 新增 | 同上，不重复占号 |

**为什么是新增 REQ 而不是并进已有条目**：`params`（REQ-F-072）描述的是"一个对象自己的技术规格"，
人员/组织架构是"这个对象内部由谁构成"——两者都挂在同一个跟踪对象上，但回答的是不同的问题，没有
已有条文能自然容纳后者，故独立成条。
```

### 1c. `## 批准状态` 节追加一行

```
- 用户确认：2026-09-18，CR-20260918-org-chart-board（L2，快车道）R1：用户在 INPUT-2026-09-18-001 第 8 条要求"新增公司组织架构和研发阵型等看板，支持对话查看一个公司的组织架构及研发阵型，具体到人名，岗位，简介。对话可以创建对一个公司的洞察，然后固化显示在动态屏。可以先以维谛为例"，并在 INPUT-2026-09-18-002 第④点确认为"动态跟踪，但是也有组织结构图，人名，岗位，简介，头像等"——结构化、可持续更新的数据。新增 **REQ-F-260**。逐 CP 方案见「变更响应 · CR-20260918-org-chart-board」。
```

---

## 目标文件二：`project/02_solution/架构设计说明书.md`

### 2a. DEC 表新增一行（表头 7 列：`DEC-ID | 关联需求 | 决策正文 | 否决方案 | 否决理由 | 代价/残留风险 | 批准状态`，紧接在届时最大的既有 DEC 编号之后——DEC-370 本身的号不变）

```
| DEC-370 | REQ-F-260 | **组织架构数据挂在公司实体上、复用既有证据闸；头像用外链不做本地托管；展示屏切换沿用会话态**（CR-20260918-org-chart-board）：①`entities.ts` 新增 `Person`（name/title/team/avatarUrl/bio）与 `people: Person[]` 字段，`setPerson`/`removePerson` 与 `setParam`/`removeParam` 同形（同名匹配即更新、证据按 `person:<name>` 归档、删除带走证据）；②`entity-proposals.ts` 的 `EntityUpdateProposal.kind` 新增 `"person"`（`value` 为 JSON 序列化字段），`entity-tools.ts` 新增 `propose_person` 工具，复用 `propose_entity_update` 的"来源受信才直接生效、否则进待采纳区"评审闸——人员数据获得与技术参数完全相同的证据纪律；同时修正 `adoptProposal` 原先把非 `"param"` 一律折回 `"field"` 的重建逻辑，否则 person 提议在被采纳时会被错误路由并报错；③头像 (`avatarUrl`) 是纯字符串外链，不下载/不本地存储字节——组织架构数据模型本身、审批闸扩展、展示屏新视图已经是三件事，"存储与展示图片"是本仓库从未有过的第四种能力（用户 2026-09-18 原话："首次引入…工作量与第 9a 条（Railway 部署）相当"），本次不叠加；④展示屏新增 `OrgChartBoard.tsx`（读 `GET /api/entities`，按公司分区、团队分组），`show_org_chart_board` 工具与 `show_board`/`show_competitor_board` 同形（会话态 `DisplayStage` 切换，不持久化），`DisplayStage`/`ChatDelta.display_stage` 并列新增 `"org-chart-board"`。 | A. 人是独立于公司的一等对象（跨公司人物库）；B. 人员数据写进 `body` 自由文本，不结构化；C. 下载并本地托管头像字节；D. 持久化 `display_state` 的第四个 kind；E. 可交互的图形化组织架构树（带汇报关系连线） | A：用户的请求是"查看一个公司的组织架构"，没有跨公司查人的用例，试点对象"维谛"本身已是既有 `competitor` 实体，人只在公司语境下有意义；B：用户明确要求"翻页/分类统计"式的结构化枚举（人名/岗位/简介/头像），自由文本没有稳定字段可供展示屏渲染；C：本仓库第一次出现图片存储需求，与本 CR 其余两件事叠加会让一个 CR 承担两个量级相当的新能力，等链接失效成为真问题时再单独立项；D：与 `CR-20260912-display-stage`、同批次 `CR-20260918-competitor-board`（DEC-349）否决"持久态 board"的理由完全一致；E：用户原文是"看板"不是"树状图"，按团队分组的卡片列表已回答"研发阵型是怎样的"，图形树是明显更大的投入且未被要求。 | ①`avatarUrl` 外链意味着链接失效、跨域加载失败均由前端 `onError` 兜底为姓名首字，不保证头像长期可用；②`propose_person` 的证据闸只能核实"来源是否在该公司已登记来源之列"，不能核实来源内容是否准确描述真实组织架构，与 `params` 面对的既有局限相同；③`EntityUpdateProposal.kind` 的第三个分支意味着未来任何读取该文件的代码都要记得处理三种 kind 而非两种，已在类型定义与两处分支逻辑的注释里明确标注。 | APPROVED（R1 已终裁；INPUT-2026-09-18-001 第 8 条 + INPUT-2026-09-18-002 第④点） |
```

### 2b. 新增小节 `## 变更响应 · CR-20260918-org-chart-board`（锚点同 1b）

```markdown
## 变更响应 · CR-20260918-org-chart-board

快车道（DEC-021 ①）：两个 CP 均双向门且均有机器检查。**无 schema 变更（新增字段向后兼容，旧文件按空数组读取）、零新增运行依赖、无新增出网面**（`avatarUrl` 由浏览器 `<img>` 直接请求，不经服务端代理）。

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 组织架构数据模型 | DEC-370 | 新增 | 新增 DEC-370 |
| CP-2 组织架构看板 | DEC-370 | 新增 | 同上，不重复占号 |
```

### 2c. `## 批准状态` 节追加一行

```
- CR-20260918-org-chart-board（R2，快车道）：新增 **DEC-370**（组织架构数据挂在公司实体上、复用既有证据闸；头像外链不本地托管；展示屏切换沿用会话态）。逐 CP 方案见「变更响应 · CR-20260918-org-chart-board」。
```

---

## 目标文件三：`project/03_modules/模块任务开发说明书.md`

### 3a. 任务总览表新增一行（表头 7 列：`任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试`）

```
| TASK-480 | MOD-ENTITIES / MOD-TOOLS / MOD-DISPLAY | **组织架构/研发阵型看板**（DEC-370，CP-1+CP-2）：`entities.ts` 新增 `Person`/`people` 字段与 `setPerson`/`removePerson`；`entity-proposals.ts` 新增 `kind:"person"` 分支并修正 `adoptProposal` 的 kind 重建逻辑；`entity-tools.ts` 新增 `propose_person` 工具，扩展 `list_entities`/`read_entity` 输出；`display-tools.ts` 新增 `show_org_chart_board`；`ui-events.ts`/`types.ts` 的 `DisplayStage`/`ChatDelta.display_stage` 并列新增 `"org-chart-board"`；新增 `src/components/OrgChartBoard.tsx`；`DisplayScreen.tsx` 新增对应渲染分支与事件监听收纳。 | DONE | 无 | REQ-F-260, DEC-370 | TEST-480 |
```

### 3b. 新增小节 `## 变更响应 · CR-20260918-org-chart-board`（锚点同上）

```markdown
## 变更响应 · CR-20260918-org-chart-board

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 组织架构数据模型 | TASK-480 | 新增 | 新增 TASK-480 |
| CP-2 组织架构看板 | TASK-480 | 新增 | 同上，不重复占号 |
```

### 3c. `## 批准状态`（或本文件等价的登记节，命名请以合并时刻的实际标题为准）追加一行

```
- CR-20260918-org-chart-board（R3）：新增 **TASK-480**（组织架构数据模型 + 看板：Person 字段/证据闸扩展/展示屏接线）。逐 CP 方案见「变更响应 · CR-20260918-org-chart-board」。
```

---

## 目标文件四：`project/04_tests/测试说明书.md`

### 4a. 测试矩阵新增一行（表头 7 列：`测试 ID | 类型 | 覆盖需求 | 覆盖模块/任务 | 断言目标 | 命令 | 必选`）

```
| TEST-480 | Unit + Component（含机器（UI）） | REQ-F-260 | MOD-ENTITIES / MOD-TOOLS / MOD-DISPLAY / TASK-480 | ①`setPerson`/`removePerson` 写入即落 frontmatter、同名更新保留未给字段、证据按 `person:<name>` 归档并随删除清走、与技术参数各自独立命名空间不互相覆盖证据、手写半行兼容、条数与命名上限、简介允许含「\|」（`tests/entities.test.ts`，7 例）；②`propose_person` 缺参数拒绝、来源受信判定、同名更新、`adoptProposal` 的 kind 重建正确性、对象不存在/链接非法回喂（`tests/entity-tools.test.ts`，4 例）；③`OrgChartBoard` 按公司分区/团队分组、无团队兜底、空态、头像兜底与渲染、读取失败提示（`tests/org-chart-board.test.tsx`，6 例）；④`show_org_chart_board` 执行后返回 `events:[{type:"display_stage",stage:"org-chart-board"}]` 且不新增持久态（`tests/tool-suites.test.ts`，1 例）；⑤`DisplayScreen` 阶段可达性与洞察优先级不变（`tests/stage-reach.test.tsx` ⑥，1 例）。 | `npx vitest run tests/entities.test.ts tests/entity-tools.test.ts tests/org-chart-board.test.tsx tests/tool-suites.test.ts tests/stage-reach.test.tsx` | 是 |
```

### 4b. 新增小节 `## 变更响应 · CR-20260918-org-chart-board`（锚点同上）

```markdown
## 变更响应 · CR-20260918-org-chart-board

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 组织架构数据模型 | TEST-480 | 新增 | 新增 TEST-480 |
| CP-2 组织架构看板 | TEST-480 | 新增 | 同上，不重复占号 |

**真实入口**：`scripts/probe-org-chart-board.mjs`（已写好，本 CR 按并行边界未执行——不得触碰共享的
3000 端口生产服务）。核对两件事：①展示屏能否由对话切到组织架构看板（空态也是合法通过条件）；
②`propose_person` 在来源不受信时是否正确进入待采纳区、不直接写入。脚本刻意避免向用户真实的
"维谛"对象写入编造数据（用几乎不可能已注册的来源域逼待采纳分支，并尝试自行清理测试记录），留给
协调会话或用户在 `build:local`/`serve:local` 上执行。

### 人工发现项

`propose_person` 的证据闸只能核实"来源是否在该公司已登记来源之列"，不能核实来源内容本身是否
准确描述真实组织架构——与既有 `params`（技术参数）面对的局限相同，如实登记，不用宽松断言伪装成
已覆盖。
```

### 4c. `## 批准状态`（或本文件等价的登记节）追加一行

```
- CR-20260918-org-chart-board（R4）：新增 **TEST-480**（组织架构数据模型 + 看板：18 个新增用例，本地全量 91 文件/850 例绿；真实入口探针已写未跑）。逐 CP 方案见「变更响应 · CR-20260918-org-chart-board」。
```

---

## 目标文件五：`project/05_evidence/test-results.json`

### 5.1 `tests` 数组追加一条（TEST-480，已实际跑过、真实 PASS）

```json
{
  "id": "TEST-480",
  "result": "PASS",
  "command": "npx vitest run tests/entities.test.ts tests/entity-tools.test.ts tests/org-chart-board.test.tsx tests/tool-suites.test.ts tests/stage-reach.test.tsx",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "组织架构/研发阵型看板（REQ-F-260）。18 个新增/改动用例；本地全量 91 个测试文件、850 个用例绿（二次确认）。首次全量跑发现并修正一处本 CR 真实引入的回归：tests/ingest-extract-chain.test.ts 用固定数组下标取 createEntityTools() 的工具，本 CR 插入新工具后下标错位，已改为按工具名查找并同步加固 entity-tools.test.ts 的同类写法。真实入口 TEST-480（scripts/probe-org-chart-board.mjs）已写好，按并行 CR 的编排边界未在本分支执行，见测试说明书「变更响应 · CR-20260918-org-chart-board」。"
}
```

### 5.2 `change_records` 数组追加一条字符串

```json
"CR-20260918-org-chart-board"
```

### 5.3 `executed_commands` 数组追加

```json
"npx tsc --noEmit -p .  (OK 0 错误)",
"npx vitest run  (二次确认 OK：91 个测试文件、850 个用例全绿；首次跑出的 3 个失败中 2 个为已知资源争用 flake，1 个为本 CR 引入并已修正的固定数组下标回归，详见 EV-2026-09-18-org-chart-board.md §2)"
```

---

## 目标文件六：`docs/INDEX.md`

**不手写内容**——由 `npm run docs:index` 生成，`check-index` 做逐字节比对。待五份文档全部落笔后统一
重新生成一次。

---

## 落笔前后的核对清单（给协调会话）

1. 落笔前对四份文档各跑一次 `python tools/governance.py check-tables`，确认插入行的单元格数与表头一致。
2. 四份文档落完之后跑 `python tools/governance.py check-ids`，确认 REQ-F-260 / DEC-370 / TASK-480 / TEST-480 与 `change-history-and-sources`（244+/350+/457+）、`industry-spec-comparison`（250+/360+/470+）两条并行 CR 声明的区间不重叠。
3. 落完 `## 变更响应` 小节后，四份文档各自的登记节都要有一行指向新小节，否则 `check-approval-log` FAIL。
4. `npm run docs:index` 重新生成 `docs/INDEX.md`。
5. **`DisplayScreen.tsx`/`ui-events.ts`/`types.ts` 与 Wave 1 `CR-20260918-competitor-board`、`CR-20260918-unified-floating-console` 的合并顺序**：三者都各自往 `DisplayStage` 联合类型追加新取值、往 `DisplayScreen.tsx` 追加新渲染分支——理论上互不冲突（取值不同、追加的代码块不同），但协调会话需要在全部合并完成后确认：①联合类型同时含 `"competitor-board"` 与 `"org-chart-board"` 两个新取值；②`DisplayScreen.tsx` 的阶段事件监听分支同时认得两个新阶段；③本 CR 新增的 `org-chart-board` 渲染分支需要像 `competitor-board` 那样，手工从 `fixed inset-x-0 top-0` + `style bottom` 同步成 `unified-floating-console` 建立的新约定 `fixed inset-0`（详见 CR 文档「并行事项说明」）。这一步不属于任何一条 CR 的变化点，是纯粹的合并期一致性维护。
6. 各条并行 CR 的 `main 合并各分支 → snapshot → 合并回 main` 顺序按 CLAUDE.md 第三节执行，snapshot 全流程只跑一次。
