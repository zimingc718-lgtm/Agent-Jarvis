# Agent-Jarvis 执行流程控制

## 当前状态

产品需求尚未确认。本流程只规定从需求确认到开发、验证、发布的控制顺序，不定义任何具体产品功能。

## 阶段与责任

| 阶段 | 主责 | 必需输入 | 输出 | 退出条件 |
|---|---|---|---|---|
| P0 需求受理 | 产品 owner | 用户原始输入 | `project/00_input/需求输入.md` | 原文已保存，状态明确 |
| P1 产品定义 | 产品 owner | 已受理输入 | `产品需求说明书.md` | G1 通过 |
| P2 架构规划 | 架构、开发、测试角色 | 已通过 G1 的需求、现有代码事实、参考证据 | 架构、模块、测试说明书 | G2 通过 |
| P3 开发验证 | 模块开发角色 | 已批准任务与测试 | 实现、测试结果、证据 | G3 通过 |
| P4 集成冒烟 | 测试角色 | 可运行构建物 | 真实入口验证记录 | G3.5 通过 |
| P5 发布 | 发布 owner | 完整验证和关闭记录 | 发布清单、回滚说明 | G4 通过 |
| P6 运行反馈 | 产品、测试、质量角色 | 运行证据、用户反馈 | 新需求、变更或问题闭环 | 重要问题已处置 |

## 标准执行循环

1. 保存用户原始需求，不改写、不补充未经确认的产品定义。
2. 产品 owner 与用户确认目标、范围、非目标、优先级和验收标准。
3. 需求确认后，生成或更新产品需求说明书。
4. 架构角色基于已确认需求形成架构设计，不从想象补充功能。
5. 模块开发角色基于架构拆解任务和接口。
6. 测试角色在编码前定义测试矩阵、命令、通过标准和覆盖关系。
7. 四类说明书一致后，进入实现。
8. 实现完成后运行必选测试，失败先回流到模块开发。
9. 若失败不是实现问题，再回流到模块、架构或需求修订。
10. 发布前启动真实构建物，通过主路径冒烟验证。
11. 发布后用运行证据和用户反馈创建新需求、变更或问题闭环。

## 变更分流

- L1 局部实现：不改变需求、架构、接口和测试基线的小修复。
- L2 设计变更：改变需求、架构、模块边界、接口、数据结构、测试标准或用户可观察行为。
- L3 重大变更：改变核心目标、技术路线、数据迁移、信任模型、权限模型、外部依赖或发布边界。

## 失败回流

```text
测试或运行证据
  -> 模块任务
  -> 架构设计
  -> 产品需求
  -> 用户确认
```

AI 不得用推测替代证据。无法定位证据的问题必须标记为证据缺口。

## 验证命令

项目技术栈尚未确认，产品测试命令暂不冻结。治理流程命令已经可执行：

```powershell
python -m unittest tests.test_governance -v
python tools/governance.py verify
python tools/governance.py gate g1
python tools/governance.py check-changes
```

技术栈确认后，产品实现相关命令必须写入 `project/04_tests/测试说明书.md`。

## UI 流程接入

UI 工作纳入现有 P1-P4 流程，不建立绕过需求确认的独立通道。

1. P1 产品定义：只记录用户已确认的 UI 目标、范围、非目标、优先级和验收标准。
2. P2 架构规划：UI 架构必须从 G1 通过的需求派生，并说明组件边界、状态流、鉴权边界、第三方模型授权边界和测试责任。
3. P3 开发验证：涉及用户交互的组件必须先有 Testing Library 组件测试，再实现行为。
4. P4 集成冒烟：必须用 Playwright 从真实浏览器入口验证主要操作流，并保存 real-entry 证据。

UI 相关流程命令：

`powershell
python tools/governance.py ui
npm run test:auth-ui
npm run test:visual
npm run test:e2e
`

## 构建目录隔离（DEC-009）

`next build` 与 `next dev` 默认共用 `.next/`。在交互式 `next dev` 运行时执行 `next build`，会覆盖运行中服务器的 webpack 运行时，使其之后重新编译的路由报 `Cannot find module './vendor-chunks/*.js'`（尤其 `/api/auth/[...nextauth]`）。

- `next.config.mjs` 从 `NEXT_DIST_DIR` 读取 `distDir`。
- 交互式开发用默认 `.next/`。
- `npm run test:smoke` → `.next-smoke/`；`npm run test:e2e` → `.next-e2e/`；`npm run build:verify` → `.next-verify/`。
- **禁止**在交互式 `next dev` 运行时直接 `next build`（会污染其 `.next/`）；验证构建一律用 `npm run build:verify`。
- `.next*` 已在 `.gitignore` 中；`npm run clean` 清除全部构建目录。

