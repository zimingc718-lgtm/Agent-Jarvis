# Agent-Jarvis UI 开发规范

本文档定义 UI 开发的项目级流程规范和可验证控制项，不定义具体产品功能、页面范围或业务交互。任何 UI 功能需求、页面结构、业务文案、信息架构和验收标准，必须先经过产品需求说明书、架构设计说明书、模块开发设计说明书和测试说明书的多角色评审。

## UI-GOV-001 规范基线

所有 UI 工作必须满足以下基线：

- 使用 Design Tokens 管理颜色、字号、间距、圆角、阴影、层级和状态，不允许在组件中随意散落不可追踪的视觉常量。
- 交互组件采用 Component-Driven Development，组件边界、输入、输出、状态和错误展示必须可独立验证。
- 可访问性目标为 WCAG 2.2 AA；复杂控件必须参考 WAI-ARIA Authoring Practices 定义键盘行为、焦点管理和语义角色。
- 组件测试使用 Testing Library，以用户可观察行为为断言目标。
- 真实操作流测试使用 Playwright，通过浏览器入口覆盖关键路径；涉及用户交互的新增能力必须有 real-entry 验证证据。
- Agent-Jarvis 自身账号登录与第三方模型账号授权分离。Google 登录只代表 Agent-Jarvis 账号体系；OpenAI、DeepSeek、本地模型等 third-party provider authorization 必须单独配置、测试和展示状态。

## 流程接入

- P1 产品定义阶段：UI 需求只能记录经过用户确认的目标、范围、非目标、优先级和验收标准。
- P2 架构规划阶段：UI 架构必须从已批准需求派生，说明组件边界、状态流、鉴权边界、配置入口和测试责任。
- P3 开发验证阶段：每个交互组件必须先有组件级测试，再实现组件行为。
- P4 集成冒烟阶段：真实浏览器入口必须验证主要用户操作流，包括登录状态、配置状态、模型连接测试、对话入口和错误状态。

## 可执行控制

以下命令是 UI 规范的强制入口：

```powershell
python tools/governance.py ui
python tools/governance.py verify
npm run test:auth-ui
npm run test:visual
npm run test:e2e
npm run test:ui-contract
```

UI-GOV-001 的可执行强制实现是 `scripts/ui-contract.mjs`：

- 静态层（无依赖）解析 `src/app/globals.css` 与组件源码，检查 Design Tokens、排版、对比度、焦点、触控尺寸、动效守卫、响应式 reflow、语义地标、表单反馈、悬浮面板布局与限高（DEC-005）和会话续接。
- **双主题**：项目声明了浅色与深色两套调色板时，正文 4.5:1 与控件边界 3:1 的对比度校验对**每套调色板各跑一次**，任一不达标即 FAIL。
- 真实浏览器层（`--live`）用 Playwright 检查 320/390/1280px reflow、浅色与深色两种主题下的计算对比度、焦点顺序、控件尺寸、reduced-motion、地标，并在安装 `axe-core` 时执行完整审计。
- `npm run test:visual`（TEST-012）运行静态层，任何 FAIL 阻断构建；WARN 为待办项。

`python tools/governance.py ui` 必须检查：

- `docs/UI_STANDARD.md` 存在并包含 UI-GOV-001、Design Tokens、WCAG 2.2 AA、WAI-ARIA Authoring Practices、Component-Driven Development、Testing Library、Playwright、real-entry、third-party provider authorization。
- `package.json` 必须提供 `test:auth-ui`、`test:visual`、`test:e2e`、`test:ui-contract`、`governance:ui` 脚本。
- `scripts/ui-contract.mjs` 必须存在。
- 如果项目存在 TSX UI 源码，必须存在组件测试和真实入口 E2E 测试。

## 评审要求

UI 相关说明书必须经过以下角色检查：

- 产品 owner：确认 UI 行为没有超出已批准产品需求。
- 架构角色：确认组件边界、鉴权边界、供应商配置边界和状态流可维护。
- 模块开发角色：确认实现任务可拆分、可测试、没有隐藏业务扩展。
- 测试角色：确认组件测试、视觉/可访问性检查、真实入口 E2E 覆盖用户可观察行为。

未经上述评审，不得进入 UI 业务功能开发；没有当前通过证据，不得标记 UI 任务完成。
