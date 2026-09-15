# Agent-Jarvis 门禁与流程控制

## 当前状态

产品功能尚未确认。本文件只保留项目级门禁和控制规则，不包含具体业务验收项。

## 门禁总览

CR-20260909-consensus-review-gates 起：设计阶段门禁为 R1–R4（共识门），G3/G3.5/G4 为机器证据门。

| 门禁 | 类型 | 控制目标 | 阻断条件 | 主要证据 |
|---|---|---|---|---|
| G0 受控入口 | 机器 | 原始需求、变更、证据可定位 | 无原始输入、无状态、无法定位来源 | `project/00_input/` |
| **R1 需求评审** | 人工终止 | 产品需求完整、变化点清晰、产品 / 架构 / 模块开发 / 测试四角色出意见后经用户拍板；签置写成一行 `- R1 终裁: 已完成 \| <签置人> [\| YYYY-MM-DD]`（DEC-190，日期可选） | 缺「变化点登记」表、CP 无来源角色、缺逐条验收/非目标/用户确认、四角色意见不齐、**签置行缺失或仍是将来式承诺**（如「R1 时一并终裁」）；状态为 DRAFT 的记录明确跳过并列名，不算通过 | `产品需求说明书.md`、CR |
| **R2 架构评审** | 机器终止 | 架构逐一响应每个 CP，四角色共识 | 有 CP 未在架构说明书 `CR-<name>` 节被引用（`COVERAGE_GAP`）；`R2 评审矩阵` 有 REJECTED / 空格 / 无条件 CONDITIONAL（`MATRIX_INVALID`）| 架构说明书、CR 的 R2 矩阵 |
| **R3 模块评审** | 机器终止 | 模块逐一响应每个架构 CP，四角色共识 | 同 R2，对模块说明书 | 模块说明书、CR 的 R3 矩阵 |
| **R4 测试评审** | 机器终止 | 测试逐一响应每个任务，四角色共识 | 同 R2，对测试说明书 | 测试说明书、CR 的 R4 矩阵 |
| G3 实施证据 | 机器 | 实现完成且必选测试通过 | 任务未完成、必选测试未跑或失败、证据缺失（DEFERRED 除外，见发布阻断例外） | 测试结果、证据记录 |
| G3.5 真实入口 | 机器 | 实际交付物可从真实入口使用 | 只测纯函数或测试桩、未启动真实构建物、主路径未覆盖 | 冒烟测试证据 |
| G4 发布 | 机器 | 发布范围满足已确认需求 | MUST 需求未验证、阻塞项开放、发布说明缺失 | 发布说明书、release manifest |

> **真实入口的两道检查分工不同**（DEC-200）：`gate g3.5` 问「这个仓库里有没有真实入口证据」，`check-real-entry` 问「**这一条**变更记录声明的真实入口跑过了吗」。后者允许一条 `- 真实入口: 未执行（原因）` 的记录过门，但会把它**点名**列出——目的不是逼人去跑，是让「登记了没跑」在输出里看得见。


`gate g1` / `gate g2` 保留为 `review r*` 的结构前置（产品需求有 APPROVED + 用户确认；REQ 有模块/测试覆盖），不再是设计阶段终门。

## 可执行命令

当前项目使用 `tools/governance.py` 执行门禁检查：

```powershell
python tools/governance.py check p1|p2|p3|release   # 阶段聚合，首选入口
python tools/governance.py verify
python tools/governance.py check-changes
python tools/governance.py check-specs
python tools/governance.py review r1|r2|r3|r4
python tools/governance.py gate g3|g3.5|g4
python tools/governance.py new-cr <CR 名>
python tools/governance.py matrix <CR 名> [--force]
python tools/governance.py snapshot --actor <name>
npm run verify:all
```

`gate g1` / `gate g2` 仍可执行，作为 `review r*` 的结构前置。

**阶段 → 门禁集合**（`check <stage>`，任一子门 FAIL 则整体 FAIL 并标出是哪一步）：

| 阶段 | 门禁集合 |
|---|---|
| `p1` | `verify` `check-changes` `review r1` |
| `p2` | `p1` 全部 + `check-specs` `gate g1` `gate g2` `review r2\|r3\|r4` |
| `p3` | `p2` 全部 + `ui` `gate g3` `gate g3.5` |
| `release` | `p3` 全部 + `gate g4` |

**`--cr <名称>` 作用域**：`gate g3\|g3.5`、`review r1..r4`、`check p1\|p2\|p3` 可收窄到单个变更记录声明的 TEST 集合，供在途 CR 自查。缺省语义不变；**`gate g4` 与 `check release` 明确拒绝 `--cr`**（发布按定义全量判定）；用 `--cr` 通过不构成交付凭证。

`verify` 检查必需治理文件、基线快照和哈希链台账。`snapshot` 写入 `project/.governance/baseline.json` 并追加 `project/.governance/ledger.jsonl`。写入基线后，受控文件发生变化会被 `verify` 阻断，直到经过正式变更并重新快照。

## 说明书结构控制（DEC-020）

`python tools/governance.py check-specs` 对四本层级说明书执行结构契约，四类违规各自阻断：

| 代码 | 含义 |
|---|---|
| `SPECS_UNKNOWN_SECTION` | `##` 节名既不在本层基线白名单，也不是 `变更响应 · <CR>` |
| `SPECS_DUPLICATE_RESPONSE` | 同一 CR 在同一层出现多个变更响应节 |
| `SPECS_REVIEW_IN_SPEC` | 说明书里残留评审 / 复盘节（评审意见只能在 CR 内） |
| `SPECS_MISSING` | 层级说明书缺失 |

结构迁移由 `python tools/migrate_specs.py` 执行，**幂等**；评审文字是**移动**不是删除，带 `（迁移自 …）` 溯源标记。

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

### 分档判据：撤回代价（DEC-021 ①）

级别由**撤回代价**决定，不由改动落在哪个目录决定。判定单位是**每个变化点（CP）**，不是整个 CR——一个 CR 里两种门并存是常态（CR-20260910-ui-foundation 的 2847 行里，CSS 重写是双向门，新增依赖进 lockfile 是单向门）。

对每个 CP 问三句话，**任何一句答「否」即为单向门**：

1. `git revert` 之后，系统状态是否完全回到从前？（不只是代码——数据、密钥、已执行的副作用）
2. 撤回是否只靠我们自己就能完成？（需要用户改用法、外部消费者改代码 → 否）
3. 如果它错了，我们**多久会知道**？（发现不了 → 否。**可逆性以可检测性为前提**）

典型单向门：数据已变形的迁移；密钥已外泄；对外契约已被消费；依赖已进 lockfile；信任面已打开（如未沙箱化的 `<iframe srcDoc>`）；**错误发现不了**。

| 档 | 判据 | 流程 |
|---|---|---|
| 快车道 | 全部 CP 双向门，且每个 CP 的「发现方式」都是一条机器检查 | CR 头部 + 证据 + 跑门禁 + snapshot；不需要 CP 矩阵与四角色意见 |
| 标准 | 全部 CP 双向门，但存在依赖人工发现的 CP | CP 表 + 相关角色意见（CR 内 `## 角色意见` 节）+ 三层说明书变更响应节逐 CP 落点 + 门禁；**不产出 R2–R4 矩阵**（`review r2|r3|r4` 按门/发现方式列计算判定、仍查落点、点名免矩阵） |
| 重型 | 含任一单向门 CP | 完整 R1–R4 + 回滚方案 + 事前验尸（pre-mortem） |

**L1 且不占用新 ID 的变更，只写 CR 与证据登记（DEC-210 ⑥）。** 不改需求、不改架构、不改接口、不改测试基线、不新增 REQ/DEC/TASK/TEST 编号的局部修复，产出就是一条 CR（含 CP 表与发现方式）加一条证据登记，不写三层说明书的变更响应节——**没有落点的东西不需要落点**。判定仍按每个 CP 的门：出现任一单向门，或需要新编号，即离开这一档。此前这一档靠每次临时判断，结果是同样形状的小修有时写三节文档、有时一节不写。

**快车道的准入条件是「该变更已被机器覆盖」**——放松的只是评审文字，机器检查一条不少。填不出「发现方式」的 CP 一律按单向门处理。

机器强制：`python tools/governance.py check-doors`。

**说明书表格的列数必须与表头一致（DEC-220 ①）**：单元格里的竖线要写成 `\|`。不是洁癖——2026-09-13 扫出 12 行不一致，TASK-161/190/200 三行因此被按列读错，REQ-F-102 / F-130 / F-140 在任何按列取值的地方都显示为「没有任何任务实现它」。机器强制：`python tools/governance.py check-tables`。

## 证据控制

正式证据必须记录来源、时间、采集者、摘要、支撑对象和可定位路径。聊天推测、模型常识或无法定位的口头描述不能单独成为正式证据。

## 真实入口控制

带 UI、CLI、API 或服务的能力，验收时必须通过真实入口验证。测试桩、硬编码响应、纯函数断言不能替代真实入口冒烟。

**真实入口的三种账（DEC-250）**：

- **已执行**——有 `real_entry: true` 的 PASS 证据。若该 CP 行写了 `（证据：TEST-xxx）`，只认这几条；**点了名就不能靠兄弟测试的证据过门**。
- **未执行**——写 `- 真实入口: 未执行（原因）`。不拦，但每次都被点名。
- **待裁定**——写 `- 真实入口: 待裁定（原因）`。声明的是产品判断而非可执行验证（观感、密度、够不够用）时用它：它在等一个人看一眼然后拍板，不在等谁去执行。**一个永远划不掉的待办会把待办本身变成噪声。**

- **路线级未执行**——在该 CP 行的「发现方式」里写 `（未执行：原因）`。**这一条与记录整体是否另有证据无关**：一份记录跑掉三条路线、剩一条没跑时，剩的那条照样被点名（DEC-300）。每条声明的路线都自陈未执行时，记录级那一行就不必再写。

未写 `（证据：…）` 的路线按记录级回退判定，并由 `REAL_ENTRY_UNNAMED_ROUTE` 单独计数——那是迁移账，不是已经堵上的洞。

## 状态语义

- `DRAFT`：草稿，未批准。
- `REVIEWING`：评审中。
- `APPROVED`：已批准，可进入下一阶段。

**需求状态什么时候从 `REVIEWING` 转 `APPROVED`（DEC-220 ②）**：该需求的 CR 的 R1 已终裁，且实现它的任务全部 `DONE`——两条同时成立即应推进，不必等发布。

判据是**推导出来的**，不是自报的：`python tools/governance.py check-req-status` 从「状态列写没写 R1 已终裁」与「任务表里关联该需求的任务是否全 DONE」两处算，`p1`/`p2`/`p3` 只报（半成品是工作中途的常态），`check release` 用 `--strict` 拦。

此前这条规则不存在：`docs/CONTROLS.md` 只定义了词义，没说谁在什么时候推进。结果是 2026-09-10 之后没人推进过，26 条已交付的需求一直挂在「评审中」，「到底做完没有」只能靠人一条条翻。
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

