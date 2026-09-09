# EV-2026-09-09-collapsible-panel-requirements

- 证据 ID: EV-2026-09-09-collapsible-panel-requirements
- 来源类型: 用户需求讨论（P6 运行反馈 → P1 新增需求）+ 多角色评审
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`；代码事实 `src/components/FloatingChat.tsx`（`expanded` 状态、`handleNewConversation`、`rollbackOptimistic`）、`src/app/globals.css`（`.floating-chat--expanded max-height: 50vh`）
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-collapsible-panel；REQ-F-003、REQ-F-014、REQ-F-018、REQ-F-019、DEC-013、TASK-030、TEST-031

## 1. 触发

用户 P6 使用中：会话进行到一定长度后，50vh 面板长期占屏，想读页面其它内容时只能点「新对话」（丢上下文）。要求「只收起面板、会话还在」。

## 2. 代码事实

| 事实 | 位置 | 结论 |
|---|---|---|
| `expanded` 由「发送→true」「新对话→false」「hydrate（restored）」三处驱动；无用户折叠入口 | `FloatingChat.tsx:156, 214, 233` | 收起唯一途径是「新对话」，会结束会话 + 清记录 |
| `rollbackOptimistic` 里 `setExpanded(remaining.length > 0)` | `FloatingChat.tsx:245` | 加第四个驱动会让 `expanded` 更难维护 → 评审要求解耦 |
| `.floating-chat--expanded { max-height: 50vh }`；grid 子项 `.floating-chat__messages { flex: 1 }` | `globals.css` | 高度过渡到 auto 不可 transition → v1 无动画 |
| `sessionEnded()` / `markSessionEnded()` 已有 try/catch 的存储读写范式 | `FloatingChat.tsx:53-71` | 折叠偏好持久化可镜像该范式，键 `jarvis:chat-collapsed` |

## 3. 决策链（用户逐轮确认）

| 项 | 决定 |
|---|---|
| 折叠层级 | **一级**（展开 ⇄ 收起为输入条，会话不结束） |
| 折叠时来新回复 | **安静**：保持折叠，仅状态灯转「生成中」，不自动展开、不显示未读计数 |
| 折叠偏好 | **记住**（`localStorage`，每浏览器） |
| 折叠时发送新消息 | **自动展开** |
| 折叠控件 | 状态灯所在行的「⌄/⌃」箭头按钮 |
| 决策 B（折叠期间回复完成提示） | **甲案**：状态灯做一次短促瞬时提示后落定（非未读角标、非第五种持久态） |
| 决策 D（折叠动画） | v1 **瞬时切换，无动画** |
| 决策 A（新对话 vs 折叠偏好） | 「新对话」不碰折叠偏好；靠「无记录时控件隐藏」自然处理 |
| 决策 C（折叠时请求级错误红字） | 照常显示在输入框上方（关联「发送」动作，输入条始终可见） |

## 4. 多角色评审要点（详见 CR 评审记录）

| 角色 | 硬提醒 | 处置 |
|---|---|---|
| 产品 owner | 折叠 + 完全沉默 → 用户漏看已完成回复；REQ-F-003 是 MUST 验收放宽 | 甲案完成提示；REQ-F-003 记为用户确认变更；非目标锁定无角标 |
| 架构角色 | `expanded` 状态过载；`localStorage` SSR 不可读 | DEC-013：`expanded`→`hasTranscript`+`userCollapsed`；SSR 首帧默认 + hydration 校正 |
| 模块开发角色 | 任务不能只是「加按钮」；动画有 CSS 成本 | TASK-030 含状态重构；v1 无动画 |
| 测试角色 | 行为相邻重构；持久化需真实浏览器 | TEST-030 / REQ-F-003 e2e 重验；持久化跨刷新走 e2e；TEST-031 |

## 5. 本证据边界

记录需求讨论 + 代码事实 + 评审结论，不含实现验证。实现证据（TEST-031、e2e 重验）待 P3/P4，届时另立 EV。
