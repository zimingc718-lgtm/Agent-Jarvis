# SPEC_DRAFT — CR-20260918-per-user-data-isolation

本文件是四份受控说明书（+ test-results.json + docs/INDEX.md）的**待落笔内容**，供协调会话在合并阶段
手工落进对应文件——本 CR 按 fork 边界不直接编辑这些共享文件。**落笔前提**：R1 已由用户人工终裁（见
CR 文档「R1 终裁」行）——与本批次此前 7 条 CR 不同，本 CR 是重型档，`.data/` 未纳入版本库、自动迁移
触碰真实生产数据，**不适用"批量 Approve as-is"式落笔**，请在落笔前确认 CR 文档「R1 终裁」一行已经是
`已完成 | 用户 | YYYY-MM-DD`，而不是假定它与同批次其它 CR 一起被批准。插入前请先 `check-ids` 核对
REQ-F-270/271、DEC-380/381、TASK-500/501、TEST-500/501 届时仍未被其它并行工作占用。

---

## 目标文件一：`project/01_specification/产品需求说明书.md`

### 1a. `## 功能需求` 表新增两行（表头：`| ID | 名称 | 优先级 | 描述 | 验收标准 | 状态 |`）

```
| REQ-F-270 | 每用户实体/知识库数据私有隔离 | MUST | 每个真实用户（真实登录会话或单管理员本机身份）的实体（`entities.ts`）与知识库（`knowledge.ts`）数据各自存放在该用户私有的文件根下，任何用户之间不共享同一个数据池——与 `store.ts`（SQLite，conversations/providers/skills）已有的按 `userId` 隔离模式对齐。 | ①两个不同 `userId` 各自创建的实体互不可见（一方的 `GET /api/entities` 看不到另一方创建的对象）；②同一 `userId` 的数据在跨请求间保持一致（不因请求顺序或并发而串号）；③本条不要求资料库（`library.ts`，团队共享参考资料，见 REQ-F-046 附近条目）与本机文档目录（REQ-F-110）具备同等隔离——两者的共享模型与本条讨论的对象不同，如实排除。 | APPROVED（CR-20260918-per-user-data-isolation，R1 已终裁：INPUT-2026-09-18-001 第 9a 条调查后，用户通过 AskUserQuestion 明确裁定"Each person needs their own private data"） |
| REQ-F-271 | 现有单管理员真实数据首次真实登录时自动继承 | MUST | 本机单管理员模式（`JARVIS_SINGLE_ADMIN_ID`）下已经存在的实体/知识库真实数据，在满足 REQ-F-270 的私有隔离形态上线后，于该管理员本人的首次真实请求时自动"过户"到他自己的私有根下，不需要任何人工复核脚本或额外操作。 | ①迁移只对判定为 owner 的身份触发（`JARVIS_SINGLE_ADMIN_ID` 精确匹配，或未来真实登录场景下 `JARVIS_OWNER_EMAIL` 大小写不敏感匹配），任何其他身份的首次请求只得到一个空的私有根，不触碰既有数据；②迁移是幂等的——同一用户的第二次及以后请求不重复执行、不报错；③迁移按 entities/knowledge 两个子域独立判定，进程在两次子迁移之间意外终止后，下次请求只补完尚未完成的那一半，不会因为"整体未完成"而重来已成功的部分。 | APPROVED（CR-20260918-per-user-data-isolation，R1 已终裁：用户通过 AskUserQuestion 明确裁定"Automatic on first login"，权衡自动化风险后的直接产品决策） |
```

### 1b. 新增小节 `## 变更响应 · CR-20260918-per-user-data-isolation`

锚点：插在既有最后一个 `## 变更响应 · CR-*` 小节之后、`## 批准状态` 之前（用
`re.search(r"(?m)^## 批准状态$")` 定位，不要用字符串 `.replace`）。

```markdown
## 变更响应 · CR-20260918-per-user-data-isolation

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 每用户文件根解析与迁移模块 | REQ-F-270（新增）、REQ-F-271（新增） | 新增 | 新增 REQ-F-270、REQ-F-271 |
| CP-2 全部真实调用点接线 | REQ-F-270、REQ-F-271 | 派生 | 不重复占号，落实 REQ-F-270/271 的具体执行面 |

**为什么是两条新 REQ 而不是一条**：私有隔离（REQ-F-270，"数据存在哪、归谁"）与自动迁移（REQ-F-271，
"现有数据什么时候、怎么过户"）是两个可以独立成立的产品承诺——一个部署可以只要隔离、手动搬迁移数据
（走「问题经过」否决的方案 D），也可以两者都要（本 CR 的实际选择）。分开登记让未来任何一条只想改动
其中一半的 CR 有干净的挂靠点，不必牵动另一半的验收条件。
```

### 1c. `## 批准状态` 节追加一行

```
- 用户确认：2026-09-18，CR-20260918-per-user-data-isolation（重型档）R1：用户在 INPUT-2026-09-18-001 第 9a 条提出 Railway/多用户部署，协调会话调查代码现状（`entities.ts`/`knowledge.ts` 完全没有 `userId` 概念，一旦启用真实多用户登录即等同于所有用户共享同一份数据）后，用户通过 AskUserQuestion 分两步明确裁定：①每用户数据私有隔离，不共享池；②现有单管理员真实数据首次真实登录时自动继承，不走人工复核脚本。新增 **REQ-F-270**、**REQ-F-271**。逐 CP 方案见「变更响应 · CR-20260918-per-user-data-isolation」。
```

---

## 目标文件二：`project/02_solution/架构设计说明书.md`

### 2a. `## 架构决策` 表新增两行（表头 7 列：`| 决策 ID | 覆盖需求 | 方案 | 替代方案 | 选择理由 | 风险 | 状态 |`，紧接在届时最大的既有 DEC 编号之后）

```
| DEC-380 | REQ-F-270 | **每个 `userId` 一个独立的文件系统根目录，路径由净化后的 `userId` 派生；`entities.ts`/`knowledge.ts` 内部零改动，只改调用点传入的既有 `root` 参数**（CR-20260918-per-user-data-isolation）：新增 `src/lib/user-data-paths.ts`，导出 `entitiesRootFor(userId)`/`knowledgeRootFor(userId)`（纯路径函数）。`sanitizeUserId` 把 `userId` 中的路径穿越/非法字符替换为 `_`，空值或净化后全空一律拒绝（抛错，不静默兜底成 `USERS_BASE` 本身）。 | A. 把两个模块整体搬进 SQLite（`store.ts` 已有的 `userId` 优先参数模式）；B. 文件仍放同一个共享目录，靠文件名加 `userId` 前缀区分 | A 是比本 CR 大一个数量级的重写，且两个模块现有的文件解析逻辑（frontmatter、`history/*.jsonl` 追加写）本身完全正确，不是本 CR 要解决的问题；B 的隔离正确性依赖"每一个读写点都记得做前缀过滤"，任何一处新代码忘记过滤就是一次真实的跨用户数据泄露且不易在代码审查中被发现——选中方案把隔离边界建在操作系统的目录边界上，不依赖任何调用点自觉地做过滤，一个忘记接线的调用点最坏结果是"用到了合法但错误的单一目录"而不是"读到了另一个真实用户的目录"，故障形态更安全。 | 忘记接线的调用点仍会读到 CP-1 之前的全局旧根而不是任何真实用户的私有数据（故障形态已在「选择理由」说明），但功能上表现为"看不到自己的数据"，需要靠 CP-2 的全量接线核对与真实入口发现——已在 CR 文档如实登记。 | APPROVED（R1 已终裁；INPUT-2026-09-18-001 第 9a 条 + AskUserQuestion 决策①） |
| DEC-381 | REQ-F-271 | **首次真实登录（`requireUserId` 解析出的 `userId` 命中 `JARVIS_SINGLE_ADMIN_ID` 精确匹配，或 `JARVIS_OWNER_EMAIL` 大小写不敏感匹配）时自动 `rename` 旧全局根到该用户私有根；entities 与 knowledge 两个子域各自独立判定、独立执行**（CR-20260918-per-user-data-isolation）：`ensureUserDataMigrated`/`resolveUserDataRoots` 是唯一入口，`existsSync(target)` 前置短路保证幂等。`rename` 是单一文件系统元数据操作，不存在"迁移到一半"的中间态——要么整条目录树瞬间换了个名字，要么因任何原因抛错、原目录分毫未动。 | C. 人工审阅后运行一次性迁移脚本（dry-run 可复核）；D. 迁移前后端到端整个 legacy 根一次性搬完（entities 和 knowledge 合并成一次事务） | C 与用户 AskUserQuestion 决策②（"Automatic on first login"）直接冲突，用户在权衡自动化风险与人工流程摩擦后明确选择自动；D 在进程于两次子迁移之间崩溃时（例如迁移完 entities、还没轮到 knowledge 时被杀）会把已经成功搬走的 entities 又判定为"整体未完成、需要重来"，按模块独立判定的幂等设计更安全。 | 首次真实迁移这一事件本身，机器测试只能证明迁移函数在各类边界条件下行为符合设计，不能证明"用户真实机器上这一次真实迁移会成功"——真实入口验证与迁移前后文件清单比对已写入 CR 文档「验收条件」，不能省略。`isOwner` 的判定条件来自运维侧环境变量，配置写错不会被本机制发现，与 `JARVIS_SECRET_KEY` 等既有环境变量的现状一致，非本 CR 新引入的风险类别。 | APPROVED（R1 已终裁；AskUserQuestion 决策②，接受本项目已发生过一次的 CR-F 式自动化风险，以本 CR 的原子化设计将其降到最低） |
```

### 2b. 新增小节 `## 变更响应 · CR-20260918-per-user-data-isolation`（锚点同 1b）

```markdown
## 变更响应 · CR-20260918-per-user-data-isolation

重型档（CP-2 的真实迁移事件判定为单向门，见 CR 文档「级别」）。**无 schema 变更**（`entities.ts`/
`knowledge.ts` 内部数据格式本 CR 完全未改动，只改调用点传入的根路径）、**零新增运行依赖**、
**无新增出网面**。

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 每用户文件根解析与迁移模块 | DEC-380、DEC-381 | 新增 | 新增 DEC-380、DEC-381 |
| CP-2 全部真实调用点接线 | DEC-380、DEC-381 | 派生 | 不重复占号，落实两条决策的执行面 |
```

### 2c. `## 批准状态` 节追加一行

```
- CR-20260918-per-user-data-isolation（R2，重型档）：新增 **DEC-380**（每用户文件根方案）、**DEC-381**（自动迁移触发机制）。逐 CP 方案见「变更响应 · CR-20260918-per-user-data-isolation」。
```

---

## 目标文件三：`project/03_modules/模块任务开发说明书.md`

### 3a. `## 模块任务总览` 表新增两行（表头 7 列：`| 任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试 |`）

```
| TASK-500 | 新增 `src/lib/user-data-paths.ts` | **每用户文件根解析与迁移模块**（DEC-380/381，CP-1）：`entitiesRootFor`/`knowledgeRootFor`（纯路径函数）、`sanitizeUserId`（路径穿越防护）、`isOwner`（双通道 owner 判定）、`ensureRootMigrated`/`ensureUserDataMigrated`/`resolveUserDataRoots`（按模块独立判定的幂等迁移 + 统一解析入口）。 | DONE | 无 | REQ-F-270, REQ-F-271, DEC-380, DEC-381 | TEST-500 |
| TASK-501 | MOD-API / MOD-CHAT / MOD-TOOLS / MOD-UI | **全部真实调用点接线**（DEC-380/381，CP-2）：`entities/**`、`knowledge/**` 共 10 个 API 路由改为 `guard()` 判别式联合类型解析 `resolveUserDataRoots`；`chat.ts#buildRegistry` 新增 `roots` 参数并接上其两个真实调用点（`runChatTurn`、`api/tools/route.ts`）；`src/app/page.tsx` 首屏 SSR；`knowledge-tools.ts` 的 `ingest_url` 工具补上此前遗漏转发的 `entitiesRoot`。`library.ts`/`documents.ts` 明确不在本任务范围，见 CR 文档「非目标」。 | DONE | TASK-500 | REQ-F-270, REQ-F-271, DEC-380, DEC-381 | TEST-501 |
```

### 3b. 新增小节 `## 变更响应 · CR-20260918-per-user-data-isolation`（锚点同上）

```markdown
## 变更响应 · CR-20260918-per-user-data-isolation

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 每用户文件根解析与迁移模块 | TASK-500 | 新增 | 新增 TASK-500 |
| CP-2 全部真实调用点接线 | TASK-501 | 新增 | 新增 TASK-501，依赖 TASK-500 |
```

### 3c. `## 批准状态`（或本文件等价的登记节，命名请以合并时刻的实际标题为准）追加一行

```
- CR-20260918-per-user-data-isolation（R3）：新增 **TASK-500**（每用户文件根解析与迁移模块）、**TASK-501**（全部真实调用点接线）。逐 CP 方案见「变更响应 · CR-20260918-per-user-data-isolation」。
```

---

## 目标文件四：`project/04_tests/测试说明书.md`

### 4a. `## 测试矩阵` 表新增两行（表头 7 列：`| 测试 ID | 类型 | 覆盖需求 | 覆盖模块/任务 | 断言目标 | 命令 | 必选 |`）

```
| TEST-500 | Unit | REQ-F-270, REQ-F-271 | MOD-ENTITIES / TASK-500 | `tests/user-data-paths.test.ts` 12 例：CP-1（①同一 `userId` 每次算出同一条路径且落在 `USERS_BASE` 下；②不同 `userId` 算出不同路径；③路径穿越字符被净化；④空/空白 `userId` 拒绝；⑤邮箱净化后仍可读）+ CP-2（①单管理员模式命中时真的搬迁；②幂等；③非 owner 只得到空目录、legacy 原样保留；④邮箱大小写不敏感；⑤legacy 根为空时 owner 得到空目录不报错；⑥半迁移恢复——entities 已迁移、knowledge 还在 legacy 时第二次调用只补完 knowledge；⑦无 owner 配置时谁登录都不触发迁移）。 | `npx vitest run tests/user-data-paths.test.ts` | 是 |
| TEST-501 | Integration + Regression | REQ-F-270, REQ-F-271 | MOD-API / MOD-CHAT / TASK-501 | ①`tests/entity-route.test.ts`/`tests/knowledge-route.test.ts`/`tests/sweep-route.test.ts` 已改造为解析同一 mock 用户（`owner@example.com`）的私有根而非直接读写全局 `ENTITIES_ROOT`/`KNOWLEDGE_ROOT`——证明真实路由确实按用户解析根，而不是继续读全局根；②`npx tsc --noEmit` 0 错误，确认 `buildRegistry` 新签名的全部调用点（含 `tests/document-tools.test.ts`/`tests/tool-budget.test.ts` 两处历史直接调用）已同步；③全量回归 `npx vitest run`——95 个测试文件、887 个用例绿，证明接线未破坏任何既有行为。 | `npx vitest run && npx tsc --noEmit -p .` | 是 |
```

### 4b. 新增小节 `## 变更响应 · CR-20260918-per-user-data-isolation`（锚点同上）

```markdown
## 变更响应 · CR-20260918-per-user-data-isolation

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 每用户文件根解析与迁移模块 | TEST-500 | 新增 | 新增 TEST-500 |
| CP-2 全部真实调用点接线 | TEST-501 | 新增 | 新增 TEST-501 |

**真实入口**：`scripts/probe-per-user-data-isolation.mjs`（已写好，本 CR 按 fork 边界刻意未对真实数据
执行——脚本本身设计为只读检查，不覆盖首次真实迁移事件本身，见脚本顶部注释）。CP-2 表格中"全部真实调用
点接线"这件事本身已由改造后的路由测试 + 全量回归机器验证；**首次真实登录触发的真实迁移事件**——现有
单管理员的真实生产数据是否真的被正确搬迁——无法由任何单测代劳,只能由协调会话在用户生产环境执行,
步骤见 CR 文档「验收条件」。

### 人工发现项

首次真实迁移事件的正确性（用户真实机器、真实文件系统状态下这一次真实迁移是否成功）如实登记为人工
（真实入口）发现项，不用宽松断言伪装成已覆盖——见 R4 评审矩阵 CP-2/测试列的 CONDITIONAL 标注。
```

### 4c. `## 批准状态`（或本文件等价的登记节）追加一行

```
- CR-20260918-per-user-data-isolation（R4）：新增 **TEST-500**（模块单测，12 例）、**TEST-501**（集成回归，含路由测试改造 + 887 例全量回归）。首次真实迁移事件的真实入口验证列为人工发现项，尚未执行，见「变更响应 · CR-20260918-per-user-data-isolation」。逐 CP 方案见同节。
```

---

## 目标文件五：`project/05_evidence/test-results.json`

### 5.1 `tests` 数组追加两条

```json
{
  "id": "TEST-500",
  "result": "PASS",
  "command": "npx vitest run tests/user-data-paths.test.ts",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "每用户文件根解析与迁移模块（REQ-F-270/271，DEC-380/381）。12 个新增用例，覆盖路径确定性/隔离性/穿越净化/空值拒绝/可读性（CP-1）与单管理员迁移/幂等/非 owner 空目录/大小写不敏感/空 legacy 根/半迁移恢复/无 owner 配置（CP-2）。纯单元测试，未触碰任何真实数据。"
},
{
  "id": "TEST-501",
  "result": "PASS",
  "command": "npx vitest run && npx tsc --noEmit -p .",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "全部真实调用点接线（REQ-F-270/271，DEC-380/381）。entity-route.test.ts/knowledge-route.test.ts/sweep-route.test.ts 三个既有路由测试文件已改造为解析同一 mock 用户的私有根（此前直接读写全局 ENTITIES_ROOT/KNOWLEDGE_ROOT，本 CR 之后与真实路由行为不一致，已同步修正，过程中发现并清理了它们此前未设置 JARVIS_USERS_PATH 导致测试数据泄漏进 worktree 共享 .data/users 目录的问题）；全量回归 95 个测试文件、887 个用例绿。首次真实登录触发的真实迁移事件本身未在此打钩——real_entry 如实标为 false，该事件的验证方式与时机见 EV-2026-09-18-per-user-data-isolation.md 与 CR 文档「验收条件」，非本条目遗漏。"
}
```

### 5.2 `change_records` 数组追加一条字符串

```json
"CR-20260918-per-user-data-isolation"
```

### 5.3 `executed_commands` 数组追加

```json
"npx tsc --noEmit -p .  (OK 0 错误)",
"npx vitest run  (OK：95 个测试文件、887 个用例全绿，含三个改造后的路由测试文件)"
```

---

## 目标文件六：`docs/INDEX.md`

**不手写内容**——由 `npm run docs:index` 生成，`check-index` 做逐字节比对。待五份文档全部落笔后统一
重新生成一次。

---

## 落笔前后的核对清单（给协调会话）

1. **先确认 R1 已真实完成**——本文件开头已强调：本 CR 是重型档、涉及真实数据自动迁移,不能假定与
   同批次其它 CR 一起被"批量 Approve as-is"。落笔前重新打开 CR 文档确认「R1 终裁」一行已经是
   `已完成 | 用户 | YYYY-MM-DD`。
2. 落笔前对四份文档各跑一次 `python tools/governance.py check-tables`，确认插入行的单元格数与表头
   一致。
3. 四份文档落完之后跑 `python tools/governance.py check-ids`，确认 REQ-F-270/271、DEC-380/381、
   TASK-500/501、TEST-500/501 未与其它并行工作的区间重叠。
4. 落完 `## 变更响应` 小节后，四份文档各自的登记节都要有一行指向新小节，否则 `check-approval-log`
   FAIL；随后 `python tools/governance.py review r2|r3|r4 --cr CR-20260918-per-user-data-isolation`
   应转为 PASS（本 fork 分支内已确认因共享文档未落笔而 FAIL，属预期）。
5. `npm run docs:index` 重新生成 `docs/INDEX.md`。
6. **合并顺序按 main → CR 分支 → snapshot → 合并回 main 执行**（CLAUDE.md 第三节），snapshot 全流程
   只跑一次。本 CR 未修改 `DisplayScreen.tsx`/`ui-events.ts`/`types.ts` 等共享 UI 状态文件，预期为
   纯净合并。
7. **合并、`verify` PASS 之后，先不要立刻当作收口**——按 CR 文档「验收条件」执行真实入口五步骤
   （迁移前文件清单基线 → 重启触发首次真实请求 → 核对迁移后目录与清单一致 → 真实 UI 读写闭环 →
   可选的非 owner 隔离验证），把结果补记进 `EV-2026-09-18-per-user-data-isolation.md`，CR 文档 R4
   矩阵 CP-2/测试列的 CONDITIONAL 才能转为 APPROVED、状态才能改为 CLOSED。这一步是本 CR 与本批次
   此前 7 条 CR 收口流程最大的不同点，不要按惯性直接照抄"合并+verify PASS=收口"。
