# SPEC_DRAFT — CR-20260918-unified-floating-console

本文件是四份受控说明书（+ test-results.json + docs/INDEX.md）的**待落笔内容**，供编排会话在合并阶段
手工落进对应文件。本 fork 按边界不直接编辑这些共享文件（四条并行 Wave-1 CR 同时改同一份文件会冲突）。
落笔前先 `check-ids` 核对 DEC-348 / TASK-454 / TASK-455 / TEST-454 / TEST-455 仍未被其它并行 CR 占用。

---

## ① project/01_specification/产品需求说明书.md

**定位**：REQ-F-200 所在行（「功能需求」表，约第 97 行）。

**操作**：整行替换为（④ 改写 + 新增 ⑤ + 状态列追加第三次修订记录；①②③ 原文一字不动）：

```
| REQ-F-200 | 设置界面上动态屏 | MUST | 改设置不必离开正在看的东西：面板开在动态屏上，而不是弹窗盖住报告或看板。 | ①**入口在对话框**：控制台上有「模型 / 技能 / 工具」三个入口，点击把对应面板唤到动态屏上；☰ 抽屉里的既有入口保留，两处唤起的是**同一个组件**，不另写一份；②面板呈现在动态屏上并可「返回」；面板状态是**瞬时的、不落库**——它是「此刻在看什么」，不是「这台机器该显示什么」，落库会让它跨会话粘住；模型设置在服务未就绪时**明说打不开**，不画一个存不了的空表单；③新增**工具面板**：列出系统登记的全部工具，标明本轮是否注册，**未注册的也列出来**（「没注册」与「不存在」对用户是两件事），并给出此刻的判定条件（技能数、知识条数、联网开关、Provider）；判定必须与 `runChatTurn` 走**同一个** `buildRegistry` 与同一份 `ToolContext`，不另写近似逻辑；④**非首页视图全部真悬浮，不再为控制台预留底边**（本条第三次修订，CR-20260918-unified-floating-console）：`DisplayScreen.tsx` 的 `insight`/`document`/`settings`/`board` 四个容器改为与首页一致的 `fixed inset-0`，不再读 `--jarvis-console-h` 让位。2026-09-15 版本（见下方历史）已经把记录区展开时的遮挡范围收窄到控制台自身 768px 宽的 footprint、不再连带遮住两侧无关内容；投入本次修订前的调查确认，这一步收窄的效果与「是否还保留让位」无关——即便让位量降到 0，遮挡范围依旧只是控制台自己的 footprint，2026-09-14 版本要防的「通栏让出一大块」不会复发。收拢态与展开态下，非首页视图与首页今天的实际表现完全一致。⑤**控制台入口合并为一行**（CR-20260918-unified-floating-console）：状态灯、上传、「模型 / 技能 / 工具 / 资料库」四个面板入口、本轮用量，全部在 `.floating-chat__status` 一行内，不再分两行分别呈现。 | APPROVED（CR-20260914-settings-on-display 首版 R1；④ 由 CR-20260915-console-menu-consolidation 第一次修订（收窄发布值）、CR-20260918-unified-floating-console 第二次修订（非首页视图全悬浮，不再让位），R1 均已终裁——本次 R1：用户 2026-09-18「按流程开始第一波的 CR」总授权，INPUT-2026-09-18-001 第 5 条；⑤ 由 CR-20260918-unified-floating-console 新增，同一轮 R1，INPUT-2026-09-18-001 第 6a 条） |
```

---

## ② project/02_solution/架构设计说明书.md

**2.1 决策日志新增一行**（定位：DEC-346 之后，按编号顺序追加）：

```
| DEC-348 | REQ-F-200 ④（修订）, REQ-F-200 ⑤（新增） | **非首页视图全部对齐首页的零让位悬浮；控制台常驻入口合并一行**（CR-20260918-unified-floating-console）：①`DisplayScreen.tsx` 的 `insight`/`document`/`settings`/`board` 四个容器从 `fixed inset-x-0 top-0 z-0` + `style={{ bottom: "var(--jarvis-console-h, 0px)" }}` 改为与首页相同的 `fixed inset-0 z-0`，不再读该 CSS 变量；`FloatingChat.tsx` 里发布 `--jarvis-console-h` 的 `collapsedConsoleHeight` 函数与其 `ResizeObserver` 原样保留（见「代价/残留风险」），只是发布结果暂时没有消费者；②投入实现前专门核查 DEC-240（发布值=控制台整体高度，记录区展开时通栏让出 50–58vh）与 DEC-340（发布值收窄为 `collapsedConsoleHeight(rootHeight, transcriptHeight) = max(0, ceil(rootHeight) - ceil(transcriptHeight))`，恒等于收拢态链路高度、与记录区是否展开无关）的关系：DEC-340 的公式已经独立于「是否还保留让位」解决了 DEC-240 要防的问题——让位量降到 0 不会让通栏遮挡复发，只会让"控制台收拢态 footprint 本就画在那里、再让一次等于让了个寂寞"这个残余的无效让位消失；③`FloatingChat.tsx` 把原本独立成行的「在屏上打开：」文案 + 模型/技能/工具/资料库四个面板按钮 + 条件渲染的 `turnUsage`，从 `.floating-chat__panels` 搬进状态灯/上传所在的 `.floating-chat__status`，删除原 `.floating-chat__panels` 容器；两个尾部元素（`turnUsage`、展开/收起按钮）各自 `ml-auto`，flexbox 下安全（只有先出现且仍有剩余空间的元素才会真正吃到该外边距）；④顺带修正：`FloatingChat.tsx` 与 `tests/floating-chat.test.tsx` 里指向从未登记过的虚构编号「REQ-F-240」的注释/用例名，改正为实际治理该逻辑的 REQ-F-200 ④，不引入新 ID、不改变任何断言或运行时行为。 | A. 维持现状不改；B. 按视图类型区别对待（如报告/看板继续让位，只有设置面板全悬浮）；C. 只用 CSS 视觉近似合并两行入口（缩小行距/负 margin）；D. 合并后再包一层 `justify-between` 容器做左右分组 | A：用户已在 INPUT-2026-09-18-001 明确要求「改为全悬浮」，且调查确认让位已是无效残余机制，维持现状没有继续存在的理由；B：用户原文没有按视图类型区分（看板恰是用户自己点名要悬浮的例子），额外的区别对待规则没有产品依据，是实现者自行发散；C：DOM 仍是两个独立容器，不同视口宽度下换行点不可控，达不到「同一行」；D：现有 DOM 顺序（上传在前，四个面板入口紧随，两个尾部元素各自 `ml-auto`）已是自然的视觉分组，多包一层是本可不必的复杂度。 | ①`collapsedConsoleHeight` 与其 `ResizeObserver` 发布机制保留但暂无消费者——这是有意的范围决定，拆除发布机制本身要触及 REQ-F-200 ④ 已有的独立测试覆盖（4 组纯函数用例 + 1 组挂载接线用例），比本次两个 CP 的范围更大；继续发布不产生开销或副作用，真要清理留给未来一条独立 CR；②「看板」视图的全悬浮改动没有直接的组件测试覆盖——驱动到 `stage === "board"` 需要真实 SQLite + 阶段事件机，工作量与本次改动不成比例，已用代码巡检确认它与其余三个视图使用完全相同的编辑模式，如实登记为人工发现项；③真实入口验证（收拢态/展开态下面板贴底、控制台入口同一行）本次交付时尚未执行，见测试说明书「真实入口」节。 | APPROVED（R1 已终裁；用户 2026-09-18「按流程开始第一波的 CR」总授权，INPUT-2026-09-18-001 第 5、6a 条） |
```

**2.2 新增变更响应小节**（定位：紧接现有最后一条 `## 变更响应 · CR-...` 小节之后追加）：

```markdown
## 变更响应 · CR-20260918-unified-floating-console

快车道（DEC-021 ①）：两个 CP 均双向门且均有机器检查。**无 schema 变更、零新增运行依赖、无新增出网面**。

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 非首页视图全悬浮 | DEC-348 ①② | 新增 | 新增 DEC-348（同时修订 REQ-F-200 ④ 的实现描述——见产品需求说明书） |
| CP-2 控制台入口合并同一行 | DEC-348 ③ | 新增 | 同上，不重复占号 |
```

---

## ③ project/03_modules/模块任务开发说明书.md

**3.1 任务表新增两行**（定位：TASK-451 之后，按编号顺序追加）：

```
| TASK-454 | MOD-DISPLAY | **非首页视图全悬浮**（DEC-348，CP-1）：`DisplayScreen.tsx` 的 `insight`/`document`/`settings`/`board` 四个容器从 `fixed inset-x-0 top-0 z-0` + `style={{ bottom: "var(--jarvis-console-h, 0px)" }}` 改为 `fixed inset-0 z-0`，删除 `style` 属性；`FloatingChat.tsx` 中发布端两处相关注释同步更新（不再声称"展示屏据此让出空间"，改为说明"已无消费者、保留原因、未来可另开 CR 清理"），并顺带把指向虚构编号「REQ-F-240」的注释/用例名改正为 REQ-F-200 ④。 | DONE | 无 | REQ-F-200 ④（修订）, DEC-348 | TEST-454 |
| TASK-455 | MOD-CHAT-UI | **控制台常驻入口合并一行**（DEC-348，CP-2）：`FloatingChat.tsx` 把「在屏上打开：」文案 + 模型/技能/工具/资料库四个面板按钮 + 条件渲染的 `turnUsage`，从独立的 `.floating-chat__panels` 容器搬进 `.floating-chat__status`（状态灯 + 上传所在行），插在既有上传 `DropdownMenu` 之后、原展开/收起按钮之前；删除原 `.floating-chat__panels` 容器。 | DONE | 无 | REQ-F-200 ⑤（新增）, DEC-348 | TEST-455 |
```

**3.2 新增变更响应小节**：

```markdown
## 变更响应 · CR-20260918-unified-floating-console

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 非首页视图全悬浮 | TASK-454 | 新增 | 新增 TASK-454 |
| CP-2 控制台入口合并同一行 | TASK-455 | 新增 | 新增 TASK-455 |
```

---

## ④ project/04_tests/测试说明书.md

**4.1 测试矩阵新增两行**（定位：TEST-451 之后，按编号顺序追加）：

```
| TEST-454 | UI/非首页视图全悬浮（机器（UI）） | REQ-F-200 ④ | MOD-DISPLAY / TASK-454 | `tests/display-screen.test.tsx` ⑧：`render` 驱动 home/insight/document/settings 四种 `DisplayView`，断言容器 `className` 含 `inset-0`、不含 `inset-x-0`，`style` 属性为 `null`（不再读 `--jarvis-console-h`）；`tests/settings-on-display.test.tsx` ⑤ 同步改写（原断言 `bottom: var(--jarvis-console-h, 0px)` 与本次改动直接矛盾，已替换为悬浮态断言）。「看板」视图未被机器覆盖——理由与如实登记见架构设计说明书「变更响应」节「代价/残留风险」列，及本表下方「人工发现项」。 | `npx vitest run tests/display-screen.test.tsx tests/settings-on-display.test.tsx` | 否（jsdom + `render`/`fireEvent`，非真实浏览器；真实浏览器验证见下「真实入口」） |
| TEST-455 | UI/控制台常驻入口合并一行（机器（UI）） | REQ-F-200 ⑤ | MOD-CHAT-UI / TASK-455 | `tests/floating-chat.test.tsx` ③c：`render` 驱动，断言 `.floating-chat__status` 容器内同时含状态灯（`role="status"`）、「上传」按钮、「在屏上打开：」文案、模型/技能/工具/资料库四个可点击按钮；原独立的 `.floating-chat__panels` 容器不再出现。 | `npx vitest run tests/floating-chat.test.tsx` | 否（jsdom + `render`/`fireEvent`，非真实浏览器；真实浏览器验证见下「真实入口」） |
```

**4.2 新增变更响应小节**：

```markdown
## 变更响应 · CR-20260918-unified-floating-console

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 非首页视图全悬浮 | TEST-454 | 新增 | 新增 TEST-454 |
| CP-2 控制台入口合并同一行 | TEST-455 | 新增 | 新增 TEST-455 |

**真实入口**：`scripts/probe-unified-floating-console.mjs`（已写好，本 CR 按并行 Wave-1 的编排边界未在本分支执行——不得触碰共享的 3000 端口生产服务）。核对两件事：①`.floating-chat__status` 一行内能否同时找到状态灯、上传、模型/技能/工具/资料库四个入口；②「资料库」面板在控制台收拢态与展开一次对话后的展开态下，容器 `getBoundingClientRect().bottom` 是否都贴到视口高度（不留让位空白）。留给合并会话或用户在 `build:local`/`serve:local` 上执行，执行前按 DEC-250 记「未执行」。

### 人工发现项

「看板」（`display-screen--board`）视图的全悬浮改动没有直接的机器覆盖——驱动到 `stage === "board"` 需要真实 SQLite + `DISPLAY_STAGE_EVENT` 阶段机（`tests/stage-reach.test.tsx` 的既有模式），工作量与本次改动本身不成比例。已用代码巡检确认它与其余三个视图使用完全相同的编辑模式（`fixed inset-x-0 top-0 z-0` + 显式 `style` → `fixed inset-0 z-0`、删除 `style`），如实登记为人工发现项，不用宽松断言伪装成已覆盖。
```

---

## ⑤ project/05_evidence/test-results.json

**5.1 `tests` 数组追加两条**（TEST-454/455，已实际跑过、真实 PASS）：

```json
{
  "id": "TEST-454",
  "result": "PASS",
  "command": "npx vitest run tests/display-screen.test.tsx tests/settings-on-display.test.tsx",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "非首页视图全悬浮（REQ-F-200 ④ 第二次修订）。真实入口 TEST-455 的浏览器验证（scripts/probe-unified-floating-console.mjs）已写好，按四条并行 Wave-1 CR 的编排边界未在本分支执行，见测试说明书「变更响应 · CR-20260918-unified-floating-console」。"
},
{
  "id": "TEST-455",
  "result": "PASS",
  "command": "npx vitest run tests/floating-chat.test.tsx",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "控制台常驻入口合并一行（REQ-F-200 ⑤ 新增）。全量 90 个测试文件、834 个用例绿（一次偶发的资源争用超时经单独重跑确认为环境问题，非本 CR 代码路径缺陷，详见 EV-2026-09-18-unified-floating-console.md 第 2 节）。"
}
```

**5.2 `change_records` 数组追加一条字符串**：

```json
"CR-20260918-unified-floating-console"
```

**5.3 `executed_commands` 数组追加**：

```json
"npx tsc --noEmit -p .  (OK 0 错误)",
"npx vitest run  (OK 90 个测试文件、834 个用例全绿，一次偶发资源争用超时已单独重跑确认非缺陷)",
"node scripts/ui-contract.mjs  (OK 53 项全过)",
"node scripts/check-module-graph.mjs  (OK 112 文件，0 环、0 分层违规)",
"python -m unittest tests.test_governance  (OK 140 个用例全绿)"
```

---

## ⑥ docs/INDEX.md

**不手写内容**——由 `npm run docs:index` 生成，`check-index` 做逐字节比对。待四份说明书全部落笔后统一重新生成一次。

---

## 落笔前后的核对清单（给编排会话）

1. `python tools/governance.py check-ids` —— 确认 DEC-348/TASK-454/TASK-455/TEST-454/TEST-455 与另外三条并行 CR 的占用 ID 不重叠。
2. `python tools/governance.py check-tables` —— 各处表格改动列数与表头一致。
3. `python tools/governance.py check-specs` / `check-changes` / `check-doors` —— 三层说明书变更响应节均出现 CP-1/CP-2 编号；CR 文档的门/发现方式声明齐全。
4. `npm run docs:index` 后 `python tools/governance.py check-index`。
5. **`DisplayScreen.tsx` 与 `CR-20260918-competitor-board` 的合并顺序**：该 CR 新增的 `if (stage === "competitor-board")` 渲染分支是在本 CR 的改动落地之前写的，仍用旧的 `fixed inset-x-0 top-0` + `style={{ bottom: "var(--jarvis-console-h, 0px)" }}` 模式——两条 CR 各自改的代码行不同、不会产生 git 冲突，但合并完成后若不手工同步，会出现"友商看板"是全场唯一还半遮挡的视图，与本 CR「全部对齐首页」的产品意图相悖。编排会话须在两者都合并进 main 后，手工把 competitor-board 分支引入的那段渲染分支也改成 `fixed inset-0`、删除其 `style` 属性，保持全站体验一致，这一步不属于任何一条 CR 的「变化点」，是纯粹的合并期一致性维护，建议随合并提交一起说明。
6. 四条并行 Wave-1 CR 的 `main 合并各分支 → snapshot → 合并回 main` 顺序按 CLAUDE.md 第三节执行，snapshot 全流程只跑一次。
