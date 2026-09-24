# CR-20260923-orphan-tool-results

- 级别: L2（标准档：全部 CP 双向门——只改代码里"发给模型的回放"与"同一会话的并发处理"，数据库一行不动，`git revert` 即回滚；真实入口需人工在受损会话里操作一次）
- 提出人: user（INPUT-2026-09-21-004，补记）
- 状态: CLOSED（2026-09-23 闭环：TASK-540 DONE，TEST-540/541 PASS，TEST-542 真实入口三步在用户运行中的本机服务上走完（分支构建 `czWnnnHPFeEgyqxr4HhYA`，受损会话自愈、断连/并发两条路径 0 孤儿、被拒请求用量 (0, 0)）；R1 四点裁定均取推荐项，R1-R4 全 PASS；全量回归 928/928，`tsc` 0 错误；snapshot ledger seq 142 后快进合入 main，合并后 `verify` PASS。服务已在跑同一份代码，无需再重建）
- 占用 ID: REQ-F-310, DEC-420, TASK-540, TEST-540, TEST-541, TEST-542
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-029（工具循环——一轮被中止后服务端仍在写库）、REQ-F-042（上下文压缩——摘要锚点落在错位处）、REQ-F-037（会话累计用量——被拒请求按预估计入）
- 影响模块: MOD-CHAT（`src/lib/chat.ts` 历史加载/回放、`src/lib/agent-loop.ts` 序列修复）、MOD-API（`src/app/api/chat/stream/route.ts` 同会话互斥）
- 影响任务: 无既有任务变更，新增 TASK-540
- 影响测试: 无既有测试变更，新增 TEST-540, TEST-541, TEST-542
- 当前证据: `project/05_evidence/EV-2026-09-23-orphan-tool-results.md`
- 方案选项:
  - A. 只在报错时提示用户"请开启新对话"——不选：受损数据仍在库里，且"点停止后立刻再发"这个动作在任何会话里都会再次制造同样的错位。
  - B. **三件事一起做：①回放净化——`loadHistory` 之后把 `tool_call_id` 不属于紧邻前一条 assistant `tool_calls` 的 `tool` 行从回放里剔除（数据库不动，与压缩同一原则），并以 notice 告知剔除条数；②同会话单轮互斥——服务端登记每个会话进行中的轮次，新的发送先中止旧轮并等其收尾，再加载历史；③被提供方拒绝的请求（无 usage 返回且以 error 结束）不再按预估值计入会话累计用量**——建议选中；②的形态经 R1 裁定为「中止旧轮再处理新消息」，不返回 409。
  - C. 写一次性脚本直接修改生产库里受损会话的行序——不选：改生产数据是单向门，而 B-① 在下次发送时即可自愈，不需要碰库。
  - D. 只做 B-①，不做 B-②——不选：只修症状不修源头，下一次"停止后立刻再发"仍会制造新的错位，只是不再永久卡死。
- 选择理由: 见「根因」。三处缺陷各自独立可证：①用现有 `repairDanglingToolCalls` 的对偶（它补缺失的结果，不删多出来的结果）即可覆盖；②是错位的唯一来源——客户端 `handleStop` 只中止 fetch 并立即允许再发，服务端循环对此毫无感知；③是"888,745"这个数字的来源，与请求大小无关。三者都不改变任何持久化数据的含义。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交，重建重启。
  - 数据：本 CR 不写库、不改 schema；回滚后受损会话回到"每次发送 400"的现状，其它会话不受影响。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260923-orphan-tool-results` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-540 DONE；TEST-540/541/542 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿；不新增 lib→tools 边。
- 真实入口: 已执行（2026-09-23 本机时区 / 2026-09-24T04:00Z，用户运行中的本机服务，分支构建 `czWnnnHPFeEgyqxr4HhYA`，由协调会话经真实 `POST /api/chat/stream` 驱动、DeepSeek `deepseek-chat` 应答：①受损会话 `b969720b…` 再发一条——SSE「已跳过 4 条错位的工具结果」，1.6 s 正常回复，库里 4 条错位行原样未动；②a 收到第一个 `tool_call` 即断开连接并立刻再发——中止经 `request.signal` 立即传到服务端，两个调用在新 user 行**之前**得「已中止」，6 行 0 孤儿；②b 不断开、1.5 s 后从另一条连接并发再发——B 收到「上一轮尚未结束，已先将其中止」，A 以 stopped 收尾，9 行 0 孤儿；③ 用不存在的模型名发一次请求——DeepSeek 拒绝后下沉到 OpenAI 又被 401 拒绝，该会话累计用量 (0, 0)。详见 EV-2026-09-23-orphan-tool-results §4）
  - **真实入口（必做）**：①受损会话自愈——发送后不再 400，回复正常，提示剔除条数；②停止后立刻再发——服务端旧轮被中止，库里 assistant(`tool_calls`) 与其 `tool` 行之间没有插入 user 行；③会话累计用量在一次被拒请求前后不变（对照 `GET /api/conversations/recent` 或 SSE `usage`）。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：待用户拍板。
- R1 终裁: 已完成 | 用户 | 2026-09-23

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：协调会话在生产库只读核实根因并写出方案 A-D 后，就 INPUT-2026-09-21-004 的四个待确认点发起 AskUserQuestion，用户逐点选择：①不合法序列在回放时自动剔除并提示（不碰库）；②上一轮未结束时新的发送先中止旧轮再处理；③被提供方拒绝且无 usage 的请求不计入会话累计用量；④既有受损会话靠①自愈、不写一次性修库脚本。四点均为方案 B 的组成部分，视为对方案 B 的终裁。

## 根因（2026-09-23 只读查询生产库 `.data/agent-jarvis.sqlite` 核实）

会话 `b969720b-2c76-4762-b023-78292133187d`（标题「拉一下行业技术指标对比表…」），106 行消息，`ORDER BY created_at, seq` 的有效顺序在第 70–77 位出现如下接缝：

| 位置 | 时间（Z） | 行 | 说明 |
|---|---|---|---|
| 70 | 22:16:03 | assistant，`tool_calls` ×4（save_knowledge） | 长任务第 2 轮的最后一次工具调用 |
| 71 | 22:16:03 | system，status=summary | 压缩摘要，后来以第 70 行为锚点插入（`insertMessageAfter`，`created_at` 取锚点时间） |
| 72 | 22:16:04 | **user「你好」** | 用户点「停止」后立刻发的新消息 |
| 73–76 | 22:16:04 | tool ×4（"已存为知识条目…"） | 第 70 行那 4 个调用的结果——落库在 user 行**之后** |
| 77 | 22:16:05 | assistant，status=stopped | 「你好」那一轮的回复 |
| 78–88 | 22:16:08–22:16:35 | assistant+tool ×5、最终报告 | **旧一轮的循环继续跑完了**：save_insight、4 次追加、生成报告——服务端从未收到停止 |
| 89–105 | 22:17 起 | user ×17，无 assistant | 之后每次发送都失败：`Provider request failed (400): Messages with role 'tool' must be a response to a preceding message with 'tool_calls'` |

三个环节各负一段责任：

1. **错位的来源**：`FloatingChat.tsx#handleStop` 中止客户端 fetch 并立即 `setIsStreaming(false)`，用户可以马上再发；服务端 `runToolLoop` 只在收到 delta 或进入下一步时检查 `signal.aborted`，而本次事实是旧轮在「停止」后又持续 30 秒、写入 20 行。新一轮在 `runChatTurn` 里先 `appendMessage(user)`（`chat.ts:255`），于是 user 行插进了旧轮 assistant(`tool_calls`) 与其 `tool` 行之间。
2. **回放不修**：`loadHistory` 按 user 行切轮，这 4 条 `tool` 行被算进下一轮；压缩计划把 `through=2` 的锚点定在第 70 行，摘要恰好插在 assistant 与其结果之间；摘要之后的回放以 `user → tool×4` 开头。`repairDanglingToolCalls` 只给没有结果的调用补 `[已中止]`，不处理"没有调用的结果"，所以不合法序列每次原样发出。
3. **数字失真**：`createStreamingResponse` 在提供方未返回 usage 时（400 即如此）无条件按 `estimateMessagesTokens(assembled)` 计入会话累计（`chat.ts:691-699`，在 status 判断之前），17 次失败把该会话累计推到 891,627 input tokens（`usage_estimated=1`）；SSE `usage` 事件发的是会话累计值，用户看到的 888,745 因此不是任何一次请求的大小。而每次失败的发送都已把 user 行落库，受损历史随重试越来越长。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 一条会话不因某一轮被中止或并发发送而永久不可用：历史出现不合法工具序列时回放自动修复并告知，重试不再加重损伤；显示的累计用量不把被拒请求按预估计入 | REQ-F-310（新增） | 缺陷修复 | 双向 | 真实入口：在受损会话 `b969720b…` 里再发一条消息得到正常回复并看到剔除提示（证据：TEST-542） |
| CP-2 | 架构 | 回放净化：`loadHistory` 之后、`assembleContext` 之前，剔除 `tool_call_id` 不属于紧邻前一条 assistant `tool_calls` 的 `tool` 行（数据库不动），剔除数以 notice 事件告知；与 `repairDanglingToolCalls` 互为对偶 | DEC-420（新增） | 缺陷修复 | 双向 | 机器：`tests/agent-loop.test.ts` 新增孤儿 tool 行用例（证据：TEST-540） |
| CP-3 | 架构 | 同会话单轮互斥：服务端以 `conversationId` 登记进行中的轮次；新的发送到达时先中止旧轮并等其收尾，再加载历史（R1 裁定：中止旧轮，不返回 409） | DEC-420 | 缺陷修复 | 双向 | 机器：`tests/chat-stream.test.ts` 并发两次 `runChatTurn` 的用例（TEST-541）；真实入口：长任务中点停止后立刻再发，事后只读核对无错位行（证据：TEST-542） |
| CP-4 | 架构 | 被提供方拒绝的请求（未返回 usage 且以 error 结束）不再按 `estimateMessagesTokens` 计入会话累计用量；仍对提供方不报 usage 的正常完成保留预估 | DEC-420 | 缺陷修复 | 双向 | 机器：`tests/chat-stream.test.ts` 用例——stub 提供方返回 error 后 `getUsage` 不变（证据：TEST-541） |
| CP-5 | 测试 | 新增 TEST-540（agent-loop 序列净化）、TEST-541（chat-stream 互斥与用量）、TEST-542（受损会话真实入口） | TEST-540, TEST-541, TEST-542 | 新增 | 双向 | 机器：`npx vitest run tests/agent-loop.test.ts tests/chat-stream.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260923-orphan-tool-results` 节后，跑 `governance.py matrix CR-20260923-orphan-tool-results` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 直接对应用户四点裁定；把"一轮被打断后会话仍可用"作为一条 MUST 单独占号，验收写的是真实会话而非断言 | APPROVED 新增 REQ-F-310 落 DEC-420；REQ-F-029/042/037 的正常路径行为未被改写 | APPROVED 落点集中在 `agent-loop.ts` 一个纯函数与 `chat.ts` 的登记/释放，不牵动 UI 与路由 | APPROVED 验收含真实入口三步（受损会话自愈、停止后再发、被拒请求用量），机器对照 TEST-540/541 |
| CP-2 | APPROVED 跳过条数说出来（REQ-F-023），用户知道模型少看了什么 | APPROVED 与 `repairDanglingToolCalls` 互为对偶、同一文件；不写库，与压缩同一原则（DEC-030 ①）；放在压缩之前，锚点不再落在接缝上 | APPROVED 泛型直接作用于 `TurnMessage[]`，不丢 `turn`；同一 id 只认第一条、system/user 行重置待回答集合 | APPROVED TEST-540 五例含生产接缝的原样形状与串联修复后的合法性断言 |
| CP-3 | APPROVED 用户裁定「中止旧轮」而非 409，与客户端已显示「已停止」一致；发生中止时对话里有提示 | APPROVED 进程内 Map 与单进程部署形态匹配；多实例风险已写入 DEC-420 风险列；等待上限 15 s 防止旧轮不收尾时新轮永远等 | APPROVED 四处 signal 消费点统一改用 `turnSignal`；`onSettled` 在 `finally` 释放；413 抛出路径也释放，不留悬挂槽位 | APPROVED TEST-541 ② 用永不返回的慢工具复现并断言库里形状与 SSE 提示 |
| CP-4 | APPROVED 用户看到的累计数不再含从未发出的请求；正常完成仍保留预估（带 estimated 标记） | APPROVED 守卫只加在 `!sawUsage` 分支，提供方真实报的 usage 路径不变 | APPROVED 一行条件 `result.status !== "error"`，位置在 status 判断之前但语义明确 | APPROVED TEST-541 ③ 断言无 usage 事件、`getUsage` 为 0，且随后正常完成计入预估 |
| CP-5 | APPROVED 测试范围与验收条件的机器可证部分一一对应，真实入口单列 TEST-542 | APPROVED 无新增 mock 基础设施；慢工具经既有 `extraTools` 注入 | APPROVED 新用例并入既有两个测试文件，命名与编号沿用文件惯例 | APPROVED 定向 92/92，全量 928/928 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-540 对应验收条件①②③ | APPROVED 与 DEC-420 ①②③ 一致 | APPROVED 两个文件、一个纯函数加一处登记，可审阅可回滚 | APPROVED TEST-540/541/542 覆盖 |
| CP-2 | APPROVED 无需求层遗留 | APPROVED 调用点在 `loadHistory` 之后、`planCompaction` 之前，与 DEC-420 ① 描述一致 | APPROVED TASK-540 ① 逐项写明规则与提示文案 | APPROVED TEST-540 逐项对应 |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 登记—中止—等待—释放四步与 DEC-420 ② 一致 | APPROVED TASK-540 ② 列出四处 signal 改点与两处释放点 | APPROVED TEST-541 ② |
| CP-4 | APPROVED 无需求层遗留 | APPROVED 与 DEC-420 ③ 一致 | APPROVED TASK-540 ③ | APPROVED TEST-541 ③ |
| CP-5 | APPROVED 无遗留 | APPROVED 无新增架构决策 | APPROVED 测试与源文件一一对应 | APPROVED 见 R2/CP-5 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-09-23 真实入口三步全部符合预期（EV §4）：受损会话一条消息即自愈、并发发送先中止旧轮、被拒请求不计用量 | APPROVED 真实服务上验证了断连（`request.signal`）与并发（`inFlightTurns`）两条中止路径都能让旧轮在新 user 行之前收尾 | APPROVED 受损会话的 4 条错位行仍原样在库、只在回放里被跳过；两条新会话 0 孤儿 | APPROVED TEST-542 `real_entry: true`（`entry: user`）；SSE 事件日志 6 份留存协调会话 scratchpad，关键数字已抄入 EV §4 |
| CP-2 | APPROVED 跳过提示文案有断言（TEST-541 ①） | APPROVED 用例①经 `runChatTurn` 全链路，证明净化发生在压缩与组装之前 | APPROVED TEST-540 ⑤ 证明对象引用与 `turn` 字段原样保留 | APPROVED `npx vitest run tests/agent-loop.test.ts` 17 例全绿，已本机实测 |
| CP-3 | APPROVED 中止提示文案有断言 | APPROVED 用例②证明旧轮以 stopped 收尾且其调用在新 user 行之前得到结果 | APPROVED 旧轮提供方只被调用 1 次，未泄漏到第二轮 | APPROVED 真实入口②a/②b 已执行：断连即中止、并发则先中止旧轮，事后只读核对两条会话均 0 孤儿（EV §4） |
| CP-4 | APPROVED | APPROVED | APPROVED | APPROVED TEST-541 ③ 已本机实测 |
| CP-5 | APPROVED | APPROVED | APPROVED | APPROVED 全量回归 928/928，无 flaky 复现 |
