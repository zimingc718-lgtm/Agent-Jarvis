# EV-2026-09-09-skills-requirements

- 证据 ID: EV-2026-09-09-skills-requirements
- 来源类型: 用户需求讨论 + R1 四角色 ReAct 评审 + 用户人工终裁
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`（用户 msg 49→54）；`产品需求说明书.md`（REQ-F-020..025）；`CR-20260909-skills.md`
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-skills（R1）；REQ-F-020 至 REQ-F-025；后续 DEC-015 / DEC-016 / TASK-033..035 / TEST-034..038

## 1. 触发

用户：「新增一个功能。我上传个 skill 文件夹，Jarvis 将该 skill 补充系统能力。当我对话调用 skill 时，能使用该 skill 进行大模型对话。使用该 skill 洞察后，skill 会输出一个 html，将其结果在首页上显示。先讨论需求。」

## 2. 需求澄清链（用户逐条决定，msg 50→54）

| 项 | 决定 |
|---|---|
| 技能来源 | 拖文件夹上传（msg 50-4）；拖到**对话框**（不是拖到菜单栏技能区），对话框把它规划到 skill（msg 51-10） |
| 拖拉后动作 | 追加一条「生成 skill」指令（msg 52-16b） |
| 技能触发粒度 | 会话中某条消息提及该 skill → **该轮触发**，后续发送不需要；参考 ChatGPT 对话里的 skill 使用（msg 51-11） |
| 路由方式 | 是对话里某个发送调用 skill（msg 50-4）→ 每次发送前判定 |
| 技能内容注入 | SKILL.md + 文件夹内文件**一起注入**（msg 51-9） |
| 技能产出 | 要求最后输出一个 HTML 文档（msg 50-5）；无 HTML 或不完整 → 对话里显示「无 / 不完整」（msg 51-14） |
| 产出展示位置 | 显示在对话框与配置悬浮框**底下**；是「Jarvis 的动态显示屏」——全屏，对话框浮其上（msg 50-6, 51-12） |
| 展示屏内容 | 默认标题视图；技能产出 HTML 时显示报告；其他对话指令可动态切换（如「显示首页」回到标题）（msg 50-6, 51-13） |
| 刷新行为 | 刷新后展示内容还在，除非对话出现其他指令（msg 51-13） |
| 扩展性 | 当前只做这一个 skill，留其他扩展（kind 扩展点）（msg 51-15） |
| 安全 | 先不考虑安全问题（msg 50-7）；**无 sandbox**（msg 54-1，明确拒绝架构师的 CONDITIONAL 沙箱建议） |
| SKILL.md 回显 | **不用回显全文**（msg 54-2）——删产品-CP-A，保留「已注册技能：<name>」确认 |
| CR 拆分 | **两个 CR**（F1 技能 / F2 展示屏）（msg 54-3） |
| CP 清单 / 验收 / 非目标 | 如草案（msg 54-4「好的」） |
| R1 四角色 | 同意 R1 由 3 角色改为 4 角色（加模块开发）（msg 54-5「好的」） |

## 3. R1 四角色 ReAct 评审

评审形态：单 Agent 顺序换视角（L3 变更，但 R1 为需求层讨论，未 spawn 子 Agent；R2–R4 若维持 L3 判定则按 CONTROLS spawn）。每角色 ReAct + 4 护栏。

### 3.1 产品 owner

- Thought：技能是首个「补充系统能力」的功能，最大风险是范围发散（技能市场、编排、版本管理）。
- Action：核对非目标清单 + REQ-F-020..025 验收逐条。
- Observation：草案未锁定「不做技能编排/市场/编辑 UI」；路由误判无用户纠错路径。
- 裁决：APPROVED。条件转处理：非目标新增 4 行；REQ-F-020③改「不回显 SKILL.md 全文」；REQ-F-021④明确 fail-open。
- 证据引用：`产品需求说明书.md` 非目标节 + REQ-F-020..025；用户 msg 54-2。

### 3.2 架构角色

- Thought：两处新信任面——独立路由 LLM 调用、未沙箱化 `<iframe srcdoc>` 渲染 LLM 生成的 HTML。
- Action：分析 `<iframe srcdoc>` 无 `sandbox` 的能力面（同源脚本可读 `localStorage['jarvis-theme'/'jarvis:*']`、可 `fetch('/api/providers', {method:'DELETE'})`、可 POST `/api/chat/stream`）。
- Observation：用户 msg 54-1 明确接受该风险并拒绝沙箱。路由若复用主对话模型会污染上下文且浪费 token。
- 裁决：CONDITIONAL。条件：① DEC-015 记录未沙箱化信任面 + 「沙箱化」为未来 CR 出口义务 + known warning `skill-html-unsandboxed`；② DEC-016 规定路由为独立最小 LLM 调用（结构化输出、无 Provider fail-open）。
- 证据引用：`src/components/*`（`localStorage` 键位）、`src/app/api/providers/route.ts`（DELETE 入口）；用户 msg 54-1。

### 3.3 模块开发角色

- Thought：CP-1「拖文件夹 → 生成 SKILL.md → 注册」在实现上是 3 个关注点，不能塞进「加个上传」单任务。
- Action：勾画实现路径——`src/lib/skills.ts` 承载路由与技能解析；`runChatTurn` 加 `skill?` 参数（该轮附加 system 段）与 `onInsight?(html)` 回调；route handler 写 `insights`。
- Observation：`SKILL.md` 生成需要明确输出格式规格（frontmatter `name`/`description` + 正文 `instructions`）与解析失败回退（文件夹名 + 「（未生成描述）」+ 提示用户）。展示屏是独立关注点。
- 裁决：CONDITIONAL。条件：① CP-1 拆 3 子任务并写入 TASK-033；② HTML 捕获走 `onInsight` 回调，MOD-CHAT 不碰 `insights`；③ 拆 F1（本 CR）/ F2（CR-20260909-display-screen）。
- 证据引用：`src/lib/chat.ts`（`runChatTurn` 现签名）、`src/lib/store.ts`（`DatabaseSync` 无迁移框架，加表用 `CREATE TABLE IF NOT EXISTS`）。

### 3.4 测试角色

- Thought：每个 CP 都要有真实入口测试（原则 12），且 `insights` 写库必须有真实消费者（原则 13）。
- Action：为 CP-1..CP-14 映射测试——路由三态单测（命中 / 未命中 / 无 Provider fail-open）、注入单测（白名单过滤 + 32KB 截断 + 仅当轮）、HTML 捕获单测（最后一块 / 无块 / 未闭合）、`insights` 写入 + `GET /api/insights` 读回、e2e 注册流 + per-message 不延续。
- Observation：草案的 `insights` 写库在 F1 无 UI 消费者 → 违反原则 13。
- 裁决：CONDITIONAL。条件：F1 内提供 `GET /api/insights?conversationId=` 读回入口并被 TEST-037 覆盖。
- 证据引用：AI_STANDARD 原则 12 / 13 / 15；`tests/e2e/human-workflow.spec.ts`（e2e 基线）。

### 3.5 汇总

产品 APPROVED；架构 / 模块 / 测试 CONDITIONAL（条件均为可实现前置：DEC-015/016、任务拆分、`GET /api/insights` 读回入口）。无 REJECTED。

## 4. R1 人工终裁

用户 msg 54：「1. 无sandbox；2. 不用回显全文；3.两个CR；4. 好的。5. 好的。」

- 接受未沙箱化风险（对应架构 CONDITIONAL 条件①的风险接受部分；沙箱化仍列为未来 CR 出口义务）。
- 不回显 SKILL.md 全文（对应产品条件）。
- 拆两个 CR（对应模块条件③）。
- CP 清单 / 验收 / 非目标如草案。
- R1 改 4 角色。

→ R1 通过。进入 P2（架构 / 模块 / 测试说明书写 `CR-20260909-skills` 节逐一响应 CP-1..CP-14，补 CR 内 R2/R3/R4 评审矩阵）。

## 5. 本证据边界

R1 只锁定需求与 CP 登记。DEC-015/016、TASK-033..035、TEST-034..038 的具体方案在 P2 各层说明书产出，届时补 EV。`review r2|r3|r4` 在 P2 各层节 + 矩阵成文前预期报 `COVERAGE_GAP` / `MATRIX_INVALID`——这是 R1 阶段的正确状态。
