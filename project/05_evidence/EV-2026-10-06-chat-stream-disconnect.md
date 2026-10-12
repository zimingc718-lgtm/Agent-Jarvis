# EV-2026-10-06-chat-stream-disconnect

- 来源: 用户 2026-10-06「检查下这个部署内容。当前会话没有回应。railway上面的。更新下。」（INPUT-2026-10-06-001）；两项 AskUserQuestion 裁定（断开语义取「落库为 stopped，保留已生成的部分」；落地顺序取「先修对话，再收 CR-20260930」）
- 时间: 2026-10-06（生产日志取自 2026-10-01 19:53–19:59Z 的四次失败）
- 采集者: 协调会话（claude），分支 `cr/20261006-chat-stream-disconnect`
- 支撑对象: `CR-20261006-chat-stream-disconnect` CP-1..CP-4
- 可定位路径: 本文件；`src/lib/chat.ts`（`createStreamingResponse` 的 `closed` / `settle` / `noteAbandoned` / `cancel`，`runChatTurn` 的 `onCancel`）、`src/lib/agent-loop.ts:199-251`（既有 `stopped` 落库分支，本 CR 不改）、`tests/chat-stream-disconnect.test.ts`、`project/01_specification/产品需求说明书.md`（REQ-F-005）、`project/02_solution/架构设计说明书.md`（DEC-510）、`project/03_modules/模块任务开发说明书.md`（TASK-630）、`project/04_tests/测试说明书.md`（TEST-630..631）

## 1. 实测的失败

**部署本身没问题。** 2026-10-06 核对：当前部署 `d2b732b7-11d6-4ef8-b3fc-10d787728dcd`（2026-09-30T14:20:22Z 创建、14:22:22Z SUCCESS，对应 main `90072cf`），`railway api` 查三条部署记录确认它是唯一 SUCCESS 的在役部署；公网不登录 `GET /api/health` → 200，`{"ok":true,"storage":"ok","build":"","uptimeSeconds":106666,…}`——连续运行 29.6 小时无重启。`build` 为空是 CR-20260930-railway-healthcheck-buildsha 在修的事，与本缺陷无关，但它的副作用是**无法用 `build` 反查线上提交**，只能用部署时间对齐 main。

**真正的失败在 main 的代码里。** `railway logs --deployment d2b732b7…` 的运行日志里，用户 2026-10-01 19:53–19:59Z 的四次尝试（四个互不相同的 `conversationId`：`0439de32…`、`90dc4b91…`、`4bca7346…`、`eae594b3…`）全部是同一条：

```
[ERRO] ts="2026-10-01T19:53:55.084Z" event="chat.turn_failed"
       conversationId="0439de32-55e4-46bd-a36a-0101f8bbd140"
       messageId="1226772a-475a-4ec0-8148-2a29487b60ee" stage="stream"
       errorName="TypeError" errorMessage="Invalid state: Controller is already closed"
       stack="TypeError: Invalid state: Controller is already closed
           at ReadableStreamDefaultController.enqueue (node:internal/webstreams/readablestream:1190:13)
           at c (/app/.next/server/chunks/8755.js:43:6559)
           at Object.start (/app/.next/server/chunks/8755.js:46:1010)"
```

**本地复现为同一签名**（2026-10-06，`runChatTurn` + 注入 `providerStream`，读到第一个 `delta` 后 `reader.cancel()`），并给出生产压缩栈看不到的出错点：

```
at send (src/lib/chat.ts:736)
at Object.emit (src/lib/chat.ts:756)
at runToolLoop (src/lib/agent-loop.ts:206)
at Object.start (src/lib/chat.ts:784)
```

机理：`createStreamingResponse` 的 `closed` 标志原来是 `start` 的局部变量，**只在自己的 `finally` 里置位**；而这个 `ReadableStream` **没有 `cancel()` 回调**，所以消费方取消之后 controller 已经关闭、代码却不知道。于是 `agent-loop.ts:206` 的 `input.emit(delta)` 抛 `TypeError` 并**穿出 `runToolLoop`**，三连抛：

1. 第一抛：`emit` → `send` → `controller.enqueue` 抛，穿出工具循环；
2. 第二抛：`catch` 记下 `chat.turn_failed` 后 `send({type:"error"})` 再抛（controller 仍是关闭的）；
3. 第三抛：`finally` 的 `controller.close()` 第三次抛，**把 `input.onSettled?.()`（即 `releaseTurn`）带走**。

三条实测后果（本地同一次复现，数值为实测）：

| 后果 | 实测 | 用户看到的 |
|---|---|---|
| 工具循环被穿出，`agent-loop.ts:247-251` 的「中止则按 `stopped` 落库」分支到不了 | 断开后该会话的行是 `[["user","complete","first"]]`——**助手行一个字都没落库** | 刷新回去是一句提问悬着没有答复，即「当前会话没有回应」 |
| `onSettled` 被第三抛带走，`inFlightTurns` 的槽位永不释放 | 同一会话的下一次发送在 `settleWithin(previous.settled, SUPERSEDE_WAIT_MS)` 上干等 **15100 ms** | 再发一条要等十几秒才开始回复 |
| 断开被记成带栈的 `error` `TypeError` | 四条生产日志全是 `chat.turn_failed stage="stream"` | 排查者按「provider 故障」方向找，而真实原因是有人掉线 |

**触发源查不到，如实登记。** 客户端只有 `handleStop` 会 abort（`src/components/FloatingChat.tsx:1089-1090`）；没有任何自动超时——唤醒定时器在 `isStreaming` 时直接 `return`，不碰 fetch（`:630-632`），`streamChatDeltas` 只接受外部传入的 `request.signal`（`:377`）。所以生产那四次断开是「按了停止 / 刷新或离开页面 / 连接经 Railway 边缘被掐」三者之一；当时的代码把断开记成 `TypeError`，恰好把这个区分丢掉了。本 CR 不声称知道是哪一个。

## 2. 设计与代码核对

- **`closed` 的作用域就是病根**，所以修法第一步是把它连同 `abandoned` / `settled` 提到 `createStreamingResponse` 的函数作用域——`start` 与新增的 `cancel` 两个回调都看得见同一个状态。三处置位：`cancel`、被拒绝的 `enqueue`、本轮正常结束。
- **`cancel()` 里不释放槽位**：`start` 这时仍在运行（它的 `await input.run(...)` 还没回来），槽位由它自己的 `finally` 释放。`settle()` 带 `settled` 去重，所以即便将来多一条释放路径也只会释放一次。
- **`onCancel` 接 `turnController.abort()`**：这一行是用户裁定①能成立的全部原因。中止之后工具循环在下一次迭代顶部看到 `input.signal?.aborted`（`agent-loop.ts:199-201`）→ `stopped = true` → `break` → `persist({role:"assistant", content: stepText, status:"stopped"})`。**`agent-loop.ts` 一行不动**——这个分支本来就在，以前被第一抛跳过了。一个字都没生成时 `if (stepText)` 为假，不写助手行，与 REQ-F-005 的措辞一致。
- **`send` 吞掉 `enqueue` 异常是有代价的**：一个非断开原因的 enqueue 失败也会静默转为「放弃」。这条代价由 TEST-630 ④ 从另一侧守住——provider 生成器中途抛错时仍须留一条 `error` 的 `chat.turn_failed`。`catch` 里的 `!abandoned` 条件只压住「已经记过放弃」的那一种。
- **放弃记 `info` 而不是 `error`**：读者走开不是故障。`noticedAt` 区分 `cancel`（消费方明说）与 `enqueue`（没说，写的时候才发现），这是日后分辨断开发生在哪一步的唯一线索——但它仍然回答不了「是谁掐断的」。
- **与 DEC-420 ② 的边界**：一会话一轮的互斥与 15 秒等待上限本身不动。本 CR 修的是「槽位在异常路径下不释放」；15 秒作为超时兜底仍然正确，只是从此不该再被真的等满。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-630 | `tests/chat-stream-disconnect.test.ts` | 4 | ①断开后落库为 `[user:first/complete, assistant:"part one"/stopped]`；②同一会话下一次发送 < 2000 ms 且拿到 `event: done`；③该次断开只有一条 `info` 的 `chat.turn_abandoned`（`noticedAt:"cancel"`）、`chat.turn_failed` 零条；④provider 中途抛错仍留一条 `error` 的 `chat.turn_failed`（`stage:"stream"`）且无放弃行 |

- 定向运行（2026-10-06）：`npx vitest run tests/chat-stream-disconnect.test.ts` → **4/4 通过**，4.9 s。四条用时分别 1451 / 1470 / 1273 / 707 ms；运行输出里可见两条 `chat.turn_abandoned` 的 JSON 行（第①②例各一条，`noticedAt:"cancel"`）。
- 修复前后的同一指标对照（同一复现脚本）：落库 `[user]` → `[user, assistant/stopped]`；下一次发送 **15100 ms → < 2000 ms**。
- `npx tsc --noEmit` → **0 错误**。
- 治理单测与全量回归：见 §3.1。

### 3.1 全量回归与治理单测

- `npx tsc --noEmit` → **0 错误**。
- `python -m unittest tests.test_governance` → 141 例。**第一次跑红 3 条，三条都是治理在替本 CR 守纪律，不是本 CR 的代码问题**：
  `GeneratedIndexTests.test_435_1` 与 `…test_435_1b` 报 `FAIL INDEX_STALE docs/INDEX.md does not match what
  node scripts/gen-index.mjs would write now`（说明书改了而 `docs/INDEX.md` 没重新生成，跑 `npm run docs:index` 后绿）；
  `RealEntryClaimRegistrationTests.test_433_1` 报 `FAIL REAL_ENTRY_UNACCOUNTED CR-20261006-chat-stream-disconnect:
  declares 2 real-entry detection route(s) but registers no real-entry PASS and carries neither a
  - 真实入口: 未执行（原因） …`——真实入口尚未执行时，CR 必须明写 `- 真实入口: 未执行（原因）`，补上后绿。
  两项修正后这 8 例复跑 OK。
- `npx vitest run` 跑了**四轮**（前三轮 116 文件 / 996 例，第四轮在合进 main 之后是 117 文件 / 1000 例）：**前三轮没有一轮整体绿，第四轮整体绿**；逐条追查的结果见本节末的「最终判定」：
  - 第一轮（与治理单测并发，机器满载）：**995 通过 / 1 文件红**，另有一条 runner 级
    `Vitest caught 1 unhandled error … Timeout calling "onTaskUpdate"`。
  - 第二轮（单独跑）：**994 通过 / 2 条红**——`tests/floating-chat.test.tsx > skill intake (TEST-044) ④
    a registration receipt that excludes files says so` 与 `tests/wake-settings.test.tsx > WakeSettings ①`。
  - 隔离复跑：三文件一起跑时 `wake-settings ①` 绿；`floating-chat ④` 单例单跑 **77 ms 通过**
    （在全量里它是 **21401 ms**，撞 20 s 的 `testTimeout`）。
  - `vitest.config.ts` 的注释记载过同类现象（原文：「一次 `verify:all` 里 27 条红、却一条断言错误都没有，
    隔离重跑 689 全绿」）。
  - 第三轮（机器空闲，但本机 `serve:local` 在跑）：**995 通过 / 1 条红**——又是
    `tests/floating-chat.test.tsx > skill intake (TEST-044) ④`，这次 **28339 ms**（比第二轮的 21401 ms 更慢，
    上限仍是 20 s）。
  - **综合判定（并修正前两次的说法）**：`wake-settings ①` 是偶发抖动（只红过一次，隔离即绿）。
    但 `floating-chat ④` **不是抖动**——2026-10-11 在机器空闲、只跑这一个文件的条件下二分复现：
    `npx vitest run tests/floating-chat.test.tsx`（47 例）④ 红在 **28638 ms**，其余 46 例全过；
    继续二分，`-t "新对话|does not hydrate|skill intake"`（16 例）与
    `-t "request-level error|mid-stream failure|skill intake"`（15 例）各自都红，
    而 `-t "skill intake"`（14 例）、`-t "collapse panel|skill intake"`（21 例）、
    `-t "status light|light is 'off'|re-probes|skill intake"`（17 例）、
    `-t "shows a bottom input|carries no provider|keeps separate assistant|Stop aborts|skill intake"`（18 例）
    全绿——**例数多的绿、例数少的红，所以与负载无关**。再缩到两例
    `-t "request-level error|a registration receipt that excludes"` 则 **365 ms 全绿**，
    说明不存在单一污染源，是「走会话结束 / 错误路径的用例」与 `skill intake` 块的**组合**才触发。
    21–28 s 是撞 `testTimeout` 的**挂住**，不是断言不符（断言不符会在 `waitFor` 的 1 s 后就报）。
  - **第四轮（2026-10-12，把 main 合进 cr/20260930 之后）：117 文件 / 1000 例全绿**，
    `floating-chat ④` 本轮 **12468 ms 通过**，整文件 29112 ms。
  - **最终判定（并收回前面两次说法）**：这一例的耗时在同一台机器、同一棵树上跨越两个数量级，
    而 20 s 的 `testTimeout` 正好落在波动区间内，所以它**时红时绿**。实测谱：
    隔离单例 **77 ms** 绿；两例子集 **365 ms** 绿；14 / 17 / 18 / 21 例子集绿；15 例与 16 例子集红；
    只跑该文件（47 例）红在 **28638 ms**；全量三轮里红过 **21401 ms** 与 **28339 ms**；
    2026-10-12 的全量 **12468 ms 绿**。
    因此先前两种说法都不成立：不是单纯的「满负载抖动」（例数更多的子集反而绿，单跑该文件也能红），
    也不是「确定性失败」（同一棵树的全量跑出过绿）。**能确定的只有一件事**：同文件内其它用例会把这一例的耗时
    推高到秒级甚至接近半分钟，即用例之间确实有相互影响；红绿则取决于那次恰好落在 20 s 的哪一侧。
    21–28 s 是撞 `testTimeout` 的**挂住**，不是断言不符（断言不符会在 `waitFor` 的 1 s 后就报）。
    线索仍是那几例都写 `sessionStorage` 的 `jarvis:chat-session-ended` 或走 `describeSendFailure`，
    而用例之间没有清理 `sessionStorage` 与 `vi.stubGlobal("fetch")`。
    待另立 CR 定位并清理那份状态，**不要用提高该用例超时的方式糊过去**。
    它**与本 CR 无关**（见下一条硬证据）。
  - **与本 CR 无关的硬证据**：该用例 `vi.stubGlobal("fetch", …)` 之后只渲染组件、上传一个 zip，
    `tests/floating-chat.test.tsx` 整个文件不 import `src/lib/chat.ts`——本 CR 唯一改动的文件。
    CR-20260930-railway-healthcheck-buildsha 的记录里也点名过它在全量负载下超时。
  - `tests/chat-stream-disconnect.test.ts` 在四轮全量里都绿。
- 治理检查（本 CR 视角）：`check-ids`、`check-specs`、`check-changes`、`check-doors` 无 FAIL；
  `gate g1`、`gate g2` PASS；`review r1` PASS，`review r2|r3|r4` 报 `SKIPPED_FAST_LANE`（见 CR「级别」行）。

## 4. 真实入口（TEST-631）

**①②③已执行（2026-10-06，用户本机生产构建）。** 环境：删 `.next-prod` 后 `npm run build:local`（exit 0）→ `npm run serve:local`；
`.data/server.log` 的 `server.start` 为 `build="90072cf6c76fb64a1cdb2513640562cffa1e6ac9"`、`node="v24.11.0"`、`env="production"`、`pid=38728`；
不带会话 `GET http://localhost:3000/api/health` → 200 `{"ok":true,"storage":"ok","build":"90072cf…"}`。
身份走 `JARVIS_SINGLE_ADMIN_ID=admin`（回环免登录，REQ-F-080 / DEC-011），Provider 是用户自己的 **DeepSeek `deepseek-chat`**（真实 key、真实往返），
不是测试桩。

- **①断开后保留已生成部分**：`POST /api/chat/stream`（`{"message":"用一句话说明什么是流式响应。"}`）→ 收到 `event: start`
  （`conversationId e9a3257b-c58d-4b90-acd7-ab5bb3441c35`、`messageId 536f2a02…`）与真实首段 `{"type":"delta","text":"流"}` 后 **abort 连接**；
  2.5 s 后 `GET /api/conversations/e9a3257b…/messages` 读回：

  | role | status | content |
  |---|---|---|
  | user | complete | 用一句话说明什么是流式响应。 |
  | assistant | **stopped** | 流 |

  修复前这第二行**根本不存在**（§1 实测 `[["user","complete",…]]`）。用户裁定①在真实路由上成立。
- **②下一次发送不再空等**：紧接着向同一会话 `POST /api/chat/stream`，整轮 **1749 ms** 返回且含 `event: done`
  （这 1749 ms 里还包含 DeepSeek 的真实往返）。修复前实测 15100 ms 是纯空等。
- **③日志分得清**：`.data/server.log` 对两次断开各留一条
  `{"level":"info","event":"chat.turn_abandoned","conversationId":"e9a3257b…"/"28d28970…","noticedAt":"cancel"}`，
  conversationId 与请求一一对应；**全文件 `chat.turn_failed` 零条**——生产那四条的签名在断开场景下不再出现。
- **④公网部署（2026-10-12 补记）**：机器可采的三项成立，需登录态的那半项如实挂起。
  - **部署清单**：Railway project `agent-jarvis`（`5a58f2e8-dc90-4cf0-8e61-7ea07f4a32db`）/ service `agent-jarvis`
    （`b18a7c15-fa6a-4230-87d6-3714923aed02`）/ env `production`（`e66f5ef2-0e28-4e5f-9dc8-d1122ff9d9ec`），
    deployment `090b220f-874b-4e07-9fdf-1a40d775bb27`，`status=SUCCESS`，
    `meta.commitHash=21ca6b6097763efa6ca942038acbefb043c84b58`（即本 CR 合入 main 的合并提交），
    `createdAt 2026-10-12T14:06:35.738Z`；采集命令 `railway status --json`。
    同一 SHA 的托管 CI run `38260510215` 九步全绿（含类型检查、单测/组件/契约、治理 `check ci`、生产构建）。
  - **公网健康**：`GET https://agent-jarvis-production-673e.up.railway.app/api/health` → `200`
    `{"ok":true,"storage":"ok","build":"","uptimeSeconds":55,"timestamp":"2026-10-12T14:10:01.998Z"}`；
    部署前同一探针（14:07:21Z）是 `uptimeSeconds 1035907`——**uptime 归零即新构建已切流**。
    `build` 为空是 CR-20260929-health-logging 已登记的 known_warning，不是本 CR 的回归。
  - **日志面板**：`railway logs --deployment 090b220f-874b-4e07-9fdf-1a40d775bb27` 里有
    `[INFO]  ts="2026-10-12T14:09:06.808Z" event="server.start" build="" node="v24.21.0" pid=25 env="production"`
    ——结构化日志在线上这一版里是活的，所以 `chat.turn_abandoned` 一旦发生就会落到同一个面板。
  - **公网的①②尚未走，原因不是忘了**：`src/app/api/chat/stream/route.ts` 第一步就是
    `requireUserId(await getServerSession(authOptions))`；线上 `NEXTAUTH_URL` 是公网 https 域名且未设
    `JARVIS_SINGLE_ADMIN_ID`，免登录路径按 `src/lib/auth-guard.ts:102-113` 被明确拒绝。
    所以公网那一遍必须由持有该 Google 身份的 owner 在浏览器里做一次（发一条消息、回复流到一半刷新或关面板，
    再回到该会话看是否带「已停止」标记，并紧接着再发一条看是否立刻开始）。
    **已登记为人工发现项**（`test-results.json` 的 `known_warnings`，`check: manual`），
    做完在 `railway logs` 里应能看到 `[INFO] … event="chat.turn_abandoned"`。

**两点如实说明**：
1. ①②③那一轮跑在修复提交之前，所以 `build` 等于 `git rev-parse HEAD`（都是 `90072cf`）这条**常规新鲜度核对在当时不足以证明跑的是新代码**
   ——真正的证明来自行为：`chat.turn_abandoned` 这个事件名只存在于本 CR 的代码里，旧构建不可能写出这两行。
2. 界面上的行内「已停止」标记由 `src/components/FloatingChat.tsx:1348-1349` 按 `message.status === "stopped"` 渲染
   （文案 `chat.stopped` = 「（已停止）」）。本次核对的是它所依据的**库内状态**，**未经浏览器目视**；
   目视那一步留给用户，随④的公网那一遍一并确认（见上）。

## 5. 局限（如实登记）

- **触发源未知**（见 §1 末）。本 CR 消除的是后果，不是触发源；`noticedAt` 只对下一次有用。
- **`send` 的 try/catch 会把非断开的 enqueue 失败也转为「放弃」**，静默。TEST-630 ④ 守住真故障那一侧，但「enqueue 因别的原因失败」这一类本身没有单独的检查——仓库里碰不到。
- **代理空闲断流没有防护**。本 CR 不加 SSE 心跳：心跳只能让断开更早被发现，而本 CR 修的是发现之后的三连抛。如果日后证实 Railway 边缘会掐长连接，那是另一条 CR。
- **15 秒等待上限仍在**。槽位泄漏修掉之后它只是超时兜底；若将来还有别的路径让 `settled` 不解决，症状会是同样的十几秒空等，只是日志里会先有一条 `chat.turn_abandoned`。
- **`npm run test:smoke` 在 main 上就是红的，本 CR 没修它**：smoke 自己拉起的 `next dev` 编译 `/instrumentation` 时报
  `UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins`，import trace 为
  `node:crypto → ./src/lib/log.ts`（CR-20260929-health-logging 引入），随后 `GET /` 持续 500、`waitForApp` 超时。
  **已复验与本 CR 无关**：把本 CR 唯一的源码改动 `git stash push src/lib/chat.ts` 掉再跑，报错一字不差。
  CI 按 DEC-480 ① 不跑 smoke，所以此前没被拦住；生产构建不受影响（§4 的真实入口就在它上面做的）。
  已登记 known_warning（`check: manual`），待另立 CR。
- **生产那四次失败的会话本身不会被追认**：它们的助手行当时没有落库，本 CR 不做数据补写。
