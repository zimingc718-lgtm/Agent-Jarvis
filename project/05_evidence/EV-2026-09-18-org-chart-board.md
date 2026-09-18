# EV-2026-09-18-org-chart-board

- 来源: 用户 INPUT-2026-09-18-001 第 8 条 + INPUT-2026-09-18-002 第④点澄清
- 时间: 2026-09-18
- 采集者: 助手（claude-sonnet-5，fork 子代理），在本仓库隔离 worktree（`.claude/worktrees/agent-a6241cbf7015c5080`，分支 `cr/20260918-org-chart-board`）执行；未接触共享 3000 端口生产服务
- 支撑对象: `CR-20260918-org-chart-board` CP-1、CP-2
- 可定位路径: 本文件；`src/lib/entities.ts`、`src/lib/entity-proposals.ts`、`src/lib/tools/entity-tools.ts`、`src/lib/tools/display-tools.ts`、`src/components/OrgChartBoard.tsx`、`src/components/DisplayScreen.tsx`、`src/lib/ui-events.ts`、`src/lib/types.ts`、`tests/entities.test.ts`、`tests/entity-tools.test.ts`、`tests/org-chart-board.test.tsx`、`tests/stage-reach.test.tsx`、`tests/tool-suites.test.ts`、`scripts/probe-org-chart-board.mjs`

## 1. 投入实现前的代码核对

- `src/lib/entities.ts`：`ENTITY_KINDS = ["competitor", "authority", "customer"]`——确认没有"人"这个概念；`Entity` 已有 `params: Param[]` 字段与配套的 `setParam`/`removeParam`/证据机制，是 CP-1 数据模型直接效仿的对象。
- `src/lib/tools/entity-tools.ts`：`propose_entity_update` 的证据闸逻辑（`entity.sources.some(host匹配)` 判定 trusted，否则走 `entity-proposals.ts` 的待采纳队列）是 CP-1 `propose_person` 复用的既有机制；同文件确认已有 `web_search`/`read_url`（`src/lib/tools/web-tools.ts`，REQ-F-033/034）——不需要为"自动寻找"这类能力重新发明网络请求。
- `src/lib/entity-proposals.ts`：`EntityUpdateProposal.kind: "field" | "param"`，`applyProposal`/`adoptProposal` 两处按 kind 分支——确认了往这里加第三个 kind 的确切改动点。
- `project/06_changes/CR-20260918-conference-preview-insight.md`（同批次并行 CR，分支 `cr/20260918-conference-preview-insight`）：已独立核实 `save_insight`/`show_insight` 完全通用，并在其"方案选项"里明确点名"后续 CR-20260918-org-chart-board 的洞察等任意主题"——确认本 CR"对话创建公司洞察"这一半不需要重复投入。
- `src/components/CompetitorBoard.tsx`（同批次并行 CR，分支 `cr/20260918-competitor-board`）：作为展示屏新视图（读 `/api/entities`、会话态 `DisplayStage` 切换）的直接实现模板，确认了 CP-2 的落地形状与既有先例一致。

## 2. 机器证据（本地实际执行，非预测）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| CR-20260918-org-chart-board（组织架构/研发阵型） | `tests/entities.test.ts` | 7 | 写入/frontmatter 一致、同名更新保留未给字段、证据按 `person:<name>` 归档并随删除清走、人员与技术参数各自独立命名空间不互相覆盖证据、手写半行兼容、条数与命名上限、简介允许含「\|」（跟 evidence 的 locator 同一处理）而结构字段的分隔符被消掉 |
| ⑨b/⑨b2/⑨c propose_person | `tests/entity-tools.test.ts` | 4 | 缺参数拒绝、来源不受信→待采纳且实体不变、同名第二次写入是更新不是重复、**待采纳提议经 `adoptProposal` 后正确写入人员**（验证了本 CR 对 `adoptProposal` 原有 kind 重建逻辑的修正——若未修正，person 提议会被错误路由进 `updateEntity` 并因字段名不在白名单而报错）、对象不存在/链接非法作失败回喂 |
| ① 工具描述与注册表 | `tests/entity-tools.test.ts` | 1（改） | `propose_person` 出现在联网关闭时的可用工具列表里，位置正确 |
| TEST-480 组织架构/研发阵型看板 | `tests/org-chart-board.test.tsx` | 6 | 按公司分区、同公司按团队分组、无团队归入"其他"、空态如实说明、无头像时姓名首字兜底、有头像时渲染 `img`、读取失败给出 `role="alert"` 提示 |
| ⑥ 展示屏阶段可达性 | `tests/stage-reach.test.tsx` | 1（新增） | 收到 `org-chart-board` 阶段事件切到看板、`opening` 能退回标题页（非单程票）、持久化的 `insight` 仍压过该阶段 |
| show_org_chart_board 工具事件 | `tests/tool-suites.test.ts` | 1（新增） | 执行后返回 `events:[{type:"display_stage",stage:"org-chart-board"}]`，`store.getDisplayState().kind` 仍为 `"home"`（不新增持久态） |

`npx tsc --noEmit -p .`：**0 错误**（2026-09-18，本机）。

`npx vitest run`（全量）：**91 个测试文件、850 个用例全绿**（2026-09-18，本机，二次确认）。第一次全量跑出现 3 个失败：

1. `tests/wake-settings.test.tsx` 1 例——与本 CR 无关（唤醒设置功能，本 CR 未触碰任何相关文件），单独重跑未复现，判定为多文件并发跑测试时的资源争用（本会话此前的 Wave 1 fork 已记录过同类现象）。
2. `tests/floating-chat.test.tsx`「④ a registration receipt that excludes files says so」——单独重跑通过；本 CR 未触碰 `FloatingChat.tsx`，与 Wave 1 `CR-20260918-competitor-board` 证据文件记录的同一个已知资源争用现象一致。
3. `tests/ingest-extract-chain.test.ts`「extract_fields 失败时的 summary 带得走原因」——**单独重跑仍然失败，这是本 fork 真实引入的一处回归，已定位并修正**：该测试文件用固定数组下标 `createEntityTools({...})[5]` 取 `extract_fields` 工具，本 CR 在数组中间插入了新工具 `propose_person`（下标 4），导致下标 5 从 `extract_fields` 变成 `fetch_source`，测试因此拿错工具、断言失败。修正为按工具名 `.find()` 查找，不再依赖数组下标；顺带把 `tests/entity-tools.test.ts` 里同样存在的固定下标解构也一并改成按名查找，防止未来再有工具插入时重犯同一个错误。修正后二次全量跑（见上）91 文件全绿，**含这两处修正过的文件本身**。

## 3. 真实入口（协调会话已执行，结果 PASS）

- 来源: `scripts/probe-org-chart-board.mjs`
- 时间: 2026-09-18
- 采集者: 协调会话（claude-sonnet-5），针对用户本机 `npm run build:local && npm run serve:local`（端口 3000，全部 7 条 2026-09-18 批次 CR 均已合并）的真实生产构建服务
- 输出:
  ```
  ①流式结束=true，组织架构看板出现=true
  ②流式结束=true，回复提到待采纳/测试字样=true
  已尝试清理探针写入的待采纳测试记录（若失败需人工在看板上核对并清理）。
  PASS 组织架构看板可由对话唤起；propose_person 在无可信来源时正确走待采纳分支
  ```
- 判定: **PASS**

**清理独立核实**：探针自己只是"尝试"清理（通过对话请求模型忽略测试提议），不保证真的成功。协调会话额外直接查询 `GET /api/entities`，确认 `pending` 与 `proposals` 两个数组均为空——"维谛"对象上没有留下任何编造的人名/职位测试痕迹，清理是真的成功，不是探针自己说了算。

## 4. 局限（如实登记）

- "对话创建公司洞察并固化显示"这一半（用户第 8 条后半句）本 CR 未新增任何测试——理由见 CR 文档「问题经过」，既有 `save_insight`/`show_insight` 的通用测试已完整覆盖，重复覆盖不产生新的保障。
- `propose_person` 的证据闸只能核实"来源是否已在该公司登记的采集源之列"，不能核实来源内容本身是否准确描述了真实的组织架构——这与既有 `params`（技术参数）面对的局限完全相同，是这套评审闸设计上早已接受的边界，不是本 CR 新引入的缺口。
- 头像 (`avatarUrl`) 是外链，本 CR 不处理链接失效、不做本地缓存或离线可用性——见 CR 文档「非目标」。
- "组织架构树状图"（带汇报关系、可视化连线）未实现，当前是按团队分组的卡片列表——见 CR 文档「方案选项」H。
- `DisplayScreen.tsx` 里本 CR 新增的渲染分支沿用的是本 fork 实现时 `main` 上的旧容器约定（`fixed inset-x-0 top-0` + 显式 `bottom` 让位样式），因为本 fork 看不到尚未合并的 `CR-20260918-unified-floating-console` 把这一约定改为 `fixed inset-0` 的改动——协调会话合并全部并行分支后需要手工同步这一处，详见 CR 文档「并行事项说明」。
