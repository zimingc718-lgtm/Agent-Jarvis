# EV-2026-09-09-minimal-floating-chat-requirements

- 证据 ID: EV-2026-09-09-minimal-floating-chat-requirements
- 来源类型: 用户需求讨论（P6 运行反馈 → P1 重新定义）
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`；代码事实 `src/lib/auth-guard.ts`、`src/lib/auth.ts`、`src/app/page.tsx`、`src/components/FloatingChat.tsx`、`src/components/AccountDialog.tsx`
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-minimal-floating-chat；REQ-F-001、REQ-F-002、REQ-F-003、REQ-F-004、REQ-F-005、REQ-F-006、REQ-F-007、REQ-F-013、REQ-F-014、REQ-F-015、REQ-F-016、REQ-F-017、REQ-F-018、REQ-NF-002、REQ-NF-004

## 1. 触发

用户在 P6 运行中尝试配置 Google OAuth（`.env.local` 缺 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`，见 EV-2026-09-09-config-root-cause），随后判断当前阶段不需要账号体系：

> "现在先不做用户账号登录。仅作模型key配置。单一管理员用户。"

## 2. 代码事实（非推测）

| 事实 | 位置 | 结论 |
|---|---|---|
| `JARVIS_TEST_USER_ID` 在 `NODE_ENV!==production` 时把每个请求固定绑到一个用户 id，跳过登录 | `src/lib/auth-guard.ts:17-31` | 单管理员形态无需新代码，用既有旁路 |
| `AccountDialog` 收到 `authenticated=true` 即显示「已登录」，不再渲染 `ConfigWarning` | `src/components/AccountDialog.tsx:28-38` | 设 `JARVIS_TEST_USER_ID` 后首页阻断消失 |
| `getServerSession` 为 null 时 `requireUserId` 回退到 `JARVIS_TEST_USER_ID` | `src/app/page.tsx:13-24` | 首页直接渲染 FloatingChat |
| `FloatingChat` 现含：模型芯片/下拉、状态文字、可编辑模型框、settings 链接 | `src/components/FloatingChat.tsx:213-288` | 均为本 CR 拟删除的元素 |
| 仅 `NODE_ENV!==production` 生效；`next start` 生产模式旁路失效 | `src/lib/auth-guard.ts:26` | 本 CR 不承诺生产免登录，列 P3 待决 |

实测：设 `JARVIS_TEST_USER_ID=admin` 重启 dev server 后 `/`、`/api/providers`、`/api/conversations/recent` 均返回 200，账号弹窗显示「已登录 Agent-Jarvis」。

## 3. 决策链（用户逐轮确认）

| 项 | 用户决定 |
|---|---|
| 账号登录 | 暂缓；首页「登录」按钮先占位 |
| 对话浮窗元素 | 仅保留：状态灯、消息记录区、输入框、单个动作按钮 |
| 模型芯片 / 下拉切换器 | 删除 |
| 状态文字（Ready/Streaming/…） | 删除 |
| 可编辑模型名输入框 | 删除 |
| 「Open model settings」链接 | 删除（配置在首页） |
| 消息记录区高度 | 上限视口 50%（原 65%） |
| 动作按钮 | 生成中=停止；有输入=发送（Enter 等效）；空闲=新对话（无历史也显示） |
| 「停止」语义 | 中断当前回复 **且结束当前会话**（下一条消息为新会话） |
| 「新对话」刷新语义 | 未点「停止」/「新对话」则刷新恢复原会话；点过则刷新呈现空白 |
| 已结束/已停止会话 | 保留在本地存储，本版本无浏览入口 |
| 状态灯语义 | 是否连接模型、能否调用；四态（检测中/灭/常亮/闪烁） |
| 状态灯时效性 | 每次进页面自动探测一次（接受出站请求成本） |
| 多 Provider（OpenAI + DeepSeek 同时启用） | 「配置」提供**优先级**（有序列表 + 上移/下移）；对话自动用「已启用且连接有效」中优先级最高者；失败 fallthrough |
| 请求级错误（回复未开始就失败） | 输入框上方一行红字，脱敏，不写入上下文，不结束会话，不阻塞输入 |
| 历史过长 | 首版不做截断，交给 Provider 报错走流中错误路径 |
| 视觉方向 | 参考 `gens.team/ai-insights`：浅色简约 SaaS、单一强调色（蓝）、统一圆角、卡片式分组、充足留白；非知识控制台、非科幻 |

## 4. gens.team/ai-insights 视觉取样（WebFetch，2026-09-09）

页面为带空状态的应用，未登录仅读到有限内容。可辨识特征：浅色/近白背景、深色文字、蓝色单一强调色、现代无衬线、卡片式布局 + 大量留白（低信息密度）、按钮圆角、padding 舒展、整体简约 SaaS 风。精确间距刻度/圆角半径/色值未取样，列为 P3 UI 规范细化项。

## 5. 未决点（P3 定）

- 「新对话后刷新空白」的持久化信号：客户端标记（`sessionStorage`）还是空会话记录。
- 生产构建（`next start`）下的单管理员形态：是否需要一个显式的 `JARVIS_SINGLE_ADMIN` 开关替代 `JARVIS_TEST_USER_ID`（后者语义是「测试旁路」）。
- 状态灯「检测中」的视觉表现与探测超时时长。
- `gens.team` 精确设计令牌取样。

## 6. 本证据边界

本文件记录的是**需求讨论与代码事实**，不含实现验证。实现证据（TEST-025..030、ui-contract 变更、真实入口冒烟）待 P3/P4 产生，届时另立 EV 文件。
