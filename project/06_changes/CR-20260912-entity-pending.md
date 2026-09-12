# CR-20260912-entity-pending

- 级别: L1（补一个流事件：模型提议跟踪对象或修改时，对话里说一句，看板随之刷新。机制早已存在（`ToolResult.events` 与 `knowledge_pending`），本 CR 只加一个变体与一个分支）
- 提出人: 模块开发（`CR-20260911-home-dashboard` 出口义务 2）
- 状态: APPROVED
- 占用 ID: TASK-134
- 评审模型: 标准档（DEC-021 ①：两个 CP 双向门，但客户端那条分支只有真实入口能发现 → 不走快车道）
- 影响需求: 落实 REQ-F-072 ①（模型只能提议）的可见性一侧
- 影响模块: MOD-CHAT（`types.ts` 的 `ChatDelta`）、MOD-TOOLS（`entity-tools.ts`）、MOD-SETTINGS-UI（`FloatingChat.tsx`）
- 影响任务: 新增 TASK-134；**小改** TASK-122
- 影响测试: **小改** TEST-121（增 1 例）
- 当前证据: `CR-20260911-home-dashboard` 出口义务表第 2 行
- 方案选项:
  - A. 维持现状（提议只落盘，不出声）——否决。用户要在看板上点一下才生效，而他可能根本没看着看板；不说等于让提议烂在队列里。
  - B. **复用既有的 `events` 侧信道**（选中）：`knowledge_pending` 已经是这个形状，照抄一个变体即可。
  - C. 新增一个 ui-event 常量专供看板刷新——否决。看板已经在听 `KNOWLEDGE_CHANGED_EVENT`，再加一个名字就是两根线干一件事。
- 选择理由: 选 B。①**机制不新增**：`ToolResult.events` 与流层的转发都在，缺的只是一个联合类型变体；②**两个队列要分得开**：整个新对象在 `entities/pending/`，单个字段或参数在 `entities/proposals/`，采纳是两次不同的点击，所以事件带 `what` 区分；③**直写不发事件**：来源可信时值已经写到卡片上了，再说一句是噪声。
- 回滚方式: `git revert` 本 CR 的提交。事件消失后提议仍照常入队，只是不再出声。无数据、无迁移。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表；`check-doors` PASS；`review r1` PASS。
  - 标准档不产出 R2/R3/R4 矩阵。
  - P3/P4: TASK-134 DONE、TEST-121 仍 PASS（含新增一例）；`gate g3|g3.5` PASS。
- 评审记录: 标准档，相关角色意见见 `## 角色意见`。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 模块开发 | **提议出声**：`propose_entity`、`propose_entity_update`（仅入队时）、`extract_fields`（有条目入队时）带出 `entity_pending` 事件，`what` 区分新对象与字段修改；**直写不发**，因为值已经在卡片上 | TASK-134 | 新增 | 双向 | 机器：TEST-121 ⑪（三种情况各一断言） |
| CP-2 | 产品 | **说一句 + 刷一次**：对话里出现一条系统消息，同时派发既有的 `KNOWLEDGE_CHANGED_EVENT`，看板据此刷新——不新增第二个事件名 | TASK-134 | 新增 | 双向 | **真实入口**：在对话里让模型提议一个对象，看转录区是否出声、看板是否出现待采纳项 |

## 角色意见

| 角色 | 意见 |
|---|---|
| 产品 | 提议是需要用户动手的事，必须在他正在看的地方说一次。只写进队列等于没说。 |
| 架构 | 不要为看板刷新再造一个事件名。`KNOWLEDGE_CHANGED_EVENT` 已经是「本地资料有变，重新拉一次」的意思，看板本来就在听。 |
| 测试 | 客户端那条分支要靠真实入口——`FloatingChat` 的测试文件正被并行会话改着，此时挤进去会打架。如实登记为真实入口，不假装覆盖。 |

## R1 人工终裁

- 出口义务 2 在 `CR-20260911-home-dashboard` 中已获批准另立 CR 清零，本 CR 照其原文落地。
- 当初记的阻塞原因是「需要改 `types.ts` 的 `ChatDelta`，被并行 CR 占用」。用户 2026-09-12 指示「如果还有其他会话在工作，以这个会话为主」，故按并行会话的当前磁盘内容叠加改动，未覆盖其未提交的工作（改动前已对其工作区做了备份提交 `backup/peer-worktree-20260912`）。

## 实施记录（2026-09-12）

- `types.ts`：`ChatDelta` 增 `{ type: "entity_pending"; title; what: "entity" | "update" }`。
- `entity-tools.ts`：三处返回带上事件；`propose_entity_update` 仅在入队时带，直写不带。
- `FloatingChat.tsx`：新增一条分支，按 `what` 说不同的话，并派发 `KNOWLEDGE_CHANGED_EVENT`。
- `tests/entity-tools.test.ts` 增一例（提议带事件、直写不带）。
- 全量 564 单测通过、ui-contract 53/0、typecheck 0。
- **仍属人工发现**：客户端那条分支（CP-2）。
