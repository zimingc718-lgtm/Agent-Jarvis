# CR-20260930-railway-healthcheck-buildsha

- 级别: L2（标准档：全部 CP 双向门——一个 Railway 服务设置（可设回 null）、删除一个不被读取的部署文件、一个小脚本与 `next.config.mjs` 一处引用、两处文档；代码部分 `git revert` 即回滚；服务设置是否在下一次部署里生效只能读部署清单核对，登记为人工发现项）
- 提出人: user（INPUT-2026-09-30-001：对 CR-20260929-health-logging ③ 核对出的两处「按你的建议来」）
- 状态: P2-P4 与真实入口①④完成，待 snapshot 与合并（R1 由用户 2026-09-30 一句终裁；R1–R4 全 PASS；TEST-620 PASS，TEST-621 真实入口①④PASS；`tsc` 0 错误（为 `.mjs` 加 `scripts/build-sha.d.mts` 声明后）；治理单测 141 通过；UI 契约 53 规则 0 FAIL；定向 4 文件 16/16；全量 116 文件 / 996 例全部通过（含此前在全量负载下超时过的 floating-chat ④ 与 language-toggle ②）；合并 main 且 `verify` PASS 后转 CLOSED，②③ 闭环推送后补记）
- 占用 ID: DEC-500, TASK-620, TEST-620, TEST-621
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: 无需求文字变更；REQ-NF-063 ① 的落地机制由本 CR 换（见 DEC-500）
- 影响模块: 部署（Railway 服务设置 `healthcheckPath` / `healthcheckTimeout`；删除 `railway.json`）、构建（新增 `scripts/build-sha.mjs`，`next.config.mjs` 改用 `resolveBuildSha()`）、文档（`docs/ARCHITECTURE.md` §1.2 与部署形态、CLAUDE.md §六）
- 影响任务: 无既有任务变更，新增 TASK-620
- 影响测试: 无既有测试变更；新增 TEST-620, TEST-621
- 当前证据: `project/05_evidence/EV-2026-09-30-railway-healthcheck-buildsha.md`
- 方案选项:
  - A. 迁到 `.railway/railway.ts`（Railway 推荐的 IaC）——不选：为一个字段引入一套 IaC 文件与 CLI 迁移步骤，等有第二个设置要管再迁。
  - B. **健康检查改为 Railway 服务设置（`serviceInstanceUpdate` 设 `healthcheckPath: /api/health`、`healthcheckTimeout: 120`，等价仪表盘），删除不被读取的 `railway.json`；构建号解析抽到 `scripts/build-sha.mjs`，git 取不到时回退 Railway 注入的 `RAILWAY_GIT_COMMIT_SHA`；文档同步**——选中（用户「按你的建议来」）。
  - C. 只改文档、健康检查暂不生效——否决：健康检查是 INPUT-2026-09-28-004 裁定③的一部分，不能装作已生效。
  - D. 在构建命令里把提交号写进环境变量——不选：Railway 已注入 `RAILWAY_GIT_COMMIT_SHA`，读它最省、零构建改动。
- 选择理由: 两处都是 CR-20260929-health-logging 真实入口③核对出的事实（部署清单 `healthcheckPath: null`、`fileServiceManifest: {}`、CLI 弃用警告；`build: ""`），修法各取最短路径且都可核对：服务设置读得回来、部署清单看得见、构建号有单测；`railway.json` 留着只会误导下一个人。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交；`scripts/build-sha.mjs` 消失、`next.config.mjs` 回到内联 `buildSha()`、`railway.json` 回来（仍不会被读取）。
  - 设置：`serviceInstanceUpdate` 把 `healthcheckPath` / `healthcheckTimeout` 设回 null。
  - 数据：无。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260930-railway-healthcheck-buildsha` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-620 DONE；TEST-620 PASS，TEST-621 真实入口 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿；`python -m unittest tests.test_governance` 通过；`npm run governance:ci` PASS；`npm run build:local` 成功且本机 `/api/health` 的 `build` 等于 HEAD。
- 真实入口: 已执行（①2026-09-30 20:22:08Z `serviceInstanceUpdate` 设 `healthcheckPath=/api/health`、`healthcheckTimeout=120`，20:22:09Z 读回一致（此前 null）；④本机重建重启后（HEAD `1775beb`）不带会话 GET `/api/health` 200 且 `build` 等于 HEAD；②③合入 main 推送后的部署清单与公网 `/api/health` 的 `build` 在闭环推送后补记于 EV-2026-09-30-railway-healthcheck-buildsha §4）
  - **真实入口（必做）**：①`serviceInstanceUpdate` 后读回 `serviceInstance.healthcheckPath` 为 `/api/health`、`healthcheckTimeout` 为 120；②合入 main 推送后的部署 `meta.serviceManifest.deploy.healthcheckPath` 为 `/api/health` 且部署 SUCCESS；③公网 `/api/health` 不登录 200 且 `build` 等于所部署提交；④本机重建重启后 `/api/health` 的 `build` 仍等于 `git rev-parse HEAD`。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：用户对协调会话逐条给出的建议一句「按你的建议来」。
- R1 终裁: 已完成 | 用户 | 2026-09-30

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：CR-20260929-health-logging 闭环推送后，协调会话核对 Railway 侧发现 `railway.json` 未被读取（健康检查未拦在部署前）、`build` 为空、「Wait for CI」仍未生效三件事并逐条给建议；用户 2026-09-30 原话「继续。按你的建议来。」（INPUT-2026-09-30-001）。前两件由本 CR 承接；第三件是用户的仪表盘动作，known_warning `railway-wait-for-ci-not-enabled` 保留。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | Railway 的健康检查真正生效：服务设置 `healthcheckPath: /api/health`、`healthcheckTimeout: 120`（API，等价仪表盘），部署清单里可见；删除不被读取的 `railway.json` | REQ-NF-063 ①（不变）、DEC-500 ① | 小改 | 双向 | 真实入口：API 读回 + 合入 main 推送后部署清单 `healthcheckPath` 为 `/api/health` 且部署成功（证据：TEST-621） |
| CP-2 | 模块 | 构建号解析抽到 `scripts/build-sha.mjs`：git 取不到时回退 `RAILWAY_GIT_COMMIT_SHA`；`next.config.mjs` 改用它，Railway 上 `/api/health` 的 `build` 不再为空 | DEC-500 ②、TASK-620 | 小改 | 双向 | 机器：`tests/build-sha.test.ts`（TEST-620）+ `npm run build:local` |
| CP-3 | 架构 | 文档：`docs/ARCHITECTURE.md` §1.2 与部署形态改为「服务设置」；CLAUDE.md §六 记「健康检查与等 CI 一样是服务设置，`railway.json` 不会被读取，核对要读部署清单」 | DEC-500 ③ | 小改 | 双向 | 机器：`tests/architecture-doc.test.ts`（TEST-560） |
| CP-4 | 测试 | 新增 TEST-620（构建号解析 4 例）、TEST-621（真实入口四步） | TEST-620, TEST-621 | 新增 | 双向 | 机器：`npx vitest run tests/build-sha.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260930-railway-healthcheck-buildsha` 节后，跑 `governance.py matrix CR-20260930-railway-healthcheck-buildsha` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 用户裁定③「Railway healthcheck 指向 /api/health」终于真的生效；`railway.json` 删掉免误导 | APPROVED 服务设置是 Railway 仪表盘的 API 形态，与「等 CI」同一类外部设置；核对读部署清单而非信文件 | APPROVED 一次 `serviceInstanceUpdate` + 一次 `git rm`，可设回 null、可 revert | APPROVED 真实入口 TEST-621 ①读回、②部署清单、③公网 build；机器对照 TEST-620 |
| CP-2 | APPROVED Railway 上的 `/api/health` 与页面 `jarvis-build` 从此能说出所部署提交，REQ-NF-063 ① 的验收在 Railway 上成立 | APPROVED 纯函数、注入 git 与环境，顺序 git → `RAILWAY_GIT_COMMIT_SHA` → 空，只接受十六进制——不编值的原则不变 | APPROVED `next.config.mjs` 只剩一行引用；本机行为不变 | APPROVED TEST-620 四例含「仓库里 git 真答得出」与「config 用的是这份解析器」两条防漂移断言 |
| CP-3 | APPROVED 文档不再声称 `railway.json` 生效 | APPROVED 架构图两处 + CLAUDE.md §六 一句，把「服务设置、读部署清单核对」写成纪律 | APPROVED 无新增模块 / 路由 / 表，附录清单不变 | APPROVED TEST-560 架构图守卫覆盖 |
| CP-4 | APPROVED 无用户可见行为之外的测试 | APPROVED 单测直接 import `.mjs` 脚本，不引依赖 | APPROVED 一个新测试文件 | APPROVED 定向与全量见 EV §3 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-620 ①② 对应验收条件 | APPROVED 与 DEC-500 ① 一致 | APPROVED 两处落点可审阅可回滚 | APPROVED TEST-621 |
| CP-2 | APPROVED REQ-NF-063 ① 验收在 Railway 上得以成立 | APPROVED 与 DEC-500 ② 一致 | APPROVED TASK-620 ③⑤ | APPROVED TEST-620 / TEST-621 ③④ |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 与 DEC-500 ③ 一致 | APPROVED TASK-620 ④ | APPROVED TEST-560 |
| CP-4 | APPROVED 无遗留 | APPROVED 无新增基础设施 | APPROVED TASK-620 | APPROVED 见 R2/CP-4 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-09-30 服务设置读回 `/api/health` / 120（此前 null）——用户裁定③在 Railway 上第一次真的成立 | APPROVED 本机重建重启后 `/api/health` 200、`build` 等于 HEAD `1775beb`：解析器在真实生产构建里成立 | APPROVED `railway.json` 已删，文档改为服务设置；②③ 部署清单与公网 `build` 在闭环推送后补记 | APPROVED TEST-621 `real_entry: true`（`entry: user`）；证据 EV-2026-09-30-railway-healthcheck-buildsha §4 |
| CP-2 | APPROVED TEST-620 四例全绿 | APPROVED 本机 `npm run build:local` 通过、`build` 仍等于 HEAD | APPROVED `tsc` 0 错误 | APPROVED `npx vitest run tests/build-sha.test.ts` |
| CP-3 | APPROVED 文档改后架构图守卫通过 | APPROVED 与部署清单核对办法一致 | APPROVED CLAUDE.md 与 `docs/ARCHITECTURE.md` 已改 | APPROVED TEST-560 |
| CP-4 | APPROVED | APPROVED | APPROVED | APPROVED 全量回归见 EV §3 |
