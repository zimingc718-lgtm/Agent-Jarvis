# EV-2026-09-29-health-logging

- 来源: 用户 2026-09-28「继续，参考业界最佳的方案，完善与优化这个系统。」（INPUT-2026-09-28-004）→ 从八个核实过的缺口里选「健康检查 + 服务端日志」；两点 AskUserQuestion 裁定（`/api/health` 免登录只报非敏感状态 / 日志 JSON 行写 stdout + 本机文件）
- 时间: 2026-09-29
- 采集者: 协调会话（claude），分支 `cr/20260929-health-logging`
- 支撑对象: `CR-20260929-health-logging` CP-1..CP-5（INPUT-2026-09-28-004 第二项）
- 可定位路径: 本文件；`src/lib/health.ts`、`src/lib/log.ts`、`src/app/api/health/route.ts`、`src/instrumentation.ts`、`railway.json`、`src/lib/chat.ts`（`provider.failover` / `chat.turn_failed`）、`src/lib/agent-loop.ts`（`tool.failed`）、六个路由的 500 分支、`src/app/api/chat/wake/route.ts`、`src/app/api/entities/sweep/route.ts`、`tests/setup.ts`、`tests/health-route.test.ts`、`tests/log.test.ts`、`tests/server-log-sites.test.ts`、`docs/ARCHITECTURE.md`、`docs/LOCAL_CONFIGURATION.md`、CLAUDE.md §四

## 1. 摸底与裁定

核实（2026-09-28）：仓库没有 `/api/health`，也没有任何服务端日志——路由的 500 分支只回一句 `message`，`chat.ts` 的失败下沉只在流末尾给用户一句通知，工具抛错只作为 tool 结果回喂模型，进程启动与未捕获异常无任何记录；Railway 的部署没有健康检查（`ServiceInstanceUpdateInput` 有 `healthcheckPath` 字段，服务从未设置）；本机判断「服务是否还活着」靠打 `/api/knowledge`（要登录、回真实数据、证明不了哪个构建在跑——2026-09-17 那次 246 条知识条目误删的根因正是「200 探活替代了构建比对」）。看护进程 `scripts/serve-local.mjs` 只记自己的启停事件（`.data/server-events.log`），不是服务进程的日志。

用户两点裁定：③`/api/health` 免登录、只报非敏感状态（构建提交号、存储可用性、运行时长、时间戳），存储不可用返 503，Railway healthcheck 指向它；④日志为 JSON 行写 stdout 并追加本机 `.data/server.log`，带 requestId，覆盖路由 500、对话轮失败、工具执行失败、Provider 失败下沉、唤醒 / 巡检结果、启动与未捕获异常，不记请求体、凭据与对话正文。

## 2. 设计与代码核对

- **健康报告**：`healthReport()` 是纯函数——`configured` 与 `probeStore` 由路由注入，所以 503 的两条分支（未配置 / 库打不开）不必动进程自己的 `JARVIS_SECRET_KEY` 就能测。放在 `src/lib/health.ts` 而不是路由文件里，还因为 Next 的路由模块只允许导出 handler 字段（`next build` 会对多余导出报类型错）。路由 `force-dynamic` + `cache-control: no-store`；探针是 `readLanguage(getStore())`——真开一次库、读一行。构建号取 `NEXT_PUBLIC_BUILD_SHA`，与页面 `jarvis-build` meta 同源（`next.config.mjs` 在构建时以 `git rev-parse HEAD` 编进产物），所以 `build` ≠ HEAD 直接等于「在跑旧构建」。
- **日志模块**：`logEvent` 永不抛（序列化失败降级为一行 `unserializable: true`，写失败吞掉）；黑名单在序列化前按键名（小写比较）丢弃，`scrub` 递归进对象与数组，把 `sk-…` 与 `Bearer …` 打码；`error` 级别走 stderr，Railway 日志面板据此标红。文件满 `JARVIS_SERVER_LOG_MAX_BYTES`（默认 5 MiB）`renameSync` 到 `.1`（Windows 上 Node 的 rename 以 `MOVEFILE_REPLACE_EXISTING` 覆盖旧 `.1`），两份文件就是全部留存。三个开关：`JARVIS_SERVER_LOG=off` 全关、`JARVIS_SERVER_LOG_PATH` 留空只写 stdout、`JARVIS_SERVER_LOG_MAX_BYTES`。
- **测试隔离**：`tests/setup.ts` 统一置 `JARVIS_SERVER_LOG=off`——否则每个开真 SQLite 的路由测试都会往仓库自己的 `.data/server.log` 追加、并把 JSON 行喷进 runner 输出。三份断言日志的测试在文件顶部自行 `delete` 该变量并把路径置空（只走 stdout），`afterAll` 复原。
- **instrumentation**：Next 的 `next-server.js` 已装 `unhandledRejection` / `uncaughtException` 处理器（`console.error` 并保活，"Install a new handler to prevent the process from crashing"）；`register()` 只在旁边再挂两个监听写结构化行，不 `process.exit`、不改任何退出行为；`NEXT_RUNTIME !== "nodejs"` 直接返回。
- **落点**：六个路由 500 分支用 `logRouteFailure(route, error)` 拿 `requestId` 并放进响应体（`skills/[name]` 的 `catch {` 改为 `catch (error) {`）；`chat.ts` 在 `failoverNote` 赋值处记 `provider.failover`（from / to / why），在流的 provider 错误分支与 catch 分支各记 `chat.turn_failed`（stage 区分）；`agent-loop.ts` 在工具 catch（非 aborted）与未知工具分支记 `tool.failed`——只记工具名、callId、conversationId、错误消息，`call.function.arguments` 永不进日志；`chat/wake` 记 `wake.outcome`（kind / reason / manual，notice 只带 conversationId 不带 text）；`entities/sweep` 记 `sweep.outcome`（ran / reasonCode / count / changed / failed / remaining / force）。
- **守卫**：`tests/server-strings-guard.test.ts` 的正则只认 `t(` / `ts(` / `coded(` 等调用名，`logEvent("x.y")` 的事件名不会被当作字典码；`tests/ui-strings-guard.test.ts` 扫 `src/app`，新路由无中文字面量；`tests/architecture-doc.test.ts` 要求 `health.ts`、`log.ts` 与 `/api/health` 出现在架构图里；`scripts/check-module-graph.mjs` 的 `node:*` 闭包检查从组件出发，`log.ts` 只被 lib 与路由引用。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-610 | `tests/health-route.test.ts` | 2 | 免登录 200、`no-store`、恰好五个键、`force-dynamic`；未配置 / 库打不开两条 503 分支并记 `health.store_failed` |
| TEST-611 | `tests/log.test.ts` | 5 | JSON 行到 stdout 与文件；黑名单键丢弃与嵌套打码；`errorFields` / `newRequestId` / `logRouteFailure`；超限滚动；空路径与 `off` |
| TEST-613 | `tests/server-log-sites.test.ts` | 3 | 路由 500 的 `requestId` 与 `route.failed` 一致且打码；`tool.failed` 不含参数与用户消息；`wake.outcome` / `sweep.outcome` 只有类别与计数 |
| 既有 | `tests/architecture-doc.test.ts`、`tests/module-graph.test.ts`、`tests/server-strings-guard.test.ts`、`tests/ui-strings-guard.test.ts` | — | 架构图、分层、字典码、零中文字面量守卫仍过 |

`npx tsc --noEmit`：**0 错误**。治理单测 141 通过；UI 契约 53 规则 0 FAIL；`npx vitest run` 定向 12 文件 96/96 通过

`npx vitest run`（全量，2026-09-29 本机）：115 文件 / 992 例：990 通过，2 例在全量负载下超时——既有 flaky tests/floating-chat.test.tsx skill intake ④ 与 tests/language-toggle.test.tsx ②；language-toggle 单独重跑 3/3 通过；floating-chat ④ 本次连单文件重跑也超时（CR 分支与未改动 main 代码各 2 次同样超时，与本 CR 无关），托管 runner 结果以本分支推送的 CI 为准——已跑：推送 `387b34e` 后 GitHub Actions run 36658307336（https://github.com/zimingc718-lgtm/Agent-Jarvis/actions/runs/36658307336）六步全绿，1 分 26 秒，含全量 vitest，floating-chat ④ 在 ubuntu runner 上通过

## 4. 真实入口（2026-09-29 已执行①②；2026-09-30 闭环推送后补记③——部分成立）

- 环境: 用户运行中的本机生产构建（`npm run build:local` → `.next-prod`，`npm run serve:local`，端口 3000），HEAD `0af1513`——不是测试桩
- ① 不带会话 `GET http://localhost:3000/api/health` → 200：`{"ok":true,"storage":"ok","build":"0af1513e9dbf7ffd8f70e7181d2d852a5d881009","uptimeSeconds":4,"timestamp":"2026-09-30T02:04:21.243Z"}`。`build` 等于 `git rev-parse HEAD`，`storage: ok`。`.data/server.log` 出现启动行：`{"ts":"2026-09-30T02:04:19.357Z","level":"info","event":"server.start","build":"0af1513e9dbf7ffd8f70e7181d2d852a5d881009","node":"v24.11.0","pid":19832,"env":"production"}`（`build` 一致）。
- ② `POST /api/chat/wake` 后 `.data/server.log` 出现：`{"ts":"2026-09-30T02:04:22.146Z","level":"info","event":"wake.outcome","kind":"noop","manual":false}`——只有 kind / manual，没有 text。本机的主动唤醒开关是开着的，所以这一下真实跑了一次唤醒（结果 `noop`，用量 497 输入 token），与界面定时器每次触发的行为相同；预案里写的「开关关着、不花 token」与实际不符，按实际登记。
- ③ 合入 main（`a92128e`）推送后（2026-09-30 14:10:23Z），Railway 部署 `0d9c1fc4-48cf-42a3-8daf-1a560f2865d6` 于 14:10:24Z 创建、14:12:08Z SUCCESS 并切流量；公网 `GET https://agent-jarvis-production-673e.up.railway.app/api/health` 不登录 → 200：`{"ok":true,"storage":"ok","build":"","uptimeSeconds":31,"timestamp":"2026-09-30T14:12:35.916Z"}`；同一时刻 `/api/knowledge` 不登录仍 401——免守卫的只有这一条路由。Railway 日志面板里出现 `[INFO] ts=… event="server.start" build="" node="v24.21.0" pid=25 env="production"`——stdout 的 JSON 行被面板解析为带属性的结构化日志，级别识别正确。
  - **成立的部分**：免登录、真开库、`no-store`、其余路由不受影响、日志到面板。
  - **不成立的两处（如实登记，另立 CR）**：(a) `build` 为空——Railpack 的构建环境里没有 `.git`，`next.config.mjs` 的 `buildSha()` 取不到就按设计留空（本机是 `0af1513…`）；候选修法：回退到 Railway 注入的 `RAILWAY_GIT_COMMIT_SHA`。(b) 健康检查没有拦在部署前——`railway api` 查该部署 `meta.serviceManifest.deploy.healthcheckPath` 为 `null`、`fileServiceManifest` 为 `{}`，即 `railway.json` 未被读取；`railway` CLI 同时警告「Config as Code (railway.json / railway.toml) is deprecated. Prefer Infrastructure as Code (.railway/railway.ts)…Existing files keep working until 2026-12-01」，本次并未生效，原因未定。候选修法：迁到 `.railway/railway.ts`，或直接用 `serviceInstanceUpdate`（`ServiceInstanceUpdateInput` 有 `healthcheckPath` / `healthcheckTimeout` 字段，等价于仪表盘设置）并把仓库里的 `railway.json` 删掉以免误导。
  - 「Wait for CI」第二次核对仍未生效：部署 14:10:24Z 创建、14:12:08Z 成功，CI run 36727092953 14:10:25Z 创建、14:12:16Z 才绿。

据此 R4 矩阵 CP-1 四列由 CONDITIONAL 转 APPROVED（以 ①② 为据；③ 于 2026-09-30 核对：免登录 200 与日志到面板成立，`build` 为空与健康检查未生效两项登记 known_warning、另立 CR）；`test-results.json` TEST-612 `PASS`、`real_entry: true`、`entry: user`。

## 5. 局限（如实登记）

- `requestId` 只在 500 响应体里，浮窗不显示；用户要引用它得看网络面板——显示到浮窗另立 CR。
- 日志文件在多实例下会互相覆盖滚动（Railway 目前单实例，架构图「边界」行已写多实例另立 CR）。
- `instrumentation.ts` 的两个监听只能证明装上了——进程活着时不能人为制造未捕获异常，是否真的记下一行由日后第一次真实事件核对。
- Railway 健康检查是否按 `railway.json` 执行、日志面板是否出现事件行，仓库守不住，只能推送后看部署结果与面板。**2026-09-30 核对：日志面板有事件行；健康检查没有生效（部署清单 `healthcheckPath: null`，`railway.json` 未被读取、且该机制已被 Railway 弃用），`build` 在 Railway 上为空——见 §4 ③。**
- 看护进程 `scripts/serve-local.mjs` 自己的事件仍写 `.data/server-events.log`（它在 Next 进程之外），本 CR 不合并两份文件。
