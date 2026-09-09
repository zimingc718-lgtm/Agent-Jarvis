# EV-2026-09-08-functional-review-retrospective

- 证据 ID: EV-2026-09-08-functional-review-retrospective
- 来源类型: 代码审查 + 测试执行
- 来源路径: 本仓库 `src/`、`tests/`、`scripts/`，会话审查记录
- 采集时间: 2026-09-08
- 采集者: agent-jarvis-00 (Claude Code session)
- 支撑对象: CR-20260908-floating-chat-functional-fixes，REQ-F-005/006/007/009/013，AI_STANDARD 第 2/7 节

## 1. 背景

首版实现（CR-20260908-floating-llm-chat）在 `test-results.json` 中 TEST-001..013 全部标记 PASS、真实入口冒烟 PASS、发布目标 0.1.0。用户随后要求逐项审视功能，审查发现 14 处实现与已批准需求不符或不完整，其中若干条对应的验收标准从未被真正验证。

## 2. 缺陷与根因（自下而上）

| 观察（事实） | 归因（根因） |
|---|---|
| `/api/providers/test` 路由体为固定 `{ok:true}`，从不访问 provider；TEST-006 却映射到 `adapters-stream.test.ts`（一个相邻单测）。 | **测试覆盖以相邻单测冒充端点覆盖。** 测试矩阵按“测试 ID → 命令”登记，没有强制“命令必须执行该需求点对应的真实入口”。 |
| `/api/chat/stream` 接收 `model` 参数、`/api/conversations/recent` 端点存在，但前端从不发送 `model`、从不调用 recent 端点。REQ-F-006“切换模型”、REQ-F-013“刷新恢复”据此被视为已实现。 | **契约悬空（orphan contract）。** 服务端新增字段/端点没有被要求验证“有真实消费者”，前端能力没有被要求验证“可观察”。两端各自单测通过，拼起来是死路。 |
| 停止生成只置前端 `stopRequested` 标志，不 abort fetch；服务端继续流式、落库 `status=complete`。TEST-009 是 `chat.ts` 纯函数单测，断言 abort 分支，但从未经真实 fetch/HTTP 验证。 | 同上：**用户可观察行为（停止后服务端真的停）没有真实入口断言。** |
| `createStore` 在缺 `JARVIS_SECRET_KEY` 时静默回退到字符串 `"test-secret-key"` 加密真实 API Key。`crypto.ts` 的 fail-fast 因此永不触发。 | **安全相关配置存在静默降级默认值。** 没有“安全配置缺失必须 fail-fast”的硬性规范。 |
| `JARVIS_SECRET_KEY` 变更后 `decryptSecret` 抛错未捕获 → 对话 500 / Provider 静默不可用。 | 错误路径未设计：解密失败没有映射到用户可读状态。 |
| `saveProvider` 固定 `INSERT`，重复保存产生多行；无 `PATCH/DELETE`。REQ-F-007 明确要求“编辑、启用、停用”。 | **验收标准未逐条拆成断言。** “可新增、编辑、启用、停用、测试”被当作一个整体，只有“新增”被测。 |

## 3. 已实施修复

见 `CR-20260908-floating-chat-functional-fixes.md` FIX-01..FIX-14。全部修复均绑定真实入口证据（route handler 测试 / smoke / e2e），不再以纯函数单测替代。

## 4. 固化到流程的控制（防止复发）

写入 `docs/AI_STANDARD.md` 第 2 节新增原则与第 7 节，`project/04_tests/测试说明书.md` 覆盖规则，`tools/governance.py ui`：

1. **真实入口对应原则**：测试矩阵每一行的“命令”必须执行该覆盖需求点对应的真实入口（HTTP 路由 / 渲染组件 / CLI），不得用相邻单元测试或纯函数断言充数。相邻单测可作为补充，不可作为该需求点的唯一证据。
2. **契约无悬空原则**：新增 API 字段/端点必须在同一变更内提供并验证真实消费者；新增前端能力必须有真实入口可观察断言。任一端单独通过不构成需求完成证据。
3. **安全配置显式失败原则**：加密密钥、鉴权密钥等安全相关配置缺失时必须 fail-fast，禁止静默降级默认值；相关错误路径必须映射到用户可读状态。
4. **验收标准逐条断言原则**：G2/G3 复核时，需求验收标准中的每个可观察动作（例如“新增、编辑、启用、停用、测试”）必须各自对应至少一条测试断言，评审记录须逐条列明。

## 5. 验证

| 命令 | 结果 | 摘要 |
|---|---|---|
| `npm test` | PASS | 15 文件 / 61 测试 |
| `npm run test:smoke` | PASS | 编辑不重复行、真实 /models 测试、双轮 ctx=2→4、刷新恢复、禁用/删除 |
| `npm run test:e2e` | PASS | 2 Chromium 用例：多轮 + 刷新恢复；停止（服务端 abort，落库 stopped） |
| `npm run build` | PASS | 10 路由 |
| `node scripts/ui-contract.mjs` | PASS | 40 规则 0 FAIL / 4 WARN |
| `node scripts/ui-contract.mjs --live` | PASS | 静态 40 + live 16 通过（axe-core 未安装则跳过） |
| `python -m unittest tests.test_governance` | PASS | 12 |
| `python tools/governance.py ui` | PASS | UI_CONTROL_PASS |
