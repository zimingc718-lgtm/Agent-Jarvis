# CR-20260911-tool-availability

- 级别: L2（修正 REQ-F-040 ③ 的一处语义错误 + 两处基础设施缺陷。无新增需求、无新增依赖、无新增信任面、无 schema 变更）
- 提出人: user（P6 运行反馈：「模型要联网的时候，要让模型可以调用起来联网搜索」）
- 状态: APPROVED（快车道，DEC-021 ①：全部 CP 为双向门且每个 CP 的发现方式都是一条机器检查）
- 占用 ID: 无（不创建 DEC / TASK / TEST；缺陷守卫并入既有 TEST-063、TEST-065、TEST-077）
- 评审模型: 快车道（CR 头部 + 证据 + 门禁 + snapshot；不需要 CP 矩阵与四角色意见）
- 影响需求: 修正 REQ-F-040 ③ 的降级触发条件（「未探测」不再等同「不支持」）；REQ-F-033/034 的可达性由此恢复。不新增、不删除任何 REQ
- 影响模块: MOD-CHAT（`toolsUsable` 判定 + 能力回写）、MOD-ADAPTER（`tools` 字段回退）、MOD-GOVERNANCE（无代码变更，仅受行尾规范化影响）
- 影响任务: 无新增（修正 TASK-063 与 TASK-071 的既有实现）
- 影响测试: 无新增 TEST 编号；`tests/chat-stream.test.ts` +2、`tests/adapters-tools.test.ts` +2 缺陷守卫；`tests/visual.test.ts` 由「无法加载」恢复为 3 PASS
- 当前证据: `project/05_evidence/EV-2026-09-11-tool-availability.md`
- 方案选项:
  - A. 让用户去「模型」里点一次「测试」再用——拒绝。把实现缺陷转嫁为用户必须知道的隐藏步骤；用户报告的正是「调不起来」，多一个前置动作不是修复。
  - B. **`unknown` 乐观尝试工具 + Provider 拒绝 `tools` 时回退一次并记住 `no` + 用实际结果回写能力**——选中。
  - C. 启动时对所有 Provider 批量探测——拒绝。每个 Provider 一次额外出站调用与 token 开销，且探测结果会因换模型而失效，收益不抵成本。
- 选择理由: 选 B。①**`unknown` 是每个 Provider 的初始状态**，而首版把它与 `no` 同等处理，导致开箱即用时工具**完全不注册**——模型再想联网也调不起来，这正是用户报告的现象。用户终裁 4 定的是「Provider *不支持* 时提醒」，「尚未探测」不在其语义内，是我实现时的错误合并。②回退机制与既有的 `stream_options` 回退同形（`shouldRetryWithoutTools`），不引入新范式。③用「实际发生了什么」回写能力（真调起工具 → `yes`，字段被拒 → `no`），比预先批量探测更准也更省。
- 回滚方式:
  - 运行回滚：`git revert` 本 CR 的实现提交即可——`toolsUsable` 回到 `support === "yes"`，adapter 去掉 `tools` 回退分支与 `shouldRetryWithoutTools`，`recordToolSupport` 回调移除。**无 schema 变更、无数据变形**，`providers.tool_support` 里已写入的值对旧代码仍然合法（旧代码只读 `yes`）。
  - `.gitattributes` 回滚：删除该文件并 `git add --renormalize .`，行尾回到 `core.autocrlf` 的行为。
  - 回滚后重跑 `npm test`、`npm run test:ui-contract`、`verify | check-changes | check-doors | check-ids` 并重新 `snapshot`。
- 验收条件:
  - 未探测的 Provider **必须收到 tools 定义**（`tests/chat-stream.test.ts`「未探测的 Provider 仍然注册工具」）；
  - 明确为 `no` 的 Provider 降级为纯对话并发 `tools-unavailable`（同文件下一条）；
  - Provider 拒绝 `tools` 字段时回退一次且回复仍然送达（`tests/adapters-tools.test.ts`）；
  - `tests/visual.test.ts` 恢复加载并 3 PASS；
  - 全量：`npm test` / `ui-contract` / `smoke` / `e2e` / `build:verify` / `tsc` / 治理单测 全绿；`gate g3|g3.5` PASS。
- 评审记录: 快车道，无四角色评审。变化点、门与发现方式见下表；证据见 EV。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。全部为双向门且各有一条机器检查 —— 满足 DEC-021 ① 的快车道准入。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **`未探测` 不再等同 `不支持`**：`toolsUsable` 由 `support === "yes"` 改为 `support !== "no"`。`unknown` 是每个 Provider 的初始状态，首版把它与 `no` 合并，导致开箱即用时工具完全不注册、模型无法调起 `web_search` —— 用户终裁 4 说的是「不支持时提醒」，不含「尚未探测」 | REQ-F-040 ③ | 缺陷修复 | 双向 | 机器：`tests/chat-stream.test.ts`「未探测的 Provider 仍然注册工具，模型可以调起来」断言 `input.tools` 非空 |
| CP-2 | 模块 | Provider 拒绝 `tools` 字段时**回退一次不带该字段**并发 `tools-unavailable`（`shouldRetryWithoutTools`，与既有 `stream_options` 回退同形）；乐观尝试因此不会把不支持工具的 Provider 变成坏 Provider | REQ-F-040 ③、REQ-F-012 | 缺陷修复 | 双向 | 机器：`tests/adapters-tools.test.ts`「4xx 指向 tools 时回退一次并发出 tools-unavailable」 |
| CP-3 | 模块 | 用**实际结果**回写能力：本轮真调起过工具 → `yes`，`tools` 字段被拒 → `no`，其余情形保持 `unknown` 下轮再试。未探测的 Provider 一轮后收敛，不必反复猜 | REQ-F-040 ①② | 新增 | 双向 | 机器：同 CP-1 用例尾部断言 `tool_support` 被写为 `{llama:"yes"}` |
| CP-4 | 模块 | **新增 `.gitattributes` 固定行尾为 LF**。`core.autocrlf=true` 在 checkout 时改写行尾，已造成两处实际故障：① `verify` 对一棵 `git status` 干净的树报 50 个 `BASELINE_CHANGED`（基线按字节哈希）；② vite 的 SSR transform 把 import 提升到 shebang 之上，CRLF 下其 shebang 剥离失效，`#!/usr/bin/env node` 落到产物第 8 行变成语法错误，`scripts/ui-contract.mjs` 在 vitest 下无法加载（`node` 直接跑却正常） | REQ-NF-004 | 缺陷修复 | 双向 | 机器：`tests/visual.test.ts` 导入 `ui-contract.mjs`——CRLF 一旦回来该套件立刻加载失败；`governance.py verify` 覆盖基线面 |
| CP-5 | 模块 | 剥掉 19 个文件的 UTF-8 BOM。PowerShell 5.1 的 `Set-Content -Encoding utf8` 写 BOM，`node` 与 `tsc` 容忍、vitest 的 transform 不容忍 | REQ-NF-004 | 缺陷修复 | 双向 | 机器：`npm test` 的套件加载本身即守卫（带 BOM 的测试文件无法解析） |

（本 CR 无 R2/R3/R4 矩阵：快车道按 DEC-021 ① 免除 CP 矩阵与四角色意见，机器检查一条不少。）
