# EV-2026-09-18-competitor-board

- 来源：`CR-20260918-competitor-board` 实施（隔离 worktree，四条 Wave 1 CR 之一）
- 时间：2026-09-18
- 采集者：Claude（模块开发 + 测试角色，fork 子代理）
- 支撑对象：TASK-456、TEST-456、REQ-F-243、DEC-349
- 可定位路径：本文件；提交见本 CR 分支 `cr/20260918-competitor-board`（提交哈希以 `git log` 为准，落于本次实施的最后一次提交）

## 1. 验证结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误 |
| `npx vitest run tests/tool-suites.test.ts tests/stage-reach.test.tsx tests/competitor-board.test.tsx` | **23 passed / 3 files** |
| `npx vitest run`（全量） | 全绿，唯一例外见下「测试基础设施噪音」一节，与本 CR 无关 |
| **真实入口** | 未执行——本 CR 按 fork 边界禁止启动或探测共享的 3000 端口生产服务；`scripts/probe-competitor-board.mjs` 已写好、未运行，留给合并会话或用户在 `npm run build:local && npm run serve:local` 上执行 |

## 2. 实现落点

| 任务 | 落点 |
|---|---|
| TASK-456 | **新增 `src/components/CompetitorBoard.tsx`**：读 `GET /api/entities`（零新增接口），筛 `kind === "competitor"`，按各自 `params` 名称并集排维度行，逐家一列，缺值占位符 `—`；四态（加载中/读取失败/零友商/友商无参数）各自有说明文案。**`src/lib/tools/display-tools.ts`** 新增 `show_competitor_board`，与既有 `show_board` 同形——先清持久态 `display_state` 回 `home`，再发 `display_stage` 事件。**`src/lib/ui-events.ts`** 的 `DisplayStage` 与 **`src/lib/types.ts`** 的 `ChatDelta.display_stage` 变体并列新增 `"competitor-board"`（两处独立声明的已知重复模式，已同步改）。**`src/components/DisplayScreen.tsx`**：新增 import，`stage` 状态类型改用 `DisplayStage`，事件监听收纳新取值，新增对应渲染分支。 |

## 3. 设计决策：评价总结如何产生（CR 要求显式记录，不得默认假设）

**决策**：逐维度"评价总结"不设新字段、不持久化，由模型在对话中基于当下的 `params` 数据现场生成。

**理由**：
1. 模型已经拥有 `list_entities`/`read_entity` 工具，能看到与本看板完全相同的一份 `params` 数据——现场作答不需要任何额外的数据管道。
2. 评价是判断而非事实：谁给出的、什么时候可能过期、要不要跟着参数变化自动失效，这些问题一旦落库就绕不开。
3. 若预先生成并存储一份评价，用户后续修改某友商的参数后，已存储的评价会与最新数据脱节，而系统没有机制知道该评价"已过期"——这是比"不提供预置评价"更差的用户体验（一份看起来权威、实际过时的结论）。
4. 反例参照：`entities.ts` 的 `ParamState`（`unknown`/`meets`/`unmet`）本身就是"我方是否满足某规格"这个需要持久化的判断——但那是与"我方"这一个固定参照系的比较，值域小、更新触发点明确（用户自己校对）；"友商之间谁更优"没有固定参照系、维度组合是任意的（N 家友商 × M 个维度），持久化的组合爆炸与评价保鲜问题在跨对象对比场景下不成立，是两类不同的问题。

**因此**：本 CR 的组件与工具都不引入新的存储字段，`CompetitorBoard.tsx` 的表格只渲染已注册的原始参数值；组件内的说明文案明确引导用户"逐维度的评价请直接在对话里问"。此决策同时记入 CR 文档「方案选项」C（否决持久化评价）与架构说明书待落笔的 DEC-349（见 `SPEC_DRAFT.md`）。

## 4. 测试基础设施噪音（如实记录，非本 CR 引入）

全量 `npx vitest run` 单次运行中 `tests/floating-chat.test.tsx` 的第 ④ 个用例出现一次 20 秒超时。单独重跑该文件（`npx vitest run tests/floating-chat.test.tsx`），全部 45 个用例（含此前超时的那个，实际用时 19.3 秒，压线但在限内）通过。本 fork 未改动 `floating-chat.test.tsx` 或其覆盖的任何源文件；现象与四个并行 worktree 同时跑重型测试套件的资源争用一致，判定为环境噪音而非回归，不需要修复动作。

## 5. 已知限制（如实登记）

1. **真实入口未执行**：`scripts/probe-competitor-board.mjs` 已按既有探针的写法（真实浏览器、真实对话触发、核对真实 `/api/entities` 数据）写好，但按 fork 边界要求未运行。它不伪造"零友商"或"友商无参数"两种边界场景（伪造需要真的改动用户账下的真实对象，与既有探针"不留痕迹"的原则冲突）——这两种边界态已由 `tests/competitor-board.test.tsx` ②③ 用注入的 `load()` 覆盖，探针只核对真实数据路径本身（列头、共享维度、未登记占位符）。
2. **`DisplayScreen.tsx` 的并行改动面**：本 CR 与同批并行的 `CR-20260918-unified-floating-console` 都会改这个文件。本 CR 的改动集中在新增 import、`stage` 类型收紧、事件分支增加一个取值判断、新增一段独立渲染分支；据已知信息，`unified-floating-console` 改的是各视图容器的 `bottom` 布局样式，行区不重叠，但仍需协调会话在实际合并两条分支时确认 diff 不冲突。
