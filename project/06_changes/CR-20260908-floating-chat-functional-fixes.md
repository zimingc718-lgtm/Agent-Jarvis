# CR-20260908-floating-chat-functional-fixes

- 级别: L2
- 提出人: user
- 状态: APPROVED
- 占用 ID: TASK-009..014, TEST-014..018 （由 CR-20260910-risk-scaled-gates 回填，只登记本 CR **创建**的 ID，不含其引用或修订的既有 ID；DEC-001..014 的创建归属无法从现有记录复原，故未登记。）
- 评审模型: pre-R1234（旧 G0/G1/G2/G3/G3.5/G4；CR-20260909-consensus-review-gates 起改为 R1–R4 + G3/G3.5/G4，不追溯本 CR）
- 影响需求: REQ-F-005、REQ-F-006、REQ-F-007、REQ-F-009、REQ-F-013、REQ-NF-002（均为实现修正，不新增需求；澄清 REQ-F-006/013 的验收在 UI 上必须可观察）
- 影响模块: MOD-ADAPTER、MOD-CHAT、MOD-CHAT-UI、MOD-PROVIDER、MOD-SETTINGS-UI、MOD-DB
- 影响任务: TASK-009 至 TASK-014（见 `project/03_modules/模块任务开发说明书.md`）
- 影响测试: TEST-006 重挂真实端点；新增 TEST-014 至 TEST-018；TEST-009、TEST-012、TEST-013 断言加强
- 当前证据: `project/05_evidence/EV-2026-09-08-functional-review-retrospective.md`、`project/05_evidence/test-results.json`
- 方案选项: A. 仅记录缺陷；B. 一次性修复全部功能缺陷并补齐真实入口测试；C. 分多个小 CR 逐条修
- 选择理由: 选 B。缺陷相互耦合（会话续接依赖 conversationId、停止依赖真实 abort、Provider 生命周期依赖 upsert），拆开修会产生中间不一致状态；且用户明确要求“全修改”。
- 回滚方式: 回退 `src/lib/{store,chat,adapters,types}.ts`、`src/components/{FloatingChat,ModelSettings}.tsx`、`src/app/page.tsx`、`src/app/api/**` 到上一基线；删除新增路由 `src/app/api/providers/[id]/route.ts`、`src/app/api/conversations/[id]/messages/route.ts`；删除 `scripts/ui-contract.mjs` 及新增测试文件；恢复上一份 `测试说明书.md`、`模块任务开发说明书.md`、`test-results.json`；重跑 `python tools/governance.py verify` 并重新 snapshot。SQLite schema 未变（仅新增幂等索引），无数据迁移回滚。
- 验收条件:
  - `npm test`（含 `tests/visual.test.ts` = ui-contract 静态层）全部 PASS。
  - `npm run test:smoke` 通过：Provider 编辑不产生重复行、真实 `/models` 连接测试、双轮对话上下文（ctx=2 → ctx=4）、刷新经 `/api/conversations/[id]/messages` 恢复、禁用/删除生效。
  - `npm run test:e2e` 通过：多轮对话 + 停止（服务端 abort，落库 status=stopped）+ 刷新恢复。
  - `node scripts/ui-contract.mjs`：0 FAIL。
  - `python tools/governance.py verify` 与 `python tools/governance.py ui` 通过。
- 评审记录:
  - 产品 owner：确认修复未超出已批准需求范围；REQ-F-006“Provider 与模型切换”、REQ-F-013“刷新恢复”从“接口存在”提升为“UI 可观察”，属验收澄清非新增。APPROVED。
  - 架构角色：确认 adapter 统一到 `/chat/completions`、SSE `start` 事件回传 conversationId、Provider `[id]` 子路由的边界划分与 MOD 划分一致。APPROVED。
  - 模块开发角色：确认 TASK-009..014 可独立验证、无隐藏业务扩展。APPROVED。
  - 测试角色：确认每条修复都有真实入口断言（route handler 测试 / smoke / e2e），不再以相邻单测替代端点覆盖。APPROVED。

## 修复清单

| ID | 缺陷 | 修复 | 覆盖需求 | 真实入口证据 |
|---|---|---|---|---|
| FIX-01 | 每轮新建会话、模型无上下文 | `runChatTurn` 接收 `conversationId`，复用会话并回放 `complete/stopped` 历史 + system prompt | REQ-F-013 | smoke ctx=2→4；e2e “Human ctx=2 / ctx=4” |
| FIX-02 | 停止仅停前端，服务端继续、落库 complete | `FloatingChat` 用 `AbortController`；`request.signal` 触发服务端 `stopped` 落库 | REQ-F-005 | e2e “Stop halts the stream server-side”（断言 status=stopped） |
| FIX-03 | assistant 气泡 id 硬编码，多轮串写 | 每轮 `crypto.randomUUID()`，只更新在途气泡 | REQ-F-004 | `tests/floating-chat.test.tsx` 多轮断言 |
| FIX-04 | 错误文本被存成 assistant 正常回复 | 错误仅走 SSE `error` 事件；落库为已到达的部分文本 + `status=error`，不回放进上下文 | REQ-F-004 | `tests/chat-stream.test.ts` |
| FIX-05 | Provider 保存永远 INSERT，无编辑 | `saveProvider` upsert（带 `id` 且属主则 UPDATE，空 secret 保留原密钥） | REQ-F-007 | `tests/provider-routes.test.ts`；smoke 编辑不产生重复行 |
| FIX-06 | 无启用/停用/删除 | 新增 `PATCH`/`DELETE /api/providers/[id]` + 设置页按钮 | REQ-F-007 | `tests/provider-routes.test.ts`；smoke disable→delete；e2e |
| FIX-07 | `/api/providers/test` 是桩 | 改为真实探测 `{baseUrl}/models`，区分 401/404/超时/网络错误 | REQ-F-007 | `tests/provider-routes.test.ts`；smoke 命中 mock `/models`；e2e “Connection OK.” |
| FIX-08 | `oauth` authMode 可保存但是死路 | POST 拒绝 `oauth`/`unsupported`，给出可读原因 | REQ-F-008、REQ-NF-003 | `tests/provider-routes.test.ts` |
| FIX-09 | 前端从不带 `model`；无 Provider 切换器 | 状态栏渲染 `<select>`（>1 provider）+ 可编辑模型输入；请求带 `model` | REQ-F-006 | `tests/floating-chat.test.tsx`；e2e selectOption |
| FIX-10 | 最近会话是死数据，刷新不恢复 | 新增 `GET /api/conversations/[id]/messages`；首页 SSR 注水 `initialMessages` | REQ-F-013 | `tests/conversation-routes.test.ts`；smoke restore；e2e reload |
| FIX-11 | 适配器无超时、错误体被丢 | 60s `AbortSignal.timeout`；读取 provider 错误体拼进 `error` message | REQ-F-010/011/012 | `tests/adapters-stream.test.ts` |
| FIX-12 | 加密密钥弱回退 `"test-secret-key"` | `createStore` 缺 `JARVIS_SECRET_KEY` 直接抛错 | REQ-F-009 | `tests/store.test.ts`；`tests/store-singleton.test.ts` |
| FIX-13 | 密钥变更后解密抛错 → 对话 500 / 静默 404 | `listProviders` 标 `connected:false`+`note`；`getProviderForUser` 抛 `ProviderSecretError` → 400 可读 | REQ-F-009 | `tests/store.test.ts`；`tests/chat-stream.test.ts` |
| FIX-14 | UI 规范只有 6 条脆弱字符串匹配 | 新增 `scripts/ui-contract.mjs`（静态 + Playwright live，41 条规则，WCAG 2.2 AA/HIG/Material）；`tests/visual.test.ts` 改为运行它 | REQ-F-014、DEC-005 | `tests/visual.test.ts`；`node scripts/ui-contract.mjs --live` |

## 与 CR-20260908-ui-standard-process 的关系

该 CR（治理会话完成）建立 UI 开发的流程基线与 `governance.py ui` 门禁。本 CR 提供其 UI-GOV-001 的可执行强制实现（`scripts/ui-contract.mjs`）与本轮功能修复。两者一致，无冲突。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019PmfK8ePNkNZmrtMS2CQGP

## R3 评审意见

**复盘迭代（CR-20260908-floating-chat-functional-fixes）**（迁移自 `模块任务开发说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 架构角色 | 新增 TASK-009..014 是否越出模块边界或引入隐藏业务 | 均为已批准需求的实现修正；`/api/providers/[id]` 与 `/api/conversations/[id]/messages` 属既有 MOD-PROVIDER/MOD-CHAT | 边界不变，接口契约表已更新 | APPROVED |
| 开发角色 | TASK-001..008 由 TODO 直接标 DONE 是否有据 | 首版实现已在 CR-20260908-floating-llm-chat 完成但未回填状态 | 结合当前 PASS 证据回填 DONE | APPROVED |
| 测试角色 | 每个新任务是否绑定真实入口测试 | TASK-009..014 均绑定 route/e2e/smoke 级测试，非纯函数 | TEST-014..018 已登记 | APPROVED |

## R4 评审意见

**复盘迭代（CR-20260908-floating-chat-functional-fixes）**（迁移自 `测试说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 测试角色 | 首版 TEST-006 以 `adapters-stream.test.ts` 充当 `/api/providers/test` 覆盖；TEST-009 仅纯函数测停止 | 违反“真实入口对应原则”（AI_STANDARD 原则 12） | TEST-006 重挂真实路由测试；TEST-009 增加 e2e 真实浏览器 Stop 断言；新增 TEST-014..018 | APPROVED |
| 架构角色 | `model` 参数、`/api/conversations/recent` 两端未对接 | 违反“契约无悬空原则”（原则 13） | 新增 `/api/conversations/[id]/messages` 与前端注水，切换器发送 `model`，smoke/e2e 双端验证 | APPROVED |
| 产品 owner | REQ-F-006/007/013 验收标准被整体判定，未逐条断言 | 违反“验收标准逐条断言原则”（原则 15） | TEST-010/011/013/016 按“新增/编辑/启用/停用/删除/测试/多轮/恢复”逐动作断言 | APPROVED |
