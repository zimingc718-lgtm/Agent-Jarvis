# CR-20260918-per-user-data-isolation

- 级别: 重型档（CP-2 判定为单向门——首次真实登录触发的自动迁移会 `rename` 现有单管理员的真实生产数据；`.data/` 全目录被 `.gitignore` 排除、不进版本库，机制本身若判断错「谁是 owner」或迁移到错误目标，没有 `git revert` 能找回，这与本批次此前 7 条 CR 都只新增能力、从不搬动既有真实数据是质的不同。CP-1 本身双向门、有完整机器检查；但整条变更含至少一个单向门 CP，按 DEC-021 应判重型档，不能因为 CP-1 达标就整体降级）
- 提出人: 用户，原始条目见 INPUT-2026-09-18-001 第 9a 条（Railway/多用户部署）；协调会话就此调查代码现状后，用户通过 AskUserQuestion 做出两条直接产品裁定——①"Each person needs their own private data"（beta 用户之间不共享实体/知识库数据池，需与 conversations/providers/skills 已有的隔离模型对齐）；②"Automatic on first login"（现有单管理员的真实数据在其本人首次真实登录时自动继承，不走人工复核脚本，是用户在权衡"自动化风险 vs 人工流程摩擦"后的明确选择，接受本项目已发生过一次的 CR-F 误删事故式风险类别，但要求以本 CR 的原子化设计把该风险降到最低）
- 状态: CLOSED（R1 已终裁并合并；P3/P4 完成；2026-09-19 已在 Railway 生产部署上完成真实入口验证——用户用 mingcz28@gmail.com 真实登录触发自动迁移，PASS，详见 `EV-2026-09-18-per-user-data-isolation.md` 第 3 节与 R4 矩阵 CP-2/测试列）
- 占用 ID: REQ-F-270, REQ-F-271, DEC-380, DEC-381, TASK-500, TASK-501, TEST-500, TEST-501
- 评审模型: 重型档（完整 R1–R4 + 本文件「回滚方式」节）
- 影响需求: **新增** REQ-F-270（每用户实体/知识库数据私有隔离）、REQ-F-271（现有单管理员真实数据首次真实登录时自动继承）
- 影响模块: MOD-ENTITIES（`src/lib/entities.ts` 只读——本 CR 不改其内部逻辑，只改调用点传入的 `root`）、MOD-KNOWLEDGE（`src/lib/knowledge.ts` 同上）、**新增** `src/lib/user-data-paths.ts`；MOD-TOOLS（`src/lib/tools/entity-tools.ts`、`src/lib/tools/knowledge-tools.ts` 的 deps 接线）、MOD-CHAT（`src/lib/chat.ts` 的 `buildRegistry`）、MOD-API（`src/app/api/entities/**`、`src/app/api/knowledge/**`、`src/app/api/tools/route.ts`）、MOD-UI（`src/app/page.tsx` 首屏 SSR 数据读取）
- 影响任务: **新增** TASK-500, TASK-501
- 影响测试: **新增** TEST-500, TEST-501
- 当前证据: `project/05_evidence/EV-2026-09-18-per-user-data-isolation.md`
- 方案选项:
  - CP-1（隔离方案：数据存在哪、怎么判定"这条数据是谁的"）
    - A. **把 `entities.ts`/`knowledge.ts` 从文件存储整体搬进 SQLite（`store.ts` 已有的 `userId` 优先参数模式）**——否决。这是比本 CR 大一个数量级的重写：两个模块现有的每一处文件解析（`parseEntityFile`、frontmatter 处理、`history/*.jsonl` 追加写）都要重新在关系型存储里实现一遍，且这些逻辑本身完全正确、不是本 CR 要解决的问题。
    - B. **文件仍放同一个共享目录，靠文件名加 `userId` 前缀区分**——否决。隔离正确性会依赖"每一个读写点都记得做前缀过滤"，任何一处新代码（未来的工具、路由）忘记过滤就是一次真实的跨用户数据泄露，且不易在代码审查中被发现——这正是用户 AskUserQuestion 决策①明确要避免的"共享池"风险，只是把共享池从"一个目录"换成了"同一个目录里靠命名约定区分"，性质不变。
    - C. **每个 `userId` 一个独立的文件系统根目录，路径由净化后的 `userId` 派生；`entities.ts`/`knowledge.ts` 每个函数早已接受可选的 `root` 参数（既有模式，非本 CR 新增），调用点只需解析出正确的 `root` 再传入**（选中）：隔离由操作系统的目录边界保证，不依赖任何调用点自觉地做过滤——一个忘记接线的调用点最坏结果是"用到了错误但仍然合法的单一目录"（例如仍读到全局旧根），而不是"读到了另一个真实用户的目录"，故障形态更安全；且完全复用已验证的文件解析逻辑，`entities.ts`/`knowledge.ts` 内部零改动。
  - CP-2（迁移触发：现有单管理员的真实数据什么时候、怎么"过户"给他自己的账号）
    - D. **人工审阅后运行一次性迁移脚本（dry-run 可复核）**——否决。用户在 AskUserQuestion 决策②中明确选择"Automatic on first login"而非本选项，见「提出人」。
    - E. **首次真实登录（`requireUserId` 解析出的 `userId` 命中 `JARVIS_SINGLE_ADMIN_ID` 或大小写不敏感命中 `JARVIS_OWNER_EMAIL`）时自动触发：把旧的全局根整体 `rename` 进这个用户的私有根**（选中）：直接实现用户的决策②。`rename` 是单一文件系统元数据操作，不存在"迁移到一半"的中间态——要么整条目录树瞬间换了个名字，要么因为任何原因抛错、原目录分毫未动；先 `existsSync(target)` 短路，同一用户的第二次及以后请求是一次只读判断，不会重复迁移、不会覆盖。
    - F. **迁移前后端到端诊断整个 legacy 根一次性搬完（entities 和 knowledge 合并成一次事务）**——否决。选 E 的细化：entities 和 knowledge 两个子迁移各自独立判定、独立执行（见 CP-2 说明），这样进程在两次迁移之间崩溃（例如迁移完 entities、还没轮到 knowledge 时进程被杀）时，下次请求只补完剩下的那一半，不会因为"整体事务未完成"而把已经成功搬走的 entities 又判定为"需要重来"。
- 选择理由: CP-1 选 C：隔离边界建立在文件系统层面而不是调用纪律层面，这是能不能"证明"隔离而不是"希望"隔离的关键区别；且 `entities.ts`/`knowledge.ts` 内部零改动，把改动面严格限制在"调用点传对参数"，可核验性最高。CP-2 选 E+F：E 直接落实用户决策②，F 让崩溃恢复是"自动补完"而不是"人工介入"，把用户已经接受的自动化风险控制在设计可及的最小范围内——rename 的原子性 + 按模块非合并幂等，是本 CR 面对"自动动真实数据"这件事能拿出的最强机器保证。
- 回滚方式:
  - **合并到 `main` 但生产服务尚未重建重启**：`git revert` 本 CR 的提交即可，磁盘上任何文件从未被触碰，零风险。
  - **生产服务已重建重启、自动迁移已对真实数据触发之后**：`.data/entities`、`.data/knowledge`（旧全局根）此时已被 `rename` 进 `.data/users/<净化后的 JARVIS_SINGLE_ADMIN_ID>/{entities,knowledge}`——字节本身完好，只是换了目录名，文件格式（frontmatter/`history/*.jsonl`）本 CR 完全未改动。回退代码前，需要先手工把这两个目录整体搬回原位（Windows PowerShell：`Move-Item .data\users\<id>\entities .data\entities; Move-Item .data\users\<id>\knowledge .data\knowledge`），再 `git revert` + 重建重启——回退后的旧代码会直接读到搬回原位的数据，不需要任何格式转换。此步骤已写入下方「验收条件」的真实入口清单，交给协调会话在生产服务重启前后各做一次目录内容核对（例如 `Get-ChildItem` 文件计数），确保迁移前后的文件集合一致，而不是只信任函数返回值。
  - **迁移函数本身的判断出现意外错误（例如把某个非 owner 的用户错误判定为 owner）**：`ensureRootMigrated` 只在 `owner === true` 且 `existsSync(legacy)` 时才会碰旧数据，`isOwner` 的两个判定条件（`JARVIS_SINGLE_ADMIN_ID` 精确匹配、`JARVIS_OWNER_EMAIL` 大小写不敏感匹配）都是运维侧配置的环境变量，不受任何请求参数影响，模型或用户输入不可能让这两个判定错判——故障只能来自运维配置本身写错（例如 `JARVIS_OWNER_EMAIL` 手滑配置成别人的邮箱），这是配置纪律问题，不是本 CR 代码逻辑的缺口，已在「代价/残留风险」如实登记。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。**当前未完成**——见「状态」。
  - R2/R3/R4: 本文件含 `## R2/R3/R4 评审矩阵`，协调会话以四角色视角自评填入，`review r2|r3|r4` PASS（机器终止，见下方矩阵）。
  - P3/P4: TASK-500、TASK-501 DONE；TEST-500、TEST-501 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量 95 个测试文件、887 个用例绿（含改造后的 `entity-route.test.ts`/`knowledge-route.test.ts`/`sweep-route.test.ts`，三者原先直接读写全局 `ENTITIES_ROOT`/`KNOWLEDGE_ROOT` 的写法在本 CR 之后会与真实路由的每用户根解析不一致，已同步改为解析同一个 mock 用户的私有根，详见 `EV-2026-09-18-per-user-data-isolation.md`）。
- 真实入口: 已执行（2026-09-19，Railway 生产部署，用户用 mingcz28@gmail.com 完成真实首次登录，触发自动迁移，PASS，详见 EV-2026-09-18-per-user-data-isolation.md 第 3 节）
  - **真实入口详情**：`scripts/probe-per-user-data-isolation.mjs` 已写好、语法已核验，**刻意未对真实数据执行**——脚本本身的克制设计与执行安全须知见该文件顶部注释。协调会话需要的真实入口步骤：①重建生产构建、重启服务前，先用文件管理器或 `Get-ChildItem` 记录 `.data/entities`、`.data/knowledge` 当前的文件清单（数量、文件名）作为迁移前基线；②重启后打一个只读路由（如 `/api/entities`）触发首次真实请求，确认返回 200 且实体列表与迁移前一致（不多不少）；③核对 `.data/users/<单管理员 ID>/{entities,knowledge}` 目录已出现且文件清单与基线完全一致，`.data/entities`、`.data/knowledge` 原地已不存在（`rename` 的证据）；④用真实 UI 走一次"新建实体→关闭页面→重新打开→仍能看到"的读写闭环，确认迁移后正常读写未受影响；⑤（可选，验证隔离本身）用 `JARVIS_TEST_USER_ID` 或第二个真实账号模拟一次"非 owner 用户"请求，确认其看到的是全新空列表而不是单管理员的真实数据。
- 评审记录: 协调会话以四角色视角自评（见下方 R2/R3/R4 矩阵），非独立多角色 Agent 出具——这是重型档在"实现者与评审者是同一会话"约束下的诚实标注，最终裁决权仍在 R1 的用户人工终裁。
- R1 终裁: 已完成 | 用户 | 2026-09-18

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签置行匹配）：协调会话独立核对了迁移逻辑（`ensureRootMigrated` 的原子 rename 语义）、`tests/user-data-paths.test.ts` 全部 12 例（尤其是非 owner 不触发迁移、半迁移崩溃恢复两例）、`src/app/api/entities/route.ts` 的实际接线 diff，以及本文件「回滚方式」节的三种场景，将审查结论与本文件一并提请用户；用户明确选择「Approve」，并知悉真实迁移事件本身要到后续 Railway + Google 登录真正激活、本人首次真实登录时才会发生——本次合并只落地代码，不触发任何真实数据搬动。

## 问题经过

用户在 INPUT-2026-09-18-001 第 9a 条提出 Railway 多用户部署。协调会话调查代码现状后发现两个事实：①`auth-guard.ts` 的 `requireUserId`/`isLoopbackInstance`/`getSingleAdminUserId` 已经正确处理"单管理员模式只在回环地址生效，公网地址强制要求真实登录"，这一半不需要改动；②`src/lib/auth.ts` 已经在 `GOOGLE_CLIENT_ID` 等四个环境变量齐全时构建真实的 `GoogleProvider`，但目前一个都未配置——处于"接好线但没插电"的状态。同时发现一个此前从未暴露的真实缺口：`entities.ts`、`knowledge.ts`、`sources.ts`、`entity-history.ts` 完全没有 `userId` 概念——每个真实调用点（API 路由、`chat.ts#buildRegistry`、`src/app/page.tsx` 首屏）**已经**通过 `requireUserId(session)`/`ToolContext.userId` 拿到了真实的 `userId`，却全部弃之不用，转而传入一个模块级的全局常量根目录。也就是说：只要 Railway + 真实 Google 登录一旦启用，**所有真实用户在事实上共享同一份实体/知识库数据**——这与 `store.ts`（SQLite）里"每个函数第一个参数都是 `userId`"的既有隔离模式形成了鲜明对比，是本项目在这一层上从未补齐的一角。

协调会话没有自行决定隔离方案与迁移策略的具体形状，而是把两个真正需要用户拍板的产品问题原样提给用户：beta 测试者之间数据要不要隔离（而不是共享一个池子）、现有单管理员的真实数据要不要自动继承（而不是走人工复核脚本）。用户分别给出了明确裁定，见「提出人」。本 CR 是这两条裁定的直接实现。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 新增 `src/lib/user-data-paths.ts`：`entitiesRootFor(userId)`/`knowledgeRootFor(userId)` 从净化后的 `userId` 派生独立文件根；`ensureUserDataMigrated`/`resolveUserDataRoots` 提供"解析根 + 按需迁移"的统一入口，`isOwner` 双通道判定（`JARVIS_SINGLE_ADMIN_ID` 精确匹配 / `JARVIS_OWNER_EMAIL` 大小写不敏感匹配） | REQ-F-270, REQ-F-271, DEC-380, DEC-381, TASK-500, TEST-500 | 新增 | 双向 | 机器：`tests/user-data-paths.test.ts` 12 例（CP-1 路径确定性/隔离性/穿越净化/空值拒绝/可读性 5 例；CP-2 单管理员迁移/幂等/非 owner 空目录/大小写不敏感/空 legacy 根/半迁移恢复/无 owner 配置 7 例），覆盖设计文档列出的每一个边界 |
| CP-2 | 产品 | 全部真实调用点接上 `resolveUserDataRoots`：`entities/**`、`knowledge/**` 共 10 个 API 路由、`chat.ts#buildRegistry`（连带其两个真实调用点 `runChatTurn`、`api/tools/route.ts`）、`src/app/page.tsx` 首屏 SSR、`knowledge-tools.ts` 的 `ingest_url` 工具（修正其此前遗漏转发 `entitiesRoot` 的既有小缺口）。`library.ts`（资料库，字节按设计进版本库、跨用户共享是既有约定）与 `documents.ts`（REQ-F-110 本机目录，远程多用户部署下"用户自己的文件"这一概念本身需要重新设计）明确排除在外，见「非目标」 | REQ-F-270, REQ-F-271, DEC-380, DEC-381, TASK-501, TEST-501 | 新增 | 单向 | 接线机制本身可双向验证（改错了能改回来），但其触发的首次真实登录迁移事件不可逆，按 DEC-021 与「级别」的判定从严记为单向。机器 + 真实入口：`tests/entity-route.test.ts`/`tests/knowledge-route.test.ts`/`tests/sweep-route.test.ts` 已改造为解析同一 mock 用户的私有根（证明路由确实按用户隔离,而不是继续读全局根）；全量回归 887 例绿证明接线未破坏任何既有行为。**首次真实登录触发的真实迁移事件**发现方式为真实入口操作（协调会话在用户生产环境执行，见「验收条件」），机器测试只能覆盖迁移逻辑本身的正确性，不能替代"对真实数据实际跑一次"这件事 |

## 非目标（如实登记）

- 不改 `entities.ts`/`knowledge.ts`/`sources.ts`/`entity-history.ts` 内部任何一行读写逻辑——它们的 `root` 参数早已存在（既有模式），本 CR 只改调用点传入的值。
- 不做 `library.ts`（资料库）的每用户隔离。该模块自己的文件头注释已经声明"字节仍留在资料库目录里（进版本库，由 git 管）"——这是与实体/知识库完全不同的共享模型（团队共用的参考资料，不是某个用户私有创建的数据），本 CR 判断这属于产品层面需要单独确认的问题，不在"private per-user data"这条决策的原始语境内自行归类，留给未来一条独立 CR。
- 不改 `documents.ts`（REQ-F-110 本机文档目录）。它读的是运行服务器的机器上用户配置的本地文件夹路径——这个概念在"服务器是远程 Railway 实例、用户在自己的浏览器里访问"的部署形态下本身就不成立（服务器所在机器上没有"用户自己的文件"这回事），需要先有单独的产品设计（例如改为真正的文件上传）才能谈隔离，本 CR 不越权替用户做这个设计决定。
- 不激活真实 Google OAuth 凭据、不做 Railway 平台部署配置（含 Railway 文件系统本身是临时的、需要持久卷这一前提）。这两件事都需要用户在 Google Cloud Console / Railway 控制台的真实账号下亲自操作，任何 Agent 都无法代为完成，是后续一条完全独立、尚未排期的 CR 的范围。
- 不为 `JARVIS_USERS_PATH` 跨文件系统挂载（`rename` 因 `EXDEV` 失败）提供自动兜底。当前真实部署下 `JARVIS_USERS_PATH`（默认）与 `JARVIS_ENTITIES_PATH`/`JARVIS_KNOWLEDGE_PATH`（默认）同在 `.data/` 之下、同一文件系统，这个失败模式在今天的真实环境里不会发生；如果运维未来手工配置 `JARVIS_USERS_PATH` 指向不同挂载点，首次真实登录会因为 `rename` 抛错而收到 500，但原数据分毫不会受损（`rename` 失败不产生中间态），恢复方式是把 `JARVIS_USERS_PATH` 改回同一文件系统后重试——不是本 CR 现在就要解决的场景，如实登记而不是预先建一整套未被真实需求触发的兜底代码。

## 代价/残留风险（如实登记）

- 首次真实登录触发的迁移事件本身，机器测试只能证明"迁移函数在各种边界条件下行为符合设计"，不能证明"用户真实机器上、真实文件系统状态下的这一次迁移会成功"——这是文件系统操作的通性,不是本 CR 特有的缺口,但在"动真实数据"这个语境下值得单独强调。已在「验收条件」写明协调会话需要执行的真实入口五步骤,其中第①③步（迁移前后文件清单比对）是专门针对这条残留风险设计的独立核验,不依赖迁移函数自己的返回值。
- `isOwner` 的两个判定条件都来自运维侧环境变量，配置写错（例如 `JARVIS_OWNER_EMAIL` 手滑配错邮箱）不会被本 CR 的任何机制发现——这类配置纪律问题超出代码层面能防御的范围，与本项目其它环境变量（如 `JARVIS_SECRET_KEY`）的现状一致，不是本 CR 引入的新风险类别。
- 迁移只发生一次（`existsSync(target)` 短路），之后旧的全局 `ENTITIES_ROOT`/`KNOWLEDGE_ROOT` 会一直保留为空目录（迁移把内容搬空但不删除目录本身，`rename` 不会删除源路径的父目录）——纯粹的空目录残留，不产生任何功能性问题，未来清理与否不影响正确性。

## 并行事项说明（如实登记）

本 CR 在独立 git worktree（`cr/20260918-per-user-data-isolation`，基于合并了本批次此前 7 条 CR 之后的 `main`）中实现，是本批次 2026-09-18 INPUT 的最后一条待办（原始编号 9a）。与此前 7 条 CR 不同，本 CR 不修改 `DisplayScreen.tsx`/`ui-events.ts`/`types.ts` 等共享 UI 状态文件，合并期不存在同形的"两条 CR 各自往同一个联合类型追加新值"式冲突；本 CR 触碰的是 API 路由与 `chat.ts#buildRegistry` 这类此前任何一条 CR 都未曾修改的路径，预期为纯净合并，无需手工冲突消解。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 直接落实用户决策①②，不引入产品层面未确认的行为 | APPROVED 隔离边界建在文件系统层、复用 `entities.ts`/`knowledge.ts` 既有 `root` 参数，零侵入既有模块内部逻辑 | APPROVED `user-data-paths.ts` 是独立新模块，三个导出函数职责单一，无循环依赖 | APPROVED 12 例覆盖设计文档列出的每个边界（幂等/半迁移恢复/大小写/无 owner） |
| CP-2 | APPROVED 隔离范围（哪些模块隔离、哪些不隔离）与用户决策语境一致，`library.ts`/`documents.ts` 排除已如实登记 | APPROVED 全部真实调用点统一走 `guard()` 判别式联合类型 + `resolveUserDataRoots`，无 ad-hoc 例外路径 | APPROVED 10+ 调用点改动模式一致，`ingest_url` 遗漏转发 `entitiesRoot` 的既有小缺口已一并修正 | APPROVED 路由测试改造 + 887 例全量回归证明接线正确、未破坏既有行为 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 无需求层遗留问题 | APPROVED `entitiesRootFor`/`knowledgeRootFor` 纯路径函数、`ensureUserDataMigrated`/`resolveUserDataRoots` 副作用集中在唯一入口，符合架构决策 | APPROVED `sanitizeUserId` 拒绝空值与路径穿越字符，`isOwner` 双通道判定逻辑与 `auth-guard.ts` 的既有单管理员判定语义一致 | APPROVED 单测直接断言模块导出函数行为，无需 mock 真实文件系统之外的任何东西 |
| CP-2 | APPROVED 无需求层遗留问题 | APPROVED 架构要求的"统一入口"在模块层体现为每个路由的 `guard()` 在唯一位置调用一次 `resolveUserDataRoots`，不重复解析 | APPROVED `chat.ts#buildRegistry` 签名变化（新增 `roots` 参数）在其仅有的两个真实调用点（`runChatTurn`、`api/tools/route.ts`）均已同步更新，`noUnusedLocals`/`tsc --noEmit` 0 错误确认无遗漏调用点 | APPROVED 模块级改动均有对应测试文件覆盖；`tests/document-tools.test.ts`/`tests/tool-budget.test.ts` 两处历史直接调用 `buildRegistry(store)` 的测试已同步新签名 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 测试场景与产品决策①②逐条对应，无遗漏 | APPROVED 测试覆盖架构文档列出的每条设计理由（rename 原子性、按模块非合并幂等） | APPROVED 测试直接针对模块导出接口，不依赖内部实现细节 | APPROVED `tests/user-data-paths.test.ts` 12 例：CP-1 路径确定性/隔离性/穿越净化/空值拒绝/可读性 5 例 + CP-2 单管理员迁移/幂等/非 owner 空目录/大小写不敏感/空 legacy 根/半迁移恢复/无 owner 配置 7 例，`npx vitest run` 全绿 |
| CP-2 | APPROVED 验收条件已列出真实入口五步骤，对应产品决策②要求的"自动迁移"可验证 | APPROVED 机器测试覆盖接线正确性（路由确实解析到每用户根），架构层面的正确性已可机器证明 | APPROVED 模块级调用点覆盖完整，`tsc --noEmit`/`vitest run` 双重确认 | APPROVED 2026-09-19 已在 Railway 生产部署上真实执行验收条件①②③④（⑤为可选项未执行，已如实登记）：用户用 mingcz28@gmail.com 真实登录触发自动迁移，迁移后 entities 11/11、knowledge 10/10 文件数与迁移前基线完全一致，`modifiedAt` 未变证明是原子 rename，用户本人确认 UI 展示内容无误，详见 `EV-2026-09-18-per-user-data-isolation.md` 第 3 节 |
