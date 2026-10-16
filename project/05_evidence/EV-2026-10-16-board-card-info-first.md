# EV-2026-10-16-board-card-info-first

- 来源: 用户 2026-10-16「以信息显示为主。例如台达，点击后展开，显示前5的信息链接。删除问 Jarvis 关于这个对象。」（INPUT-2026-10-16-001，附一张看板对象卡片展开态的粘贴内容）；同日三项裁定「删按钮，改需求，5条加查看全部」；紧接着的第二条「不要技术参数与要求。最新消息，直接显示标题。」（INPUT-2026-10-16-002，并入同一 CR 的 CP-3/CP-4）
- 时间: 2026-10-16
- 采集者: 协调会话（claude），分支 `cr/CR-20261016-board-card-info-first`
- 支撑对象: `CR-20261016-board-card-info-first` CP-1、CP-2、CP-3、CP-4
- 可定位路径: 本文件；`src/components/KnowledgeDashboard.tsx`（`HISTORY_PREVIEW`、`showAllHistory`、展开态消息列表、原 `knowledge-dashboard__ask` 按钮处）、`src/lib/i18n.ts`（`board.showAllMessages` / `board.showFewerMessages` 两键新增，`board.askJarvis` / `board.askAboutPrefix` 两键删除，中英各一处）、`tests/knowledge-dashboard.test.tsx`（⑤d 新增、⑥ 改写）、`src/lib/entity-history.ts:27`（`MAX_HISTORY_READ = 200`，本 CR 不动）、`project/01_specification/产品需求说明书.md`（REQ-F-071 ③）、`project/03_modules/模块任务开发说明书.md`（TASK-124 ②）、`project/04_tests/测试说明书.md`（TEST-123 ⑤d、⑥）

## 1. 改之前的实测现状

协调会话先读代码核实用户描述，有一项与直觉不同，必须写明：

**消息列表本来就是链接。** `HistoryEntry = { at: string; url: string; change: string }`（`src/lib/entity-history.ts:29`），
展开态把每条渲染成 `<a href={item.url} target="_blank" rel="noreferrer">`，新的在前。所以用户说的「显示前 5 的信息链接」
里，「链接」这一半早就成立，**缺的只是条数上限**：

- 组件侧**没有任何上限**，`history[entity.name]!.map(...)` 把取回的全部列出来。
- 接口侧 `MAX_HISTORY_READ = 200`，`/api/entities/[name]/history` 在没有 `limit` 参数时按 200 返回
  （`src/app/api/entities/[name]/history/route.ts:38`）。

一张活跃对象的卡片因此能把半屏铺满，展开第一眼是一长串变更摘要——这正是「以信息显示为主」在观感上落不下来的原因。

**展开态的段落顺序本来已是「消息列表 → 技术参数与要求 → 采集源设置 → 问 Jarvis → 删除对象」**，消息已经在最前，所以
本 CR 不需要调整顺序（用户第三问未点选，亦不自行调整）。

## 2. 与已批准需求的冲突（本 CR 的关键一点）

`问 Jarvis 关于这个对象` 不是随手加的按钮，它是 **REQ-F-071 ③** 的落地机制。该条原文：

> ③卡片展开为该对象的详情与**采集源管理**；工具与技能的调用**不放进卡片**，改为把问题预填进对话框；

状态 APPROVED（CR-20260911-home-dashboard，R1 逐轮拍板 2026-09-11）。同一机制另被三处明文引用：
**TASK-124 ②**、**TEST-123 ⑥**、`tests/knowledge-dashboard.test.tsx` 的 ⑥。

因此「删掉这个按钮」不是一处纯 UI 改动，它同时触及需求、模块任务与测试标准，按 L2 处理，并须由用户 R1 终裁
（CLAUDE.md §一：产品需求说明书为 APPROVED，修改需求须走 CR 与 R1，不能直接改表）。协调会话就此提问，用户裁定
**「删按钮，改需求」**。

**禁令本身没有被取消。** 改写后的 REQ-F-071 ③ 仍写明「工具与技能的调用**仍不放进卡片**」；变的是卡片正面不再承担
交接。预填进对话框的通路仍有一处落地——采集源弹窗里的「自动配置来源」（`onAsk`，CR-20260918-change-history-and-sources
CP-2 的既有选择），所以 `onAsk` prop 保留，没有删。

## 3. 改动与机器证据

| CP | 改动 | 机器检查 |
|---|---|---|
| CP-1 | 删除卡片正面 `knowledge-dashboard__ask` 按钮；`board.askJarvis` / `board.askAboutPrefix` 两键在中英两份文案里各删一处 | `tests/knowledge-dashboard.test.tsx` ⑥（改写） |
| CP-2 | 新增 `HISTORY_PREVIEW = 5` 与按对象记的 `showAllHistory` 状态；超出 5 条时给带 `aria-expanded` 的「查看全部（N）」，可展开也可收回；新增 `board.showAllMessages` / `board.showFewerMessages` 两键 | `tests/knowledge-dashboard.test.tsx` ⑤d（新增） |

⑥ 里有一处刻意的写法要说明：断言「按钮不存在」之前**先等参数段渲染完**
（`expect(await screen.findByText("技术参数与要求")).toBeInTheDocument()`）。否则「查不到元素」既可能是真的没有、
也可能只是还没渲染，那条断言会变成一条永远绿的空断言。

⑤d 含**收回**一步。只验展开会漏掉「状态被写死成 true」这一类实现错误。

## 3b. CP-3 / CP-4（INPUT-2026-10-16-002）

### CP-3 技术参数与要求整段移出卡片

删除的是：段标题、空态提示、参数行、我方状态切换按钮、删参数按钮、手填表单。随之变死的
`PARAM_STATE_LABEL` / `NEXT_PARAM_STATE` / `PARAM_STATE_CLASS` 一并删除——`noUnusedLocals` 当场把这三处报了出来
（TS6133），不留死代码（CLAUDE.md §六）。`ParamState` 类型保留，另两个对比视图仍在用。

**能力去向，实测核过**：

| | 还在吗 | 在哪 |
|---|---|---|
| **看**参数 | 在 | `src/components/IndustrySpecComparison.tsx`（行业技术要求对比）、`src/components/CompetitorBoard.tsx`（友商对比），都按 `params` 渲染；`entities.ts` 的数据模型一行未动 |
| **改**参数（我方状态 / 删 / 手填） | 界面上没有了 | 此前只在这张卡上——`paramStatus` 全仓仅此一处渲染（已 grep 核实）。后端路由与工具保留，仍可经对话让 Jarvis 写 |

**一处如实登记的需求缺口**：**REQ-F-180 ⑥**（APPROVED）要求「`kind=推定` 的字段在知识看板上必须与有据可查的字段
看起来不同」。参数移出卡片后，**参数级的推断标记在整个界面上没有落点**——两个对比视图都不渲染任何推断标记
（已核实无 `cited` / `quoted` / `InferredTag` 相关代码）。卡片仍渲染的 `change` / `capacity` / `nextDate` 三字段的标记未丢
（由 TEST-123 ⑰ 守住）。本证据**不**声称 REQ-F-180 ⑥ 仍完整成立。已做的防扩大：TEST-123 ⑯ 改写为「卡片上不渲染任何
参数」——一个参数都没有就不可能出现没有标记的推断参数，谁日后把参数加回卡片而忘带标记，该例会红。建议另立小 CR
把标记补到两个对比视图，**等用户点头**。

### CP-4 消息只显示标题

`src/lib/sources.ts#describeChange` 产出的格式是 `新增 N 行，移除 M 行：<首个新增行截断到 60 字>`，而那个「首个新增行」
在实践中就是页面标题。本机真实数据实测（`.data/users/admin/entities/history/台达-delta.jsonl`）：

```
{"at":"2026-09-22T03:11:49.981Z","url":"https://www.delta-china.com.cn/zh-CN/index","change":"新增 2 行：2026 云栖大会"}
{"at":"2026-10-16T19:12:51.060Z","url":"…","change":"新增 23 行，移除 20 行：Smarter is Greener 越智慧 越永续"}
```

新增导出的纯函数 `messageTitle(change)` 剥掉冒号前缀，**折叠态那一行与展开列表两处同用**（只改一处会看起来像 bug）。
行数统计从界面上消失，仍保留在落盘的 `change` 字段里。冒号后为空时（纯行数、或 `页面有变化` 兜底文案）原样显示——
把它吞掉会让一条真实发生过的变化在界面上消失。

**选择渲染侧而不是数据侧的理由**：加 `title` 字段要迁移已落盘的 JSONL，且对老条目无效；剥前缀零迁移、对已有历史立即生效。

## 4. 执行记录

- `npx tsc --noEmit`：0 错误。
- `npx vitest run tests/knowledge-dashboard.test.tsx`：全绿（含改写的 ⑥ 与新增的 ⑤d）。详细结果见 §6。
- 文档门禁：`check-changes` / `check-specs` / `check-ids` / `check-tables` / `check-doors` / `check-approval-log` 全 OK。
- `review r1` PASS；`review r2|r3|r4` 报 `SKIPPED_FAST_LANE`（DEC-021 ①，工具判定两个 CP 全双向门且各有机器检查）——
  本 CR 仍按标准档填满三张矩阵，属自愿加严，理由见 CR「级别」行（验收含真实入口）。

## 5. 真实入口

**已执行并全部 PASS**（2026-10-16 19:29Z，本机生产构建：删 `.next-prod` → `build:local` → `serve:local` 重启，
`/api/health` 200 且 `uptimeSeconds=1`）。

走法用新增的 `scripts/probe-board-card-info-first.mjs`，与 `scripts/probe-change-history-and-sources.mjs` 同一套做法：
建一个带时间戳的一次性对象、直接往运行中服务器读的那份 `entities/history` 写 JSONL、在**真实 Chromium**（有头）里核对
渲染、结束时无论成败都 `DELETE` 清理。写 7 条而不是 6 条：5 是上限、6 验「默认不在 DOM 里」、7 验「展开后最后一条也在」——
只写 6 条的话这两件会是同一条，验不出展开的完整性。

本机库里真实数据最多只有 3 条历史（`维谛技术` 3 条、`施耐德电气` 2 条、`台达` 2 条），**验不出 5 条上限**，所以用合成
对象；要核对的渲染本身仍然是真实的。这一点如实写明，不假称用了真实对象。

原始输出：

```
已建立探针对象：探针测试友商-1792178960758
entities 根目录=D:\OneDrive\桌面\工作\项目文件\Agent-Jarvis\.data\users\admin\entities
API 读回 7 条（期望 7）=true
最新的一条排在最前=true
展开第一眼可见条目=[3,4,5,6,7]（期望 [3,4,5,6,7]）=true
最新一条 href=https://probe.example/board-card-info-first/7 target=_blank 正确=true
卡片正面「问 Jarvis 关于这个对象」已消失=true
「技术参数与要求」整段已消失=true
行数前缀未出现在界面上=true
「查看全部（7）」存在=true，aria-expanded=false
展开后第 1 条可见=true，第 2 条可见=true
收回按钮存在=true，aria-expanded=true
收回后第 1 条重新消失=true
清理探针对象=true
PASS 展开只显示最近 5 条且各为指向来源的链接、「查看全部」可展开可收回、卡片正面已无「问 Jarvis 关于这个对象」
```

**探针自己踩过的两个坑，如实记下**（都不是产品缺陷）：

1. 第一版把历史写到 `.data/entities/history`，而按用户隔离（CR-20260918-per-user-data-isolation）之后，本机单管理员
   模式下服务器读的是 `.data/users/admin/entities`——历史 API 因此读回 0 条。改为**建完对象先在盘上找到它的 `<name>.md`
   再推导 history 目录**，不硬编码 `admin`。
2. 重构时加了 `findEntitiesRoot()` 却没调用，正文仍引用已删的变量，报 `entitiesRoot is not defined`。补上调用。

**顺带一个与本 CR 无关的观察**：`history/` 目录里留着一条早先探针对象的 `探针测试友商-1789769579428.jsonl`——
**删除对象时它的历史 JSONL 没有被一起删**。无害（看板上已无该对象），但是一处真实的清理遗漏，未在本 CR 内处理。

## 6. 全量与收口记录

- **定向**（2026-10-16）：`npx vitest run tests/knowledge-dashboard.test.tsx tests/i18n.test.ts` → **32 例全绿**，
  含改写的 ⑥ 与新增的 ⑤d。`npx tsc --noEmit` → 0 错误。
- **全量**（2026-10-16 15:07Z，开跑时可用内存 **1.41 GB**）：`npx vitest run` → **117 文件 / 1001 例全部通过**，
  exit 0，墙钟 58.03 s。用例数由 1000 增至 1001（新增 TEST-123 ⑤d）。
  - 按 CR-20261016-floating-chat-test-isolation 的判读规则记下同轮的抖动用例读数：
    `floating-chat` 的 `③c` 5646 ms、`④` 10078 ms，**均绿**，与「可用内存越宽裕耗时越短」一致。
- **文档门禁**（2026-10-16）：`check-changes` / `check-specs` / `check-ids`（399 个编号无重叠无悬空）/
  `check-tables`（2093 行表格宽度一致）/ `check-doors` / `check-approval-log`（285 个变更响应节都有登记，
  需求输入状态块与最后一条输入一致）全 OK。
- **评审门**：`review r1` **PASS**；`review r2|r3|r4` 报 `SKIPPED_FAST_LANE`（DEC-021 ①）——三张矩阵仍已填满，
  属自愿加严。

### CP-3 / CP-4 之后的复跑

- `npx tsc --noEmit` → 0 错误（期间 `noUnusedLocals` 报出三个变死的常量与一处 `act.mock.calls` 元组取值，均已修）。
- `npx vitest run tests/knowledge-dashboard.test.tsx` → **32 例全绿**。CP-3/CP-4 合理地推翻了四条既有用例
  （⑤c 期望旧的行数前缀、⑥ 拿「技术参数与要求」当锚点、⑮ 断言能看能改参数、⑯ 比较参数的推断标记），
  已全部按新行为改写，理由逐条写在用例注释里。
- **全量**（2026-10-16 15:25Z）：`npx vitest run` → **117 文件 / 1001 例全部通过**，exit 0，墙钟 100.18 s。
- 文档门禁复跑：`check-changes` / `check-specs` / `check-ids` / `check-tables`（2095 行）/ `check-doors`（371 个变化点）/
  `check-approval-log` 全 OK；`review r1` PASS，`r2|r3|r4` 报 `SKIPPED_FAST_LANE`，三张矩阵已按四个 CP 填满。
