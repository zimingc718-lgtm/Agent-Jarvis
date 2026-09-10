# EV-2026-09-09-display-screen-requirements

- 证据 ID: EV-2026-09-09-display-screen-requirements
- 来源类型: 用户需求讨论（承接技能系统讨论）+ R1 四角色 ReAct 评审
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`（用户 msg 50→54，展示屏部分）；`产品需求说明书.md`（REQ-F-015 重写 + REQ-F-026/027）；`CR-20260909-display-screen.md`
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-display-screen（R1）；REQ-F-015（重写）、REQ-F-026、REQ-F-027；后续 DEC-017 / TASK-036..039 / TEST-039..042

## 1. 触发

用户（技能系统讨论中）："使用该 skill 洞察后，skill 会输出一个 html，将其结果在首页上显示。"→ 澄清为独立的 F2 CR（msg 54-3「两个CR」）。

## 2. 需求澄清链（用户 msg 50→51）

| 项 | 决定 |
|---|---|
| 展示位置 | "显示对话框，配置悬浮框底下。底下不是首页标题，是根据对话框显示出固定的知识呈现或者动态内容显示"（msg 50-6） |
| 心智模型 | "可以理解为 Jarvis 的动态显示屏"（msg 50-6） |
| 内容来源 | "当前使用 skill，会出来一份 html 报告。这个报告要显示在底下。当其他对话指令触发其他内容，也可以动态在底下显示"（msg 50-6） |
| 尺寸/层叠 | "全屏。对话框在它的上面"（msg 51-12） |
| 刷新行为 | "刷新还在，除非对话出现其他指令显示其他内容。例如在对话中，让它显示首页。那么就回到标题首页"（msg 51-13） |
| 产出内容 | "输出对话返回的 html，若无，就在对话里显示无，或者不完整"（msg 51-14，HTML 捕获属 F1） |
| 扩展性 | "当前只做这个 skill，但留有其他的扩展"（msg 51-15 → `kind` 扩展点） |
| 拆 CR | F1 技能 / F2 展示屏两个 CR（msg 54-3） |

## 3. R1 四角色 ReAct 评审

评审形态：单 Agent 顺序换视角（L3；R1 为需求层）。每角色 ReAct + 4 护栏。

### 3.1 产品 owner

- Thought：F2 把"首页"语义从"极简空页 + 标题"改成"动态屏"，是 REQ-F-015 的 MUST 验收重写，最大风险是范围发散（多屏、历史回看、编辑）。
- Action：核对用户原话——"一块屏幕"（单数）、"根据对话动态"、"刷新还在"、"回到标题首页"。
- Observation：用户心智是**一块**全局屏幕，不是每会话一块；`display_state` 应全局单行。非目标未锁。
- 裁决：APPROVED。条件转处理：REQ-F-015 重写记为用户确认变更；REQ-F-026 写明"全局单行"；非目标加 4 行（多屏/历史/编辑/导出）。
- 证据引用：用户 msg 50-6 / 51-12 / 51-13。

### 3.2 架构角色

- Thought：三个技术点——`display_state` 存储形态、未沙箱化 iframe 的实际渲染、`routeTurn` 如何扩 `display`。
- Action：①`display_state` 全局单行 → 固定主键 `id='singleton'` + `INSERT OR REPLACE`（get-or-create）。②F1 的 DEC-015 只"立项"，F2 才真正 `<iframe srcdoc>` 渲染——信任面此刻真实打开，缓解只有提示条。③`routeSkill`（F1）扩成 `routeTurn` 返回 `{skill, display}`，同一次调用、`display` 同样 fail-open——不加第二次 LLM 调用。④展示屏内容变更用 `jarvis:display-changed` 事件 + `GET /api/display` 重取，对话已有 SSE，展示屏不需要独立长连接。
- Observation：提示条若设计成"首次渲染后消失"则大部分时间用户看不到警告——**必须不可关闭且渲染 insight 时常驻**。
- 裁决：CONDITIONAL。条件：① REQ-F-025 ② 改为"渲染技能 HTML 时常驻不可关闭提示条"；② DEC-017（`display_state` + 事件流）P2 成文。
- 证据引用：`架构设计说明书` DEC-011（SSR/hydration 模式）、DEC-015/016（F1）；`node:sqlite` 无迁移框架。

### 3.3 模块开发角色

- Thought：`page.tsx` 首页重写是本 CR 最大的实现块——从 `header <h1> + 空` 变成 `全屏 DisplayScreen + 浮层`。
- Action：勾画——`DisplayScreen` client 组件，`page.tsx` SSR 首帧读 `display_state` 传入（避免闪烁，同 DEC-011）；header `<h1>` 迁进 DisplayScreen 的 home 视图；z-index 层叠 DisplayScreen 基底 / FloatingChat 20 / CornerMenu 30；`FloatingChat` 在收到 `insight` 尾事件 / display 指令时 `dispatchEvent(new Event("jarvis:display-changed"))`。
- Observation：`routeSkill`→`routeTurn` 是签名变更，触碰 F1 的 TASK-035 调用点——若 F1 尚未 P3 落地，签名改动并入 F1 实现；若已落地则本 CR 改。
- 裁决：CONDITIONAL。条件：① `page.tsx` 重写按 2 子项提交（Ⅰ DisplayScreen + 数据流；Ⅱ 首页布局重写 + TEST-021/032 回归）；② `routeTurn` 签名与 F1 同步。
- 证据引用：`模块任务开发说明书` TASK-031（corner-menu 首页改动先例）、TASK-035（F1 `routeSkill`）；DEC-011。

### 3.4 测试角色

- Thought：展示屏的"刷新保持"和"提示条不可关闭"是两个必须真实浏览器验证的点。
- Action：为 CP 映射测试——`display_state` get-or-create 单测；`DisplayScreen` 组件（默认 home / insight 渲染 / 提示条 / kind 扩展点）；e2e（技能洞察 → 上屏 → 「显示首页」回标题 → `page.reload()` 保持）；`routeTurn` `display` fail-open 单测。
- Observation：REQ-F-015 重写会反转 TEST-021（"首页仅标题 + ☰"）和 TEST-032（首页菜单）的结构断言——回归门。
- 裁决：APPROVED。TEST-039..042 + TEST-021/032 回归。
- 证据引用：AI_STANDARD 原则 12/15；`tests/e2e/human-workflow.spec.ts`。

### 3.5 汇总

产品 / 测试 APPROVED；架构 / 模块 CONDITIONAL（条件均为可实现前置：DEC-017 成文、提示条不可关闭常驻、`page.tsx` 2 子项、`routeTurn` 签名同步）。无 REJECTED。

## 4. R1 反馈闭环（用户要求：CONDITIONAL 必须闭环至全 APPROVED）

见 `CR-20260909-display-screen.feedback.jsonl`。R1 首轮：产品 / 测试 APPROVED；架构 / 模块 CONDITIONAL。

| 角色 | R1 CONDITIONAL 条件 | 处理 | R2 轮 |
|---|---|---|---|
| 架构 | ① 提示条不可关闭且渲染 insight 时常驻；② 内容流机制须 R1 锁定 | ① REQ-F-025 ② 收紧为"渲染时常驻不可关闭（无按钮 / Esc 无效）"；② CR 新增「机制 R1 锁定」节 + DEC-017 誊写 | **APPROVED** |
| 模块 | ① `page.tsx` 重写按 2 子项；② `routeSkill→routeTurn` 签名 churn 须消除 | ① CP-12 + TASK-038 写死 2 子项；② 定 F1/F2 P3 合并实现，`src/lib/skills.ts` 从第一行即 `routeTurn(): {skill, display}`——F1 的 `架构 DEC-016 / 模块 TASK-035 / 接口契约 / TEST-034` 同步为 `routeTurn`，代码中永不出现 `routeSkill` | **APPROVED** |

**R1 收敛**：1 轮反馈闭环，四角色全 APPROVED，无遗留 CONDITIONAL。**待用户人工终裁**。

## 5. P2 产出（R2/R3/R4，均已 APPROVED + 机器门 PASS）

| 层 | 产出 | R2/R3/R4 评审 |
|---|---|---|
| 架构（R2） | `## CR-20260909-display-screen 方案`（CP-1..CP-15 逐行五面裁决）+ **DEC-017**（display_state 全局单行 get-or-create / 事件+重取无轮询·SSE / SSR 首帧同 DEC-011 / 路由层两处 setDisplayState）+ DEC-016 修订 + **MOD-DISPLAY** + `GET /api/display` 契约 + `DisplayState` 类型 | 四角色 APPROVED |
| 模块（R3） | `## CR-20260909-display-screen 变化点影响矩阵` + `技术设计`（逐 CP）+ **TASK-036**（display_state 表 + 读写原语）**TASK-037**（DisplayScreen + GET /api/display + 事件流 + 不可关闭提示条 + 未沙箱化 iframe）**TASK-038**（page.tsx 重写，2 子项）**TASK-039**（routeTurn display 消费 + 路由层写 display_state）+ 关键接口新增行 | 四角色 APPROVED |
| 测试（R4） | `## CR-20260909-display-screen 任务→测试派生矩阵` + `测试设计`（逐 CP）+ **TEST-039**（display_state get-or-create）**TEST-040**（DisplayScreen 组件：home/insight/提示条不可关闭/kind 回退/事件重取）**TEST-041**（e2e：全屏 → 洞察上屏 → 显示首页回标题 → **刷新保持** → ☰ 可点）**TEST-042**（routeTurn display 字段 + fail-open + 路由层写入）+ **TEST-021/032 回归门重写** | 四角色 APPROVED |

CR `## R2/R3/R4 评审矩阵`：CP-1..CP-15 × 4 角色，**全 APPROVED，无 REJECTED、无遗留 CONDITIONAL**。

### 5.1 验证

| 命令 | 结果 |
|---|---|
| `python tools/governance.py review r1\|r2\|r3\|r4` | 全 PASS（skills + display-screen 两个 CR 均过）|
| `python tools/governance.py verify \| gate g1 \| gate g2 \| check-changes \| ui` | 全 PASS |
| `python tools/governance.py gate g3` | **如实阻断**：`missing PASS evidence for: TEST-034..042`（F1+F2 合并 P3 待实现）|

## 6. 本证据边界

P2 锁定三层设计 + R2/R3/R4 矩阵。**F1（CR-20260909-skills）与 F2（本 CR）P3 合并实现**——`routeTurn` 从第一行即目标签名。P3 落地 TASK-033..039、TEST-034..042 回填 PASS、清 F1 出口义务清单后补实现 EV。DEC-015 的"后续 CR 必须沙箱化"是跨 CR 长期义务。
