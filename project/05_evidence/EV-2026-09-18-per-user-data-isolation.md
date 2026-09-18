# EV-2026-09-18-per-user-data-isolation

- 来源: 用户 INPUT-2026-09-18-001 第 9a 条（Railway/多用户部署）+ 协调会话调查后的两次 AskUserQuestion（用户裁定：①每用户数据私有隔离；②现有单管理员真实数据首次真实登录时自动继承）
- 时间: 2026-09-18
- 采集者: 助手（claude-sonnet-5，fork 子代理），在本仓库隔离 worktree（`.claude/worktrees/agent-a2dd262a16ef2aa7c`，分支 `cr/20260918-per-user-data-isolation`）执行；未接触共享 3000 端口生产服务、未触碰任何真实用户数据
- 支撑对象: `CR-20260918-per-user-data-isolation` CP-1、CP-2
- 可定位路径: 本文件；`src/lib/user-data-paths.ts`、`src/lib/chat.ts`、`src/lib/tools/knowledge-tools.ts`、`src/app/api/entities/**`、`src/app/api/knowledge/**`、`src/app/api/tools/route.ts`、`src/app/page.tsx`、`tests/user-data-paths.test.ts`、`tests/entity-route.test.ts`、`tests/knowledge-route.test.ts`、`tests/sweep-route.test.ts`、`scripts/probe-per-user-data-isolation.mjs`

## 1. 投入实现前的代码核对

- `src/lib/auth-guard.ts`：`requireUserId`/`isLoopbackInstance`/`getSingleAdminUserId` 已经正确处理"单管理员模式只在回环地址生效，公网地址强制要求真实登录"——这一半确认不需要改动。单管理员模式下 `userId` 就是 `JARVIS_SINGLE_ADMIN_ID` 本身（`getSingleAdminUserId` 直接返回该环境变量的值），这一事实直接决定了 CP-2 的 `isOwner` 判定可以用同一个环境变量做精确匹配。
- `src/lib/auth.ts`：`createAuthOptions` 已经在 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`NEXTAUTH_SECRET`/`NEXTAUTH_URL` 四个环境变量齐全时构建真实的 `GoogleProvider`，当前一个都未配置；`session` 回调是空实现（`return session`），意味着 `session.user.id` 从未被真正赋值——真实 Google 登录场景下的实际 `userId` 是 `session.user.email`，与单管理员模式统一走"字符串标识符"这一点一致，`user-data-paths.ts` 的 `sanitizeUserId` 因此同时兼容两种形态而不需要区分。
- `src/lib/entities.ts`/`src/lib/knowledge.ts`：确认每个函数早已接受可选的 `root: string = ENTITIES_ROOT`/`KNOWLEDGE_ROOT` 参数——这是既有模式，不是本 CR 新增的能力，本 CR 因此不需要改动这两个模块内部任何一行。
- `src/lib/library.ts`：文件头注释明确声明资料库字节"进版本库，由 git 管"——与实体/知识库完全不同的共享模型（团队共用参考资料），据此判断不在本 CR 的处理范围，写入 CR 文档「非目标」而不是自行决定归类。
- `src/lib/documents.ts`（`rootsOf(store)`）：读的是运行服务器的机器上用户配置的本地文件夹路径——这个概念在"服务器是远程实例、用户在浏览器里访问"的部署形态下本身不成立，需要独立的产品设计，据此判断不在本 CR 范围。
- `.gitignore` 第 18 行：`.data/` 整目录被排除，不进版本库——这是本 CR 判定 CP-2（真实迁移事件）为单向门、CR 整体归类重型档的直接依据：迁移出错没有 `git revert` 能找回。

## 2. 机器证据（本地实际执行，非预测）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| CP-1 路径解析（TEST-500） | `tests/user-data-paths.test.ts` | 5 | 同一 `userId` 每次算出同一条路径且落在 `USERS_BASE` 下；不同 `userId` 算出不同路径；路径穿越字符被净化且净化后仍在 `USERS_BASE` 内；空/空白 `userId` 拒绝而不是悄悄退化成 `USERS_BASE` 本身；邮箱净化后仍可读（非纯哈希，便于运维排查） |
| CP-2 迁移逻辑（TEST-500） | `tests/user-data-paths.test.ts` | 7 | 单管理员模式命中时真的把 legacy 数据 `rename` 过去（用 `existsSync(legacy)===false` 直接证明是 rename 不是 copy）；幂等（第二次调用直接短路为 `exists`）；非 owner 只得到空目录、legacy 原样保留；`JARVIS_OWNER_EMAIL` 大小写不敏感；legacy 根为空时 owner 得到空目录不报错；**半迁移恢复**——手工模拟"进程在两次子迁移之间崩溃"（entities 已搬、knowledge 还在 legacy），验证第二次调用只补完 knowledge 而不是把已成功的 entities 又重搬一遍；无 owner 配置（两个环境变量都未设置）时谁登录都不触发迁移 |
| CP-2 路由接线（TEST-501） | `tests/entity-route.test.ts`（改造） | 12 | 路由改造后仍全绿，且改造本身证明了接线正确——测试的 fixture 写入与断言读取都改为解析同一 mock 用户（`owner@example.com`）的私有根（`entitiesRootFor`/`knowledgeRootFor`），而不是继续假设路由读写全局 `ENTITIES_ROOT`/`KNOWLEDGE_ROOT`；若路由接线有遗漏（仍读全局根），这些测试会因为 fixture 与路由读写的目录不一致而失败 |
| CP-2 路由接线（TEST-501） | `tests/knowledge-route.test.ts`（改造） | 6 | 同上，知识库路由 |
| CP-2 路由接线（TEST-501） | `tests/sweep-route.test.ts`（改造） | 4 | 巡检路由同样接上 `resolveUserDataRoots`；本文件不直接读写全局根，仅需补 `JARVIS_USERS_PATH` 隔离，避免测试运行时的迁移副作用泄漏进 worktree 共享的 `.data/users` 目录 |

`npx tsc --noEmit -p .`：**0 错误**（2026-09-18，本机，含 `OwnerEnv` 索引签名修正后的最终态）。

`npx vitest run`（全量）：**95 个测试文件、887 个用例全绿**（2026-09-18，本机，`buildRegistry` 签名变化后的两处历史直接调用——`tests/document-tools.test.ts`、`tests/tool-budget.test.ts`——已同步新签名）。

### 实现过程中发现并修正的问题（如实登记，非提前设计好的）

1. **`ingest_url` 工具遗漏转发 `entitiesRoot` 的既有小缺口**：`src/lib/tools/knowledge-tools.ts` 的 `createKnowledgeTools` 早已通过 `deps.entitiesRoot` 解出本地变量 `entitiesRoot`（用于同文件另一处 `listEntities` 校验），但 `ingest_url` 工具自己调用 `ingestUrl(url, {...})` 时只转发了 `knowledgeRoot`，没有转发 `entitiesRoot`——这个缺口在本 CR 之前完全无害（因为不论传不传，`ingestUrl` 内部 `deps.entitiesRoot ?? ENTITIES_ROOT` 解出来的都是同一个全局值），但本 CR 把 `entitiesRoot` 变成真实的、每用户不同的值后，这个缺口会变成真实故障：模型调用 `ingest_url` 并指定 `entity` 字段时，会拿全局旧根去找这个用户自己私有根下才有的实体，大概率找不到。已在本 CR 内一并修正（补上 `entitiesRoot` 转发），`tests/knowledge-tools.test.ts`/`tests/ingest-extract-chain.test.ts` 修正后仍全绿。
2. **三个既有路由测试文件的隔离泄漏**：`tests/entity-route.test.ts`/`tests/knowledge-route.test.ts`/`tests/sweep-route.test.ts` 在本 CR 之前只隔离 `JARVIS_DB_PATH`/`JARVIS_ENTITIES_PATH`/`JARVIS_KNOWLEDGE_PATH`，从未设置 `JARVIS_USERS_PATH`（因为在本 CR 之前，路由代码从不读这个环境变量）。本 CR 让路由第一次真正调用 `resolveUserDataRoots`，而 `user-data-paths.ts` 的 `USERS_BASE` 在未设置 `JARVIS_USERS_PATH` 时默认落在 `process.cwd()/.data/users`——运行测试时因此在本 worktree 的 `.data/users/` 下真实创建了目录（`owner_example_com/` 以及来自其它未隔离测试文件、如 `chat-stream.test.ts`/`compaction.test.ts`/`wake.test.ts` 的一批随机 UUID 目录）。已核对 `.data/` 已被 `.gitignore` 排除，泄漏范围仅限本 worktree 自身、从未接触主仓库或用户真实生产数据；已给三个直接受影响（会跑真实路由断言）的测试文件补上 `JARVIS_USERS_PATH` 隔离并清理了已产生的目录。`chat-stream.test.ts`/`compaction.test.ts`/`wake.test.ts` 三个文件同样会触发这一 mkdir 副作用（因为 `runChatTurn` 内部现在也调用 `resolveUserDataRoots`），但这三个文件用**静态** `import { runChatTurn } from "@/lib/chat"`（不是路由测试文件用的、在设置环境变量之后才动态 `await import` 的写法），真正修好需要重构这三个文件的导入结构——判断为本 CR 范围外的既有测试架构问题，已如实登记在「局限」，未做超出范围的重构。

## 3. 真实入口（本 CR 交付时未执行，留给协调会话）

`scripts/probe-per-user-data-isolation.mjs` 已写好、`node --check` 语法核对通过，但**本 fork 按约定不得触碰共享的生产服务器**，且更重要的是：本 CR 的核心真实入口事件——首次真实登录触发的真实数据迁移——按设计只应该在用户自己的真实生产环境、针对用户自己的真实数据发生**恰好一次**；不存在"先在别处演练一次"这个选项（这正是本 CR 判定为重型档、要求协调会话执行 CR 文档「验收条件」五步骤而不是本 fork 自行执行的原因）。

探针脚本本身的职责是**只读验证**：确认迁移之后的路由行为正常（列表可读、写入可用），不承担"触发迁移"这个动作本身——触发动作是协调会话按 CR 文档「验收条件」重启生产服务这一步的自然结果，不需要脚本额外做什么。

**这是本 CR 唯一尚未闭环的部分**：模块本身的正确性、全部调用点的接线正确性已经由代码核对、12+22 个新增/改造用例、全量回归确认；但"用户真实机器上，这一次真实迁移是否成功"只有真实入口能回答。CR 文档「验收条件」已列出协调会话需要执行的五个步骤（迁移前文件清单基线 → 触发首次真实请求 → 核对迁移后目录与清单一致 → 真实 UI 读写闭环 → 可选的非 owner 隔离验证），执行结果需要补记进本证据文件第 3 节，R4 矩阵 CP-2/测试列的 CONDITIONAL 才能转为 APPROVED。

## 4. 局限（如实登记）

- `library.ts`（资料库）与 `documents.ts`（本机文档目录）未纳入本 CR 的隔离范围——理由见「投入实现前的代码核对」与 CR 文档「非目标」，不是遗漏，是产品层面需要单独确认的问题。
- `chat-stream.test.ts`/`compaction.test.ts`/`wake.test.ts` 三个既有测试文件在本 CR 之后会在 worktree 本地的 `.data/users/` 下产生若干随机 UUID 命名的空目录（无害、已被 `.gitignore` 排除、不影响测试通过与否）——完整修好需要把这三个文件的静态 `import` 改造成路由测试文件已使用的"先设置环境变量、再动态 `await import`"模式，判断为本 CR 范围外的既有测试架构问题，如实登记而不是顺手做一次未被要求的重构。
- `JARVIS_USERS_PATH` 若被运维配置为与 `JARVIS_ENTITIES_PATH`/`JARVIS_KNOWLEDGE_PATH` 不同的文件系统/挂载点，`rename` 会因 `EXDEV` 抛错——当前真实部署三者同在 `.data/` 之下、同一文件系统，这个失败模式今天不会发生；抛错时原数据不受损（`rename` 失败不产生中间态），已在 CR 文档「非目标」如实登记为未做自动兜底的已知限制，不是本证据文件遗漏。
- 首次真实迁移事件的真实入口验证，按设计只能由协调会话在收口阶段执行一次，本证据文件第 3 节的验证结果留空，需要协调会话在执行后补齐——这不是证据缺失，是本 CR 的验收结构本身要求"实现证据"与"真实迁移证据"分两阶段登记。
