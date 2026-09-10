# CR-20260909-minimal-floating-chat

- 级别: L3
- 提出人: user（"现在先不做用户账号登录。仅作模型key配置。单一管理员用户。" → 多轮需求讨论 → "确认。落地后，给我看各个流程的变化点方案及角色评审的意见。" → "按开发流程执行。"）
- 状态: CLOSED（P1-P4 完成；TASK-021..029 DONE、TEST-025..030 PASS、g1-g4 全绿）
- 占用 ID: TASK-021..029, TEST-025..030 （由 CR-20260910-risk-scaled-gates 回填，只登记本 CR **创建**的 ID，不含其引用或修订的既有 ID；DEC-001..014 的创建归属无法从现有记录复原，故未登记。）
- 评审模型: pre-R1234（旧 G0/G1/G2/G3/G3.5/G4；CR-20260909-consensus-review-gates 起改为 R1–R4 + G3/G3.5/G4，不追溯本 CR）
- 影响需求: REQ-F-001（暂缓）、REQ-F-002、REQ-F-003、REQ-F-004、REQ-F-005、REQ-F-006（重写）、REQ-F-007、REQ-F-013、REQ-F-014（重写）、REQ-F-015、REQ-F-016、REQ-NF-002（暂缓）、REQ-NF-004；新增 REQ-F-017、REQ-F-018
- 影响模块: MOD-AUTH（单管理员形态）、MOD-PROVIDER（优先级）、MOD-CHAT（会话生命周期、优先级解析）、MOD-CHAT-UI（浮窗收敛、状态灯四态、新对话、错误行、视觉简约化）、MOD-SETTINGS-UI（优先级 UI）
- 影响任务: 新增 TASK-021..TASK-029；既有 TASK-007「模型切换」子功能废止（由 TASK-023 收敛）、TASK-001 语义降级、TASK-009/010 小改（TASK-025 承接）
- 影响测试: 新增 TEST-025..TEST-030；改写 TEST-011（删「浮窗切换器」断言）、TEST-012（面板限高 65vh→50vh + 状态灯四态对比度）；扩展 TEST-016（reorder）、TEST-023（config 单管理员适配）；TEST-022 随 REQ-F-001 暂缓
- 当前证据: `project/05_evidence/EV-2026-09-09-minimal-floating-chat-requirements.md`（需求讨论与决策链）、`project/05_evidence/EV-2026-09-09-minimal-floating-chat-impl.md`（P3 实现 + P4 验证）
- 方案选项:
  - A. 只把 Google OAuth 配完，不改需求（成本：Google Console 15 分钟；代价：从此依赖一个 Google Cloud 项目）
  - B. 降级 REQ-F-001 为「本地单管理员会话」，浮窗收敛为「状态灯 + 输入框 + 单按钮」，Provider 选择整体移到「配置」并引入优先级
  - C. 登录做成可选（默认单管理员，配了 Google 凭据即启用登录，两套并存）
- 选择理由: 选 B。当前功能的「用户范围」本就是「本机个人用户」，Google 登录（REQ-F-001）与多用户隔离（REQ-NF-002）在本功能中没有被真实行使的场景——REQ-NF-002 的 A/B 隔离只在合成测试里出现，无真实第二用户。A 引入长期外部依赖；C 让 auth 层承担两套模式与两套测试，改动量最大且当前无收益。B 把「单管理员」从临时 workaround（`JARVIS_TEST_USER_ID` 旁路，已实现且已测）正式写进说明书，作为当前版本形态；REQ-F-001/NF-002 标记 DEFERRED，登录入口占位保留，待后续 CR 恢复。浮窗收敛与优先级机制为用户逐条确认的产品决策。
- 回滚方式:
  - 文档回滚：还原 `产品需求说明书.md`（REQ-F-001/NF-002 状态、REQ-F-002..016 验收、删除 REQ-F-017/018 与本 CR 澄清小节与评审小节）、`架构设计说明书.md`（删「架构角色定位与文档范围」「技术栈与部署形态」「CR-20260909 变化点架构裁决」三节与 DEC-010/011/012，还原 DEC-005 与 MOD 职责表、接口契约）、`模块任务开发说明书.md`（删 TASK-021..029、「变化点影响矩阵」节与本 CR 复盘小节）、`测试说明书.md`（删 TEST-025..030、「任务→测试派生矩阵」节，还原 TEST-011/012、TEST-016/023）、删除 `EV-2026-09-09-minimal-floating-chat-requirements.md`、`test-results.json` 去除本 CR 条目。
  - 运行回滚：从 `.env.local` 删除 `JARVIS_TEST_USER_ID`，配置 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 即恢复 REQ-F-001 登录路径（代码无需改动）。
  - 无 schema 变更（P3 实现阶段若新增 Provider 优先级字段，另在实现 CR 中记录迁移）。
  - 回滚后重跑 `python tools/governance.py verify|gate g1|gate g2|check-changes` 并重新 `snapshot`。
- 验收条件:
  - P1/P2（本 CR 范围）：四本说明书一致，`gate g1`、`gate g2`、`check-changes`、`verify`、`ui` 全部通过；REQ-F-017、REQ-F-018 在模块与测试说明书均有覆盖；REQ-F-001、REQ-NF-002 保留模块/测试覆盖行且状态标 DEFERRED。
  - P3/P4（后续实现 CR 范围，不在本 CR）：TEST-025..030 取得 PASS 证据；`ui-contract.mjs` 删除 `__chip`/`__state`/`__model` 相关规则并新增状态灯四态规则；真实入口冒烟走通「无登录进入 → 配置优先级 → 对话 → 停止即结束 → 新对话 → 刷新空白」。
- 评审记录: 各角色以本职说明书 + 行业惯例为立场独立评审，允许 CONDITIONAL / 反对。
  - **产品 owner**（守：已批准需求不得静默削减、MUST 须有可观察验收、变更须用户确认）：①「用户范围」原文即「本机个人用户」，单管理员一致，非收缩。②浮窗删元素是能力迁移 + 升级（Provider 选择→优先级），净增。③坚持优先级机制写进 REQ-F-006 验收，不下放 UI 规范——否则「对话用哪个 Provider」无验收锚点。④REQ-F-001/NF-002 只能 DEFERRED，须保留模块/测试覆盖行。⑤15 个变化点已逐轮用户确认。结论：**APPROVED**。
  - **架构角色**（守：技术可行、可维护、信任模型清晰；行业惯例：本地单用户工具 OAuth 是摩擦项）：①`JARVIS_TEST_USER_ID` 旁路已存在且被 TEST-001/002 覆盖，无新增信任面。②**但该 env 语义是「测试旁路」，且生产构建 `next start` 下不生效**——当前「单管理员」实际只在 `npm run dev` 成立，架构说明书须显式标注生产形态为待定。③新增「架构角色定位与文档范围」「技术栈与部署形态」两节，补齐首版缺失的部署/技术栈/依赖边界记录（含 `openai` 冗余依赖）。④DEC-010/011/012 立项（待评审），P3 落定后转 APPROVED。⑤请求级错误以 HTTP 错误状态返回（非 SSE `error` 事件），属 DEC-004 细化。结论：**CONDITIONAL**——生产形态须在架构说明书显式标注为待定（已落实）。
  - **模块开发角色**（守：任务单一职责、可独立提交与回滚、可独立测试、无隐藏业务）：①对 16 个架构裁决点逐行建「变化点影响矩阵」，标注不变/小改/大改/废止，无遗漏。②**TASK-025 职责过宽**（跨 MOD-CHAT + MOD-CHAT-UI、三件事）→ 要求按 3 个可独立提交子项实现。③**TASK-024 让首页 SSR 发起出站探测会耦合首屏 TTFB**→ 要求探测不阻塞首屏（灯先「检测中」）。④`providers.priority` 迁移须 `ALTER TABLE ... DEFAULT`（`node:sqlite` 无迁移框架）→ 写入 TASK-021。结论：**CONDITIONAL**——TASK-024/025 条件已写入任务描述，P3 实现须满足。
  - **测试角色**（守：AI_STANDARD 原则 12 真实入口对应、原则 15 逐条断言、行为回归须有守卫）：①建「任务→测试派生矩阵」，覆盖 TASK-021..029 + 3 个受影响既有任务。②**REQ-F-005「停止即结束会话」是行为回归**（原停止后可续）→ TEST-029 必须断言「停止后下一条消息为新 `conversationId`」。③REQ-F-018「每次加载探测」**严禁在 vitest/CI 打真实网络**→ TEST-027 用 mock，真实探测仅 e2e 对 `127.0.0.1`。④TEST-030「新对话」按 6 个独立断言展开，断言层级定在 DOM 可观察结果，不绑定 `sessionStorage` 键名/服务端字段。⑤TEST-022 随 REQ-F-001 暂缓，g3 措辞改「需求暂缓」，不得造成「登录已验证」假象。结论：**APPROVED**。
- 评审结论汇总: 产品 owner APPROVED；架构 CONDITIONAL（生产形态标注已落实）；模块 CONDITIONAL（TASK-024/025 条件已写入描述，P3 实现前置）；测试 APPROVED。CR 状态 APPROVED，CONDITIONAL 条款转为 P3 实现 CR 的验收前置。

## 背景

用户在 P6 运行中尝试配置 Google OAuth，判断当前阶段不需要账号体系，要求以单一本地管理员身份先把模型 Key 配置与对话跑通。随后逐轮确认了对话浮窗的最简形态与 Provider 优先级机制。视觉方向参考 `gens.team/ai-insights`（浅色简约 SaaS，非知识控制台）。

## 各流程变化点

### P1 产品需求说明书

| 位置 | 变化 |
|---|---|
| 产品目标段 | 删「选择 OpenAI/DeepSeek/本地模型」；加「以单一本地管理员身份运行」「开启新对话」；注明 Provider 启用与优先级在「配置」管理，浮窗不做选择 |
| 用户范围段 | 主要用户改为「单一本地管理员（不区分多用户，无账号登录）」 |
| REQ-F-001 | 状态 `APPROVED` → `DEFERRED（暂缓）`，描述加注占位入口 |
| REQ-F-002 | 验收：悬浮条仅含状态灯 + 输入框 + 单按钮；输入框不依赖 Provider 状态 |
| REQ-F-003 | 验收：状态仅由状态灯表达；面板高度上限 65% → 50% |
| REQ-F-004 | 验收补充：每轮请求由服务端携带该会话全部历史消息 + 固定 system prompt |
| REQ-F-005 | 验收重写：停止 = 服务端停止请求模型 + 当前会话结束；被中断回复带行内「已停止」标记 |
| REQ-F-006 | 重命名「Provider 启用与优先级」，整条重写（有序列表 + 上移/下移 + 优先级解析 + fallthrough + 无可用拦截），状态回退待评审 |
| REQ-F-007 | 验收补充：设置页提供优先级有序管理 |
| REQ-F-013 | 验收补充：仅当最近会话仍活动时刷新才恢复 |
| REQ-F-014 | 重写：视觉方向由「知识控制台」调整为「浅色简约」（参考 gens.team/ai-insights）；删除验收中「模型芯片」；状态灯四态达非文本对比 3:1 |
| REQ-F-015 | 补充：当前版本「账号登录」为占位入口 |
| REQ-F-016 | 验收补充：请求级错误在输入框上方一行红字，脱敏，不写入上下文，不结束会话 |
| 验收澄清 | 新增小节：会话生命周期、请求级错误 vs 流中错误、面板高度 50%、动作按钮状态机 |
| REQ-NF-002 | 状态 `APPROVED` → `DEFERRED（暂缓）` |
| REQ-NF-004 | 验收「走通登录后」→「走通（管理员身份免登录进入后）」 |
| 非目标 | 新增三条：不实现多用户与账号隔离、不实现对话历史浏览、不实现超长上下文截断/摘要 |
| 新增 REQ-F-017 | 开始新对话（MUST） |
| 新增 REQ-F-018 | 连接状态指示灯（MUST，四态 + 加载探测） |
| 多角色评审 | 新增本 CR 评审行 |
| 批准状态 | 用户确认追加 2026-09-09 本 CR |

### P2 架构设计说明书

| 位置 | 变化 |
|---|---|
| 设计目标段 | 「Google 登录入口」→「占位登录入口（当前单管理员）」+ 暂缓说明 |
| **新增「架构角色定位与文档范围」节** | 明确架构角色负责/不负责的边界；要求对每个需求变化点给出架构裁决 |
| **新增「技术栈与部署形态」节** | 运行形态（单进程全栈）、部署方式表（dev/生产/验证）、前端技术表、后端技术表、依赖清单与边界（含 `openai` 冗余依赖）、关键运行配置 |
| **新增「CR-20260909 变化点架构裁决」表** | 对 14 个需求变化点 + schema 变更逐点裁决（不涉及架构/既有决策已覆盖/新增或修订 DEC），含 schema 变更清单 |
| DEC-001 | 状态 → `DEFERRED`：NextAuth 代码保留，当前 `JARVIS_TEST_USER_ID` 旁路（仅 `NODE_ENV!==production`），生产形态 P3 待决 |
| DEC-005 | 覆盖需求删 REQ-F-006、加 REQ-F-017/018；限高 ≤65vh → ≤50vh；浮窗不含切换控件 |
| 新增 DEC-010（待评审） | Provider 优先级：`priority` 字段 + `resolveActiveProvider` 升序取首个 connected + fallthrough |
| 新增 DEC-011（待评审） | 会话生命周期：停止/新对话均结束会话；「新对话刷新空白」持久化信号（`sessionStorage` 标记 vs 服务端标志位）P3 定 |
| 新增 DEC-012（待评审） | 状态灯四态 + 首页加载探测（**不阻塞首屏**，模块评审 CONDITIONAL） |
| 模块边界表 | 6 个模块职责与覆盖需求列同步；MOD-CHAT-UI 删「模型切换」，视觉措辞「浅色控制台」→「浅色简约」 |
| 接口契约 | `ProviderSummary` +`priority`；`resolveActiveProvider` 定义；`/api/providers` 按 priority 排序、`PATCH` 承载 reorder；`/api/chat/stream` `providerId`/`model` 可选化；请求级错误以 HTTP 错误状态（非 SSE `error`）返回 |
| 多角色评审 | 新增本 CR 评审小节（含架构角色自审、CONDITIONAL 结论） |

### P2 模块任务开发说明书

| 位置 | 变化 |
|---|---|
| **新增「CR-20260909 变化点影响矩阵与任务派生」节** | 对 16 个架构裁决点逐行标注既有任务影响（不变/小改/大改/废止）并派生任务；既有任务状态变更汇总（TASK-007「模型切换」子功能废止、TASK-001 语义降级、TASK-010 增前置判断） |
| 任务总览 | 新增 TASK-021（优先级字段 + API + 排序 UI，含迁移 SQL）、TASK-022（`resolveActiveProvider` + fallthrough + 无可用拦截）、TASK-023（FloatingChat 收敛）、TASK-024（状态灯四态，探测不阻塞首屏）、TASK-025（会话生命周期，**按 3 个可独立提交子项**）、TASK-026（请求级错误红字 + 50vh）、TASK-027（视觉简约化 token + `--live` 对比度回归）、TASK-028（`ui-contract.mjs` 规则适配 + `UI_STANDARD.md` 同步）、TASK-029（`check-config.mjs` 单管理员适配） |
| 关键接口 | `saveProvider` +`priority`；新增 `resolveActiveProvider`、`reorderProvider`；`POST /api/chat/stream` `providerId`/`model` 可选化 |
| 复盘迭代 | 新增本 CR 评审小节：模块 CONDITIONAL（TASK-024/025）、测试补绑 TEST-018、迁移 SQL 明确 |

### P2 测试说明书

| 位置 | 变化 |
|---|---|
| **新增「CR-20260909 任务→测试派生矩阵」节** | 对 TASK-021..029 + 3 个受影响既有任务逐行派生测试任务，标注类型与真实入口 |
| 测试矩阵 | 新增 TEST-025（优先级解析 + fallthrough）、TEST-026（无可用 Provider 拦截 + 灯灭）、TEST-027（四态映射 mock + e2e 首屏不阻塞）、TEST-028（两类错误分流、脱敏、不入上下文）、TEST-029（停止即结束：stopped + 下一条为新 conversationId）、TEST-030（新对话 6 个独立断言 + 50vh） |
| TEST-011 | 删「>1 Provider 渲染切换器」，改「浮窗无切换控件 + 请求不带 provider 参数」 |
| TEST-012 | 限高 65vh → 50vh + 状态灯四态非文本对比 |
| 真实入口冒烟 | 流程脚本更新：免登录进入 → 配两个 Provider + 调优先级 → 探测 → 对话 → 停止（会话结束）→ 新会话 → 新对话 → 刷新空白 → 制造请求级错误 |
| 复盘迭代 | 新增本 CR 评审小节：测试 APPROVED，行为回归守卫（TEST-029）、mock-only 探测（TEST-027）、逐条断言（TEST-030） |

### P3/P4（已完成 —— 详见 EV-2026-09-09-minimal-floating-chat-impl）

- `src/`：TASK-021..029 全部实现（`store.ts` 优先级迁移 + `resolveActiveProvider`；`FloatingChat` 收敛 + 四态灯 + 会话生命周期 + 请求级错误行；`ModelSettings` 排序 UI；`page.tsx` `hasEnabledProvider`；`globals.css` 单蓝强调色 + 50vh；新增 `GET /api/providers/probe`；`PATCH /api/providers/[id] {direction}`）。
- `scripts/ui-contract.mjs`：LB-05/LB-06/CC-04 重写、RF-09 阈值 55vh、FF-03/LB-04 适配 —— 仍 45 规则 0/0/0。
- `scripts/check-config.mjs`：单管理员模式适配。
- `tools/governance.py`：`check_g3` 识别 `result: "DEFERRED"`（不阻断、列出）；`docs/CONTROLS.md` 发布阻断条件加例外条款。
- `package.json`：移除未使用的 `openai` 依赖（`package-lock.json` 已同步）。
- `test-results.json`：TEST-025..030 = PASS；TEST-022 = DEFERRED。
- **CONDITIONAL 全部满足**：TASK-025 分 2 次提交（数据层 / UI 层）；TASK-024 首屏 `检测中` + `useEffect` 探测不阻塞 SSR；TASK-021 迁移 `ALTER TABLE ... NOT NULL DEFAULT 1000000` + rowid 回填。
- **门禁**：`verify`/`ui`/`check-changes`/`g1`/`g2`/`g3`/`g3.5`/`g4` 全 PASS（g3+ 首次转绿——此前长期因 TEST-022 为红）。`npm test` 115、`ui-contract` 45/0/0、smoke、6 e2e、`build:verify`、17 治理单测全通过。

## P6 复盘（同会话运行反馈 → 固化控制）

| 观察 | 根因 | 固化控制 |
|---|---|---|
| 配好 Provider 后状态灯仍白 | `FloatingChat` 探测门控在 SSR 快照 `hasEnabledProvider` 上，弹窗内配置后无重探信号——这是「新增前端能力缺少『配置变更→UI 反应』闭环」 | 探测改为 mount 必探 + `focus`/`jarvis:providers-changed` 重探；`ModelSettings` 每次写操作派发事件。测试「re-probes when providers change」。 |
| 用户指出重写后旧代码/样式未清 | 无强制机制阻止新旧实现并存（如 `.floating-chat__light` 残留 `box-shadow`、`--muted` 兜底） | 新增 AI_STANDARD 原则 16「无残留旧代码原则」；`tsconfig.json` 开 `noUnusedLocals`/`noUnusedParameters`，`test:typecheck` 对未使用局部/导入/参数报错。已清理本 CR 全部残留。 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ

## R1 评审意见

**CR-20260909-minimal-floating-chat 评审**（迁移自 `产品需求说明书.md`）

评审立场：各角色以本说明书职责 + 行业惯例为立场，独立评审，允许 CONDITIONAL / 反对。

| 角色 | 立场与检查重点 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|---|
| 产品 owner | 守「已批准需求不得被静默削减」「每条 MUST 有可观察验收」「变更须用户确认」 | ①「用户范围」原文即「本机个人用户 + 同一用户配置 Provider」，单管理员与之一致，不算收缩范围。②浮窗删芯片/状态文字/模型框/链接**不是删能力**——Provider 选择迁到「配置」且升级为优先级（REQ-F-006），能力净增。③**坚持**优先级机制（有序列表 + 上移/下移 + 解析规则 + fallthrough）写进 REQ-F-006 验收，不下放 UI 规范——否则「对话用哪个 Provider」这个用户可观察行为将无验收锚点。④REQ-F-001/NF-002 只能标 DEFERRED 不能删，且必须保留模块/测试覆盖行，恢复路径可追溯。⑤全部 15 个变化点已于 2026-09-09 逐轮取得用户确认。 | REQ-F-006 按④重写；REQ-F-017/018 新增；DEFERRED 保留覆盖行；用户确认记入批准状态 | APPROVED |
| 架构角色 | 守「技术可行、可维护、信任模型清晰」；行业惯例：本地单用户工具 OAuth 是摩擦项 | ①`JARVIS_TEST_USER_ID` 旁路已在 `auth-guard.ts` 存在且被 TEST-001/002 覆盖，作当前身份来源无新增信任面。②**但该 env 语义是「测试旁路」，用作产品形态开关名不副实**——生产构建（`next start`）下不生效，当前「单管理员」实际只在 `npm run dev` 成立。要求本 CR 明确「生产形态待 P3 决」，不得让说明书读起来像生产已支持免登录。③优先级解析、会话生命周期、状态灯探测三处需成文为 DEC。 | ②记入 REQ-F-001 验收注与 DEC-001；架构说明书补「技术栈与部署形态」节；DEC-010/011/012 立项（待评审） | CONDITIONAL：生产形态须在架构说明书显式标注为待定 |
| 测试角色 | 守 AI_STANDARD 原则 12（真实入口对应）、原则 15（验收逐条断言） | ①原 REQ-F-006「浮窗切换器」验收随需求作废，须有替代覆盖，否则「对话用哪个 Provider」无断言。②REQ-F-005 语义从「停止后可续」变为「停止即结束」，是**行为回归风险点**，必须有断言证明「停止后下一条消息是新会话」。③REQ-F-018「每次加载探测」若在测试里打真实网络会让 CI 不稳定。④REQ-F-001 正向验收（TEST-022 人工）随 REQ-F-001 暂缓，但不能因此假装 REQ-F-001 已验证——`gate g3` 对 TEST-022 的阻断应转为「需求暂缓」而非「待执行」。 | ①→TEST-025；②→TEST-029；③→TEST-027 用 mock；④测试说明书「未完成项」明确措辞 | APPROVED |
| 开发角色 | 守「任务可实现、依赖清晰、无隐藏返工」 | ①`providers` 表加列需向后兼容迁移（`node:sqlite` 无迁移框架）。②「新对话后刷新空白」跨 SSR/hydration，是本 CR 最不确定的实现点，不宜在 P1 冻结方案。③浮窗收敛涉及删除多个已测元素，须同步更新 TEST-011/012 断言避免测试与实现漂移。 | ①②记入架构 DEC-010/011 待决点；③TEST-011/012 本 CR 同步改写 | APPROVED |

## R2 评审意见

**CR-20260909-minimal-floating-chat 评审**（迁移自 `架构设计说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 架构角色（自审） | 文档是否明确本角色定位、技术栈与部署形态 | 首版架构说明书缺技术栈、部署方式、依赖边界的显式记录，只有 DEC 表；本角色定位未成文 | 新增「架构角色定位与文档范围」「技术栈与部署形态」两节；新增「CR-20260909 变化点架构裁决」表，对 14 个需求变化点逐点给出「不涉及架构 / 既有决策已覆盖 / 新增或修订 DEC」裁决 | APPROVED |
| 产品 owner | 架构是否仍覆盖暂缓需求的恢复路径 | NextAuth 代码保留、DEC-001 标 DEFERRED 而非删除，恢复只需配 OAuth 变量 + 移除旁路 | 记入 DEC-001 与 MOD-AUTH 职责 | APPROVED |
| 架构角色 | 新增 DEC-010/011/012 是否越出模块边界 | 优先级解析属 MOD-PROVIDER、会话生命周期属 MOD-CHAT、状态灯探测复用 MOD-ADAPTER，均在既有边界内；`priority` schema 迁移与「新对话刷新空白」持久化信号列为 P3 待决点并已在 DEC 中标注 | DEC-010/011/012 记为「待评审」，P3 实现 CR 落定后转 APPROVED | APPROVED |
| 开发角色 | `/api/chat/stream` 去掉必填 `providerId` 的兼容性 | 现有前端会传 `providerId`；改为「可选覆盖」向后兼容，服务端缺参时走 `resolveActiveProvider` | 记入接口契约表 | APPROVED |
| 测试角色 | 加载探测的出站请求成本与可测性 | 每 Provider 一次探测，串行 + 超时上限 P3 定；TEST-027 用 mock adapter 断言四态映射，不打真实网络 | 记入测试说明书 TEST-027 | APPROVED |
| 架构角色 | 请求级错误的传输层裁决 | 原 DEC-004 只定义 SSE `error` 事件；「回复第一段前失败」应以 HTTP 错误状态返回（连 SSE 流都未建立），前端据 `response.ok` 分流——这是 DEC-004 的细化，非新 DEC | 记入变化点裁决表 REQ-F-016 行与接口契约 `/api/chat/stream` | APPROVED |

## R3 评审意见

**复盘迭代（CR-20260909-minimal-floating-chat）**（迁移自 `模块任务开发说明书.md`）

评审立场：模块开发角色以「本说明书的任务单一职责、可独立提交与回滚、可独立测试、无隐藏业务」为立场，结合 React 组件开发与 `node:sqlite` 无框架迁移的行业实践审视架构裁决的每一点。

| 角色 | 立场与检查重点 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|---|
| 模块开发角色 | 影响矩阵是否与架构裁决 1:1；任务是否单一职责 | 16 个架构裁决点已逐行建矩阵，无遗漏。**TASK-025 职责过宽**——同时含「停止结束会话（MOD-CHAT）」「新对话按钮态（MOD-CHAT-UI）」「刷新空白持久化」，跨模块且难独立回滚 | TASK-025 保留为一个任务，描述内拆 3 个可独立提交子项，各绑独立断言（TEST-029 停止、TEST-030 新对话+刷新）；实现按子项分 commit | CONDITIONAL：须按子项提交 |
| 模块开发角色 | `providers.priority` 迁移的向后兼容 | `node:sqlite` 无迁移框架，`migrate()` 靠幂等 `ALTER TABLE`。新增 `NOT NULL` 列**必须带 `DEFAULT`**，否则旧库打开即抛。回填按 `rowid` 升序 → 「先建的 Provider 优先级更高」，作为初始序可接受（用户可调） | TASK-021 描述补 `ALTER TABLE providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 1000000` + 按 `rowid` 回写 0,1,2… | APPROVED |
| 架构角色 | TASK-021..029 是否越界、TTFB 耦合 | 未越界。**TASK-024 让首页 SSR 阶段发起出站探测会把首屏 TTFB 耦合到最慢的 Provider 探测** | TASK-024 改为「首屏渲染灯为『检测中』，探测在客户端 effect / RSC streaming 中完成，不阻塞首屏」 | CONDITIONAL：探测不得阻塞首屏 |
| 测试角色 | 每个新/改任务是否绑定可观察断言 + 真实入口（AI_STANDARD 原则 12） | 绑定关系完整。**TASK-027（视觉 token）只绑静态 `ui-contract`，缺真实浏览器对比度回归**——简约化改调色板有 AA 回归风险 | TASK-027 追加绑定 TEST-018（`--live` 双主题计算对比度） | APPROVED（补绑 TEST-018） |
| 开发角色 | 「新对话刷新空白」持久化信号能否在 P2 冻结 | 不建议。`sessionStorage` 方案 SSR 首帧会闪旧会话（hydration 后才清）；服务端标志位更干净但多一次写。属实现权衡 | 记 DEC-011 P3 待决；TASK-025 子项 3 在实现证据说明选型与首帧处理 | APPROVED |

## R4 评审意见

**复盘迭代（CR-20260909-minimal-floating-chat）**（迁移自 `测试说明书.md`）

评审立场：测试角色以 AI_STANDARD 原则 12（真实入口对应）、原则 15（验收逐条断言），以及「行为回归必须有守卫」的行业惯例为立场独立评审。

| 角色 | 立场与检查重点 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|---|
| 测试角色 | 每个任务是否有对应测试、是否打到真实入口、行为回归是否有守卫 | ①派生矩阵已覆盖 TASK-021..029 + 3 个受影响既有任务，无遗漏。②**REQ-F-005「停止即结束会话」是从既有行为的回归**（原停止后可续接），TEST-029 必须断言「停止后下一条消息 → 新 `conversationId`」，不能只测 `stopped` 落库。③**REQ-F-018「每次加载探测」严禁在 vitest/CI 打真实网络**——TEST-027 只用 mock 结果断言「结果→灯态」映射，真实探测仅 e2e 对 `127.0.0.1` 本地 Provider。④TEST-011/012 与实现同 CR 改写，避免测试-实现漂移。 | ②③④已落入矩阵与用例描述 | APPROVED |
| 测试角色 | REQ-F-001 暂缓期 `gate g3` 的诚实性 | TEST-022 随 REQ-F-001 暂缓，但**不得让 g3 变绿造成「登录已验证」的假象**。g3 对 TEST-022 的阻断措辞应从「待人工执行」改为「需求暂缓，恢复登录的 CR 须一并恢复」 | 「未完成项」按此措辞 | APPROVED |
| 架构角色 | 探测的测试策略是否与 DEC-012「不阻塞首屏」一致 | e2e 须显式断言首屏渲染时灯为「检测中」，探测落定后才转「常亮」——这同时验证了 DEC-012 的非阻塞约束 | TEST-027 e2e 分支补该断言 | APPROVED |
| 产品 owner | 「新对话」相关验收是否逐条可观察（原则 15） | TEST-030 须分别断言：空闲空输入时按钮文案为「新对话」／点击后记录区 DOM 清空／`conversationId` 丢弃／发送前无新会话记录／点后刷新为空／未点刷新则恢复——六个独立断言，不可合并判定 | TEST-030 描述按六点展开 | APPROVED |
| 开发角色 | 测试对「新对话刷新空白」实现方式的耦合 | 断言应针对「刷新后记录区为空」这一可观察结果，不绑定 `sessionStorage` 键名或服务端字段，以免实现选型改变时测试假失败 | TEST-030 断言层级定在 DOM 可观察结果 | APPROVED |
