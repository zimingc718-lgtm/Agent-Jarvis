# EV-2026-09-25-write-approval-action-log

- 来源: 用户 2026-09-25「另外帮我看看最近meta出的muse，有哪些值得借鉴的功能。」→ 协调会话六条借鉴点 → 用户「好的。继续推进。」（INPUT-2026-09-25-001）；R1 四点裁定（AskUserQuestion，2026-09-25）
- 时间: 2026-09-25 / 26
- 采集者: 协调会话（claude），分支 `cr/20260925-write-approval-action-log`；未触碰生产数据；测试经 `JARVIS_DB_PATH` / `JARVIS_SKILLS_PATH` 隔离
- 支撑对象: `CR-20260925-write-approval-action-log` CP-1..CP-6
- 可定位路径: 本文件；`src/lib/store.ts`（`skill_proposals` / `action_log`）、`src/lib/tools/registry.ts#effectOf`、`src/lib/agent-loop.ts#onAction`、`src/lib/skill-proposals.ts`、`src/lib/tools/skill-tools.ts#register_skill`、`src/app/api/skills/proposals/**`、`src/app/api/actions/route.ts`、`src/components/{SkillProposalCard,ActionLog,SkillList}.tsx`、`tests/{agent-loop,skill-tools-register,skill-proposals-route,actions-route}.test.ts`、`tests/{skill-list,action-log,floating-chat}.test.tsx`

## 1. 借鉴对象与现状核对

Meta Muse（2026-09-08 发布，Connect 2026 扩充）在发邮件、付款前必须获用户批准，并给用户看"已做过什么、计划做什么"的完整记录（Meta 新闻稿、TechCrunch 09-23）。对照本项目（2026-09-25 读代码）：

| 现状 | 位置 | 含义 |
|---|---|---|
| `management` 优先级工具 11 个 | `src/lib/tools/*.ts` | `propose_*`、`save_knowledge`、`ingest_url` 已是"先 pending、用户采纳"；`add_source` / `fetch_source` / `extract_fields` / `classify_knowledge` 直写（`extract_fields` 对已登记来源直写是有证据的设计）；`save_insight` 写报告；**`register_skill` 直写，门是模型自述的 `confirmed`**（EV-2026-09-21-chat-skill-register §4 已登记为局限） |
| 转录内「采纳 / 忽略」卡片 | `FloatingChat.tsx` 处理 `entity_pending`（CR-20260915-entity-proposal-card） | 对话内确认的 UI 形态已存在，可原样给技能提议复用 |
| 提议存储 | `entity-proposals.ts`（字段级 JSON）、`entities/pending/`、`knowledge/pending/` | 都是实体 / 知识专用，技能需要自己的一条队列 |
| 工具步骤持久化 | `messages` 表的 assistant `tool_calls` 与 `tool` 行 | 只能按会话回看，且会被压缩 / 剔除改写；没有 effect / outcome，没有跨会话的账 |

用户四点裁定：复用「提议→卡片采纳」；本次只把 `register_skill` 纳入；记所有工具调用、页面默认只显示写与出网；☰ 新增「操作记录」一页。

## 2. 设计取舍与代码核对（决定了落点）

- **新表而不是反推 `messages`**：`messages` 按会话组织、会被压缩与剔除改写、没有 effect / outcome 字段；`action_log` 追加写入，`LEFT JOIN conversations` 取标题，`(user_id, created_at DESC)` 索引直接服务"最新在前 + 分页"。
- **`effect` 只在出网工具上显式声明**（`web_search` / `read_url` / `ingest_url` / `fetch_source`），其余由 `effectOf` 推出——`management` 即 `write`，否则 `read`。11 个写工具零改动，未知工具名（模型编造）记为 `read` / `failed`。
- **`ActionEffect`（store）与 `ToolEffect`（registry）两处声明同一组字面量**：`src/lib/*` → `src/lib/tools/**` 是冻结白名单（`scripts/check-module-graph.mjs`），store 不能从 registry 导入；注释互指，`tests/module-graph.test.ts` 23 例照旧全绿。
- **落账在结果之后**：`runToolLoop` 的 `Promise.all` 之后按调用顺序逐条 `onAction`，五种结算结果（ok / failed / aborted / refused / not_run）都从实际发生的事推出，不从"打算调用"推出；`chat.ts` 只做一行接线 `store.insertAction`。
- **技能提议不落磁盘**：正文存在 `skill_proposals.body`，采纳时才由 `adoptSkillProposal` 用同一个 `buildSkillDoc` 拼出 SKILL.md 并走 `registerSkill()`（slug、路径穿越守卫、重名、落盘 + 插表全部沿用；`complete: null` 不调模型）。重名在提交时早拒（模型可换名），采纳时再撞名（提议先于占名）则 409 且提议保持 pending，用户可先删旧的再采纳。
- **`register_skill` 的参数表去掉 `confirmed`**：模型再也没有可以自述的确认位；描述仍要求"先给用户看全文、用户说注册再调用"，但抢跑的后果从"写入"降为"多一张卡片"。
- **路由形态照抄实体提议**：`GET /api/skills/proposals`（待确认列表）、`POST / DELETE /api/skills/proposals/[id]`（采纳 / 忽略）；`GET /api/actions?effects=&limit=&before=`，未知 effect 400 而不是静默放行。Next 的静态段 `proposals` 优先于同级动态段 `[name]`。
- **界面**：`SkillProposalCard` 与 `EntityProposalCard` 同形态，成功后派发 `SKILLS_CHANGED_EVENT`；`SkillList` 在技能列表之上加「待确认」区，采纳 / 忽略走同一条路由；`ActionLog` 入口行与 `SearchSettings` 同形态、列表在 `<dialog>` 内、**打开前不请求**、默认 `effects=write,network`、开关切换全部。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-550 | `tests/agent-loop.test.ts`（新增 2 例，文件合计 19）+ `tests/actions-route.test.ts`（新建 3 例） | 5 | 成功 / 失败 / 未知工具 / 参数截断各一条且 effect 按优先级或声明推出；重复失败第 3 次 refused、执行期中止 aborted；路由 401、只列本人、最新在前、联表标题、`effects` 过滤、`limit` / `before` 分页、未知 effect 400 |
| TEST-551 | `tests/skill-tools-register.test.ts`（改写为 10 例）+ `tests/skill-proposals-route.test.ts`（新建 6 例） | 16 | 只落提议不落盘且事件正确；采纳后落盘、插表、`read_skill` 读回、提议离队；忽略不写盘；提交重名早拒、采纳时 409 仍 pending；参数缺失与换行；32 KB；无技能可用；穿越名经 slug 收住；参数表无 `confirmed`；路由 401 / 404 / 409 / 二次采纳 404 / 他人提议 404 |
| TEST-552 | `tests/floating-chat.test.tsx`（+1）、`tests/skill-list.test.tsx`（+2，另给既有「删除需二次确认」用例补 `fetchProposals` 缝）、`tests/action-log.test.tsx`（新建 2） | 5 | `skill_pending` 带出卡片并派发 skills-changed；待确认区列在技能之上、采纳走 POST 并刷新、忽略走 DELETE 且失败文案原样；操作记录入口在抽屉、列表在对话框、打开前不请求、默认 `write,network`、切换后含只读、空态与失败态 |

`npx tsc --noEmit`：**0 错误**（2026-09-26）。首轮类型检查抓到一处：`registerSkill` 返回 `RegisterSkillResult` 而非 `SkillRecord`，采纳结果的类型随之修正。

定向运行 10 个相关文件：首轮 151 例中 3 例失败并已修（路由测试把行种在 `upsertUser().id` 下而 `requireUserId` 解析的是会话邮箱；组件测试第二次 `render` 时第一份实例未卸载导致按钮重名；类型如上），既有 flaky `floating-chat ④` 在该轮再次超时。修后受影响的 4 个文件 21/21 通过。

`npx vitest run`（全量，2026-09-26 本机）：102 文件 / **946 例全部通过**（较上一 CR 增 3 文件、18 例），既有 flaky 本轮未复现。

## 4. 真实入口（2026-09-26 本机时区已执行）

- 环境: 用户本机**正在运行**的生产构建——从本 CR 分支构建，BUILD_ID `M1ZH_UX3FdslPgilWKml5`（18:59:18，晚于最后一处源码改动 18:41），`serve:local` 看护 23:00:28Z 启动；用户自己的 `.data/agent-jarvis.sqlite` 与 `.data/skills`——即 DEC-210 ③ 的 `user` 环境
- 驱动方式: 协调会话用 stdlib HTTP 客户端（`real_entry_t553.py`）向 `POST /api/chat/stream` 发送真实消息并解析 SSE；采纳 / 忽略调用转录卡片与 ☰「技能」所用的同一条 `POST` / `DELETE /api/skills/proposals/[id]`；操作记录经 `GET /api/actions`。事件与响应全量留存协调会话 scratchpad `real-entry/t553.json`。**不是**在浮窗里点击——卡片与「操作记录」页的目视由用户完成
- 应答模型: DeepSeek `deepseek-chat`
- 事后核对: 生产库只读查询（`mode=ro`）

| 步 | 做了什么 | 观察到的事件 | 事后核对 | 判定 |
|---|---|---|---|---|
| ① A 生成 | 会话 A「帮我生成一个『周报速记』技能…先给我看 SKILL.md 全文」 | 15.4 s；`tool_call` 只有 `list_skills`、`read_skill`；**无** `register_skill`、无 `skill_pending` | — | 模型未抢跑 |
| ① A 注册 | 「注册」 | 11.0 s；`tool_call register_skill` → `skill_pending{name: 周报速记}` | `GET /api/skills/proposals` = [周报速记]；`GET /api/skills` **不含**它 | 提议先于技能 |
| ① A 采纳 | `POST /api/skills/proposals/<id>` | 200，`skill.name = 周报速记`，description 为模型写的一句话 | `GET /api/skills` 含它、待确认区为空；只读查库 `skill_proposals` 该行 `adopted`，`skills.dir_path/SKILL.md` 存在 | 符合 ① 正例 |
| ① B 生成 + 注册 | 会话 B「帮我生成一个『会议复盘』技能…」→「注册」 | 12.9 s（只读工具）+ 10.1 s（`register_skill` → `skill_pending{name: 会议复盘}`） | — | 同 A |
| ① B 忽略 | `DELETE /api/skills/proposals/<id>` | 200 | `GET /api/skills` 不含「会议复盘」，待确认区为空；查库该行 `discarded`，磁盘无该目录 | 符合 ① 反例 |
| ② 操作记录 | `GET /api/actions?effects=write,network`；`GET /api/actions` | 默认：2 行 `register_skill` write / ok，`conversationTitle` 分别为两条会话的首句；全部：6 行，工具 `list_skills` / `read_skill` / `register_skill`，effect `read` / `write`，覆盖两条会话 | 查库 `action_log` 6 行 | 符合 ② |
| ③ 既有采纳流程 | — | 由全量回归 946/946（knowledge / entity 提议用例在内）覆盖 | — | 机器覆盖，未在真实入口重复 |

据此 R4 矩阵 CP-1、CP-2 各四列由 CONDITIONAL 转 APPROVED；`test-results.json` TEST-553 `PASS`、`real_entry: true`、`entry: user`。

## 5. 局限（如实登记）

- 操作记录只记**工具调用**：提供方请求本身、用户在 ☰ 里的手工操作（删技能、采纳知识）都不在账上。
- `skill_proposals` 里被遗忘的 pending 行没有过期清理；数量小、体量小，暂不处理。
- 模型抢跑（用户没说注册就调 `register_skill`）现在只会多出一张待确认卡片，不再写入——从单向风险降为打扰问题，但没有消除。
- 本 CR 只把 `register_skill` 纳入系统级确认；`add_source` / `fetch_source` / `extract_fields` / `classify_knowledge` / `save_insight` 仍直写（用户裁定）。
