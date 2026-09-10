# Agent-Jarvis 门禁与流程控制

## 当前状态

产品功能尚未确认。本文件只保留项目级门禁和控制规则，不包含具体业务验收项。

## 门禁总览

CR-20260909-consensus-review-gates 起：设计阶段门禁为 R1–R4（共识门），G3/G3.5/G4 为机器证据门。

| 门禁 | 类型 | 控制目标 | 阻断条件 | 主要证据 |
|---|---|---|---|---|
| G0 受控入口 | 机器 | 原始需求、变更、证据可定位 | 无原始输入、无状态、无法定位来源 | `project/00_input/` |
| **R1 需求评审** | 人工终止 | 产品需求完整、变化点清晰、经用户拍板 | 缺「变化点登记」表、CP 无来源角色、缺逐条验收/非目标/用户确认、人未拍板 | `产品需求说明书.md`、CR |
| **R2 架构评审** | 机器终止 | 架构逐一响应每个 CP，四角色共识 | 有 CP 未在架构说明书 `CR-<name>` 节被引用（`COVERAGE_GAP`）；`R2 评审矩阵` 有 REJECTED / 空格 / 无条件 CONDITIONAL（`MATRIX_INVALID`）| 架构说明书、CR 的 R2 矩阵 |
| **R3 模块评审** | 机器终止 | 模块逐一响应每个架构 CP，四角色共识 | 同 R2，对模块说明书 | 模块说明书、CR 的 R3 矩阵 |
| **R4 测试评审** | 机器终止 | 测试逐一响应每个任务，四角色共识 | 同 R2，对测试说明书 | 测试说明书、CR 的 R4 矩阵 |
| G3 实施证据 | 机器 | 实现完成且必选测试通过 | 任务未完成、必选测试未跑或失败、证据缺失（DEFERRED 除外，见发布阻断例外） | 测试结果、证据记录 |
| G3.5 真实入口 | 机器 | 实际交付物可从真实入口使用 | 只测纯函数或测试桩、未启动真实构建物、主路径未覆盖 | 冒烟测试证据 |
| G4 发布 | 机器 | 发布范围满足已确认需求 | MUST 需求未验证、阻塞项开放、发布说明缺失 | 发布说明书、release manifest |

`gate g1` / `gate g2` 保留为 `review r*` 的结构前置（产品需求有 APPROVED + 用户确认；REQ 有模块/测试覆盖），不再是设计阶段终门。

## 可执行命令

当前项目使用 `tools/governance.py` 执行门禁检查：

```powershell
python tools/governance.py verify
python tools/governance.py check-changes
python tools/governance.py review r1
python tools/governance.py review r2
python tools/governance.py review r3
python tools/governance.py review r4
python tools/governance.py gate g3
python tools/governance.py gate g3.5
python tools/governance.py gate g4
python tools/governance.py snapshot --actor <name>
```

`gate g1` / `gate g2` 仍可执行，作为 `review r*` 的结构前置。

`verify` 检查必需治理文件、基线快照和哈希链台账。`snapshot` 写入 `project/.governance/baseline.json` 并追加 `project/.governance/ledger.jsonl`。写入基线后，受控文件发生变化会被 `verify` 阻断，直到经过正式变更并重新快照。

## 一致性控制

- 产品需求说明书是产品意图基线。
- 架构、模块、测试说明书必须从产品需求派生。
- **每个变化点（CP）必须在其下的每一层都有响应行，任何 CP 在任何层「消失」即阻断该层门禁（R2/R3/R4 的 `COVERAGE_GAP`）。**
- 编码前必须先有任务和测试定义（R4 通过）。
- 基线批准后，变更必须走 `project/06_changes/`。
- 测试结果和运行记录只能证明当前实现，不自动证明未来版本。

## 变更控制

| 级别 | 适用范围 | 评审要求 |
|---|---|---|
| L1 | 不改变需求、架构、接口、数据结构或测试标准的小修复 | 开发和测试确认 |
| L2 | 改变需求、架构、模块边界、接口、数据结构、测试标准或用户可观察行为 | 产品、架构、开发、测试确认 |
| L3 | 改变核心目标、技术路线、数据迁移、信任模型、权限模型、外部依赖或发布边界 | L2 要求，加迁移、回滚和发布风险评审 |

## 证据控制

正式证据必须记录来源、时间、采集者、摘要、支撑对象和可定位路径。聊天推测、模型常识或无法定位的口头描述不能单独成为正式证据。

## 真实入口控制

带 UI、CLI、API 或服务的能力，验收时必须通过真实入口验证。测试桩、硬编码响应、纯函数断言不能替代真实入口冒烟。

## 状态语义

- `DRAFT`：草稿，未批准。
- `REVIEWING`：评审中。
- `APPROVED`：已批准，可进入下一阶段。
- `TODO`：任务尚未开始。
- `DOING`：任务实施中。
- `DONE`：依赖完成且必选验证当前通过。
- `BLOCKED`：受明确外部条件阻塞。
- `DEFERRED`：经批准移出当前范围。
- `REJECTED`：已拒绝。
- `CLOSED`：闭环完成。

## 发布阻断条件

任一情况存在时不得发布：

- 用户未确认产品需求。
- MUST 需求没有当前通过证据（例外：需求状态为 `DEFERRED` 时，其唯一绑定测试可在 `test-results.json` 标 `result: "DEFERRED"`；`gate g3` 不将其计入阻断，但会在输出中列出，且必须随恢复该需求的 CR 一并恢复为 `PENDING`）。
- 架构、模块或测试与需求不一致。
- 阻塞变更或重要反馈未关闭。
- 真实入口冒烟测试未执行或失败。
- 发布说明书缺失或未记录回滚方式。

## UI 规范门禁

UI 规范门禁由 python tools/governance.py ui 执行，并纳入 python tools/governance.py verify。

阻断条件：

- docs/UI_STANDARD.md 缺失或缺少 UI-GOV-001 基线关键项。
- package.json 缺少 	est:auth-ui、	est:visual、	est:e2e 或 governance:ui。
- 存在 TSX UI 源码时，缺少组件测试或真实入口 E2E 测试。
- UI 说明书或实现超出已批准产品需求。
- 将 Agent-Jarvis 自身登录与 OpenAI、DeepSeek、本地模型等 third-party provider authorization 混同。

执行命令：

`powershell
python tools/governance.py ui
python tools/governance.py verify
`

