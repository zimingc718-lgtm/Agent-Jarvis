# CR-20260925-write-approval-action-log

- 级别: L2（标准档：全部 CP 双向门——新增一张追加写入的表与一条待确认队列，`git revert` 后表与待确认文件成为无人读写的残留、不影响其它数据；不改既有表结构，不改任何已有数据的含义）
- 提出人: user（INPUT-2026-09-25-001）
- 状态: R1 已终裁（2026-09-25 用户经 AskUserQuestion 四点裁定均取推荐项：复用「提议→卡片采纳」模式 / 本次只把 `register_skill` 纳入 / 记所有工具调用、页面默认只显示写与出网 / ☰ 新增「操作记录」页）；P2 进行中
- 占用 ID: REQ-F-320, DEC-430, TASK-550, TEST-550, TEST-551, TEST-552, TEST-553
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-300（`register_skill` 的确认由"模型自述 `confirmed`"改为系统承担）、REQ-F-046 ③ 与实体提议卡片（既有"先提议、再采纳"模式被复用为通用确认形态）、REQ-F-035（工具步骤流——步骤第一次跨会话持久可查）
- 影响模块: MOD-TOOLS（`skill-tools.ts`、`registry.ts`）、MOD-CHAT（`agent-loop.ts` 落账）、MOD-STORE（新增 `action_log` 表）、MOD-CHAT-UI（转录卡片、☰「操作记录」页）
- 影响任务: 无既有任务变更，新增 TASK-550
- 影响测试: 无既有测试变更，新增 TEST-550, TEST-551, TEST-552, TEST-553
- 当前证据: `project/05_evidence/EV-2026-09-25-write-approval-action-log.md`（待建；R1 阶段的依据见本文件「现状核对」）
- 方案选项:
  - A. Muse 式对话内实时审批——写类工具执行前流里出现「批准 / 拒绝」按钮，服务端挂起等待点击（超时即放弃）。优点是当场决定；代价是工具循环要从"同步执行"改成"可挂起、可续跑"，SSE 要多一种等待态，超时/断连/并发（刚做完的 DEC-420 互斥）都要重新推敲。
  - B. **复用既有「提议 → 卡片采纳」模式**——写类工具不直接写，先落一条待确认记录，转录里出现与实体提议同形态的「采纳 / 忽略」卡片，☰ 里也有队列；用户点击后才真正执行。知识条目（REQ-F-046 ③）与实体字段提议（CR-20260915-entity-proposal-card）已经是这个形态，本 CR 把 `register_skill` 接上同一套，并新增跨会话的「操作记录」页——建议选中。
  - C. 只做「操作记录」，不改确认机制——不选：`register_skill` 靠模型自述 `confirmed` 的缺口（EV-2026-09-21-chat-skill-register §4）继续存在，只是事后能看到。
  - D. 把全部 `management` 优先级的直接写入（`add_source` / `fetch_source` / `extract_fields` / `classify_knowledge` / `save_insight`）一律改为先提议——不选：`extract_fields` 对已登记来源直写是有证据的设计（"registered may write straight through"），`save_insight` 是报告本身的出口；全部拦下会让用户被确认请求淹没，Muse 也只在"发邮件、付款"这类有外部后果的动作前请求批准。
- 选择理由: 见「现状核对」——本项目已经有一套被两处使用的确认形态，且 chat-skill-register 的 EV 已把"确认靠模型自述"登记为局限；补上同一形态比另造一套流内挂起协议便宜得多，也和用户已经熟悉的界面一致。操作记录则填补"每轮步骤只在当轮转录可见"的空白，是 Muse「完整审计轨迹」在本项目里的对应物。
- R1 裁定（2026-09-25，AskUserQuestion 四点）: ①确认机制取 B（复用「提议→卡片采纳」）；②本次只把 `register_skill` 纳入系统级确认，`add_source` / `fetch_source` / `extract_fields` / `classify_knowledge` / `save_insight` 保持现状；③操作记录记**所有**工具调用，页面默认只显示写与出网、可切换显示全部；④放在 ☰ 新增的「操作记录」一页。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交，重建重启；`register_skill` 回到 `confirmed` 自述形态，「操作记录」页消失。
  - 数据：`action_log` 表与待确认技能记录成为无人读写的残留，不影响其它表；需要时可手工删除，不做自动迁移。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260925-write-approval-action-log` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-550 DONE；TEST-550..553 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿；不新增 lib→tools 边。
- 真实入口: 未执行（R1 尚未终裁。实现并重建重启后在用户运行中的服务上：①对话里生成技能并说「注册」→ 转录出现「采纳 / 忽略」卡片、技能**尚未**出现在 ☰「技能」→ 点「采纳」后出现；点「忽略」则不出现；②☰「操作记录」里能看到刚才的 `register_skill` 提议、采纳动作与本轮其它工具调用，跨会话仍在；③回归：知识条目与实体提议的既有采纳流程不变）
  - **真实入口（必做）**：①「注册」后先卡片、后采纳、技能才出现；忽略则不出现；②操作记录跨会话可查、条目含时间 / 会话 / 工具 / 参数摘要 / 结果；③既有的知识/实体采纳流程不受影响。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：待用户拍板。
- R1 终裁: 已完成 | 用户 | 2026-09-25

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：用户 2026-09-25 要求调研 Meta Muse 可借鉴功能（INPUT-2026-09-25-001），协调会话给出六条并建议先做第 1 条，用户回复「好的。继续推进。」；协调会话读代码核对现状后写出方案 A-D，就确认机制 / 纳入范围 / 记录范围 / 展示位置四点发起 AskUserQuestion，用户逐点选择推荐项，视为对方案 B 的终裁。

## 现状核对（2026-09-25 读代码）

| 现状 | 位置 | 含义 |
|---|---|---|
| `management` 优先级（写与配置类）工具共 11 个：`propose_entity`、`propose_entity_update`、`propose_person`、`add_source`、`fetch_source`、`extract_fields`、`save_knowledge`、`ingest_url`、`classify_knowledge`、`save_insight`、`register_skill` | `src/lib/tools/*.ts` | 其中 `propose_*` 与 `save_knowledge`/`ingest_url` 已是"先 pending、用户采纳"；`add_source`/`fetch_source`/`extract_fields`/`classify_knowledge` 直写（对已登记来源，`extract_fields` 设计上直写）；`save_insight` 写报告；`register_skill` 直写但以模型自述 `confirmed` 为门 |
| 转录内「采纳 / 忽略」卡片 | `FloatingChat.tsx` 处理 `entity_pending` 事件（CR-20260915-entity-proposal-card）；`knowledge_pending` 只给系统提示、去 ☰ 采纳 | 对话内确认的 UI 形态已存在，可直接给技能提议复用 |
| 提议存储 | `src/lib/entity-proposals.ts`（`entities/proposals/*.json`，字段级；`entities/pending/` 整体实体；知识 `knowledge/pending/*.md`） | 都是实体/知识专用，技能提议需要自己的一条队列（`.data/skills/pending/<slug>/SKILL.md` + 表状态，或 JSON 记录），P2 决定 |
| 工具步骤持久化 | `messages` 表里的 assistant `tool_calls` 与 `tool` 行 | 只能按会话回看，且被压缩/剔除后对用户不可见；没有跨会话、按时间的操作账 |
| ☰ 抽屉的条目形态 | `SearchSettings.tsx`「Entry row: same shape as 「模型」/「账号登录」」 | 新增「操作记录」一行可照此形态 |

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 写入面的确认由系统承担：`register_skill` 不再直接写入，而是生成一条待确认的技能提议，用户在转录卡片或 ☰ 队列里「采纳」后才真正注册，「忽略」则丢弃；模型自述的 `confirmed` 参数退役 | REQ-F-320（新增） | 新增 | 双向 | 真实入口：对话里生成 → 说「注册」→ 卡片 → 采纳后技能出现 / 忽略则不出现（证据：TEST-553） |
| CP-2 | 产品 | 「操作记录」：用户能跨会话查看模型做过的动作——时间、所在会话、工具、参数摘要、结果（成功 / 失败 / 中止 / 被拒），默认显示写与出网类、可切换显示全部 | REQ-F-320 | 新增 | 双向 | 真实入口：☰「操作记录」里看到刚才的动作，换会话后仍在（证据：TEST-553） |
| CP-3 | 架构 | 新增 `action_log` 表（追加写入，不改既有表）；`runToolLoop` 每次执行完一个工具调用就落一行（含失败 / 中止 / 参数被截断而未执行）；`GET /api/actions` 分页读取 | DEC-430（新增） | 新增 | 双向 | 机器：`tests/agent-loop.test.ts` 落账用例 + `tests/actions-route.test.ts`（证据：TEST-550） |
| CP-4 | 架构 | 技能提议的存储与生命周期：`register_skill` 写待确认记录并发 `skill_pending` 事件；`POST /api/skills/proposals/[id]` 采纳（走既有 `registerSkill()`）或忽略；重名在采纳时按既有规则拒绝 | DEC-430 | 新增 | 双向 | 机器：`tests/skill-tools-register.test.ts` 改写 + 提议路由用例（证据：TEST-551） |
| CP-5 | 模块 | 转录内技能提议卡片（复用实体提议卡片形态）+ ☰「技能」待确认区 + ☰「操作记录」页（含筛选） | TASK-550 | 新增 | 双向 | 机器：`tests/floating-chat.test.tsx` / 新增组件测试（证据：TEST-552） |
| CP-6 | 测试 | 新增 TEST-550..553 | TEST-550, TEST-551, TEST-552, TEST-553 | 新增 | 双向 | 机器：`npx vitest run tests/agent-loop.test.ts tests/skill-tools-register.test.ts tests/actions-route.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260925-write-approval-action-log` 节后，跑 `governance.py matrix CR-20260925-write-approval-action-log` 生成矩阵骨架，再逐格填裁决。
