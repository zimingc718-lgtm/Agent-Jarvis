# EV-2026-09-23-orphan-tool-results

- 来源: 用户 2026-09-21 报告「... （生成失败）对话经常报这个错误。」「本地。经常。就对话里的回复我这个。」并粘贴 SSE 原文（INPUT-2026-09-21-004，补记）；R1 四点裁定（AskUserQuestion，2026-09-23）
- 时间: 2026-09-23
- 采集者: 协调会话（claude），分支 `cr/20260923-orphan-tool-results`；生产库 `.data/agent-jarvis.sqlite` 只以 `mode=ro` 打开查询，未写入
- 支撑对象: `CR-20260923-orphan-tool-results` CP-1..CP-5
- 可定位路径: 本文件；`src/lib/agent-loop.ts#dropOrphanToolResults`、`src/lib/chat.ts`（`inFlightTurns` / `settleWithin` / `runChatTurn` / `createStreamingResponse`）、`tests/agent-loop.test.ts`、`tests/chat-stream.test.ts`

## 1. 根因核实（生产库只读查询）

会话 `b969720b-2c76-4762-b023-78292133187d`，标题「拉一下行业技术指标对比表，我要横向看所有友商、准入方和客户的技术参数。」，`conversations` 行：`input_tokens=891627`、`output_tokens=9168`、`usage_estimated=1`；`messages` 106 行，按 `listMessages` 的排序（`created_at, seq`）：

| 位置 | 时间（Z） | 行 | 含义 |
|---|---|---|---|
| 0–69 | 09-18 22:12–22:16 | 2 轮 user、多轮 assistant+tool_calls 与 tool 结果 | 一个长研究任务，全部成对、合法 |
| 70 | 22:16:03 | assistant，`tool_calls` ×4（save_knowledge） | 该轮最后一次工具调用 |
| 71 | 22:16:03 | system，`status=summary`，927 字 | 压缩摘要，事后以第 70 行为锚点 `insertMessageAfter` 插入（`created_at` 取锚点时间，`seq` 顶到 71） |
| 72 | 22:16:04 | **user「你好」** | 用户点「停止」后立刻发出的新消息 |
| 73–76 | 22:16:04 | tool ×4「已存为知识条目…」 | 第 70 行那 4 个调用的结果——落库在 user 行**之后** |
| 77 | 22:16:05 | assistant，`status=stopped`「你好！刚才那批抓取被中止了，我先停在这里…」 | 「你好」这一轮的回复 |
| 78–88 | 22:16:08–22:16:35 | assistant+tool_calls ×5（save_insight、追加 ×4）、最终报告 977 字 | **旧一轮的循环继续跑完**——服务端从未收到停止 |
| 89–105 | 09-18 22:17 → 09-21 14:10 | user ×17，其间无任何 assistant 行 | 17 次发送全部失败：`Provider request failed (400): Messages with role 'tool' must be a response to a preceding message with 'tool_calls'` |

按 DB 顺序统计孤儿 `tool` 行（其 `tool_call_id` 不在紧邻前一条 assistant 的 `tool_calls` 里）：**4 条**，即第 73–76 行。角色/状态计数：assistant complete 28、stopped 1；system summary 1；tool complete 53、error 3；user 20。

三段责任（对应 CR「根因」节）：
1. **错位来源**——`src/components/FloatingChat.tsx#handleStop`（第 1069–1079 行）：`abortRef.current?.abort()` 后立即 `setIsStreaming(false)`，`handleSubmit` 的 `if (!message || isStreaming) return` 不再拦截；服务端 `runToolLoop` 只在收到下一条 delta 或进入下一步时检查 `signal.aborted`，而上表第 78–88 行证明旧轮在客户端断开后又跑了 30 秒。新一轮 `runChatTurn` 先 `appendMessage(user)`（原 `chat.ts:255`）再做别的，于是 user 行落在旧轮的 assistant 与其 tool 结果之间。
2. **回放不修**——`loadHistory` 按 user 行切轮，第 73–76 行归入下一轮；`planCompaction` 的 `through=2` 使锚点 `lastRowIdByTurn.get(2)` 恰为第 70 行，摘要插在 assistant 与其结果之间；摘要之后的回放以 `user → tool×4` 开头。`repairDanglingToolCalls` 只补"有调用无结果"，不删"有结果无调用"。
3. **数字失真**——`createStreamingResponse` 在 `!sawUsage` 时无条件 `addUsage(estimateMessagesTokens(assembled))`（原 `chat.ts:691-699`，位于 status 判断之前）；400 不返回 usage，17 次失败各计一次整段上下文的预估，累计 891,627；SSE `usage` 事件发的是 `getUsage(conversationId)` 的会话累计，用户粘贴的 888,745 是倒数第二次失败时的累计值，不是任何一次请求的大小。

## 2. 实现前的代码核对（决定了改动落点）

- `repairDanglingToolCalls`（`agent-loop.ts`）是纯函数、对 `ChatMessage[]` 工作、在 `assembleContext` 之后调用；孤儿剔除必须在**压缩之前**做（否则锚点与摘要仍会落在接缝上），所以新函数做成泛型 `<T extends ChatMessage>` 直接作用于带 `turn` 的 `TurnMessage[]`，紧跟 `loadHistory`。
- `chat.ts` 里 `input.signal` 有 4 处下游消费（流响应、`toolContext.signal`、`runToolLoop.signal`、提供方流 `signal`）——互斥要能从服务端中止旧轮，四处都要改用本轮自己的 `turnController.signal`，再让它联动请求 signal。
- `createStreamingResponse` 的 `finally` 是"这一轮无论如何结束"的唯一汇点——释放互斥槽位放在这里；`runChatTurn` 在登记之后只剩一个抛出路径（`assembleContext` 的 `ContextOverflowError → 413`），在那个 catch 里先释放再抛。
- 模块图：新函数在 `src/lib/agent-loop.ts`，`chat.ts` 本就从 `./agent-loop` 导入；不新增任何 lib→tools 边（`tests/module-graph.test.ts` 23 例照旧全绿）。
- 部署形态：本地 `serve:local` 与 Railway 都是单个 `next start` 进程，进程内 `Map` 足够；多实例是另一条 CR 的事，已写进 DEC-420 风险列。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-540 | `tests/agent-loop.test.ts`（新增 5 例，文件合计 17 例） | 5 | ①生产接缝形状：4 条错位结果被跳过、其余原样、输入数组未被改动；串联 `repairDanglingToolCalls` 后序列合法且 4 个调用各得「已中止」；②合法序列 `toEqual` 原样；③摘要边界后紧跟的 tool 行是孤儿；④同一 id 只认第一条、无 id 的 tool 行也是孤儿；⑤泛型在带 `turn` 的行上保留对象引用 |
| TEST-541 | `tests/chat-stream.test.ts`（新增 3 例，文件合计 20 例） | 3 | ①把接缝原样种进真实 sqlite 再发一条：SSE 含「已跳过 2 条错位的工具结果」与 `event: done`，发给提供方的序列合法、不含错位结果、两个调用得「已中止」，库里 8 行原样；②旧轮卡在永不返回的慢工具里时再次发送：旧轮以 `stopped` 结束，其调用在新 user 行之前得「已中止」，库里形状 `user / assistant+calls / tool[slow-1] / user / assistant`，新轮 SSE 含「上一轮尚未结束，已先将其中止」，旧轮的提供方只被调用 1 次；③提供方直接 error 且无 usage：不发 `usage` 事件、`getUsage` 为 0；随后正常完成仍计预估（`estimated: true`） |

`npx tsc --noEmit`：**0 错误**（2026-09-23）。

定向运行 `npx vitest run tests/agent-loop.test.ts tests/chat-stream.test.ts tests/compaction.test.ts tests/wake.test.ts tests/module-graph.test.ts`：5 文件 **92/92 通过**（compaction 18 例与 wake 14 例都经 `runChatTurn`，证明互斥登记不影响既有单轮路径）。

`npx vitest run`（全量，2026-09-23 本机）：99 文件 / **928 例全部通过**，84.5 s；此前两次收口都出现的既有 flaky（`tests/floating-chat.test.tsx > skill intake ④`）本次未复现。

## 4. 真实入口（待执行）

按 CR「验收条件」在用户运行中的本机服务上：①受损会话 `b969720b…` 再发一条消息；②长任务中「停止」后立刻再发，事后只读核对；③一次被拒请求前后累计用量不变。执行后补记本节并翻转 TEST-542。

## 5. 局限（如实登记）

- 被跳过的孤儿结果对模型不可见：它们是被中止那一轮的产物，用户当时已放弃；如需其内容，让模型重新读取。
- 互斥表是进程内状态；多实例部署下各实例互不知情。当前两处部署都是单进程。
- 客户端「停止」仍不会向服务端发显式停止请求——服务端只在**下一条消息到达时**中止旧轮。旧轮在无人再发消息的情况下会自行跑完（与修复前一致，但不再污染后续历史）。
