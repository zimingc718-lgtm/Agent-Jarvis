# CR-20260908-floating-llm-chat

- 级别：L2
- 提出人：用户
- 状态：APPROVED
- 占用 ID: TASK-001..008, TEST-001..013 （由 CR-20260910-risk-scaled-gates 回填，只登记本 CR **创建**的 ID，不含其引用或修订的既有 ID；DEC-001..014 的创建归属无法从现有记录复原，故未登记。）
- 评审模型：pre-R1234（旧 G0/G1/G2/G3/G3.5/G4；CR-20260909-consensus-review-gates 起改为 R1–R4 + G3/G3.5/G4，不追溯本 CR）
- 影响需求：REQ-F-001 至 REQ-F-014，REQ-NF-001 至 REQ-NF-004
- 影响模块：MOD-AUTH，MOD-DB，MOD-PROVIDER，MOD-ADAPTER，MOD-CHAT，MOD-CHAT-UI，MOD-SETTINGS-UI
- 影响任务：TASK-001 至 TASK-008
- 影响测试：TEST-001 至 TEST-013
- 当前证据：`project/05_evidence/EV-2026-09-08-provider-api-auth.md`
- 方案选项：Next.js 全栈；React + FastAPI；Vue + FastAPI
- 选择理由：Next.js 全栈能在一个本机项目内完成 Google 登录、API routes、SSE、设置页和悬浮 UI，首版集成成本最低。
- 回滚方式：回退代码和受控说明书到上一基线；恢复上一份 SQLite schema 与配置快照；重新运行治理脚本。
- 验收条件：G1/G2 通过；全部必选测试通过；真实入口冒烟通过；发布清单生成。
- 评审记录：产品、架构、开发、测试、发布角色在对应说明书中完成评审并给出 APPROVED。

- 实施验证证据：project/05_evidence/test-results.json；npm test、npm run build、npm run test:smoke、python -m unittest tests.test_governance -v 均已通过。

- 认证配置修正：移除 Google OAuth 假 client fallback；缺 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/NEXTAUTH_SECRET/NEXTAUTH_URL 时首页显示配置阻断；真实 Google 登录必须使用 .env.local 配置。

- 人操作流测试：新增 Playwright Chromium E2E，按用户路径执行首页 -> 模型设置 -> 保存本地 provider -> 回首页 -> 发送流式对话 -> 验证最近会话。

## R1 评审意见

**多角色评审**（迁移自 `产品需求说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 产品 owner | 目标、范围、非目标、验收标准 | 第三方账号授权需要纳入需求，但不能误写为 OpenAI/DeepSeek 官方 OAuth 已可用于模型调用。 | 增加 REQ-F-008 与 REQ-NF-003，写明官方 OAuth 优先、API Key 兜底。 | APPROVED |
| 架构角色 | 技术可行性与外部 API 边界 | OpenAI/DeepSeek 官方模型 API 当前以 Bearer/API Key 调用为主。 | 将 OpenAI/DeepSeek 首版认证模式定义为 API Key 托管，本地模型定义为 Local。 | APPROVED |
| 测试角色 | 可测试性 | 每条 MUST 需求需要可观察验收标准。 | 为所有 MUST 需求补充验收标准。 | APPROVED |

## R2 评审意见

**多角色评审**（迁移自 `架构设计说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 产品 owner | 是否覆盖产品需求 | 架构必须保留第三方账号授权能力，但不能承诺非官方 OAuth。 | ProviderAuthMode 纳入 OAuth/API Key/Local/Unsupported。 | APPROVED |
| 架构角色 | 模块边界与接口 | SSE 足够首版文本流式；WebSocket 延后。 | DEC-004 固化为 SSE。 | APPROVED |
| 开发角色 | 可实现性 | 本地开发 OAuth 需要环境变量配置。 | 在风险中记录 Google OAuth client 依赖。 | APPROVED |
| 测试角色 | 可验证性 | 需要真实入口冒烟覆盖 UI、设置、流式对话。 | 测试说明书必须包含真实 Next.js 应用冒烟。 | APPROVED |

**R2 四角色审查**（迁移自 `架构设计说明书.md`）

| 角色 | 独立审查结论 | 处理结果 | 结论 |
|---|---|---|---|
| 产品 | 一次性重写覆盖所有已批准界面，且浅色紫色默认、深色保留、Provider 仍由「模型」配置，未新增业务能力。 | CP-1..CP-5 在 DEC-019 与视图表逐条保持。 | APPROVED |
| 架构 | Tailwind v4/PostCSS、本地 shadcn primitives、HSL token 和 `data-theme` custom variant 可满足当前 Next 15/React 19；无服务端契约改变。 | CP-6..CP-8 成文；依赖与回滚受 DEC-019 约束。 | APPROVED |
| 模块 | 一次性最终态可实现，但 P3 脏改动必须作为实施前置隔离，不能交叉记账；全局 CSS 清理与一次性路线一致。 | CP-9/CP-10 定义隔离、基线和删除旧样式规则。 | APPROVED |
| 测试 | 两套主题、真实入口、键盘、焦点、reflow 和 Provider 语义均可在后续 R4 拆为独立断言；P3 测试不混入。 | CP-11/CP-12 定义验证责任与隔离边界。 | APPROVED |

**架构总判：FEASIBLE。** 外部依赖和构建链属于 L3 风险，已由最小依赖表、components.json、受控生成、一次性删除旧视觉体系、工作区隔离和构建基线回滚处理。所有验证均为 `PLANNED_VERIFICATION`，尚无实现或通过证据。

## R3 评审意见

**多角色评审**（迁移自 `模块任务开发说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 架构角色 | 任务是否匹配模块边界 | Provider 管理和 Adapter 需要分离，避免 UI 绑定供应商协议。 | 拆分 TASK-003 和 TASK-004。 | APPROVED |
| 开发角色 | 依赖是否可实现 | Google OAuth、本地 SQLite、SSE 可以在 Next.js 全栈内实现。 | 保持 Next.js 单体项目。 | APPROVED |
| 测试角色 | 任务是否可测 | 每个任务必须绑定至少一个测试 ID。 | 任务表补齐 TEST-001 至 TEST-013。 | APPROVED |

**R3 四角色审查**（迁移自 `模块任务开发说明书.md`）

| 角色 | 独立审查结论 | 处理结果 | 结论 |
|---|---|---|---|
| 产品 | 一次性重写覆盖全部已批准界面，且不改变「模型」Provider 优先级和业务路径；P3 排除明确。 | CP-1..CP-5、CP-11 写入影响矩阵和任务约束。 | APPROVED |
| 架构 | 任务顺序先隔离和基础层，再重写视觉壳、设置、聊天，最后删除旧 CSS；接口、数据与授权不在任务范围。 | CP-6..CP-10 的依赖、边界和回滚写入 TASK-044..048。 | APPROVED |
| 模块 | 五个任务各有单一交付边界和回滚点；最终一次性合并与中间独立验证不冲突。 | 每个任务绑定 TEST-047..050，TASK-048 作为唯一发布收敛点。 | APPROVED |
| 测试 | 任务均有可观察入口，双主题与真实浏览器验证可在 R4 独立设计；P3 测试被排除。 | CP-11/CP-12 映射到 TEST-047..050。 | APPROVED |

**模块总判：FEASIBLE。** TASK-044 的 P3 隔离是开始实施的硬前置；在没有隔离基线时状态必须是 BLOCKED，不能以当前混合工作区直接实现。其他任务均为 TODO，尚无实现或通过证据。

## R4 评审意见

**多角色评审**（迁移自 `测试说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 产品 owner | 是否覆盖全部验收标准 | 测试必须覆盖 Google 登录、Provider 设置、底部浮窗和会话保存。 | TEST-001 至 TEST-013 覆盖所有需求。 | APPROVED |
| 架构角色 | 是否符合真实入口原则 | 冒烟测试必须启动真实应用，不能只测纯函数。 | 增加 TEST-013。 | APPROVED |
| 开发角色 | 命令可执行性 | 项目脚本需将测试标签映射到实际 Vitest/Playwright 命令。 | 实现阶段在 `package.json` 固化命令。 | APPROVED |
| 测试角色 | 断言充分性 | 测试必须验证可观察行为和安全边界。 | 增加凭据不明文、用户隔离、Abort 状态断言。 | APPROVED |

**R4 四角色审查**（迁移自 `测试说明书.md`）

| 角色 | 独立审查结论 | 处理结果 | 结论 |
|---|---|---|---|
| 测试 | 每项用户可观察动作都有单独的静态、组件或真实入口断言；320/390/1280px 与亮暗主题形成固定矩阵。 | TEST-047..050 与既有 TEST-025/026 逐 CP 映射。 | APPROVED |
| 架构 | Token、主题、primitive 边界、旧 CSS 删除和 P3 隔离都有可定位检查；没有用截图替代接口/状态验证。 | TEST-047、TEST-048、TEST-050 承接 DEC-019。 | APPROVED |
| 模块 | 五项 TASK 的完成边界与测试一一对应；TASK-048 没有绕过前序任务的集成验收。 | 派生矩阵按子项列行。 | APPROVED |
| 产品 | 视觉重写不改变「模型」入口或 Provider 自动优先级；P3 未被宣布完成。 | 保留 TEST-025/026 作为业务回归。 | APPROVED |

**测试总判：PLANNED_VERIFICATION。** TEST-047..050 均为必选，尚未执行；不得将本文档中的计划描述当作通过证据。
