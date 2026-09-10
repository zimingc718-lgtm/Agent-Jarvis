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

## 4. R1 人工终裁

**待用户拍板**。需确认：CP-1..CP-15、REQ-F-015 重写为"全屏动态展示屏"、未沙箱化 `<iframe srcdoc>` + 不可关闭提示条、`display_state` 全局单行 + `kind` 扩展点、`routeTurn` 扩 `display` 字段、非目标 4 行。

## 5. 本证据边界

R1 只锁定需求与 CP 登记。DEC-017、TASK-036..039、TEST-039..042 的具体方案在 P2 各层说明书产出。`review r2|r3|r4` 在 P2 各层节 + 矩阵成文前预期报 `COVERAGE_GAP` / `MATRIX_INVALID`——R1 阶段的正确状态。
