# AGENTS.md

面向任意 AI 编码工具的入口说明。Claude Code 会自动加载 `CLAUDE.md`；其它工具请从本文件开始读。

**操作规则的唯一出处是 `CLAUDE.md`**（猜不到的命令、分支与 snapshot 顺序、已知的坑、写文档的固定动作）。本文件只讲范围、引用位置与角色边界，不重复那些内容。

## 适用范围

本文件适用于 Agent-Jarvis 仓库的全部工作。

产品需求说明书当前为 **APPROVED**。这不等于可以随意改：新增或修改任何需求、架构、模块任务、测试矩阵、发布结论，都必须先在 `project/06_changes/` 立变更记录（CR）并通过 R1 人工终裁。用户未确认的产品内容，不得自行发散。

## 规范文件

| 内容 | 路径 |
|---|---|
| 会话操作规则（命令、坑、纪律） | `CLAUDE.md` |
| 治理原则与完成定义 | `docs/AI_STANDARD.md` |
| 阶段流程与分支合并 | `docs/WORKFLOW.md` |
| 门禁、分档判据、状态语义 | `docs/CONTROLS.md` |
| UI 开发规范 | `docs/UI_STANDARD.md` |
| 本机配置与运行方式 | `docs/LOCAL_CONFIGURATION.md` |

## 受控文档区

| 区域 | 路径 | 责任角色 |
|---|---|---|
| 需求输入（用户原话） | `project/00_input/` | 产品 owner |
| 产品需求说明书 | `project/01_specification/` | 产品 owner |
| 架构设计说明书 | `project/02_solution/` | 架构角色 |
| 模块任务开发说明书 | `project/03_modules/` | 模块开发角色 |
| 测试说明书 | `project/04_tests/` | 测试角色 |
| 证据记录 | `project/05_evidence/` | 测试 / 质量角色 |
| 变更记录 | `project/06_changes/` | 变更提出人与评审角色 |
| 版本发布控制说明书 | `project/07_releases/` | 发布 owner |

治理文档与业务文档分开存放，不要混写。

## 工作规则

- 用户原始需求必须先原样保存，再派生任何产品文档。
- 不得静默覆盖受控文档；实质变更记录在 `project/06_changes/`。
- 需求、任务、测试、发布、知识资产没有当前证据时不得标记完成。
- UI 工作必须满足 `docs/UI_STANDARD.md` 并通过 `python tools/governance.py ui`，其实现证据才被接受。
- 声称治理文件一致之前，先跑 `python tools/governance.py verify`。

## 角色边界

- **产品 owner**：确认需求正确性、范围、优先级与验收标准。
- **架构角色**：在产品意图确认后才定义技术结构、边界与接口。
- **模块开发角色**：只实现已批准的任务；在 R1 就介入可实现性与隐藏 scope 检查。
- **测试角色**：在编码前定义测试与通过标准，执行并处理失败回流。
- **发布 owner**：门禁与证据通过后才发布。

一人可以承担多个角色，但每次受控评审必须**声明当前角色**与检查结论。同一人扮演多角色时，不得用一句「均通过」代替逐角色意见。
