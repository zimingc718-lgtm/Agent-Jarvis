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

## 5. P2 产出（R2/R3/R4）

2026-09-09 同会话完成 P2 三层设计并通过 R2/R3/R4 机器门。

### 5.1 架构（R2）

- `架构设计说明书.md`：新增 `## CR-20260909-skills 方案`（CP-1..CP-14 逐行 部署/后端/数据库/前端/依赖/可行性）+ schema 清单（`skills` / `insights` 两表幂等迁移）+ 架构总判。
- **DEC-015**（技能生成 HTML 未沙箱化）：立项为**高危**——`<iframe srcdoc>` 无 `sandbox` → 同源脚本可读 `localStorage`（`jarvis-theme`/`jarvis:chat-collapsed`/`jarvis:chat-session-ended`）、可打任意同源 API（`DELETE /api/providers/[id]`、`POST /api/chat/stream`、`GET /api/insights`）。用户 msg 54-1 接受风险。出口义务：后续 CR 必须加 `sandbox` 或改独立 origin/Worker。缓解（当前）：known warning `skill-html-unsandboxed` + F2 首渲提示条。
- **DEC-016**（技能路由为独立最小 LLM 调用）：非流式、`max_tokens` 小、10s 超时、不带历史、fail-open（无 Provider / 超时 / 非法 JSON / 未知名 → `{skill:null}` 不抛）。触发时机：`POST /api/chat/stream` 收到发送后、启动主流式前，`listSkills` 非空时一次。
- 新增 **MOD-SKILLS**（`src/lib/skills.ts`）；`MOD-CHAT` 职责扩到技能路由前置 + 注入 + HTML 捕获 + `insights` 读写；接口契约加 `POST/GET /api/skills`、`GET /api/insights`、`ChatDelta` 的 `insight`/`insight-missing` 尾事件、`runChatTurn` 的 `skill?`/`onInsight?`/`onInsightMissing?`。

### 5.2 模块（R3）

- `模块任务开发说明书.md`：新增 `## CR-20260909-skills 变化点影响矩阵与任务派生`（CP-1..CP-14 逐行 影响/分类/派生任务）+ `## CR-20260909-skills 技术设计`（逐 CP 实现方案 + 涉及符号 + 可行性）。
- **TASK-033**（技能上传→SKILL.md 生成→注册，3 子项：Ⅰ 上传+落盘+路径穿越防护 / Ⅱ `generateSkillDoc` + frontmatter 解析 + 失败回退 / Ⅲ `registerSkill` + `listSkills`）。
- **TASK-034**（`runChatTurn` `onInsight`/`onInsightMissing` 回调 + 路由层写 `insights` + `GET /api/insights` + 系统消息）。
- **TASK-035**（`src/lib/skills.ts` `routeTurn` + `resolveSkillForTurn`；`runChatTurn` 加 `skill?`；`/api/chat/stream` 路由前置）。
- 可行性：CP-1 中高（目录拖放跨浏览器差异 → `<input webkitdirectory>` 兜底），其余全高。**零新增运行依赖**（frontmatter 极简自解析，不引 yaml）。`runChatTurn` 缺省行为不变（CP-14，grep +测试守卫）。

### 5.3 测试（R4）

- `测试说明书.md`：新增 TEST-034（`routeTurn` mock，含 4 条 fail-open + 请求体形态）、TEST-035（`resolveSkillForTurn` 白名单/32KB/仅当轮 + frontmatter 回退）、TEST-036（HTML 捕获四态）、TEST-037（`insights` 写入 + `GET /api/insights` 读回，真实入口，满足原则 13）、TEST-038（e2e：拖放注册 → 技能轮 → 洞察落库 → per-message 不延续 → 未产出提示）+ `任务→测试派生矩阵` + `测试设计` 表（逐 CP）。
- `routeTurn` 单测严格 mock（禁 CI 真实网络）；真实 LLM 仅 e2e 对本地 Provider。

### 5.4 R2/R3/R4 未决条件（P3 出口义务清单）

见 CR `## R4 评审矩阵` 末尾：① `skill-html-unsandboxed` 登记 `test-results.json`；② DEC-015 出口义务保留给 F2 CR；③ `routeTurn` 4 条 fail-open + 请求体形态断言（并入 TEST-034）；④ `src/lib/chat.ts` 不出现 `insertInsight`（grep 守卫）；⑤ TASK-033 Ⅰ 路径穿越防护（已在描述内）。

### 5.5 验证

| 命令 | 结果 |
|---|---|
| `python tools/governance.py review r1\|r2\|r3\|r4` | 全 PASS（首个真实 CR 跑通新模型全链）|
| `python tools/governance.py verify \| gate g1 \| gate g2 \| check-changes \| ui` | 全 PASS |
| `python tools/governance.py gate g3` | **如实阻断**：`missing PASS evidence for: TEST-034..038`（P3 待实现）|
| `python -m unittest tests.test_governance` | 23 PASS（含 `_cr_scoped_text` 回归）|

## 6. P3/P4 实施（2026-09-10）

用户 2026-09-10「确认，开始执行」授权后，与 CR-20260909-display-screen **合并实现**。逐任务落点、P3 设计细化（5 项）与出口义务清零表见 `project/06_changes/CR-20260909-skills.md` 的「P3/P4 实施记录」。要点：

- **新增源文件**：`src/lib/skills.ts`（MOD-SKILLS）、`src/app/api/skills/route.ts`、`src/app/api/insights/route.ts`。
- **改动**：`src/lib/store.ts`（`skills`/`insights` 表 + CRUD + `SkillNameConflictError`）、`src/lib/chat.ts`（`skill?` 附加 system 段 + `onFinal` 回调）、`src/app/api/chat/stream/route.ts`（路由前置 + 写库 + 尾事件）、`src/components/FloatingChat.tsx`（拖放上传 + 三类系统消息 + 尾事件处理）、`src/lib/types.ts`（`ChatDelta` 加 `insight`/`insight-missing`/`display`）。
- **零新增运行依赖**；新增 env `JARVIS_SKILLS_PATH`（测试/e2e 隔离技能目录）。
- **出口义务 5 条全部清零**（known warning 已登记、DEC-015 出口义务保留、`routeTurn` 4 条 fail-open + 请求体形态断言、`chat.ts` grep 无 `insertInsight`、路径穿越防护双重）。
- **验证**：`npm test` 159、`ui-contract` 49/0/0 与 `--live` 67 PASS/1 SKIP、`smoke` OK、`test:e2e` 10 PASS、`build:verify` OK、`tsc --noEmit` OK；`g1/g2/g3/g3.5/g4` + `review r1..r4` 全 PASS。

## 7. 本证据边界

CR CLOSED。DEC-015 的「后续 CR 必须沙箱化」是**跨 CR 长期义务**，由 `test-results.json` 的 `skill-html-unsandboxed` known warning 持续可追溯。技能的删除 / 编辑 / 多技能管理 UI 仍是非目标。
