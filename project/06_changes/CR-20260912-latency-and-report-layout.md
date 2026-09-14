# CR-20260912-latency-and-report-layout

- 级别: L2（改变发送给模型的上下文构成与报告渲染的可观察行为；无 schema 变更、无新增依赖、无新增出网面）
- 提出人: user（P6 运行反馈，INPUT-2026-09-11-013：「现在对话框回复比较慢。检查下当前对话框的逻辑实现是否有问题。或者找一下有没有提升的地方」「生成的报告靠左边显示，调为居中显示，且宽度占屏幕的 0.68 左右」）
- 状态: CLOSED（闭环完成：1 个任务 DONE、2 条测试 PASS；2026-09-14 按 DEC-270 ③ 收口。原记：APPROVED（R1 人工终裁：用户直接授权修改报告布局；延迟部分为排查结论 + 一处按已批准需求的实现补正）→ P3 完成，**本 CR 为事后补记，见「如实说明」**）
- 占用 ID: REQ-F-090, REQ-F-091, DEC-070, TASK-140, TEST-150, TEST-151
- 评审模型: 标准档（DEC-021 ①：CP-1 与 CP-3 依赖人工发现 → 不走快车道）
- 影响需求: 新增 REQ-F-090（报告列宽与居中）、REQ-F-091（保留窗口无条件生效，作为 REQ-F-041 ① 的实现补正）；不修改 REQ-F-041 的语义
- 影响模块: MOD-TOOLS（`budget.ts` 的 `assembleContext`）、MOD-DISPLAY（`display-document.ts` 的外框样式）
- 影响任务: 新增 TASK-140（DONE）
- 影响测试: 新增 TEST-150, TEST-151（均 PASS）
- 当前证据: `project/05_evidence/EV-2026-09-11-chat-latency.md`
- 方案选项:
  - **延迟** — A. 为对话加缓存 / 连接预热 / 并行预取：**否决**。实测自有开销仅 80 ms，首字时间由 DeepSeek 自身波动（432–6,248 ms）主导，这些手段增加复杂度却改善不了首字。B. 降低每轮输入规模：**选中**，是唯一我们能控且有实测收益的一项。C. 什么都不做：否决——61,760 token 里有 97% 是陈旧工具结果，且工具循环按步数翻倍重发。
  - **报告布局** — A. 给分层规则加 `!important`：**否决**。会连带压过文档对自身内容的一切控制，与「自带样式优先」的既定设计冲突。B. 改用内层包裹 div：否决，完整文档无法安全地重包 body 内容。C. **不分层的 `body.jarvis-insight` 规则，注入在文档自带样式之后**：选中，靠特异性取胜，不影响文档内部。
- 选择理由: 延迟部分先量后改——同一请求内分段计时证明自有开销 80 ms（EV §1），交叉对照排除了 `max_tokens` 与工具数组（EV §3），并推翻了一个自己得出的错误中间结论（EV §2）。唯一能控的是每轮重放规模，而那里存在一处**实现与已批准需求不符**：REQ-F-041 ① 写的是「只有最近 N 轮的工具结果以原文保留」，实现却只在超预算时才套用，导致 80% 预算处的会话每轮重发 6.1 万 token。布局部分的根因是把布局约束放进了会被文档覆盖的 `@layer`（EV §4）。
- 回滚方式:
  - 运行回滚：`git revert` 本 CR 的实现提交。`assembleContext` 回到「先全量、超限再收窄」；`display-document.ts` 的 `INSIGHT_FRAME_STYLE` 与 `frameStyleTag()` 移除、宽度与 `margin` 移回 `INSIGHT_BASE_STYLE` 的 `.jarvis-insight`。
  - 无 schema 变更、无数据变形、无依赖变更；落库记录不受影响（保留窗口只改发送给模型的上下文，REQ-F-041 ③ 不变）。
  - 文档回滚：删除 REQ-F-090 / REQ-F-091 行、DEC-070 行与本 CR 的三层变更响应节。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + R1 终裁痕迹；`review r1` PASS。
  - P3: TASK-140 DONE；TEST-150 / TEST-151 PASS；`npm test` / `test:ui-contract` / `tsc` 全绿。
  - P4 真实入口：1920 / 1440 / 900 三种视口下报告占比分别为 0.68 / 0.68 / 1.00 且左右留白相等；真实会话的每轮发送 token 数较改动前显著下降。
- 评审记录: 标准档，相关角色意见见下。**R1 人工终裁**：报告布局为用户直接指定（「调为居中显示，且宽度占屏幕的 0.68 左右」）；延迟部分用户要求「检查下…或者找一下有没有提升的地方」，助手给出实测结论后实施了唯一有收益的一项。
- R1 终裁: 已完成 | 用户
- **如实说明（本 CR 的性质）**: 代码改动发生在 2026-09-11，本 CR 与证据文件补写于 2026-09-12。补写起因是助手自查时发现 `budget.ts` 与 `display-document.ts` 的注释引用了**当时并不存在**的证据文件 `EV-2026-09-11-chat-latency`，以及一个当时并不存在的功能需求编号（F 系列 059）—— 即先改了受控行为再补登记，违反 AI_STANDARD 原则 8「变更闭环」。那个虚构编号已替换为真实分配的 REQ-F-090。该疏漏由助手主动上报，不抹去。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了`。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **保留窗口无条件生效**。`assembleContext` 原先只在超预算时收窄，而 REQ-F-041 ① 没有预算前提；结果是卡在预算 80% 的会话每轮原样重发全部历史工具结果（实测 61,760 token，其中 97% 是工具输出），且工具循环按步数翻倍。改为始终套用，实测最大会话由 240,768 降至 24,923 token（EV §3） | REQ-F-091、REQ-F-041 ① | 缺陷修复 | 双向 | 机器：`tests/budget.test.ts` 新增两条——未超预算时旧工具结果仍被省略且省下过半；用户与助手文本不受影响。**「某次追问恰好需要更早的工具结果」属人工发现** |
| CP-2 | 架构 | **溢出路径简化**。收窄既然无条件发生，DEC-026 ⑥ 的「先收窄再报错」只剩后半段：收窄后仍超限即抛 `ContextOverflowError`，不做循环压缩 | REQ-F-091 ②、DEC-026 ⑥ | 小改 | 双向 | 机器：`tests/budget.test.ts` 既有「收窄后仍超限则报错」用例不变且仍 PASS |
| CP-3 | 产品 | **报告列宽 68% 并居中**。布局约束原先写在 `@layer jarvis-base` 的 `.jarvis-insight` 上，而模型生成的完整 HTML 自带未分层的 `body { margin: 0 }`——未分层无条件压过分层，居中被取消而 `max-width` 存活，1152 px 的列被钉在 1440 px 视口左侧（EV §4）。改为不分层的 `body.jarvis-insight`，注入在文档自带样式之后，靠特异性取胜且不用 `!important` | REQ-F-090 | 缺陷修复 | 双向 | 机器：`tests/display-document.test.ts` 新增三条——frame 样式在文档样式之后、宽度 68% 且 margin auto、布局约束不得回到 base 层。**「68% 好不好看」属人工发现** |

## 相关角色意见（标准档）

- **产品**：用户报的「慢」实测主因在 Provider 侧，如实告知而不假装优化掉了；真正做的是把每轮重放规模降下来，那是我们能控的部分，也顺带降低 token 花费。报告布局是用户直接指定的数值，照做。
- **架构**：CP-1 不是新需求而是**实现补正**——REQ-F-041 ① 早已批准且无预算前提，之前的实现是打了折扣的版本。CP-3 的关键是认识到 `@layer` 对未分层声明必输，所以布局约束不能放在那里；用特异性而非 `!important` 取胜，保住了「文档内部归文档自己管」这条设计意图。
- **模块开发**：两处改动各自集中在一个纯函数里，互不耦合，可分别回滚。`display-document.ts` 仍是纯函数、无 DOM 依赖。
- **测试**：CP-1 的关键断言是「**未超预算时**也收窄」——这正是旧实现漏掉的条件，用宽松断言会放过。CP-3 增加了一条防回归断言：布局约束若被挪回 base 层即失败。两处人工发现项如实登记，不用宽松断言伪装覆盖。

## 实施记录（2026-09-11 改动 / 2026-09-12 补记）

- **`src/lib/tools/budget.ts`**：`assembleContext` 删去「先全量、未超限即返回」分支，改为始终 `applyRetentionWindow` 后再判预算；注释写明实测数据与 REQ-F-041 ① 的原文依据。
- **`src/lib/display-document.ts`**：`INSIGHT_BASE_STYLE` 的 `.jarvis-insight` 去掉 `max-width` 与 `margin`；新增不分层的 `INSIGHT_FRAME_STYLE`（`body.jarvis-insight`，`width/max-width: 68%`，`margin-inline: auto`，1024 px 以下让出整宽）与 `frameStyleTag()`；`buildInsightDocument` 对片段在 `<head>` 末尾注入，对完整文档在 `</head>` 前注入——即文档自带 `<style>` **之后**。
- **测试**：`tests/budget.test.ts` +2、`tests/display-document.test.ts` +3。
- **验证**：单测 67 文件 / 571 用例 PASS；`ui-contract` 53/0/0；`tsc` 0；真实入口三视口实测 0.68 / 0.68 / 1.00。
- **未做**：`snapshot` 未执行——按 `docs/WORKFLOW.md` 全流程只在合并前跑一次。

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260912-latency-and-report-layout` 节 + DEC-070 + MOD-TOOLS / MOD-DISPLAY 边界行。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 实测 65%–90% 的降幅，且是已批准需求的应有之义 | APPROVED DEC-070 ① 无新增状态，只删一条分支（自审） | APPROVED 纯函数内改动，可独立回滚 | APPROVED 「未超预算也收窄」是关键断言 |
| CP-2 | APPROVED 溢出语义对用户不变 | APPROVED DEC-026 ⑥ 后半段保留，不做循环压缩（自审） | APPROVED 无新增代码路径 | APPROVED 既有溢出用例不变仍 PASS |
| CP-3 | APPROVED 用户指定的 0.68 已落实 | APPROVED DEC-070 ② 靠特异性而非 !important，保住文档自治（自审） | APPROVED 纯函数，两处注入点明确 | APPROVED 含一条防回归断言 |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260912-latency-and-report-layout` 节 + TASK-140。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-140 ① 写明依据原文 | APPROVED 与 DEC-070 ① 一致 | APPROVED 删分支而非加开关，不留两套行为（自审） | APPROVED 对应 TEST-150 |
| CP-2 | APPROVED 报错文案不变 | APPROVED 溢出仍为请求级错误 | APPROVED 无额外改动 | APPROVED 既有用例覆盖 |
| CP-3 | APPROVED TASK-140 ② 覆盖两种注入点 | APPROVED 片段与完整文档分别处理 | APPROVED 不用 !important 写进任务约束（自审） | APPROVED 对应 TEST-151 |

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260912-latency-and-report-layout` 节 + TEST-150 / TEST-151。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 副作用如实登记为人工发现 | APPROVED 不为「不丢上下文」写假断言 | APPROVED 用真实规模的夹具 | APPROVED TEST-150（自审） |
| CP-2 | APPROVED 无需新增用例 | APPROVED 既有断言即回归门 | APPROVED — | APPROVED 既有溢出用例（自审） |
| CP-3 | APPROVED 观感缺口如实登记 | APPROVED 层序断言是根因的直接守卫 | APPROVED 纯函数可 node 单测 | APPROVED TEST-151（自审） |
