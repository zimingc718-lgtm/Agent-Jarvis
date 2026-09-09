# EV-2026-09-09-collapsible-panel-impl

- 证据 ID: EV-2026-09-09-collapsible-panel-impl
- 来源类型: 三角色逐变化点方案（架构 / 模块 / 测试）+ P3 实现 + P4 真实入口验证
- 来源路径或引用: `src/components/FloatingChat.tsx`、`src/app/globals.css`、`scripts/ui-contract.mjs`、`tests/floating-chat.test.tsx`、`tests/e2e/human-workflow.spec.ts`；方案表见 `架构设计说明书`「CR-20260909-collapsible-panel 方案」/ `模块任务开发说明书`「技术设计」/ `测试说明书`「测试设计」
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-collapsible-panel；REQ-F-019、REQ-F-003、DEC-013、TASK-030、TEST-031、TEST-030（回归）

## 1. 变化点编号

CP-1 REQ-F-019（整体）· CP-2 REQ-F-003 验收放宽 · CP-3 DEC-013 状态模型 · CP-4 折叠偏好持久化 · CP-5 折叠控件 · CP-6 折叠期间行为 · CP-7 v1 无动画 · CP-8 TEST-030 + 「发送后展开」e2e 回归。

## 2. 三角色逐变化点响应（严格对应，均已成文进说明书）

### 架构角色（部署 / 前端 / 后端 / 数据库 + 可行性）

结论：本 CR **零部署、零后端、零数据库变更**（CP-1..CP-8 逐条判定见架构说明书方案表），纯 MOD-CHAT-UI 组件内改动，无新依赖。CP-4 的 SSR/hydration 走已验证的 DEC-011 模式（`localStorage` 服务端不可读 → 首帧默认渲染 + client 一帧校正）。全部变化点技术可行性 **高**。

### 模块开发角色（实现方案 + 涉及符号 + 可行性）

| CP | 落地 | 可行性 |
|---|---|---|
| CP-3 | 删 `const [expanded, setExpanded]`；新增 `const [userCollapsed, setUserCollapsed] = useState(() => chatCollapsed())`；派生 `hasTranscript = messages.length > 0`、`showTranscript = hasTranscript && !userCollapsed`；删 `handleSubmit`/`handleNewConversation`/`rollbackOptimistic` 里全部 `setExpanded` | 高 |
| CP-4 | 模块级 `chatCollapsed()`/`writeChatCollapsed(v)`（try/catch 包 `localStorage`，键 `jarvis:chat-collapsed`，紧邻 `sessionEnded`/`markSessionEnded`）；组件内 `applyCollapsed(v)` = `setUserCollapsed(v)` + `writeChatCollapsed(v)`；`userCollapsedRef` 供异步流处理器读当前值 | 高（镜像已上线范式） |
| CP-5 | `.floating-chat__status` 内 `{hasTranscript ? <button className="floating-chat__toggle" aria-expanded={showTranscript} aria-label={showTranscript ? "收起对话" : "展开对话"} onClick={() => applyCollapsed(showTranscript)}><span aria-hidden className="floating-chat__toggle-icon"/></button> : null}`；CSS `1.75rem` 方块（触控 ≥24px）+ border 画箭头 + `[aria-expanded="false"]` 旋转 | 高 |
| CP-6 | ①保持折叠：`showTranscript` 不含 `isStreaming`，天然。②`justFinished` state + `finishTimerRef`；`handleSubmit` 的 `finally` 里 `if (userCollapsedRef.current) { setJustFinished(true); setTimeout(() => setJustFinished(false), 1200) }`；`lightState = isStreaming ? "busy" : justFinished ? "done" : probeState`；`LIGHT_LABEL.done = "回复已就绪"`；CSS `.floating-chat__light--done { background: var(--ok); animation: floating-chat-pulse 0.55s ease-in-out 2 }`。③`handleSubmit` 首行 `applyCollapsed(false)` | 高 |
| CP-7 | `.floating-chat--expanded` 无 `transition`；`showTranscript` 切换 = 条件渲染 `.floating-chat__messages`（挂/卸），瞬时 | 高 |
| CP-2 | 无独立代码——CP-3 的 `showTranscript` 派生天然实现「发送触发展开 + 可手动收起」 | 高 |
| CP-8 | 提交前跑 `test:floating-chat` + `test:e2e`；ui-contract LB-03 改判派生模型 | 高 |

`finishTimerRef` 用一个 `useEffect(() => () => clearTimeout(finishTimerRef.current), [])` 清理。

### 测试角色（可验证 + 可交付，逐 CP）

| CP | 验证 | 证据 |
|---|---|---|
| CP-2 | TEST-011 + e2e：发送 → `--expanded` 出现；收起 → 消失；再发 → 再现 | PASS |
| CP-3 | TEST-031 + 回归门（TEST-030 + 「发送后展开」e2e 全绿） | PASS |
| CP-4 | 组件断言 `localStorage['jarvis:chat-collapsed']` 值；**e2e** `page.reload()` 折叠/展开各保持 | PASS |
| CP-5 | TEST-031：无消息时无 toggle button；发送后出现；`aria-expanded` 随态变 | PASS |
| CP-6 | TEST-031（fake timers）：折叠 + 流式 → `--busy` 且无 `.floating-chat__messages`；完成 → `--done` → `advanceTimersByTime(1300)` → `--ready`；折叠时发送 → `--expanded` + `localStorage` 清 | PASS |
| CP-7 | ui-contract（LB-07 断言 `.floating-chat--expanded` 无 `transition height`）+ MO-01（动画被 reduced-motion 中和） | PASS |
| CP-8 | `test:floating-chat`（重写后 18 用例）+ `test:e2e`（7 用例，含「新对话清空」「停止」「折叠+reload」） | PASS |

## 3. 验证结果（全部本机执行）

| 命令 | 结果 | 摘要 |
|---|---|---|
| `npx tsc --noEmit`（含 `noUnusedLocals`/`noUnusedParameters`） | PASS | 无类型错误 |
| `npm test` | PASS | 21 文件 / **120** 测试（floating-chat 13 → 18，含 collapse 5 用例） |
| `node scripts/ui-contract.mjs` | PASS | **46** 规则 0 FAIL 0 WARN（LB-03 改判派生模型 + 新增 LB-07） |
| `npm run build:verify` | PASS | 11 路由（无新增），`.next-verify` |
| `npm run test:smoke` | PASS | 无回归 |
| `npm run test:e2e` | PASS | **7** Chromium（新增「collapsing the panel keeps the conversation and survives a reload」：真实 收起对话 → reload → 仍折叠 → 展开对话按钮 → 折叠时发送续接同一会话 ctx=4） |
| `python -m unittest tests.test_governance` | PASS | 17 |
| `python tools/governance.py verify\|gate g1..g4\|ui\|check-changes` | 全 PASS | g1-g4 全绿 |

## 4. 已知取舍

- CP-4 的 `useState(() => chatCollapsed())` 在 dev 模式会产生 hydration mismatch warning（server 渲染展开 / client 读到折叠），生产 build 无 warning，client 值胜出。与 DEC-011（`jarvis:chat-session-ended`）完全同模式，TEST-030 e2e 已证明 React 19 正确收敛。未额外做双 render / `suppressHydrationWarning`（超出本 CR 收益，DEC-013 已声明「接受一帧校正」）。
- 折叠控件图标用 CSS border 画箭头（`▾` 的两条边），无 SVG、无字体依赖。精确视觉（旋转角度、尺寸）可在后续 UI 细化调整。
