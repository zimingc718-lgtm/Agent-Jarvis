# CR-20260909-collapsible-panel

- 级别: L2
- 提出人: user（"对话框支持折叠" → 决策 1-5 + B/D 讨论 → "进入角色评审" → "反馈到产品经理，继续修正" → 决策 B「甲」 → "按开发流程执行" + 要求三角色逐变化点严格响应）
- 状态: CLOSED（P1-P4 完成：TASK-030 DONE、TEST-031 PASS、g1-g4 全绿、回归 e2e 通过）
- 影响需求: REQ-F-003（验收放宽）、REQ-F-014（新控件视觉约束）、REQ-F-018（显示表现补充，不改验收）；新增 REQ-F-019
- 影响模块: MOD-CHAT-UI（`expanded` 状态解耦 + 折叠控件 + 持久化）
- 影响任务: 新增 TASK-030
- 影响测试: 新增 TEST-031；TEST-030 与 REQ-F-003 的 e2e 需在实现后重验（行为相邻重构守卫）
- 当前证据: `project/05_evidence/EV-2026-09-09-collapsible-panel-requirements.md`（需求讨论与角色评审）、`project/05_evidence/EV-2026-09-09-collapsible-panel-impl.md`（架构/模块/测试逐变化点方案 + P3/P4 验证）
- 方案选项:
  - A. 一级折叠（展开 ⇄ 收起为输入条，会话不变）
  - B. 两级折叠（+ 最小化为角落图标，输入条也隐藏 —— 与 REQ-F-002「输入条常驻」冲突，需同改）
  - C. 不做，靠「新对话」（代价：丢上下文）
- 选择理由: 选 A。用户明确要「会话不结束」的轻量收起，两级的「最小化」会推翻 REQ-F-002 且当前无诉求。折叠期间安静（不自动展开、不显示未读角标），仅状态灯在回复完成时做一次瞬时提示（决策 B 甲案）——在 REQ-F-018 四态的「显示表现」层解决「用户漏看已完成回复」的产品缺口，不引入第五种持久状态。v1 瞬时切换无高度动画（决策 D，避免 flex/grid 子项高度过渡的 CSS 脆弱点）。
- 回滚方式:
  - 文档回滚：还原 `产品需求说明书.md`（删 REQ-F-019、还原 REQ-F-003 验收、删本 CR 澄清小节与非目标条与评审行、还原 REQ-F-018/F-014 补充）、`架构设计说明书.md`（删 DEC-013、还原 MOD-CHAT-UI 职责与状态流）、`模块任务开发说明书.md`（删 TASK-030 与影响矩阵行、评审行）、`测试说明书.md`（删 TEST-031、还原派生矩阵与复盘行）、删 `EV-2026-09-09-collapsible-panel-requirements.md`、`test-results.json` 去除本 CR 条目。
  - 运行回滚（P3 后）：还原 `FloatingChat.tsx` 的 `expanded` 单 boolean 模型、删折叠控件与 `jarvis:chat-collapsed` 读写、还原 `globals.css` 的收起控件样式。无 schema、无 API、无依赖变更。
  - 回滚后重跑 `python tools/governance.py verify|gate g1|gate g2|check-changes` 并重新 `snapshot`。
- 验收条件:
  - P1/P2（本 CR 范围）：四本说明书一致，`gate g1`、`gate g2`、`check-changes`、`verify`、`ui` 全部通过；REQ-F-019 在模块与测试说明书均有覆盖；REQ-F-003 验收放宽记为用户确认的变更。
  - P3/P4（后续实现，不在本 CR）：`expanded` 拆为 `hasTranscript` + `userCollapsed`（`showTranscript = hasTranscript && !userCollapsed`）；折叠控件为真实 `<button>`，满足焦点/对比/触控；`localStorage['jarvis:chat-collapsed']` 读写（SSR 首帧按默认渲染 + hydration 校正）；TEST-031 取得 PASS 证据；TEST-030 与「发送后展开」e2e 在重构后重验通过；`ui-contract` 仍 0 FAIL 0 WARN。
- 评审记录: 各角色以本职说明书 + 行业惯例为立场独立评审，允许 CONDITIONAL / 反对。
  - **产品 owner**（守：已批准 MUST 不得静默削减、验收可观察、范围不发散）：①在范围内，SHOULD 合理。②**REQ-F-003「发送后必须展开」→「触发展开、可手动收起」是一次 MUST 验收放宽**，须记为用户确认的变更，不作附带项。③**反对「折叠 + 完全沉默」**——折叠后回复完成，唯一信号是与「空闲就绪」同色的常亮绿灯，用户无法区分「可以聊」和「答案在等你」，而 REQ-F-018 四态无「回复完成未读」态。处置：加状态灯完成瞬时提示（非角标、非持久新态），并新增非目标锁定「无未读角标/计数」。④决策 A（新对话不碰折叠偏好）认可。结论：**APPROVED**（B 已按甲案解决）。
  - **架构角色**（守：技术可行、状态流清晰、模块边界；行业：chat widget minimize/restore 成熟模式）：①**`expanded` 状态必须解耦**为 `hasTranscript`（派生）+ `userCollapsed`（持久），否则 `rollbackOptimistic`/`handleNewConversation`/发送路径要各自打补丁。写进 REQ-F-019 实现约束 + DEC-013。②**SSR/hydration**：`localStorage` 服务端不可读，首帧只能按默认渲染，client 校正——与 DEC-011（`sessionStorage`）同类，DEC-013 明确「接受一帧校正，不接受持久错误态」。③纯 MOD-CHAT-UI，无 API/store/schema，与 DEC-005「保持主界面可见」方向一致。④偏离「折叠即有未读角标」的强约定（决策 2a），有意为之需明示——已由产品非目标锁定。⑤a11y：折叠时 `aria-live` 记录区移除，屏幕阅读器折叠期间不朗读流式回复——与视力用户对等（都需展开），非缺陷，UI 规范记一句。结论：**APPROVED**（附 DEC-013）。
  - **模块开发角色**（守：任务单一职责、可独立提交、可独立测试、无隐藏返工）：①**任务不能是「加个按钮」**——必须含 `expanded`→`showTranscript` 重构，写死在任务描述。②持久化集中为一个 `setUserCollapsed` helper（try/catch，镜像 `markSessionEnded`），键 `jarvis:chat-collapsed`。③**决策 D**：`max-height` 到 `auto` 不能 transition，grid 子项高度动画要 `0fr↔1fr` 技巧或固定高度——v1 建议瞬时切换。④控件为 `.floating-chat__status` 行首个交互元素，真 `<button>`（FK-03）。结论：**APPROVED**（CONDITIONAL 条件并入 TASK-030 描述与 DEC-013）。
  - **测试角色**（守：AI_STANDARD 原则 12 真实入口、原则 15 逐条断言、行为回归须有守卫）：①**`expanded`→`showTranscript` 是行为相邻重构**，会碰 REQ-F-003 的「发送后展开」e2e 和 TEST-030「新对话清空 + 刷新空白」——两者须在重构后重跑并可能重写断言，作为 CR 回归门。②REQ-F-019 七条验收 → 七组独立断言（原则 15）。③**持久化跨刷新必须真实浏览器**（原则 12）：component 测逻辑，e2e 测「折叠 → reload → 仍折叠」，因 SSR 首帧展开 / client 校正折叠这条路径 jsdom 测不出。④陈旧偏好（`collapsed=true` 但无记录）须显式断言不出现「折叠了却空白」的中间态。结论：**APPROVED**（附条件：持久化走 e2e、REQ-F-003 e2e 重验、TEST-031 承载折叠行为）。
- 评审结论汇总: 产品 owner / 架构 / 模块 / 测试 全部 APPROVED（原产品 & 模块的 CONDITIONAL 条件——完成瞬时提示、`expanded` 解耦、无动画——已并入 REQ-F-019 验收 / 实现约束 / DEC-013 / TASK-030）。B 选甲，D 选无动画，A/C 三方无异议。

## 背景

用户在 P6 使用中觉得 50vh 面板长期占屏，想要「只收起面板、会话还在」的操作（「新对话」代价太大——丢上下文）。经产品讨论确定：一级折叠、折叠时安静、偏好记住、发送即展开、控件放状态栏。角色评审提出两处硬阻塞（完成提示、状态解耦），产品 owner 按甲案解决完成提示，架构方案解决状态解耦。

## 各流程变化点

### P1 产品需求说明书

| 位置 | 变化 |
|---|---|
| 新增 REQ-F-019 | 收起对话面板（SHOULD，7 条验收 + 实现约束） |
| REQ-F-003 | 验收「发送后**必须**展开」→「发送**触发**展开；用户可随后手动收起（REQ-F-019），再次发送重新展开」 |
| 验收澄清 | 新增小节：折叠状态语义、折叠期间回复完成提示、请求级错误红字、折叠 a11y |
| 非目标 | 新增：折叠状态不显示未读角标/消息计数/持久新回复标记 |
| REQ-F-018 | 补充说明：「生成中」与「完成瞬时提示」属显示表现，不新增可辨识状态；四态不变 |
| REQ-F-014 | 补充：收起/展开控件的焦点/对比/触控/真实 `<button>` 约束 |
| 多角色评审 | 新增本 CR 评审小节 |
| 批准状态 | 用户确认追加本 CR |

### P2 架构设计说明书

| 位置 | 变化 |
|---|---|
| 新增 DEC-013 | 折叠面板状态模型：`expanded` 拆 `hasTranscript`（派生）+ `userCollapsed`（持久 `localStorage['jarvis:chat-collapsed']`）；SSR 首帧按默认渲染 + hydration 校正（同 DEC-011）；瞬时切换无动画；折叠控件为状态栏内真实 `<button>` |
| MOD-CHAT-UI 职责 | 加「面板收起/展开 + 偏好持久化」；覆盖需求列加 REQ-F-019 |
| DEC-005 | 备注：折叠与「保持主界面可见」意图一致，不改布局决策 |
| 多角色评审 | 新增本 CR 评审小节 |

### P2 模块任务开发说明书

| 位置 | 变化 |
|---|---|
| 任务总览 | 新增 TASK-030（MOD-CHAT-UI：`expanded`→`showTranscript` 重构 + 折叠控件 + `setUserCollapsed` helper + 发送即展开；无动画） |
| 关键接口 | 无（纯组件内状态） |
| 影响矩阵 | 新增行：REQ-F-003 放宽 = 小改（TASK-030 承接）；REQ-F-019 = 新增 |
| 复盘迭代 | 新增本 CR 评审小节 |

### P2 测试说明书

| 位置 | 变化 |
|---|---|
| 测试矩阵 | 新增 TEST-031（折叠隐藏记录保留会话 / 展开恢复 / 折叠+流式=busy + 完成瞬时提示 / 折叠时发送自动展开 / `localStorage` 跨刷新偏好【e2e】/ 陈旧偏好无空白中间态） |
| 派生矩阵 | 新增行：TASK-030 → TEST-031 + TEST-030 重验 + REQ-F-003 e2e 重验 |
| 复盘迭代 | 新增本 CR 评审小节 |

### P3/P4（已完成 —— 详见 EV-2026-09-09-collapsible-panel-impl）

三角色逐变化点响应见 `架构设计说明书 · CR-20260909-collapsible-panel 方案` / `模块任务开发说明书 · 技术设计` / `测试说明书 · 测试设计` 三张表（CP-1..CP-8 全覆盖）。

- `src/components/FloatingChat.tsx`：`expanded` → `hasTranscript` + `userCollapsed`（派生 `showTranscript`）；`chatCollapsed`/`writeChatCollapsed`/`applyCollapsed` helper；`justFinished` + `finishTimerRef` → `--done` 一次性脉冲；状态栏 `.floating-chat__toggle`；发送首行 `applyCollapsed(false)`。删除全部 `setExpanded`。
- `src/app/globals.css`：`.floating-chat__toggle` / `--toggle-icon` / `.floating-chat__light--done`；`.floating-chat--expanded` 无 `transition`（v1 瞬时）。
- `scripts/ui-contract.mjs`：LB-03 改判派生模型；新增 LB-07（折叠控件 = 真实 button + `aria-expanded` + transcript-gated + 无高度动画）。46 规则 0/0/0。
- `test-results.json`：TEST-031 = PASS；TEST-030 补回归说明。
- **验证**：`npm test` 120（含 TEST-031 的 5 个折叠组件用例）、`ui-contract` 46/0/0、smoke、**7** Playwright e2e（新增「collapsing the panel keeps the conversation and survives a reload」）、`build:verify`、17 治理单测；`verify`/`ui`/`check-changes`/`g1`/`g2`/`g3`/`g3.5`/`g4` 全 PASS。
- **零部署 / 零后端 / 零数据库变更**（架构角色裁决），无新依赖。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ
