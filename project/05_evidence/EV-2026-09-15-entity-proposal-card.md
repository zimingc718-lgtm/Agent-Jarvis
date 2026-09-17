# EV-2026-09-15-entity-proposal-card

- 来源: 用户 INPUT-2026-09-15-029 第 2 条后半（友商卡片「支持对话阅读，编辑」）
- 时间: 2026-09-15（需求提出）–2026-09-16（实现、说明书落点、机器证据与真实入口核对，含一次真实模型调用）
- 采集者: 助手（claude-sonnet-5），在本仓库真实工作树上执行；真实入口部分在用户自己那台服务器（端口 3000）
- 支撑对象: `CR-20260915-entity-proposal-card` CP-1
- 可定位路径: 本文件；`src/lib/types.ts`（`entity_pending` 事件）、`src/lib/tools/entity-tools.ts`（`propose`/`proposeUpdate`）、`src/components/EntityProposalCard.tsx`、`src/components/FloatingChat.tsx`、`scripts/probe-entity-proposal-card.mjs`

## 1. 现场核对：三件事里已经有两件成立

用户原话「支持对话阅读，编辑与沟通」——核对代码：

1. **「阅读」**——`read_entity` 工具在本 CR 之前已存在。不产生变化点。
2. **「沟通」**——`INPUT-2026-09-15-031` 决策 10 已裁定不做。
3. **「编辑」**——`propose_entity`/`propose_entity_update` 两个提议工具已存在，且已经守住「模型只能提议，不能直写」（REQ-F-072 ①）。缺的是提议出现后，用户能不能不离开对话就处理掉它：改前 `entity_pending` 事件只触发一句纯文字通知，没有按钮。

## 2. 机器证据

| 用例 | 条数 | 守住的事 |
|---|---|---|
| `entity-tools.test.ts` ⑪（改写） | 1 | `propose`/`proposeUpdate` 的事件带出 `name`/`id`/`field`/`value`；直写（同域自动生效）不带事件 |
| `entity-proposal-card.test.tsx` ①–⑤ | 5 | 采纳/忽略调用与看板相同的路由；成功显示对应结果并派发看板刷新事件；失败原样显示错误；网络异常显示网络错误；处理中按钮禁用不连发 |
| `floating-chat.test.tsx`（改写 1 + 新增 1） | 2 | 标识齐全渲染带采纳按钮的卡片，两种 `what` 各自文案正确；标识不全（`extract_fields` 批量场景）退回纯文字通知、不出卡片 |

`npx vitest run tests/entity-tools.test.ts tests/entity-proposal-card.test.tsx tests/floating-chat.test.tsx`：**60 个用例全绿**。`npx tsc --noEmit`：0 错误。全量 `npx vitest run`：**819 个用例全绿**（较 CR-D 收口时的 813 增 6）。`node scripts/check-module-graph.mjs`：0 环 0 违规。`node scripts/ui-contract.mjs`：53 项全过。`python tools/governance.py check-ui-route`：本 CR 的 `机器（UI）` 路线 PASS（6 条中的新一条）。`check-tables`/`check-doors`/`check-ids`/`check-test-commands`/`check-hygiene`：均 PASS。

## 3. 真实入口（用户自己那台，端口 3000）

`npm run build:local` 重建 `.next-prod`，重启 `serve:local`，`curl http://localhost:3000/api/knowledge`
确认 200 后开始。

`node scripts/probe-entity-proposal-card.mjs`（1440x900 真实 Chromium，真实 DeepSeek API 调用两次）：

```
新对象卡片出现=true，点采纳后显示已采纳=true，真的出现在看板=true
修改提议卡片出现=true，点忽略后显示已忽略=true，真实字段未被改动=true
PASS 两条路线都在真实对话框里出现了可操作的卡片：新对象采纳后真的上了看板（已清理）；字段修改忽略后真实对象未被改动
```

采集时间 2026-09-17（本地服务器，端口 3000），采集者：助手（claude-sonnet-5）。

**过程记录（如实登记）**：

1. 对话历史跨刷新持久（REQ-F-013）——这是产品本身的既有行为，不是缺陷。探针第一版每次都在同一条持久对话里追加消息，重复跑几次后同一张卡片的 `aria-label` 不再唯一。改为每次先点「新对话」按钮再开始。
2. 改完「新对话」后，第二条消息（`propose_entity_update`）仍然没有触发——用一个独立的诊断脚本捞出页面全文才发现：第一条消息发完后底部按钮变回了「发送」而不是「新对话」，说明第二条消息**根本没有被提交**，模型从未收到它。根因是探针用 `box.press("Enter")` 提交，这条路径在这次会话的时序下不可靠；改成显式点击「发送」按钮（按钮当下显示什么本身就是「现在能不能发」的信号）后，两条路线都稳定通过。这是探针脚本自身的问题，不是 `EntityProposalCard`/`entity_pending` 事件链路的缺陷——整个排查过程中，看板上的真实数据（`台达-delta` 的 `change` 字段、跟踪对象总数）始终没有被动过。
3. 诊断过程中一个独立诊断脚本成功触发了一次真实的 `propose_entity_update`（验证了链路本身是通的），但脚本本身没有走到「忽略」那一步，在待采纳队列里留下一条明显是探针测试值的提议；发现后已用同一条 `DELETE /api/entities/proposals/<id>` 路由手动清理，采集完毕后核对 `proposals` 计数回到 0。

真实入口的核心结论没有变：卡片链路（模型调用 → 事件 → 卡片渲染 → 点击 → 路由调用 → 状态更新 →
看板同步）是通的，问题始终出在探针脚本自己的提交方式上，已经修好并在 `scripts/probe-entity-
proposal-card.mjs` 里留下代码注释说明。

## 4. 局限（如实登记）

- `extract_fields` 的批量提议场景不出卡片，理由见 CR 文档「方案选项」C/D 的否决记录。
- 卡片是会话内瞬时产物，不写回持久化的消息记录——用户刷新页面或换一台设备回来，看到的仍是（如今未变的）看板待采纳队列，不会在转录区里重新出现这张卡片。这与它取代的纯文字通知是同一个局限，不是本 CR 引入的退步。
- `check-ui-route` 是文件级核对——`tests/floating-chat.test.tsx` 里有大量其它用例本就用 `fireEvent`，是 v1 已知粒度限制（CR-20260915-process-hardening-flow 已记录同类情况）。
