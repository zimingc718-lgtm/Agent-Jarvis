# CR-20261006-chat-stream-disconnect

- 级别: L2（标准档，**自愿加严**：四个 CP 全双向门——改动集中在 `createStreamingResponse` 一个函数内，`git revert` 即回滚，无数据迁移、无部署形态变化、无新模块/路由/表/依赖。四个 CP 各有机器检查，所以 `review r2|r3|r4` 实测报的是 `SKIPPED_FAST_LANE`（DEC-021 ①），按工具判定本可走快车道；仍按标准档填满三张矩阵并要求真实入口，理由是本缺陷恰恰「本机全绿、线上无声」——只有真实入口能确认断开后会话里真的留下了带「已停止」标记的回复）
- 提出人: user（INPUT-2026-10-06-001：「检查下这个部署内容。当前会话没有回应。railway上面的。更新下。」）
- 状态: CLOSED（2026-10-12 合入 main `21ca6b6`，合并后 `verify` PASS；R1 由用户 2026-10-06 两项裁定终裁；`review r1` PASS，`review r2|r3|r4` 报 `SKIPPED_FAST_LANE`（见「级别」行）；`gate g1`/`g2`/`g3`/`g3.5` PASS；TEST-630 四例 PASS，TEST-631 ①②③ 真实入口 PASS；`npx tsc --noEmit` 0 错误；治理单测 141 例（修正 `docs/INDEX.md` 与真实入口登记两处后）通过；全量 116 文件 / 996 例跑了三轮、没有一轮整体绿——红的文件均不 import 本 CR 改动的 `src/lib/chat.ts`；其中 `wake-settings ①` 是偶发抖动，`floating-chat ④` 是 **main 上一处用例间相互影响**——耗时在 77 ms 到 29 s 之间跨两个数量级、20 s 超时正好落在区间内，故时红时绿（2026-10-12 合并后的第四轮全量 117 文件 / 1000 例整体绿，该例 12468 ms 通过；此前「满负载抖动」与「确定性失败」两种说法均已按实测收回，详见 EV §3.1），两条均已登记 known_warning 并各待一条独立 CR；`npm run build:local` 成功并以 `serve:local` 重启。合并提交 `21ca6b6` 推送后托管 CI run `38260510215` 九步全绿，Railway deployment `090b220f…` SUCCESS，真实入口④的部署清单、公网 `/api/health`、日志面板三项已补记于 EV §4；④里需登录态的公网①②因线上拒绝免登录路径而留给 owner 在浏览器做一次，已登记为人工发现项）
- 占用 ID: DEC-510, TASK-630, TEST-630, TEST-631
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-005（小改：连接断开与点「停止」同义）、REQ-NF-063 ②（小改：日志事件清单补「对话轮被放弃」）
- 影响模块: 对话（`src/lib/chat.ts` 的 `createStreamingResponse` 与 `runChatTurn` 一处接线）；无新增模块、路由、表、依赖，`docs/ARCHITECTURE.md` 的分层与清单不变
- 影响任务: 无既有任务变更，新增 TASK-630
- 影响测试: 无既有测试变更；新增 TEST-630, TEST-631
- 当前证据: `project/05_evidence/EV-2026-10-06-chat-stream-disconnect.md`
- 方案选项:
  - A. 在 `send` 外面裹 try/catch 吞掉异常就收工——不选：异常是症状不是病。不补 `cancel()`，`closed` 仍然不知道对方走了，`onSettled` 仍可能被 `controller.close()` 的抛出盖掉，15 秒泄漏照旧；而且会把真正的流故障一起吞掉。
  - B. **`closed` 提到 `start` 之外，补 `cancel()` 回调（置 `closed` + 经 `onCancel` 中止本轮）；`send` 的 `enqueue` 容错；`finally` 里 `close()` 容错且 `onSettled` 放在任何抛出都盖不住的位置；断开记一条 `info` 的 `chat.turn_abandoned` 而不是带栈的 `error`**——选中。
  - C. 客户端断开后让本轮继续跑到底再落库 `complete`——不选：用户已经走了，继续调模型是在花看不到的钱；且与 REQ-F-005「停止即停止请求模型」的既有语义相反。
  - D. 给 SSE 加心跳、靠心跳发现对方走了——不选：心跳只是让断开更早被发现，而发现之后的三连抛和槽位泄漏一条都不少。真要加心跳是另一件事（抗代理空闲断流），不在本 CR。
- 选择理由: 四次生产失败的日志指向同一函数，本地复现为同一签名并给出压缩栈看不到的出错点（`send (chat.ts:736)` ← `emit (:756)` ← `runToolLoop (agent-loop.ts:206)` ← `Object.start (chat.ts:784)`）。病根是**这个 `ReadableStream` 没有 `cancel()` 回调**——局部 `closed` 只在自己的 `finally` 里置位，所以消费方取消后代码并不知道。三连抛的第三抛把 `onSettled` 盖掉，实测让同一会话的下一次发送干等 15100 ms。`agent-loop.ts:247-251` 本来就有「中止则把已生成文本按 `stopped` 落库」的分支，是 `emit` 先抛把它跳过了——所以用户裁定的那条语义不需要新写落库逻辑，只需要让断开不再变成异常（TEST-630 ① 守住这一点，不靠推断）。
- 回滚方式:
  - 代码：`git revert` 本 CR 的合并提交。`createStreamingResponse` 回到局部 `closed`、无 `cancel()`，`runChatTurn` 去掉 `onCancel` 一行。回滚即回到现缺陷状态，无残留。
  - 数据：无。本 CR 不改表、不改既有行，只影响断开那一轮新写入的一行助手消息。
  - 设置：无。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 四层说明书（需求 / 架构 / 模块任务 / 测试）各含 `变更响应 · CR-20261006-chat-stream-disconnect` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED、无 TODO；`review r2|r3|r4` 不红——实测为 `SKIPPED_FAST_LANE`（见「级别」行：工具判定可走快车道，矩阵属自愿加严）。
  - P3/P4: TASK-630 DONE；TEST-630 四例 PASS，TEST-631 真实入口 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量——本 CR 的定向用例必绿，全量里出现的红必须逐条隔离复跑为绿并登记为满负载抖动（EV §3.1）；`python -m unittest tests.test_governance` 通过；`npm run governance:ci` PASS；`npm run build:local` 成功并以 `serve:local` 重启；`test:ui-contract` 53 规则 0 FAIL、`test:visual` 3 例绿。**`test:smoke` 不在本 CR 的验收内**——它在 main 上已是红的（`node:crypto` 经 `log.ts` 进 smoke 的 dev server 包），已登记 known_warning 并用 `git stash` 复验与本 CR 无关。
- 真实入口: 已执行（①②③2026-10-06 在本机生产构建上成立——删 `.next-prod` 后 `build:local` + `serve:local`，`server.start build=90072cf`、`env=production`；真实 DeepSeek Provider 下断开后读回 `[user:complete, assistant:"流"/stopped]`，同一会话下一次发送 1749 ms 拿到 `done`，`.data/server.log` 两条 `info` 的 `chat.turn_abandoned`（`noticedAt:cancel`）、`chat.turn_failed` 零条；④2026-10-12 推送后补记于 EV-2026-10-06-chat-stream-disconnect §4——deployment `090b220f…` SUCCESS 且 `meta.commitHash=21ca6b6`、公网 `/api/health` 200 且 `uptimeSeconds` 由 1035907 归零为 55、Railway 日志面板有 `[INFO] … event="server.start" … env="production"`；公网的①②需 Google 登录态，线上按 `auth-guard.ts:102-113` 拒绝免登录路径，留给 owner 在浏览器走一次，已登记为人工发现项）
  - **真实入口（必做）**：①本机生产构建重启后发一条消息，回复流到一半断开连接（关标签页 / 刷新），重新进入该会话应看到**已生成部分带「已停止」标记**而不是一句提问悬着；②同一会话紧接着再发一条，应**立即**开始回复（不是等十几秒）；③`.data/server.log` 中该次断开只有一条 `level:"info"` 的 `chat.turn_abandoned`，没有 `chat.turn_failed`；④合入 main 推送部署后，公网同样走一遍①②，并确认 Railway 日志面板里是 `[INFO] … event="chat.turn_abandoned"`。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审，见「R1 评审」节。**R1 人工终裁**：用户 2026-10-06 就两项待裁定给出选择（AskUserQuestion）——断开语义选「落库为 stopped，保留已生成的部分」，落地顺序选「先修对话，再收 CR-20260930」。
- R1 终裁: 已完成 | 用户 | 2026-10-06

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：用户要求检查 Railway 部署并报告「当前会话没有回应」（INPUT-2026-10-06-001）。协调会话核实部署本身健康（`d2b732b7`，连续运行 29 小时，`/api/health` 200），定位到 main 里的流式缺陷并本地复现，就「断开后该留下什么」与「两条 CR 的先后」两项请用户裁定，用户各选其一。触发源（按了停止 / 刷新离开 / 代理掐断）**如实登记为查不到**，见 CP-3。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 客户端中途断开不再把整轮打死：`closed` 提到 `start` 之外、补 `cancel()` 回调、`enqueue` 与 `close()` 容错，已生成文本按 REQ-F-005 既有语义落库 `stopped` | REQ-F-005（小改）、DEC-510 ①、TASK-630 | 缺陷修复 | 双向 | 机器：`tests/chat-stream-disconnect.test.ts` ①（TEST-630）；真实入口：断开后回到该会话看到「已停止」标记（TEST-631 ①） |
| CP-2 | 模块 | `onSettled` 放在任何抛出都盖不住的位置并去重，`inFlightTurns` 槽位不再泄漏——同一会话的下一次发送不再干等 `SUPERSEDE_WAIT_MS` | DEC-510 ②、TASK-630 | 缺陷修复 | 双向 | 机器：TEST-630 ②（实测修复前 15100 ms，修复后 < 2000 ms）；真实入口：TEST-631 ② |
| CP-3 | 架构 | 断开记一条 `info` 的 `chat.turn_abandoned`（带 `noticedAt`），不再记成带栈的 `error` `TypeError`；真正的流故障仍记 `chat.turn_failed` | REQ-NF-063 ②（小改）、DEC-510 ③ | 小改 | 双向 | 机器：TEST-630 ③④（③断开只有 info 一条、无 turn_failed；④真故障仍报 turn_failed） |
| CP-4 | 测试 | 新增 TEST-630（四例：落库 stopped / 槽位释放 / 日志分得清 / 真故障不被吞）、TEST-631（真实入口四步） | TEST-630, TEST-631 | 新增 | 双向 | 机器：`npx vitest run tests/chat-stream-disconnect.test.ts` |

**登记为查不到**：生产那四次断开**由谁触发查不到**。客户端只有 `handleStop` 会 abort（无自动超时；idle 定时器在 `isStreaming` 时直接 return，不碰 fetch），所以是「按了停止 / 刷新或离开页面 / 连接经 Railway 边缘被掐」三者之一，而当时的代码把断开记成 `TypeError` 恰好把这个区分丢掉了。CP-3 补的 `chat.turn_abandoned` 带 `noticedAt`，**下一次**再发生可以分辨在哪一步被发现；但对已发生的那四次，本 CR 不声称知道触发源。这不构成单向门：三条后果已被 CP-1/CP-2 从根上消除，与触发源是哪一个无关。

## R1 评审

| 角色 | 裁决 | 意见 |
|---|---|---|
| 产品 | APPROVED | 用户看到的「没有回应」有了确切解释：会话里只剩提问、没有答复行。裁定①把断开并入 REQ-F-005 已有的「停止」语义，不新造概念——用户按停止和连接断开，在会话里留下的东西从此一样。 |
| 架构 | APPROVED | 病根是 Web Streams 的一个契约被漏掉：`ReadableStream` 的消费方取消要靠 `cancel()` 告知，源端不能只信自己的 `finally`。修法把「流是否还能写」这一状态移到两个回调都看得见的位置，并让三处写操作全部容错，不引入新机制。 |
| 模块开发 | APPROVED | 改动在一个函数内加一行接线（`onCancel: () => turnController.abort()`），`agent-loop` 一行不动——`stopped` 落库分支本来就在，只是以前到不了。可审阅、可 revert。 |
| 测试 | APPROVED | 四例对应四个症状，且第四例专门守「别把真故障一起吞了」这个新风险。真实入口必做，因为落库与界面标记是 UI 可见行为，机器断言不算验收（CLAUDE.md §六）。 |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20261006-chat-stream-disconnect` 节后，跑 `governance.py matrix CR-20261006-chat-stream-disconnect` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 用户裁定①落到 REQ-F-005 既有语义上，不新造概念：按停止与掉线在会话里留下同样的东西 | APPROVED DEC-510 ① 补的是 Web Streams 本来就有的契约（消费方取消经 `cancel()` 告知），不是新机制 | APPROVED 改动在一个函数内，加 `onCancel` 一行接线；`agent-loop.ts` 不动 | APPROVED TEST-630 ① 断言落库三元组，TEST-631 ① 走真实界面 |
| CP-2 | APPROVED 15 秒空等不是需求允许的行为，修掉不需要改需求文字 | APPROVED `settle()` 去重 + `close()` 容错，把「槽位必定释放」从依赖无异常变成结构保证 | APPROVED `onSettled` 移出 `close()` 的抛出路径，`DEC-420 ②` 的互斥策略一字不动 | APPROVED TEST-630 ② 用时间断言（< 2000 ms）对照修复前实测的 15100 ms |
| CP-3 | APPROVED 日志能分清「人走了」和「服务坏了」，这是下一次排查的前提 | APPROVED 放弃是 `info` 不是 `error`；`chat.turn_failed` 的语义收窄为真故障，与 DEC-490 ④ 的事件清单一致 | APPROVED 一个 `noteAbandoned` 去重函数，两个调用点（`cancel` / `enqueue`） | APPROVED TEST-630 ③ 守 info 一条且无 turn_failed，④ 专守「真故障不被吞」这个新风险 |
| CP-4 | APPROVED 四例对应四个实测症状，不是凑数 | APPROVED 测试直接驱动 `runChatTurn`，不引新依赖、不打桩 provider 之外的东西 | APPROVED 一个新测试文件，复用 `server-log-sites.test.ts` 的 `captureLines` 写法 | APPROVED 定向与全量见 EV §3；真实入口 TEST-631 必做 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED REQ-F-005 修订与 TASK-630 ①②③ 对齐 | APPROVED 与 DEC-510 ① 一致 | APPROVED TASK-630 ①②③，落点可审阅可 revert | APPROVED TEST-630 ①、TEST-631 ① |
| CP-2 | APPROVED 无需求层遗留 | APPROVED 与 DEC-510 ② 一致 | APPROVED TASK-630 ④ | APPROVED TEST-630 ②、TEST-631 ② |
| CP-3 | APPROVED REQ-NF-063 ② 事件清单已补「对话轮被放弃」 | APPROVED 与 DEC-510 ③ 一致 | APPROVED TASK-630 ①⑤ | APPROVED TEST-630 ③④、TEST-631 ③④ |
| CP-4 | APPROVED 无遗留 | APPROVED 无新增基础设施 | APPROVED TASK-630 ⑥ | APPROVED 见 R2/CP-4 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-10-06 本机生产构建上真实断开后，会话读回 `[user:complete, assistant:"流"/stopped]`——用户裁定①第一次真的成立，修复前该助手行根本不存在 | APPROVED `cancel()` 回调在真实 HTTP 断开下被调用（日志里两条 `noticedAt:"cancel"` 为证），不是只在单测里成立 | APPROVED `agent-loop.ts` 未改一行而 `stopped` 分支到达，印证病根只在 `closed` 的作用域 | APPROVED TEST-630 ① PASS；TEST-631 ① `real_entry: true`（`entry: user`），证据 EV §4 |
| CP-2 | APPROVED 同一会话的下一次发送 1749 ms 跑完整轮（含 DeepSeek 真实往返），不再是十几秒空等 | APPROVED `settle()` 去重 + `close()` 容错，槽位释放从「依赖无异常」变成结构保证 | APPROVED `tsc` 0 错误；`DEC-420 ②` 的互斥策略未动 | APPROVED TEST-630 ②（< 2000 ms，对照修复前 15100 ms）；TEST-631 ② |
| CP-3 | APPROVED 日志从此分得清「人走了」与「服务坏了」 | APPROVED 两次断开各一条 `level:"info"` 的 `chat.turn_abandoned`，`.data/server.log` 全文件 `chat.turn_failed` 零条 | APPROVED `noteAbandoned` 去重，两个调用点各自可达（`cancel` 已实证，`enqueue` 由 TEST-630 覆盖） | APPROVED TEST-630 ③④；TEST-631 ③ |
| CP-4 | APPROVED 四例对应四个实测症状 | APPROVED 不引新依赖 | APPROVED 一个新测试文件 | APPROVED 定向 4/4 绿；全量两轮的红均为满负载抖动、隔离复跑全绿，详见 EV §3.1 |
