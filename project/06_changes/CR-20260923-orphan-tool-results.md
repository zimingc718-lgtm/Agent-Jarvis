# CR-20260923-orphan-tool-results

- 级别: L2（标准档：全部 CP 双向门——只改代码里"发给模型的回放"与"同一会话的并发处理"，数据库一行不动，`git revert` 即回滚；真实入口需人工在受损会话里操作一次）
- 提出人: user（INPUT-2026-09-21-004，补记）
- 状态: R1 已终裁（2026-09-23 用户经 AskUserQuestion 四点裁定均取推荐项：回放自动剔除并提示 / 新消息先中止旧轮 / 被拒请求不计用量 / 受损会话靠回放自愈不碰库）；P2 进行中
- 占用 ID: REQ-F-310, DEC-420, TASK-540, TEST-540, TEST-541, TEST-542
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-029（工具循环——一轮被中止后服务端仍在写库）、REQ-F-042（上下文压缩——摘要锚点落在错位处）、REQ-F-037（会话累计用量——被拒请求按预估计入）
- 影响模块: MOD-CHAT（`src/lib/chat.ts` 历史加载/回放、`src/lib/agent-loop.ts` 序列修复）、MOD-API（`src/app/api/chat/stream/route.ts` 同会话互斥）
- 影响任务: 无既有任务变更，新增 TASK-540
- 影响测试: 无既有测试变更，新增 TEST-540, TEST-541, TEST-542
- 当前证据: `project/05_evidence/EV-2026-09-23-orphan-tool-results.md`（待建；根因核实数据先记在本文件「根因」节）
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
- 真实入口: 未执行（P2-P4 尚未开始。实现并重建重启后两条路线各走一次：①在受损会话 `b969720b-2c76-4762-b023-78292133187d` 里再发一条消息，得到正常回复且出现"已剔除 N 条错位工具结果"的提示；②在一个会跑工具的长任务里点「停止」后立刻再发一条，事后用只读查询核对该会话没有新的错位行）
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
| CP-3 | 架构 | 同会话单轮互斥：服务端以 `conversationId` 登记进行中的轮次；新的发送到达时先中止旧轮并等其收尾，再加载历史（R1 裁定：中止旧轮，不返回 409） | DEC-420 | 缺陷修复 | 双向 | 机器：`tests/chat-stream.test.ts` 并发两次 `runChatTurn` 的用例（证据：TEST-541）；真实入口：长任务中点停止后立刻再发，事后只读核对无错位行 |
| CP-4 | 架构 | 被提供方拒绝的请求（未返回 usage 且以 error 结束）不再按 `estimateMessagesTokens` 计入会话累计用量；仍对提供方不报 usage 的正常完成保留预估 | DEC-420 | 缺陷修复 | 双向 | 机器：`tests/chat-stream.test.ts` 用例——stub 提供方返回 error 后 `getUsage` 不变（证据：TEST-541） |
| CP-5 | 测试 | 新增 TEST-540（agent-loop 序列净化）、TEST-541（chat-stream 互斥与用量）、TEST-542（受损会话真实入口） | TEST-540, TEST-541, TEST-542 | 新增 | 双向 | 机器：`npx vitest run tests/agent-loop.test.ts tests/chat-stream.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260923-orphan-tool-results` 节后，跑 `governance.py matrix CR-20260923-orphan-tool-results` 生成矩阵骨架，再逐格填裁决。
