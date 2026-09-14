# CR-20260914-probe-failure-is-not-no

- 级别: L2（改变工具能力探测的判定与落库条件，直接影响每一轮是否注册工具。无 schema 变更、零新增依赖）
- 提出人: 助手 2026-09-14 在用户自己那台机器上跑真实对话时发现：两个 Provider 的工具探测都被记成「不支持」，而它们都支持工具调用
- 状态: APPROVED（R1 人工终裁：用户 2026-09-13 授权按业界最佳实践代为决策并闭环，INPUT-2026-09-13-027）
- 占用 ID: DEC-260
- 评审模型: 快车道（DEC-021 ①：两个 CP 均双向门且均有机器检查）
- 影响需求: 无（REQ-F-040 ② 的判定收紧，不改条款）
- 影响模块: MOD-PROVIDERS（`src/lib/adapters.ts`、`/api/providers/test`）
- 影响任务: **小改** TASK-011（Provider 能力探测）
- 影响测试: TEST-011
- 当前证据: `project/05_evidence/EV-2026-09-14-live-turns.md`
- 方案选项:
  - A. **失败回 `unknown` 且不落库**（选中）：只有对方正常应答、模型没发 tool_calls 时才是 `no`。
  - B. 失败时重试几次再判——否决。重试解决不了「一次失败被写成永久事实」这个根，只是把窗口拉长。
  - C. 保持现状，让用户自己重点「测试」——否决。用户根本不知道要重点：界面只会说「当前模型不支持工具调用」，看不出那是一次超时的结论。
- 选择理由: 选 A。①`unknown` 这一档本来就有，`runChatTurn` 对它的处置是「先按支持来试」（CR-20260911-tool-availability 已裁），缺的只是**别把失败说成结论**；②不落库是关键——`no` 一旦写进 `providers.tool_support`，此后每一轮都按不支持走；③改动 12 行，两处。
- 回滚方式: `git revert` 本 CR 的提交。探测回到「失败即 no」。库里已被清掉的 `tool_support` 不会自动回填，下次点「测试」会重新写入。无迁移。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 机器检查：TEST-011 增三例（429 → unknown、超时 → unknown、正常应答无 tool_calls → no）。
  - **真实入口**：在用户自己那台服务器上重跑同一条探测，改前写回 `no`、改后回 `unknown` 且库里保持空（证据：TEST-011）。
- 评审记录: 快车道。两个 CP 都能被路由测直接断言。
- R1 终裁: 已完成 | 用户 | 2026-09-14

## 问题陈述

2026-09-14 在用户自己那台机器上跑真实对话，撞出一串事实：

| 观察 | 值 |
|---|---|
| 「测试连接」（GET /models） | 两个 Provider 都 `Connection OK` |
| 工具探测 | 两个都 `no`，库里存着 `{"deepseek-chat":"no"}`、`{"gpt-5":"no"}` |
| 实际能力 | 这两个模型**都支持工具调用**（当天用 gpt-5 真跑通了三步工具循环） |

`probeToolSupport` 把**任何**失败都当成 `no`：超时、非 2xx、抛异常，一律 `return "no"`。而 `no` 会被写进 `providers.tool_support`，此后每一轮 `toolsUsable = support !== "no"` 都按不支持走。

**一次网络抖动，就能把工具能力永久关掉**，而界面只会说「当前模型不支持工具调用」——用户看不出那是一次超时的结论，也就不会想到去重点一次「测试」。

`unknown` 这一档本来就有，`runChatTurn` 对它的处置早已裁定为「先按支持来试」。缺的只是别把失败说成结论。

## 实测（2026-09-14，用户自己那台服务器）

```
改前：清空 tool_support → 点一次「测试」→ {"toolSupport":"no"} → 库里又写回 {"deepseek-chat":"no"}
改后：清空 tool_support → 点一次「测试」→ {"toolSupport":"unknown"} → 库里保持 NULL
```

改后同一台机器用 gpt-5 跑真实对话，工具循环正常：`list_entities → read_entity → propose_entity_update`。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 架构 | **失败不是结论**：超时、非 2xx、异常一律回 `unknown`，只有正常应答且无 tool_calls 才是 `no` | DEC-260 | 缺陷修复 | 双向 | 机器：TEST-011（429 → unknown、超时 → unknown、正常应答无 calls → no） |
| CP-2 | 模块 | **`unknown` 不落库**：把一次失败存成永久事实，正是这个缺陷的伤害来源 | DEC-260 | 缺陷修复 | 双向 | 机器：TEST-011；**真实入口**：改前写回 `no`、改后库里保持空（证据：TEST-011） |

## 附带发现（不属本 CR，另行报告）

同一轮实测里还撞到两件事，都已如实记进 `EV-2026-09-14-live-turns.md`：

1. **DeepSeek（优先级 0，默认 Provider）当前不可用**：上游返回 200 之后 60 秒一个字节都不发，`Provider stream timed out`。用假密钥探同一端点 401 秒回，网络与路径都正常；换 OpenAI 同一问题 3.6 秒答完。**用户现在打开应用发消息，默认会等 60 秒再看到超时。**
2. `providers.tool_support` 里那两条 `no` 是坏探测写下的，已清空（改后不会再被写回）。
