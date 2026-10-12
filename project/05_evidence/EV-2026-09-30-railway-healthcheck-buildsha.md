# EV-2026-09-30-railway-healthcheck-buildsha

- 来源: 用户 2026-09-30「继续。按你的建议来。」（INPUT-2026-09-30-001）——对 CR-20260929-health-logging 真实入口③核对出的两处按协调会话建议处理
- 时间: 2026-09-30
- 采集者: 协调会话（claude），分支 `cr/20260930-railway-healthcheck-buildsha`
- 支撑对象: `CR-20260930-railway-healthcheck-buildsha` CP-1..CP-4
- 可定位路径: 本文件；`scripts/build-sha.mjs`、`next.config.mjs`、`tests/build-sha.test.ts`、（删除）`railway.json`、`docs/ARCHITECTURE.md` §1.2 与部署形态、CLAUDE.md §六；Railway 服务 `b18a7c15-fa6a-4230-87d6-3714923aed02` / 环境 `e66f5ef2-0e28-4e5f-9dc8-d1122ff9d9ec` 的 `serviceInstance.healthcheckPath`

## 1. 起因（2026-09-30 的核对事实）

CR-20260929-health-logging 合入 main（`a92128e`）后，Railway 部署 `0d9c1fc4-48cf-42a3-8daf-1a560f2865d6`（14:10:24Z 创建、14:12:08Z SUCCESS）：`railway api` 查该部署 `meta.serviceManifest.deploy.healthcheckPath` 为 `null`、`fileServiceManifest` 为 `{}`——仓库根的 `railway.json` 没有被读取；`railway` CLI 同时警告「Config as Code (railway.json / railway.toml) is deprecated. Prefer Infrastructure as Code (.railway/railway.ts) … Existing files keep working until 2026-12-01」。运行日志里没有任何健康检查行。公网 `GET /api/health` 不登录 → 200，但 `build` 为 `""`：`next.config.mjs` 的 `buildSha()` 在 Railpack 构建环境里执行 `git rev-parse HEAD` 失败（构建上下文没有 `.git`），按设计留空。两处已作为 known_warning `railway-healthcheck-not-applied` / `railway-build-sha-empty` 登记在 `test-results.json`。

## 2. 设计与代码核对

- **健康检查**：`ServiceInstanceUpdateInput` 确有 `healthcheckPath` / `healthcheckTimeout` 两个字段（此前核对「Wait for CI」时已列出），`serviceInstanceUpdate` 就是仪表盘 Settings → Deploy 那两格的 API 形态；设完先读回 `serviceInstance`，再看下一次部署的 `meta.serviceManifest.deploy.healthcheckPath`——只有后者能证明「这次部署真的带着健康检查」。`railway.json` 删除：留着只会让下一个人以为它生效。
- **构建号**：`scripts/build-sha.mjs` 的 `resolveBuildSha(env, head)` 是纯函数（git 与环境都可注入），顺序 git → `RAILWAY_GIT_COMMIT_SHA` → 空；只接受 7–40 位十六进制，别的都当作没有——宁可让检查报「拿不到」，也不编值。`next.config.mjs` 只剩一行引用；本机行为不变（git 答得出）。
- **文档**：架构图部署形态行与 §1.2 把「`railway.json`」改成「服务设置」并写明核对办法；CLAUDE.md §六 那条「等 CI 是仪表盘设置」的纪律扩到健康检查。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-620 | `tests/build-sha.test.ts` | 4 | git 优先；回退 `RAILWAY_GIT_COMMIT_SHA` 并去空白；皆无或非十六进制留空；仓库里 git 真答得出且 `next.config.mjs` 用的是该解析器 |
| 既有 | `tests/architecture-doc.test.ts`、`tests/ci-workflow.test.ts`、`tests/health-route.test.ts` | — | 架构图守卫仍过；CI 工作流守卫不受影响；健康路由不变 |

`npx tsc --noEmit`：**0 错误（为 `.mjs` 加 `scripts/build-sha.d.mts` 声明后）**。治理单测 141 通过；UI 契约 53 规则 0 FAIL；定向 4 文件 16/16

`npx vitest run`（全量，2026-09-30 本机）：116 文件 / 996 例全部通过（含此前在全量负载下超时过的 floating-chat ④ 与 language-toggle ②）；托管 runner：推送 `87b3821` 后 GitHub Actions run 36773361345（https://github.com/zimingc718-lgtm/Agent-Jarvis/actions/runs/36773361345）六步全绿，1 分 33 秒，含 `build:verify`

## 4. 真实入口（2026-09-30 执行①④；②③于 2026-10-12 补记，四项全部成立）

- 环境: 真实 Railway 服务 `agent-jarvis`（`b18a7c15…`，环境 production）与用户运行中的本机生产构建（HEAD `1775beb`）——不是测试桩
- ① 20:22:08Z `serviceInstanceUpdate(serviceId, environmentId, input:{healthcheckPath:"/api/health", healthcheckTimeout:120})` → `true`；20:22:09Z 读回 `serviceInstance { healthcheckPath healthcheckTimeout }` = `/api/health` / `120`（此前两者都是 `null`）。第一次调用失败过：PowerShell 5.1 把单引号字符串里的双引号原样丢给 node 前会剥掉，JSON 变量成了 `{healthcheckPath:/api/health,…}`，Railway 回「Problem processing request」；内层双引号写成 `\"` 后成功——记入 [[railway-deployment]]。
- ④ 本机重建重启后不带会话 `GET http://localhost:3000/api/health` → 200：`{"ok":true,"storage":"ok","build":"1775beb85050e585d0d3013cd0c538abcafa69d8","uptimeSeconds":5,"timestamp":"2026-09-30T20:31:29.337Z"}`，`build` 等于 `git rev-parse HEAD`（git 可用时行为不变）。
- **② 2026-10-12 补记：成立。** 服务设置确实进了部署清单——不需要等本 CR 合并，CR-20261006-chat-stream-disconnect
  推送产生的两次真实部署就能核：
  - deployment `090b220f-874b-4e07-9fdf-1a40d775bb27`（main `21ca6b6`）与 `9e597e86-a0bf-4b6d-be9f-7b42ab2051c8`
    （main `33c9582`，`status=SUCCESS`）的 `meta.serviceManifest.deploy.healthcheckPath` 均为 `/api/health`、
    `healthcheckTimeout` 均为 `120`；采集命令 `railway status --json`（采集者：协调会话，2026-10-12）。
    此前 2026-09-30 的部署 `0d9c1fc4` 读到的是 `null`——差别正是本 CR ① 那一次 `serviceInstanceUpdate`。
  - 同一次部署的 `meta.fileServiceManifest` 仍是 `{}`：**仓库根的 `railway.json` 一个字段都没进清单**，
    而此刻它还在仓库里（本 CR 的删除尚未合入 main）。DEC-500 ① 的前提因此在一次新部署上重新成立。
  - **一处要说准**：同一次部署的日志里 Railway 确实对该文件发了弃用警告——
    `warning: Config as Code (railway.json / railway.toml) is deprecated. Prefer Infrastructure as Code
    (.railway/railway.ts) … Existing files keep working until 2026-12-01`。
    所以准确的说法是「被看见，但没有被采纳进该次部署的清单」，不是「平台完全无视这个文件」。
    删掉它的理由不变：留着只会让人以为健康检查是由仓库文件配置的，而清单显示它不是。
    平台给出的 2026-12-01 期限也说明这条路本来就要废。
- **③ 2026-10-12 补记：成立。** 本 CR 自己合入 main（`193acfa`）并部署后，构建号第一次在 Railway 上落下来了：
  - 部署：deployment `6227c595-87f4-42d6-9589-3e80d84bd2ee`，`status=SUCCESS`，`meta.commitHash=193acfae215ac64add9979ea3d153db35c4a1cab`，`createdAt 2026-10-12T22:52:33.703Z`；
    同一清单里 `healthcheckPath` 为 `/api/health`、`healthcheckTimeout` 为 `120`，`fileServiceManifest` 为 `{}`。
  - 公网 `GET https://agent-jarvis-production-673e.up.railway.app/api/health` → `200`
    `{"ok":true,"storage":"ok","build":"193acfae215ac64add9979ea3d153db35c4a1cab","uptimeSeconds":35,"timestamp":"2026-10-12T22:55:02.653Z"}`
    ——`build` **等于所部署提交，也等于本地 `git rev-parse HEAD`**。部署前同一探针得的是 `build:""`（14:10:02Z）。
  - 页面 meta 同步生效：`GET /` 的 `<meta name="jarvis-build" content="193acfae215ac64add9979ea3d153db35c4a1cab"/>`。
  - 日志面板：`[INFO]  ts="2026-10-12T22:54:27.624Z" event="server.start" build="193acfae215ac64add9979ea3d153db35c4a1cab" node="v24.21.0" pid=25 env="production"`
    ——`server.start` 的 `build` 不再是空串，「哪个构建在跑」从此在 Railway 上也答得出。
  - **附带一项确认**：这次的部署日志里**再没有** `warning: Config as Code (railway.json / railway.toml) is deprecated`
    那一行——因为文件已随本 CR 删除。此前它和 `fileServiceManifest` 为 `{}` 并存，正是「被看见但没被采纳」的证据。
  - 采集命令：`railway status --json`、`curl -s …/api/health`、`curl -s …/ | grep jarvis-build`、
    `railway logs --deployment 6227c595-87f4-42d6-9589-3e80d84bd2ee`（采集者：协调会话，2026-10-12）。
- **③ 的第二次独立复核（2026-10-12 23:02–23:18Z，同日下一次部署）**：结论不是只在一次部署上成立。
  deployment `19d96f14-2c3d-4e27-871a-f8575dd6f5bb`（main `14cf39d`，`status=SUCCESS`）：
  - 公网 `GET /api/health` → `200 {"ok":true,"storage":"ok","build":"14cf39d85dec8816640b2d8baf1f8b946a273e03","uptimeSeconds":943,…}`；
    `GET /` 的 `<meta name="jarvis-build" content="14cf39d85dec8816640b2d8baf1f8b946a273e03"/>`；两者都等于该次部署的 `meta.commitHash`。
  - 清单 `healthcheckPath=/api/health`、`healthcheckTimeout=120`、`fileServiceManifest={}`。
  - 日志（`railway logs --deployment 19d96f14-2c3d-4e27-871a-f8575dd6f5bb`，共 14 行）：
    `[INFO]  ts="2026-10-12T23:02:41.374Z" event="server.start" build="14cf39d85dec8816640b2d8baf1f8b946a273e03" node="v24.21.0" pid=25 env="production"`；
    **`Config as Code … deprecated` 0 行**（连续两次部署都没有，文件删除的效果稳定），
    `chat.turn_failed` / `route.failed` / `[ERROR]` / 未捕获异常 **各 0 行**。
  - 另外 `GET /api/auth/csrf` → `200`，说明 NextAuth 在这一版上正常起着。
- **顺带废掉两条 known_warning**（两条原文都写着「另立 CR 处理后删除本条」，本 CR 就是那条）：
  CR-20260929-health-logging ③ 的「`railway.json` 未被读取、健康检查没拦在部署前」与「Railway 上 `build` 为空」
  已由本 CR 的 ①②③ 分别消除，已从 `test-results.json` 删除。
- **仍未消除的一条**：「Wait for CI」第三次复核**依旧未生效**，而且这次是决定性的——
  deployment `6227c595-87f4-42d6-9589-3e80d84bd2ee` 的 `server.start` 在 `22:54:27.624Z`，而同一提交的 CI run `38319114665`
  到 `22:54:43Z` 才结束（`createdAt 22:52:34Z`）：**新构建比 CI 绿早 16 秒就在对外服务了**。
  本 CR 不处理它（那是用户的仪表盘动作），known_warning 已按这次的时间戳更新。

据此 R4 矩阵 CP-1 四列由 CONDITIONAL 转 APPROVED（①②③④ 四项全部实测成立）；`test-results.json` TEST-621 `PASS`、`real_entry: true`、`entry: user`。

## 5. 局限（如实登记）

- 服务设置不在仓库里：换服务、换项目、或有人在仪表盘改动，`healthcheckPath` 可能又变回空——每次部署后读部署清单才知道（同「等 CI」）。
- `RAILWAY_GIT_COMMIT_SHA` 是 Railway 私有约定；换平台要再加一个回退。
- 本 CR 不处理「Wait for CI」——那是用户的仪表盘动作，known_warning 保留；2026-10-12 的第三次复核见 §4，这次有决定性时间差（服务起于 22:54:27.624Z，CI 22:54:43Z 才绿）。
- `railway.json` 的措辞已按实测收紧（见 §4 ②）：被平台看见并警告，但没进部署清单。本 CR 不迁 `.railway/railway.ts`——平台给的期限是 2026-12-01，等有第二个设置要管再迁（DEC-500 选项 A 的理由不变）。
