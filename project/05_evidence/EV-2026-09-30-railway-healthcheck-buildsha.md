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

`npx vitest run`（全量，2026-09-30 本机）：116 文件 / 996 例全部通过（含此前在全量负载下超时过的 floating-chat ④ 与 language-toggle ②）

## 4. 真实入口（2026-09-30 已执行①④，②③待闭环推送后补记）

- 环境: 真实 Railway 服务 `agent-jarvis`（`b18a7c15…`，环境 production）与用户运行中的本机生产构建（HEAD `1775beb`）——不是测试桩
- ① 20:22:08Z `serviceInstanceUpdate(serviceId, environmentId, input:{healthcheckPath:"/api/health", healthcheckTimeout:120})` → `true`；20:22:09Z 读回 `serviceInstance { healthcheckPath healthcheckTimeout }` = `/api/health` / `120`（此前两者都是 `null`）。第一次调用失败过：PowerShell 5.1 把单引号字符串里的双引号原样丢给 node 前会剥掉，JSON 变量成了 `{healthcheckPath:/api/health,…}`，Railway 回「Problem processing request」；内层双引号写成 `\"` 后成功——记入 [[railway-deployment]]。
- ④ 本机重建重启后不带会话 `GET http://localhost:3000/api/health` → 200：`{"ok":true,"storage":"ok","build":"1775beb85050e585d0d3013cd0c538abcafa69d8","uptimeSeconds":5,"timestamp":"2026-09-30T20:31:29.337Z"}`，`build` 等于 `git rev-parse HEAD`（git 可用时行为不变）。
- ②③ 合入 main 推送后：读该次部署的 `meta.serviceManifest.deploy.healthcheckPath` 应为 `/api/health` 且部署 SUCCESS；公网 `GET /api/health` 的 `build` 应等于所部署提交——闭环推送后补记于此。

据此 R4 矩阵 CP-1 四列由 CONDITIONAL 转 APPROVED（以 ①④ 为据；②③ 为部署侧核对，闭环推送后补记）；`test-results.json` TEST-621 `PASS`、`real_entry: true`、`entry: user`。

## 5. 局限（如实登记）

- 服务设置不在仓库里：换服务、换项目、或有人在仪表盘改动，`healthcheckPath` 可能又变回空——每次部署后读部署清单才知道（同「等 CI」）。
- `RAILWAY_GIT_COMMIT_SHA` 是 Railway 私有约定；换平台要再加一个回退。
- 本 CR 不处理「Wait for CI」——那是用户的仪表盘动作，known_warning 保留。
