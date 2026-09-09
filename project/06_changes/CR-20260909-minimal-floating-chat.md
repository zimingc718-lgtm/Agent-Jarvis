# CR-20260909-minimal-floating-chat

- 级别: L3
- 提出人: user（"现在先不做用户账号登录。仅作模型key配置。单一管理员用户。" → 多轮需求讨论 → "确认。落地后，给我看各个流程的变化点方案及角色评审的意见。"）
- 状态: APPROVED
- 影响需求: REQ-F-001（暂缓）、REQ-F-002、REQ-F-003、REQ-F-004、REQ-F-005、REQ-F-006（重写）、REQ-F-007、REQ-F-013、REQ-F-014（重写）、REQ-F-015、REQ-F-016、REQ-NF-002（暂缓）、REQ-NF-004；新增 REQ-F-017、REQ-F-018
- 影响模块: MOD-AUTH（单管理员形态）、MOD-PROVIDER（优先级）、MOD-CHAT（会话生命周期、优先级解析）、MOD-CHAT-UI（浮窗收敛、状态灯四态、新对话、错误行、视觉简约化）、MOD-SETTINGS-UI（优先级 UI）
- 影响任务: 新增 TASK-021、TASK-022、TASK-023、TASK-024、TASK-025、TASK-026
- 影响测试: 新增 TEST-025、TEST-026、TEST-027、TEST-028、TEST-029、TEST-030；改写 TEST-011（删「浮窗切换器」断言）、TEST-012（面板限高 65vh→50vh）
- 当前证据: `project/05_evidence/EV-2026-09-09-minimal-floating-chat-requirements.md`（需求讨论与决策链）；实现证据待 P3/P4 产生
- 方案选项:
  - A. 只把 Google OAuth 配完，不改需求（成本：Google Console 15 分钟；代价：从此依赖一个 Google Cloud 项目）
  - B. 降级 REQ-F-001 为「本地单管理员会话」，浮窗收敛为「状态灯 + 输入框 + 单按钮」，Provider 选择整体移到「配置」并引入优先级
  - C. 登录做成可选（默认单管理员，配了 Google 凭据即启用登录，两套并存）
- 选择理由: 选 B。当前功能的「用户范围」本就是「本机个人用户」，Google 登录（REQ-F-001）与多用户隔离（REQ-NF-002）在本功能中没有被真实行使的场景——REQ-NF-002 的 A/B 隔离只在合成测试里出现，无真实第二用户。A 引入长期外部依赖；C 让 auth 层承担两套模式与两套测试，改动量最大且当前无收益。B 把「单管理员」从临时 workaround（`JARVIS_TEST_USER_ID` 旁路，已实现且已测）正式写进说明书，作为当前版本形态；REQ-F-001/NF-002 标记 DEFERRED，登录入口占位保留，待后续 CR 恢复。浮窗收敛与优先级机制为用户逐条确认的产品决策。
- 回滚方式:
  - 文档回滚：还原 `产品需求说明书.md`（REQ-F-001/NF-002 状态、REQ-F-002/003/004/005/006/007/013/014/015/016 验收、删除 REQ-F-017/018 与本 CR 澄清小节与评审行）、`架构设计说明书.md`（删 DEC-010/011/012，还原 DEC-005 与 MOD 职责表）、`模块任务开发说明书.md`（删 TASK-021..026 与本 CR 复盘小节）、`测试说明书.md`（删 TEST-025..030，还原 TEST-011/012）。
  - 运行回滚：从 `.env.local` 删除 `JARVIS_TEST_USER_ID`，配置 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 即恢复 REQ-F-001 登录路径（代码无需改动）。
  - 无 schema 变更（P3 实现阶段若新增 Provider 优先级字段，另在实现 CR 中记录迁移）。
  - 回滚后重跑 `python tools/governance.py verify|gate g1|gate g2|check-changes` 并重新 `snapshot`。
- 验收条件:
  - P1/P2（本 CR 范围）：四本说明书一致，`gate g1`、`gate g2`、`check-changes`、`verify`、`ui` 全部通过；REQ-F-017、REQ-F-018 在模块与测试说明书均有覆盖；REQ-F-001、REQ-NF-002 保留模块/测试覆盖行且状态标 DEFERRED。
  - P3/P4（后续实现 CR 范围，不在本 CR）：TEST-025..030 取得 PASS 证据；`ui-contract.mjs` 删除 `__chip`/`__state`/`__model` 相关规则并新增状态灯四态规则；真实入口冒烟走通「无登录进入 → 配置优先级 → 对话 → 停止即结束 → 新对话 → 刷新空白」。
- 评审记录:
  - 产品 owner：单管理员形态与「用户范围」原文一致；浮窗收敛（删模型芯片、状态文字、可编辑模型框、settings 链接）不删除已批准能力——Provider 选择迁移到「配置」并升级为优先级，能力增强而非缩减。要求优先级机制写进产品需求（有序列表 + 上移/下移），不下放给 UI 规范。REQ-F-001/NF-002 标 DEFERRED 而非删除，登录入口占位。结论：APPROVED。
  - 架构角色：`JARVIS_TEST_USER_ID` 旁路已在 `src/lib/auth-guard.ts` 存在且被 TEST-001/002 覆盖，作为当前形态无新增信任面；仅 `NODE_ENV!==production` 生效，生产构建下登录仍必需——本 CR 不承诺生产免登录，列入 P3 待决（DEC-011 备注）。优先级解析 + fallthrough、会话生命周期（停止/新对话结束会话）、状态灯加载探测三处新增决策记为 DEC-010/011/012，均在既有模块边界内。状态灯「每次加载探测一次」会给每个已启用 Provider 增加一次出站请求，接受该成本换取灯的真实性。结论：APPROVED。
  - 模块开发角色：TASK-021..026 均绑定至少一个新测试 ID，无纯函数充数；FloatingChat 精简为删除既有元素，风险低；优先级 UI 复用 `ModelSettings` 既有宿主。「新对话后刷新空白」需要一个持久化信号（客户端标记或空会话记录），实现方式在 P3 定，记为 DEC-011 待决点。结论：APPROVED。
  - 测试角色：新增 6 条测试按「优先级解析 + fallthrough / 无可用 Provider 拦截 / 加载探测 / 状态灯四态 / 请求级错误红字 / 停止即结束会话 / 新对话清空 + 刷新空白 / 面板 50vh」逐条可观察断言，符合 AI_STANDARD 原则 12/15。原 REQ-F-006「浮窗切换器」断言（TEST-011）作废并改写。REQ-F-001 正向验收（TEST-022 人工）在本版本随 REQ-F-001 一同暂缓，`gate g3` 的 TEST-022 阻断转为「已知暂缓」。结论：APPROVED。

## 背景

用户在 P6 运行中尝试配置 Google OAuth，判断当前阶段不需要账号体系，要求以单一本地管理员身份先把模型 Key 配置与对话跑通。随后逐轮确认了对话浮窗的最简形态与 Provider 优先级机制。视觉方向参考 `gens.team/ai-insights`（浅色简约 SaaS，非知识控制台）。

## 各流程变化点

### P1 产品需求说明书

| 位置 | 变化 |
|---|---|
| 产品目标段 | 删「选择 OpenAI/DeepSeek/本地模型」；加「以单一本地管理员身份运行」「开启新对话」；注明 Provider 启用与优先级在「配置」管理，浮窗不做选择 |
| 用户范围段 | 主要用户改为「单一本地管理员（不区分多用户，无账号登录）」 |
| REQ-F-001 | 状态 `APPROVED` → `DEFERRED（暂缓）`，描述加注占位入口 |
| REQ-F-002 | 验收：悬浮条仅含状态灯 + 输入框 + 单按钮；输入框不依赖 Provider 状态 |
| REQ-F-003 | 验收：状态仅由状态灯表达；面板高度上限 65% → 50% |
| REQ-F-004 | 验收补充：每轮请求由服务端携带该会话全部历史消息 + 固定 system prompt |
| REQ-F-005 | 验收重写：停止 = 服务端停止请求模型 + 当前会话结束；被中断回复带行内「已停止」标记 |
| REQ-F-006 | 重命名「Provider 启用与优先级」，整条重写（有序列表 + 上移/下移 + 优先级解析 + fallthrough + 无可用拦截），状态回退待评审 |
| REQ-F-007 | 验收补充：设置页提供优先级有序管理 |
| REQ-F-013 | 验收补充：仅当最近会话仍活动时刷新才恢复 |
| REQ-F-014 | 重写：视觉方向由「知识控制台」调整为「浅色简约」（参考 gens.team/ai-insights）；删除验收中「模型芯片」；状态灯四态达非文本对比 3:1 |
| REQ-F-015 | 补充：当前版本「账号登录」为占位入口 |
| REQ-F-016 | 验收补充：请求级错误在输入框上方一行红字，脱敏，不写入上下文，不结束会话 |
| 验收澄清 | 新增小节：会话生命周期、请求级错误 vs 流中错误、面板高度 50%、动作按钮状态机 |
| REQ-NF-002 | 状态 `APPROVED` → `DEFERRED（暂缓）` |
| REQ-NF-004 | 验收「走通登录后」→「走通（管理员身份免登录进入后）」 |
| 非目标 | 新增三条：不实现多用户与账号隔离、不实现对话历史浏览、不实现超长上下文截断/摘要 |
| 新增 REQ-F-017 | 开始新对话（MUST） |
| 新增 REQ-F-018 | 连接状态指示灯（MUST，四态 + 加载探测） |
| 多角色评审 | 新增本 CR 评审行 |
| 批准状态 | 用户确认追加 2026-09-09 本 CR |

### P2 架构设计说明书

| 位置 | 变化 |
|---|---|
| 设计目标段 | 「Google 登录入口」→「占位登录入口（当前单管理员）」 |
| DEC-001 | 状态加注：REQ-F-001/NF-002 暂缓，当前以 `JARVIS_TEST_USER_ID` 旁路提供单管理员身份 |
| DEC-005 | 覆盖需求删 REQ-F-006；限高 ≤65vh → ≤50vh；浮窗不含模型切换 |
| 新增 DEC-010 | Provider 使用优先级：有序列表持久化，`runChatTurn` 取「已启用且连接有效」中优先级最高者，失败 fallthrough 到下一个 |
| 新增 DEC-011 | 会话生命周期：`停止` 与 `新对话` 均结束会话（丢弃 conversationId）；「新对话后刷新空白」的持久化信号（客户端标记 vs 空会话记录）P3 定 |
| 新增 DEC-012 | 状态灯四态（检测中/灭/常亮/闪烁）；首页加载对已启用 Provider 执行一次连接探测 |
| 模块边界表 | MOD-AUTH 加「单管理员形态」；MOD-PROVIDER 加「使用优先级」；MOD-CHAT 加「会话生命周期、优先级解析」；MOD-CHAT-UI 删「模型切换」加「状态灯四态、新对话、请求级错误行」，视觉措辞「浅色控制台」→「浅色简约」；覆盖需求列同步 |
| 接口契约 | `/api/providers` GET/POST 增加 `priority` 字段；`/api/chat/stream` 请求体不再要求 `providerId`/`model`（服务端按优先级解析）；新增或复用探测端点说明；ChatDelta 不变 |
| 多角色评审 | 新增本 CR 评审行 |

### P2 模块任务开发说明书

| 位置 | 变化 |
|---|---|
| 任务总览 | 新增 TASK-021（MOD-PROVIDER/MOD-SETTINGS-UI：Provider 优先级字段 + `/api/providers` 读写 + 设置页有序 UI）、TASK-022（MOD-CHAT：优先级解析 + fallthrough + 无可用 Provider 拦截）、TASK-023（MOD-CHAT-UI：FloatingChat 收敛——删模型芯片/状态文字/可编辑模型框/settings 链接）、TASK-024（MOD-CHAT-UI：状态灯四态 + 加载探测接线）、TASK-025（MOD-CHAT/MOD-CHAT-UI：停止即结束会话 + 新对话动作 + 刷新空白）、TASK-026（MOD-CHAT-UI：请求级错误红字行 + 面板 50vh + 视觉简约化） |
| 关键接口 | `runChatTurn` 签名去掉必填 `providerId`/`model`，新增可选覆盖；新增 `resolveActiveProvider(userId)`；`saveProvider` 增 `priority` |
| 复盘迭代 | 新增本 CR 小节 + 多角色评审行 |

### P2 测试说明书

| 位置 | 变化 |
|---|---|
| 测试矩阵 | 新增 TEST-025（优先级解析 + fallthrough）、TEST-026（无可用 Provider 时发送被拦截 + 状态灯灭）、TEST-027（首页加载探测 + 状态灯四态）、TEST-028（请求级错误输入框上方红字、脱敏、不入上下文）、TEST-029（停止即结束会话：落库 stopped + 下一条消息为新 conversationId）、TEST-030（新对话清空 + 刷新呈现空会话 + 面板 50vh 限高） |
| TEST-011 | 删除「>1 Provider 时渲染切换器并发送选择」，改为「浮窗不渲染 Provider 切换控件；对话请求不携带 provider 参数」 |
| TEST-012 | 展开面板限高断言 65vh → 50vh |
| 真实入口冒烟 | 流程脚本更新：无登录进入 → 配置优先级 → 对话 → 停止（会话结束）→ 新对话 → 刷新空白 |
| 复盘迭代 | 新增本 CR 小节 + 多角色评审行 |

### P3/P4（不在本 CR，列入后续实现 CR）

- `scripts/ui-contract.mjs`：删 `__chip`/`__state`/`__model` 规则与「模型芯片」规则；新增状态灯四态规则；间距/圆角刻度按简约方向调整。
- `src/`：按 TASK-021..026 实现。
- `test-results.json`：TEST-025..030 回填 PASS 证据后 `gate g3` 才可能转绿（当前 g3 已因 TEST-022 暂缓而红）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ
