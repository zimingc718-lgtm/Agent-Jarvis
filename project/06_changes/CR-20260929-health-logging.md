# CR-20260929-health-logging

- 级别: L2（标准档：全部 CP 双向门——新增两个横切模块、一条免登录路由、一个 instrumentation 钩子、一个 `railway.json`、十来处一行日志，`git revert` 即回滚；不动 schema、不动用户数据；Railway 健康检查是否真的执行、日志面板是否出现事件行，由部署结果与面板核对，登记为人工发现项）
- 提出人: user（INPUT-2026-09-28-004 第二项：健康检查 + 服务端日志；裁定③④）
- 状态: CLOSED（2026-09-30 闭环：TASK-610 DONE，TEST-610 / 611 / 613 PASS、TEST-612 真实入口①②PASS（`entry: user`）；L2 标准档，R1 由用户 2026-09-28 两轮 AskUserQuestion 终裁；R1–R4 全 PASS；TEST-610 / 611 / 613 PASS，TEST-612 真实入口①②PASS；`tsc` 0 错误；治理单测 141 通过；UI 契约 53 规则 0 FAIL；`npx vitest run` 定向 12 文件 96/96 通过；全量 115 文件 / 992 例：990 通过，2 例在全量负载下超时——既有 flaky tests/floating-chat.test.tsx skill intake ④ 与 tests/language-toggle.test.tsx ②；language-toggle 单独重跑 3/3 通过；floating-chat ④ 本次连单文件重跑也超时（CR 分支与未改动 main 代码各 2 次同样超时，与本 CR 无关），托管 runner 结果以本分支推送的 CI 为准——已跑：推送 `387b34e` 后 GitHub Actions run 36658307336（https://github.com/zimingc718-lgtm/Agent-Jarvis/actions/runs/36658307336）六步全绿，1 分 26 秒，含全量 vitest，floating-chat ④ 在 ubuntu runner 上通过；用户 2026-09-30 snapshot ledger seq 149 后快进合入 main（`911e7e6`），合并后 `verify` PASS；③ Railway 带健康检查的部署与公网 `/api/health` 在闭环推送后按实际补记于 EV-2026-09-29-health-logging §4；本机服务已在跑本 CR 的构建 `RaB5d4hapLaXp2jIvm0yK`，无需再重建）
- 占用 ID: REQ-NF-063, DEC-490, TASK-610, TEST-610, TEST-611, TEST-612, TEST-613
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: 无既有需求变更；新增 REQ-NF-063
- 影响模块: MOD-API（新增 `/api/health`；`chat/stream`、`entities`、`knowledge`、`skills`、`skills/[name]`、`documents/raw` 六个路由的 500 分支加 `requestId` 与日志；`chat/wake`、`entities/sweep` 各留一行结果）、MOD-CHAT-CORE（`chat.ts` 失败下沉与轮失败、`agent-loop.ts` 工具抛错各留一行）、横切新增 `src/lib/health.ts` `src/lib/log.ts` `src/instrumentation.ts`；部署 `railway.json`；`tests/setup.ts` 一行环境变量；文档 `docs/ARCHITECTURE.md` `docs/LOCAL_CONFIGURATION.md` CLAUDE.md §四
- 影响任务: 无既有任务变更，新增 TASK-610
- 影响测试: 无既有测试断言变更（`tests/setup.ts` 加 `JARVIS_SERVER_LOG=off` 一行）；新增 TEST-610, TEST-611, TEST-612, TEST-613
- 当前证据: `project/05_evidence/EV-2026-09-29-health-logging.md`
- 方案选项:
  - A. 只加 `/api/health`，日志继续为零——用户否决：两项一起选的（INPUT-2026-09-28-004），服务端至今没有一行自己的日志，出了 500 只有浮窗里一句话。
  - B. **`src/lib/health.ts` + `/api/health`（免登录、`force-dynamic`、真开一次库、只报构建号 / 存储 / 运行时长 / 时间戳，存储不可用 503）+ `railway.json` 健康检查；`src/lib/log.ts`（JSON 行写 stdout 并追加 `.data/server.log`，按大小滚动，键名黑名单 + 密钥打码，`logRouteFailure` 生成 `requestId`）+ `src/instrumentation.ts`（启动行与未捕获异常）；落点为六个路由 500、`chat.ts`、`agent-loop.ts`、`chat/wake`、`entities/sweep`（用户裁定③④）**——选中。
  - C. 引入 pino / winston——不选：多一个运行依赖换来的是格式化与传输，本项要的是十几行代码和一份守得住的黑名单。
  - D. 日志只写 stdout——用户否决（裁定④）：本机 supervisor 重启后 stdout 就没了，要本机文件。
  - E. 健康检查复用 `/api/knowledge` 一类既有只读路由——不选：要登录、回真实数据，也证明不了「哪个构建在跑」。
- 选择理由: 两点裁定直接给出形态；健康报告的四个字段没有一个是用户数据，所以可以不过守卫；日志模块自写而不引库，是因为要守住的是「不记什么」而不是「怎么记」——黑名单与打码写在序列化之前，任何调用方都绕不过；`instrumentation.ts` 只在 Next 自带的保活处理器旁加一行结构化记录，不改退出行为；`requestId` 同时进日志与 500 响应体，用户能从错误里引用、操作者能在日志里 grep 到。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交；路由、模块、钩子、`railway.json` 与十来处日志行一并消失，六个路由的 500 响应体回到只有 `message`。
  - 数据：无 schema 变更；`.data/server.log`（与 `.log.1`）是追加日志，回滚后留在原地、可直接删除。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260929-health-logging` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-610 DONE；TEST-610、TEST-611、TEST-613 PASS，TEST-612 真实入口 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿；`python -m unittest tests.test_governance` 通过；`npm run governance:ci` PASS；架构图守卫与模块图守卫通过。
- 真实入口: 已执行（①②2026-09-29 本机重建重启后（HEAD `0af1513`）不带会话 GET `/api/health` → 200、`build` 等于 HEAD、`storage: ok`，`.data/server.log` 出现 `server.start` 与 `wake.outcome` 行且无 text；③合入 main 推送后 Railway 带健康检查的部署与公网 `/api/health` 在闭环推送后补记于 EV-2026-09-29-health-logging §4）
  - **真实入口（必做）**：①本机 `build:local` + `serve:local` 重启后，不带会话 `GET http://localhost:3000/api/health` → 200，`build` 等于 `git rev-parse HEAD`，`storage: ok`；`.data/server.log` 出现 `server.start` 行且 `build` 一致；②触发一次唤醒后 `.data/server.log` 出现 `wake.outcome` 行且无 text（开关开着就是一次真实唤醒，与界面定时器相同）；③合入 main 推送后 Railway 部署（带 `healthcheckPath`）成功并切流量，公网域名不登录 `GET /api/health` → 200 且 `build` 为所部署提交。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：用户从八个候选里选定本项，再就 `/api/health` 的内容边界与日志形态两点裁定。
- R1 终裁: 已完成 | 用户 | 2026-09-28

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：用户 2026-09-28 原话「继续，参考业界最佳的方案，完善与优化这个系统。」；协调会话逐项核实仓库现状后列出八个缺口经 AskUserQuestion 请用户挑，用户选「部署前 CI 门禁」与「健康检查 + 服务端日志」两项；随后就本项两点裁定：③`/api/health` 免登录、只报非敏感状态（构建提交号、存储可用性、运行时长、时间戳），存储不可用返 503，Railway healthcheck 指向它；④日志为 JSON 行写 stdout 并追加本机 `.data/server.log`，带 requestId，覆盖路由 500、对话轮失败、工具执行失败、Provider 失败下沉、唤醒 / 巡检结果、启动与未捕获异常，不记请求体、凭据与对话正文。前一项已由 CR-20260928-ci-gate 承接并闭环；本 CR 承接后一项。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | `/api/health` 免登录只报非敏感状态（构建号 / 存储 / 运行时长 / 时间戳），存储不可用 503；Railway 部署健康检查指向它 | REQ-NF-063 ①（新增） | 新增 | 双向 | 真实入口：本机重建重启后与 Railway 部署后不带会话 GET `/api/health` 200 且 `build` 等于所部署提交（证据：TEST-612） |
| CP-2 | 产品 | 结构化日志：JSON 行写 stdout 并追加 `.data/server.log`（滚动），`requestId` 进日志与 500 响应体，覆盖七类事件，不记请求体 / 凭据 / 对话正文 | REQ-NF-063 ②③（新增） | 新增 | 双向 | 机器：`tests/log.test.ts`（TEST-611）+ `tests/server-log-sites.test.ts`（TEST-613） |
| CP-3 | 架构 | `health.ts` / `log.ts` / `instrumentation.ts` / `railway.json` 与三个环境变量；Next 自带保活处理器旁加一行结构化记录，不改退出行为 | DEC-490（新增） | 新增 | 双向 | 机器：TEST-610 + TEST-611 + `tests/architecture-doc.test.ts` + `tests/module-graph.test.ts` |
| CP-4 | 模块 | 六个路由 500 分支、`chat.ts`、`agent-loop.ts`、`chat/wake`、`entities/sweep` 的日志落点；`tests/setup.ts` 置 off；三份文档改探针为 `/api/health` | TASK-610 | 新增 | 双向 | 机器：TEST-613 + `npx tsc --noEmit` + 既有路由 / 对话 / 唤醒 / 巡检测试断言不变 |
| CP-5 | 测试 | 新增 TEST-610（健康路由 2 例）、TEST-611（日志 5 例）、TEST-612（真实入口）、TEST-613（落点 3 例） | TEST-610, TEST-611, TEST-612, TEST-613 | 新增 | 双向 | 机器：`npx vitest run tests/health-route.test.ts tests/log.test.ts tests/server-log-sites.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260929-health-logging` 节后，跑 `governance.py matrix CR-20260929-health-logging` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 落实裁定③：免登录、四个非敏感字段、存储不可用 503、Railway healthcheck 指向它 | APPROVED 纯函数 `healthReport` + 注入探针，路由 `force-dynamic`；构建号与页面 `jarvis-build` 同源，`build` ≠ HEAD 即旧构建 | APPROVED 落点为 `health.ts`、`/api/health`、`railway.json` 三处；不动守卫代码，只是不调用它 | APPROVED 机器 TEST-610 两条 503 分支不必动进程密钥；真实入口 TEST-612 三步（本机 200 + 日志行、唤醒行、Railway 部署） |
| CP-2 | APPROVED 落实裁定④：JSON 行、stdout + 本机文件、`requestId`、七类事件、不记请求体 / 凭据 / 正文 | APPROVED 黑名单与打码在序列化之前、任何调用方绕不过；`logEvent` 永不抛；滚动两份文件即全部留存 | APPROVED 自写十几行不引库；`logRouteFailure` 一处生成 `requestId` 供响应体与日志共用 | APPROVED TEST-611 五例守形态与黑名单，TEST-613 三例守落点 |
| CP-3 | APPROVED 无用户可见行为之外的新增；三个环境变量都有默认值 | APPROVED `instrumentation.ts` 只在 Next 自带保活处理器旁加一行，不 `process.exit`；`health.ts` 独立于路由文件是因为 Next 路由模块只许导出 handler 字段 | APPROVED 新模块只被 lib 与路由引用，组件闭包不触 `node:*`；架构图横切、路由表、数据表、部署形态四处同步 | APPROVED TEST-560 与模块图守卫覆盖新增清单 |
| CP-4 | APPROVED 六个路由的 500 响应体多一个 `requestId` 字段，`message` 不变 | APPROVED 落点与裁定④的七类一一对应：路由 500 / `chat.turn_failed` / `tool.failed` / `provider.failover` / `wake.outcome` / `sweep.outcome` / `server.start` + 未捕获异常 | APPROVED 每处一行、不改控制流；`skills/[name]` 的 `catch {` 改 `catch (error) {`；`tests/setup.ts` 置 off 避免测试写仓库 `.data` | APPROVED TEST-613 覆盖路由 500、工具、唤醒、巡检四类；既有路由 / 对话 / 唤醒 / 巡检测试断言不变 |
| CP-5 | APPROVED 无用户可见行为之外的测试 | APPROVED 断言日志的测试自行开日志、只走 stdout，不写文件 | APPROVED 三个新测试文件 + setup 一行 | APPROVED 定向与全量见 EV §3 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-610 ① 对应验收条件①③ | APPROVED 与 DEC-490 ① 一致 | APPROVED 三处落点逐条可审阅可回滚 | APPROVED TEST-610 / TEST-612 |
| CP-2 | APPROVED REQ-NF-063 ②③ | APPROVED 与 DEC-490 ② 一致 | APPROVED TASK-610 ② | APPROVED TEST-611 / TEST-613 |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 与 DEC-490 ①②③ 一致 | APPROVED TASK-610 ①②⑤ | APPROVED TEST-610 / TEST-611 + TEST-560 |
| CP-4 | APPROVED 无需求层遗留 | APPROVED 与 DEC-490 ④ 一致 | APPROVED TASK-610 ③④⑤ | APPROVED TEST-613 |
| CP-5 | APPROVED 无遗留 | APPROVED 无新增基础设施 | APPROVED TASK-610 ⑥ | APPROVED 见 R2/CP-5 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-09-29 本机重建重启后不带会话 GET `/api/health` 200，`build` 等于 HEAD `0af1513`，`storage: ok` | APPROVED `server.start` 行的 `build` 与响应一致，证明健康报告、日志模块与 instrumentation 钩子在真实生产构建里成立 | APPROVED 唤醒后 `wake.outcome` 行只有 kind / manual、没有 text——落点与黑名单在真实服务上成立（开关为开，真实跑了一次 noop 唤醒）；③ Railway 部署侧在闭环推送后补记 | APPROVED TEST-612 `real_entry: true`（`entry: user`）；证据 EV-2026-09-29-health-logging §4 |
| CP-2 | APPROVED TEST-611 五例全绿 | APPROVED 黑名单与打码经嵌套值与文件内容双重断言 | APPROVED `tsc` 0 错误 | APPROVED `npx vitest run tests/log.test.ts tests/server-log-sites.test.ts` |
| CP-3 | APPROVED `next build` 接受路由导出与 instrumentation 钩子 | APPROVED 架构图守卫与模块图守卫通过 | APPROVED `railway.json` 与三个环境变量已文档化 | APPROVED TEST-560 + `tests/module-graph.test.ts` |
| CP-4 | APPROVED TEST-613 三例全绿 | APPROVED 既有路由 / 对话 / 唤醒 / 巡检测试通过，断言未改 | APPROVED `tsc` 0 错误 | APPROVED 全量回归见 EV §3 |
| CP-5 | APPROVED | APPROVED | APPROVED | APPROVED 全量回归见 EV §3 |
