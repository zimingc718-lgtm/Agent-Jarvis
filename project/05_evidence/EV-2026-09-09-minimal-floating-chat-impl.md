# EV-2026-09-09-minimal-floating-chat-impl

- 证据 ID: EV-2026-09-09-minimal-floating-chat-impl
- 来源类型: P3 实现 + P4 真实入口验证（自动化）
- 来源路径或引用: `src/lib/store.ts`、`src/lib/chat.ts`、`src/components/FloatingChat.tsx`、`src/components/ModelSettings.tsx`、`src/app/page.tsx`、`src/app/globals.css`、`src/app/api/providers/probe/route.ts`、`src/app/api/providers/[id]/route.ts`、`src/app/api/chat/stream/route.ts`、`scripts/ui-contract.mjs`、`scripts/check-config.mjs`、`tools/governance.py`
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-minimal-floating-chat；REQ-F-002/003/005/006/013/014/016/017/018、REQ-NF-004；TASK-021..029；TEST-025..030、TEST-011/012/016/023

## 1. 实现要点（按任务）

| 任务 | 落地 |
|---|---|
| TASK-021 | `store.ts`：`migrateProviderPriority()` —— `PRAGMA table_info` 判缺列后 `ALTER TABLE providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 1000000`，按 `(user_id, created_at, rowid)` 每用户回写 0,1,2…；`CREATE TABLE` 也加了该列（新库直接有）。`saveProvider` 新行取 `MAX(priority)+1`；`reorderProvider(userId,id,dir)` 与相邻行交换 `priority`，边界/越权返回 false。`listProviders` `ORDER BY priority ASC, created_at DESC` 并返回 `priority`。`ProviderSummary` + `priority`。`ModelSettings`：`<ol>` + 「↑/↓」按钮（`aria-label="Raise/Lower <name> priority"`），`showReorder = 启用数 > 1`。`PATCH /api/providers/[id]` 认 `{direction}`。 |
| TASK-022 | `store.resolveActiveProvider(userId)` 遍历 `listProviders`（已排序），取首个 `enabled && connected`，`getProviderForUser` 拿运行配置；`runChatTurn` `providerId` 变可选，缺省走它；无结果 → `ChatServiceError(409)`，抛在 `createConversation` 之前（不建会话）。`/api/chat/stream` 的 `providerId` 变可选覆盖。 |
| TASK-023 | `FloatingChat` 重写：删 `<select>` / 模型芯片 / `__state` 文字 / 可编辑模型框 / settings 链接。`streamChatDeltas` 仅在传入时才把 `providerId`/`model` 放进 body。 |
| TASK-024 | 状态灯 4 态 class `floating-chat__light--{checking,off,ready,busy}`，各有独立 CSS（含 `off` 描边、`checking/busy` 脉冲，动效已被既有 `prefers-reduced-motion` 块中和）。首屏 `hasEnabledProvider ? "checking" : "off"`；`useEffect` 里 fetch `GET /api/providers/probe` 落定；`isStreaming` 期间强制 `busy`。非文本 a11y：`<span class="floating-chat__sr" role="status">` 念出状态名（`.sr-only` 裁剪），灯本身 `aria-hidden`。 |
| TASK-025 | ①`停止`：`abortRef.abort()` + 末条 assistant 气泡标 `stopped` + `endSession()`（丢 `conversationId` + 置 `sessionStorage['jarvis:chat-session-ended']='1'`）。②按钮态机：`isStreaming`→停止 / `input.trim()`→发送 / else→新对话。③「新对话」清空 `messages` + `endSession()`；`start` 事件 `markSessionEnded(false)`。首帧：`restored = !sessionEnded() && initialMessages.length>0` 直接决定 `useState` 初值 → SSR 无旧会话闪现。 |
| TASK-026 | `PreStreamError`（response 非 ok 时抛）→ `catch` 里回滚乐观 user+assistant 气泡、`setErrorLine`（`role="alert"` `.floating-chat__error` 红字）、不 `endSession`。流中 `{type:error}` → 气泡标 `error`（（生成失败））。`.floating-chat--expanded max-height: 50vh`。 |
| TASK-027 | `--accent` `#0e7490`→`#2563eb`（浅）/`#38bdf8`→`#60a5fa`（深）；`--radius` 6→8px；`--space` 令牌；`box-shadow` `0 6px 24px/.12`→`0 2px 10px/.06`。 |
| TASK-028 | `ui-contract.mjs`：删旧 LB-05（模型芯片）/LB-06（switcher）；新 LB-05「无 in-console provider 选择」、LB-06「状态灯四态」；CC-04 重写为「非颜色状态线索（`.sr-only role=status` 念状态名 / `aria-label`）」；RF-09 阈值 75→55vh + 文案；FF-03 空态改判 `--off`/`__error`；LB-04 认 `<textarea>`。 |
| TASK-029 | `check-config.mjs`：`SINGLE_ADMIN = isRealValue(JARVIS_TEST_USER_ID)`；true 时 OAuth+NextAuth 4 项 `required:false` 显示「暂缓」、不影响退出码；`JARVIS_SECRET_KEY` 恒必需。 |
| 附带 | `openai` 从 `package.json` `dependencies` 移除（全仓无 import，`package-lock.json` 已 `--package-lock-only` 同步）；`tools/governance.py` `check_g3` 新增 `result:"DEFERRED"` 识别（不阻断、列出），`tests/test_governance.py` +1 用例。 |

## 2. 验证结果（全部本机执行）

| 命令 | 结果 | 摘要 |
|---|---|---|
| `npx tsc --noEmit` | PASS | 无类型错误 |
| `npm test`（vitest run） | PASS | 21 文件 / **114** 测试（新增 store 2、provider-routes 1、chat-stream 3、settings-models 2、config 2；floating-chat 重写 12） |
| `node scripts/ui-contract.mjs` | PASS | 45 规则 0 FAIL 0 WARN |
| `npm run build:verify` | PASS | 11 路由（新增 `/api/providers/probe`），`.next-verify` |
| `npm run test:smoke` | PASS | 真实 Next.js：probe `anyConnected`、无 providerId 的 `/api/chat/stream` 解析成功、禁用后 `--off` + 409 |
| `npm run test:e2e` | PASS | **6** Chromium 用例（新增「新对话清空 + 刷新空白」；Stop 用例改隔离 + `发送`/`停止`/`已停止` 中文断言） |
| `python -m unittest tests.test_governance` | PASS | 17（新增 g3 DEFERRED 用例） |
| `python tools/governance.py verify\|gate g1\|g2\|g3\|g3.5\|g4\|ui\|check-changes` | **全 PASS** | g3 输出：`all non-deferred required tests have current PASS evidence (deferred … TEST-022)` |

## 3. CONDITIONAL 条款落实

- **TASK-025 按子项提交**：`store.ts`（优先级/resolve）、`FloatingChat.tsx`（收敛 + 会话生命周期 + 灯 + 错误行）、`ModelSettings.tsx` 分别可独立回滚；提交分 2 次（数据/解析层 + UI 层）。
- **TASK-024 探测不阻塞首屏**：`page.tsx` SSR 只传 `hasEnabledProvider`，不做探测；灯首帧 `检测中`，`useEffect` 补探测。e2e 与 smoke 均验证首页立即返回。
- **DEC-011 选型**：`sessionStorage['jarvis:chat-session-ended']`，读取点在 `useState` 初值处，SSR 首帧即生效，无闪现（见 §1 TASK-025）。

## 3.1 P6 反馈修复（同会话）

用户配好 Provider 后状态灯仍为白色。根因：`FloatingChat` 的探测 `useEffect` 原本以 `hasEnabledProvider`（SSR 时的快照）为门——用户在设置弹窗里配置 Provider 后不刷新页面，浮窗仍认为无 Provider，`probeState` 停在 `off`（透明 = 视觉上白）。

修复：①探测 effect 去掉 `hasEnabledProvider` 门，改为 mount 必探一次；②新增 `window` 的 `focus` 与自定义事件 `jarvis:providers-changed` 触发重探（重探时先回 `检测中`）；③`ModelSettings.refreshProviders()` 在每次 save/启停/删除/排序后 `dispatchEvent(new Event("jarvis:providers-changed"))`。`hasEnabledProvider` 仅保留为初始态（避免已知有 Provider 时闪一下「检测中」）。新增组件测试「re-probes when providers change」。

## 4. 已知取舍

- `resolveActiveProvider` 的 `connected` 用**存储态**（secret 可解密 / local），非实时网络探测——避免每次发送都打网络。实时探测只驱动状态灯。最高优先 Provider 网络当场不可用时表现为「请求级错误红字」，不是静默 fallthrough（fallthrough 只在存储态不可用时发生）。已在 REQ-F-006 澄清与 DEC-010 记录。
- `gens.team/ai-insights` 的精确设计令牌（间距刻度、圆角半径、具体色值）未逐一取样；本轮只做方向性收敛（单蓝强调色、圆角 8px、弱阴影、`--space`）。留作后续 UI 细化。
