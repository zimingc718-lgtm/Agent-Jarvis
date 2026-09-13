# CR-20260912-local-production

- 级别: L2（新增一个身份来源与两条运行脚本，改变可观察行为；**无 schema 变更、无新增依赖、无新增出网面**。信任模型的变化被限制在「仅回环」内，且默认不启用）
- 提出人: user（P6 运行反馈：dev server 连续四次被系统因内存不足杀掉，表现为「删不掉 Provider / 优先级不生效」；助手提出走生产构建，用户 2026-09-12 回复「要。继续」）
- 状态: APPROVED（R1 人工终裁：用户明确授权）→ P3/P4 完成
- 占用 ID: REQ-F-080, REQ-NF-040, DEC-060, TASK-110, TEST-140
- 评审模型: 标准档（DEC-021 ①：CP-1 与 CP-2 依赖人工发现 → 不走快车道）
- 影响需求: 新增 REQ-F-080（本机生产运行与单管理员模式）、REQ-NF-040（免登录模式的边界）；修正 `scripts/check-config.mjs` 对 REQ-F-001 DEFERRED 形态的判定缺陷
- 影响模块: MOD-AUTH（`auth-guard.ts` 新增身份来源与模式描述）、MOD-GOVERNANCE（预检脚本求值时机修正）
- 影响任务: 新增 TASK-110（DONE）
- 影响测试: 新增 TEST-140（PASS）；`tests/auth.test.ts` 既有三条不变，用于证明本 CR 未放宽测试旁路
- 当前证据: `project/05_evidence/EV-2026-09-12-local-production.md`
- 方案选项:
  - A. **放宽 `JARVIS_TEST_USER_ID` 使其在生产也生效**——否决。它的名字与注释都写明是测试旁路，「拒绝生产」正是它存在的意义；放宽等于给未来任何部署留下永久后门。
  - B. **新增语义不同的 `JARVIS_SINGLE_ADMIN_ID`，并要求 `NEXTAUTH_URL` 为回环地址**——选中。陈述的是另一件事实（本实例没有登录），且带一道机器可判定的边界。
  - C. 先把 Google OAuth 配通再跑生产——否决。用户 2026-09-09 已明确暂缓登录（REQ-F-001 DEFERRED）；为了省内存而要求先接第三方登录，是把手段变成前提。
  - D. 加内存看门狗自动重启 dev——否决。治标不治本，且会掩盖真实内存压力。
- 选择理由: 实测生产构建常驻内存 126 MB，对照 dev 的 1,564 MB（峰值 3,806 MB），差 12 至 21 倍（EV §2），而四次服务事故的直接原因就是 dev 的内存增长（EV §1）。挡在路上的只有一件事——生产模式下所有 API 返回 401（EV §3）。选 B 是因为它在不削弱既有守卫的前提下解决这件事：新开关默认不存在，启用后还必须是回环地址，指向真实域名即拒绝并回落为 401。
- 回滚方式:
  - 运行回滚：从 `.env.local` 删除 `JARVIS_SINGLE_ADMIN_ID` → 生产模式立即回到全 401；`git revert` 实现提交则连开关本身一并移除。`next dev` 路径完全不受影响。
  - 脚本回滚：删除 `build:local` / `start:local` 两条 npm 脚本与 `.next-prod` 目录。
  - 预检回滚：`SINGLE_ADMIN` 改回模块顶层常量（即恢复那个缺陷）。
  - 无 schema 变更、无数据变形、无依赖变更。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + R1 人工终裁痕迹；`review r1` PASS。
  - P3: TASK-110 DONE；TEST-140 PASS；`npm test` / `test:ui-contract` / `tsc` / `build:local` 全绿。
  - P4 真实入口：`npm run build:local && npm run start:local` 后，`/`、`/api/providers`、`/api/display` 均 200，且看到的 Provider 与 dev 完全一致；写路由往返成功；`npm run config:check` 退出码 0 并报告单管理员模式。
- 评审记录: 标准档，相关角色意见见下。**R1 人工终裁**：助手在 2026-09-11 末尾明确提出取舍与两个前提（需重新构建、需先解决登录），用户 2026-09-12 回复「要。继续」。授权明确。**一处如实更正**：助手当时估计「内存约为 dev 的三分之一」，实测为十二分之一到二十一分之一，估计偏保守，已在 EV §2 用实测数据更正。
- R1 终裁: 已完成 | 用户 | 2026-09-11

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了`。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **本机生产运行路径**：`build:local` / `start:local` 两条脚本，构建产物落在独立的 `.next-prod`，可与运行中的 `next dev` 并存。实测常驻内存 126 MB 对 1,564 MB，是四次服务被 OOM 杀掉的直接对策（EV §1/§2） | REQ-F-080 ①② | 新增 | 双向 | 真实入口：`npm run build:local && npm run start:local` 后三条路由 200。**长期运行是否也增长属人工发现** |
| CP-2 | 产品 | **单管理员模式** `JARVIS_SINGLE_ADMIN_ID`：生产构建忽略 `JARVIS_TEST_USER_ID`，导致全部 API 401（EV §3）。新开关语义不同、默认不存在、需显式设置 | REQ-F-080 ③④ | 新增 | 双向 | 机器：`tests/single-admin.test.ts` ①②⑤⑥。**「改完代码忘记重新构建」属人工发现** |
| CP-3 | 架构 | **免登录只允许开在本机**：单管理员模式要求 `NEXTAUTH_URL` 主机名为回环地址；指向真实域名、局域网地址、或 URL 缺失/非法时一律拒绝并回落 401。这是本 CR 信任模型变化的全部边界 | REQ-NF-040 | 新增 | 双向 | 机器：`tests/single-admin.test.ts` ③④（含 `localhost.evil.com` 前缀钓鱼域名） |
| CP-4 | 模块 | **预检求值时机修正**：`SINGLE_ADMIN` 原先在模块顶层、`.env.local` 加载之前求值，导致从环境文件配置的单管理员形态**永远检测不到**——Google 两项始终算必需、输出「缺少 2 项必需配置」、退出码 1（EV §4）。改为加载后求值，并同时识别两个开关；两个 id 不一致时显式告警 | REQ-F-001（DEFERRED 形态的判定） | 缺陷修复 | 双向 | 机器：`npm run config:check` 退出码由 1 变 0，Google 两项显示「暂缓」；`tests/config-check.test.ts` 8 条仍 PASS |

## 相关角色意见（标准档）

- **产品**：用户要的是「服务别再自己坏掉」，内存是直接原因，本 CR 给的是一条内存低一个数量级的运行方式，而不是看门狗那种掩盖问题的办法。代价（无热更新、需重新构建）已写进文档与 CR，不藏。
- **架构**：本 CR 唯一触及信任模型的地方是 CP-3，且方向是**收紧后开口**——新开关默认不存在，启用后仍被回环判定卡住。既有的 `JARVIS_TEST_USER_ID` 一个字没动，`tests/auth.test.ts` 原三条用例原样通过即为证据。
- **模块开发**：`auth-guard.ts` 保持纯函数、env 由参数注入，因此测试不必污染 `process.env`。`describeAuthMode` 让预检与未来的 UI 共用同一套判定，避免两处各说各话（与 `probeSearchBackend` 同一手法）。
- **测试**：CP-3 的负面用例是本 CR 的重点——四种非回环地址与一个前缀钓鱼域名逐一断言拒绝。CP-1 的「长期是否增长」与 CP-2 的「忘记重新构建」如实登记为人工发现，不用宽松断言伪装覆盖。

## 实施记录（2026-09-12）

- **`src/lib/auth-guard.ts`**：新增 `getSingleAdminUserId`、`isLoopbackInstance`、`describeAuthMode` 与 `AuthMode` 类型；`requireUserId` 的身份来源顺序为 会话 → 测试旁路（仅非生产）→ 单管理员（仅回环）。既有测试旁路逻辑未改动一行。
- **`package.json`**：新增 `build:local` / `start:local`，均固定 `NEXT_DIST_DIR=.next-prod`。
- **`.env.local`**：新增 `JARVIS_SINGLE_ADMIN_ID=admin`（与既有 `JARVIS_TEST_USER_ID` 同值，使 dev 与生产看到同一套数据）。
- **`scripts/check-config.mjs`**：`SINGLE_ADMIN` 由顶层常量改为加载环境后赋值，并同时识别两个开关；新增单管理员模式就绪/被拒两种报告与 id 不一致告警；可选变量的标签不再被误标为「暂缓」。
- **测试**：新增 `tests/single-admin.test.ts`（7 条）。全量 65 文件 / 556 用例 PASS；`ui-contract` 53/0/0；`smoke` PASS；`tsc` 0；`build:local` 成功。
- **真实入口**：生产构建在 3002 端口，`/`、`/api/providers`、`/api/display` 均 200，Provider 列表与 dev 一致，写路由往返成功（净效果为零）。`npm run config:check` 退出码 0。
- **未做**：`snapshot` 未执行——按 `docs/WORKFLOW.md` 全流程只在合并前跑一次；本工作树同时有并行会话的多个 CR，需先确认分支归属。

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260912-local-production` 节（逐变化点方案表 + 架构总判）+ DEC-060 + MOD-AUTH / MOD-GOVERNANCE 边界行。行 = CP-1..CP-4，列 = 四角色。无 REJECTED、无空格。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 直接对症四次 OOM 事故 | APPROVED DEC-060 ① 沿用 DEC-009 的目录隔离，不新开范式（自审） | APPROVED 两条脚本，无产品代码变更 | APPROVED 真实入口可验；长期增长如实登记人工 |
| CP-2 | APPROVED 生产下全 401 是唯一拦路问题 | APPROVED DEC-060 ②③ 新开关而非放宽旧开关，避免永久后门（自审） | APPROVED 守卫层加一个来源，既有旁路零改动 | APPROVED 既有 auth.test.ts 原样通过即为「未放宽」的证据 |
| CP-3 | APPROVED 免登录必须有边界 | APPROVED DEC-060 ④ 主机名精确匹配；判断不了即拒绝，安全默认值（自审） | APPROVED 纯函数，env 注入 | APPROVED 四种非回环 + 前缀钓鱼域名逐一断言 |
| CP-4 | APPROVED 配置正确却报失败会误导人 | APPROVED 求值时机是根因，与既有三个「诊断说谎」同类 | APPROVED 改为加载后赋值，顺带消掉可选变量的错误标签（自审） | APPROVED 退出码 1→0 可直接断言；config-check 8 条回归 |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260912-local-production` 节（变化点影响矩阵 + 技术设计）+ TASK-110。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-110 ② 固定独立构建目录 | APPROVED 与 DEC-060 ① 一致 | APPROVED 脚本内联 NEXT_DIST_DIR，不依赖调用方设环境变量（自审） | APPROVED 真实入口对应 TEST-140 |
| CP-2 | APPROVED TASK-110 ①③ 覆盖 REQ-F-080 ③④ | APPROVED 身份来源顺序写进任务，避免实现时次序颠倒 | APPROVED 明确「不修改 getNonProductionTestUserId 一行」（自审） | APPROVED TEST-140 ①②⑥⑦ |
| CP-3 | APPROVED 边界写进任务约束 | APPROVED 约束③禁用 startsWith/includes，正是钓鱼域名的防线 | APPROVED 纯函数、可单测（自审） | APPROVED TEST-140 ③④⑤ |
| CP-4 | APPROVED TASK-110 ④ 说清根因而非只说现象 | APPROVED 同时识别两个开关，避免只修一半 | APPROVED 赋值点在 loadEnv 之后，位置明确（自审） | APPROVED 退出码 + 既有 8 条回归 |

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260912-local-production` 节（任务→测试派生矩阵 + 两处覆盖缺口 + 一条不写成断言的边界）+ TEST-140。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 内存数字写进 EV 而非断言 | APPROVED 不为「不增长」写假断言 | APPROVED 真实入口三条路由 | APPROVED TEST-140 真实入口 + 缺口登记（自审） |
| CP-2 | APPROVED 「忘记重新构建」如实填发现不了 | APPROVED 机器确实无法区分意图 | APPROVED 以文档说明代价 | APPROVED TEST-140 ①②⑥⑦（自审） |
| CP-3 | APPROVED 负面用例是本 CR 重点 | APPROVED 覆盖真实域名 / 局域网 / IPv6 / 缺失 / 非法 / 前缀钓鱼 | APPROVED env 注入，测试不污染全局 | APPROVED TEST-140 ③④⑤（自审） |
| CP-4 | APPROVED 退出码本身即断言 | APPROVED 不需要新增用例即可守住 | APPROVED 既有 config-check 8 条覆盖回归 | APPROVED TEST-140 真实入口（自审） |

