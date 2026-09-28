# CR-20260928-server-strings-i18n

- 级别: L2（标准档：全部 CP 双向门——一个服务端字典、一个请求级翻译器、类型化错误多一个 `code`、路由与编排层的字面量改为查表；不改数据含义、不改任何接口形状（`message` 字段仍是字符串），`git revert` 即回滚；英文措辞与模型对摘要 / 唤醒语言的遵从度须人看，登记为人工发现项）
- 提出人: user（INPUT-2026-09-28-002；INPUT-2026-09-27-002 第三步）
- 状态: CLOSED（2026-09-28 闭环：TASK-590 DONE，TEST-590/591/592 PASS、TEST-593 真实入口 PASS（`entry: user`），TEST-581 扫描范围扩大后 PASS；L2 标准档，R1 由用户四点裁定终裁，R2–R4 全 PASS、R4 CP-1 由 CONDITIONAL 转 APPROVED；`tsc` 0 错误，全量 111 文件 / 978 例：976 通过，2 例在全量负载下超时（既有 flaky floating-chat ④ 与 knowledge-dashboard ①）单独重跑 78/78 通过，治理单测通过；TEST-593 于 2026-09-28 在用户运行中的本机服务（分支构建 `kQJFQcIfS8LGB18ZjELjh`）上经真实接口请求走完，见 EV §4；snapshot ledger seq 147 后快进合入 main（`3838d37`），合并后 `verify` PASS；本机服务已在跑本 CR 的构建，无需再重建）
- 占用 ID: REQ-F-350, DEC-470, TASK-590, TEST-590, TEST-591, TEST-592, TEST-593
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-340（界面双语的边界从「浏览器渲染的文案」扩到「经接口与流回到界面的服务端文案」）、REQ-F-330（回复语言设置同时决定压缩摘要与唤醒提醒的语言）
- 影响模块: MOD-API（26 个路由文件的 message 改查表）、MOD-CHAT（`chat.ts` / `agent-loop.ts` / `adapters.ts` 的通知与步骤行状态改查表；压缩摘要提示词按语言）、MOD-ENTITY / MOD-KNOWLEDGE / MOD-LIBRARY / MOD-DOCUMENTS / MOD-SKILLS（校验错误改 `coded`，`validateRoot`、巡检与唤醒结果、排版备注、markitdown 失败原因改返回 code）、MOD-SETTINGS-UI（`send-failure.ts`、`STORAGE_CONFIG_HINT`、`SETTINGS_PANEL_LABEL` 走界面字典）、MOD-GOVERNANCE（`docs/ARCHITECTURE.md` 同步；守卫扩展）
- 影响任务: 无既有任务变更，新增 TASK-590
- 影响测试: 既有路由 / 领域 / 对话测试在默认中文下断言不变；新增 TEST-590, TEST-591, TEST-592, TEST-593
- 当前证据: `project/05_evidence/EV-2026-09-28-server-strings-i18n.md`
- 方案选项:
  - A. 领域函数增加 `language` 参数一路传到底——用户否决（裁定②）：改动面大，工具路径也被迫带语言，与「工具结果保持中文」的裁定④不好共存。
  - B. **入口绑定 + 错误码：新增服务端字典 `src/lib/i18n-server.ts`（zh 表为键源、en 表编译期同键，不进浏览器包）与共用查表核心 `i18n-core.ts`；API 路由经 `requestTranslator()` 在入口读一次全局 `ui.language` 绑定 `t`，`runChatTurn` 用已读到的语言绑定并传给 `runToolLoop`；领域模块的类型化错误增加 `coded(code, params, status)` 工厂——中文 `message` 由字典派生（工具路径拿到的仍是同一句中文），路由边界用 `messageFor(t, error)` 按 `code` 成句；`validateRoot`、巡检 / 唤醒结果、排版备注、markitdown 失败原因、技能提议裁定、Provider 备注改为返回 code 由调用方成句；压缩摘要与唤醒提示词按语言取字典（裁定④）；守卫：语法树扫描扩到 `src/app/api/**`，加错误码覆盖检查（裁定③）**——选中。
  - C. 领域模块内部直接读全局设置成句——用户否决（裁定②）：模块与存储单例耦合，工具结果也会跟着变语言。
  - D. 连写进数据文件的文案（采集源健康备注、变更历史、技能默认描述、排版缓存标记）一起做——用户否决（裁定①）：要改存储结构存码不存文本，涉及实体文件格式与已有数据迁移。
  - E. 本 CR 不碰提示词——用户否决（裁定④）：English 下早前对话的摘要与唤醒提醒仍是中文。
- 选择理由: 四点裁定直接给出形态；错误码让「同一句校验错误」在工具路径保持中文、在界面按语言成句，两条路径共用一处字典与一份实现；请求级翻译器在入口读一次设置，领域模块不接触存储单例；服务端字典单独成文件，浏览器包不多一个字节；守卫沿用第二步的语法树扫描，路由文件里的字符串全是回界面的 message，可以整文件零中文；`chat.ts` / `agent-loop.ts` 含给模型看的中文提示词，不能整文件扫描，改到的通知逐条测试。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交，重建重启；服务端文案回到中文字面量，错误对象少一个 `code` 字段，接口形状不变。
  - 数据：无——不新增设置键、表或文件；`ui.language` 仍由第一步的路由读写。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260928-server-strings-i18n` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-590 DONE；TEST-590/591/592 PASS，TEST-593 真实入口 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿（既有路由 / 领域 / 对话测试默认中文下断言逐字不变；`tests/architecture-doc.test.ts` 含新增模块）。
- 真实入口: 已执行（2026-09-28 本机时区，用户运行中的本机服务，分支构建 `kQJFQcIfS8LGB18ZjELjh`，由协调会话经真实 `GET/PUT /api/settings/language` 与四条会被拒绝的接口请求驱动（`POST /api/settings/documents` 相对路径、`PUT /api/settings/wake` 间隔 0、`POST /api/library/decide` 非 JSON、`GET /api/actions?effects=bogus`）；①默认 zh → 四条均 400，message 与改写前逐字一致；②`PUT en` 后 `GET` 读到 en（持久化）→ 同四条 400，message 为英文，如『Enter an absolute path.』『The request body is not valid JSON.』；③`PUT zh` → 四条恢复中文。全程无写入。详见 EV-2026-09-28-server-strings-i18n §4）
  - **真实入口（必做）**：①默认中文：一批会被拒绝的接口请求（加相对路径目录、唤醒间隔越界、裁定体非 JSON、非法 effects）的 message 与现状逐字一致；②切 English：同一批请求返回英文 message；③切回中文恢复。对话通知与压缩摘要 / 唤醒提示词要特定模型状态才出现，机器对照 TEST-591，English 下首次出现时由用户看一眼（人工发现项）。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：用户四点裁定。
- R1 终裁: 已完成 | 用户 | 2026-09-28

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：用户 2026-09-28 原话「继续」；协调会话列出四个候选经 AskUserQuestion 请用户选，用户选「服务端回界面文案双语」；随后就范围 / 机制 / 守卫 / 模型产出语言四点再次 AskUserQuestion，用户逐点选择推荐项：三类都做、入口绑定 + 错误码、路由扫描 + 错误码覆盖、摘要与唤醒一并处理。视四点裁定为终裁。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | English 下，服务端回到界面的文案——接口的错误 / 提示 message、对话转录里的系统提示条与工具步骤行状态、发送失败红字、配置提示——全部为英文，中文下与现状逐字一致；上下文压缩摘要与主动唤醒提醒跟随回复语言；给模型看的提示词与工具结果保持中文，写进数据文件的文案不变 | REQ-F-350（新增） | 新增 | 双向 | 真实入口：切 English 后同一批接口请求返回英文 message，切回恢复（证据：TEST-593） |
| CP-2 | 架构 | 服务端字典 `src/lib/i18n-server.ts`（不进浏览器包）+ 共用查表核心 `i18n-core.ts`；`requestTranslator()` 在路由入口读全局 `ui.language`；类型化错误的 `coded(code, params, status)` 工厂（zh `message` 由字典派生，工具路径不变）与 `messageFor(t, error)` 边界成句；`runChatTurn` / `runToolLoop` 接收 `t`；压缩与唤醒提示词按语言取字典 | DEC-470（新增） | 新增 | 双向 | 机器：`tests/i18n-server.test.ts`（TEST-590） |
| CP-3 | 模块 | 26 个路由文件 74 处 message、`chat.ts` / `agent-loop.ts` / `adapters.ts` 约 40 处通知与状态、领域模块约 90 处校验错误改 `coded`，`validateRoot` / 巡检与唤醒结果 / 排版备注 / markitdown 失败原因改返回 code；`send-failure.ts`、`STORAGE_CONFIG_HINT`、`SETTINGS_PANEL_LABEL` 走界面字典；`docs/ARCHITECTURE.md` 同步新增模块 | TASK-590 | 大改 | 双向 | 机器：`tests/server-strings-lang.test.ts`（TEST-591：en 下路由 message / 对话通知 / 唤醒提示词为英文，zh 下逐字不变）+ 既有路由 / 领域 / 对话测试 + `tests/architecture-doc.test.ts` |
| CP-4 | 测试 | 守卫扩展：`tests/ui-strings-guard.test.ts` 扫描范围加 `src/app/api/**`；新增 `tests/server-strings-guard.test.ts` 错误码覆盖（凡 `coded("…")` 的 code 都在字典里）与 zh / en 同键；新增 TEST-590..593 | TEST-590, TEST-591, TEST-592, TEST-593 | 新增 | 双向 | 机器：`npx vitest run tests/i18n-server.test.ts tests/server-strings-lang.test.ts tests/server-strings-guard.test.ts tests/ui-strings-guard.test.ts`（TEST-592 为守卫） |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260928-server-strings-i18n` 节后，跑 `governance.py matrix CR-20260928-server-strings-i18n` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 直接落实四点裁定：三类文案按当前语言成句、给模型的提示词与工具结果照旧、写进数据的不动；摘要与唤醒跟随回复语言 | APPROVED 新增 REQ-F-350 落 DEC-470；接续 REQ-F-340 ⑤ 的边界，不新增设置键 | APPROVED 落点为两个纯数据 / 纯函数模块、一个请求级翻译器、错误类上的一个工厂、路由与编排层的查表改写；无新增路由、表、依赖 | APPROVED 验收含真实入口三步（同一批被拒请求在 zh / en 下的 message），机器对照 TEST-590/591/592 |
| CP-2 | APPROVED 同一句校验错误在界面与工具路径各说各的语言，用户与模型都拿到熟悉的句子 | APPROVED 错误码让两条路径共用一处字典；请求级翻译器在入口读一次设置，领域模块不接触存储单例；`i18n-core.ts` 抽出后两本字典一份实现 | APPROVED `coded` 工厂只加不改：既有 `new XError(message)` 调用点原样保留；`messageFor` 对非 coded 错误原样透出 | APPROVED TEST-590 四例覆盖键集 / 占位符 / 查表 / coded 派生 / `messageFor` 分支 |
| CP-3 | APPROVED 改写后路由文件零中文字面量；默认中文下既有路由 / 领域 / 对话测试逐字照旧通过 | APPROVED 结果对象带码（`reasonCode` / `messageCode` / `noteCode`）而非在领域层成句；排版缓存旧行照读；适配层通知在编排层重述 | APPROVED 四批脚本各带逐条计数断言：领域 coded、结果对象、编排通知、26 个路由；`docs/ARCHITECTURE.md` 同步四个新模块 | APPROVED TEST-591 四例 + 既有测试 + TEST-560 架构图守卫 |
| CP-4 | APPROVED 无用户可见行为之外的测试 | APPROVED 守卫用语法树扫路由、用正则收集码——码必须在字典里，TypeScript 类型再兜一层 | APPROVED 两个新测试文件 + 一个新守卫 + 既有守卫扫描范围扩大 | APPROVED 定向与全量见 EV §3 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-590 对应验收条件①②③ | APPROVED 与 DEC-470 一致 | APPROVED 七项落点逐条可审阅可回滚 | APPROVED TEST-590/591/592/593 |
| CP-2 | APPROVED 无需求层遗留 | APPROVED 与 DEC-470 ①②③ 一致 | APPROVED TASK-590 ①② | APPROVED TEST-590 |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 与 DEC-470 ④⑤⑥ 一致 | APPROVED TASK-590 ②③④⑤⑦ | APPROVED TEST-591 + 既有测试 + TEST-560 |
| CP-4 | APPROVED 无遗留 | APPROVED 无新增基础设施 | APPROVED TASK-590 ⑥ | APPROVED TEST-592 + TEST-581 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-09-28 真实入口三步通过：en 下四条接口 message 为英文，切回中文逐字恢复，设置持久化（EV §4） | APPROVED 同一批请求只换了 `ui.language` 就换了语言，证明请求级翻译器 + 错误码链路（`requestTranslator` → `t` / `messageFor`）在真实服务里成立 | APPROVED 四条覆盖路由字面量、`validateRoot` code、coded `WakeSettingsError`、带参字面量四种落法 | APPROVED TEST-593 `real_entry: true`（`entry: user`）；请求与应答日志留存协调会话 scratchpad `real-entry/t593.json`，关键句已抄入 EV §4 |
| CP-2 | APPROVED 字典与 coded 四例全绿 | APPROVED `messageFor` 三个分支（coded / 自带 message / fallback）有断言 | APPROVED `tsc` 0 错误，`satisfies` 同键在编译期强制 | APPROVED `npx vitest run tests/i18n-server.test.ts` |
| CP-3 | APPROVED 默认中文四类 message 逐字不变有断言；切 en 换词、切回恢复有断言 | APPROVED 唤醒提示词与步骤行状态随语言有断言 | APPROVED 架构图守卫通过证明四个新模块已同步 | APPROVED `npx vitest run tests/server-strings-lang.test.ts tests/architecture-doc.test.ts` |
| CP-4 | APPROVED 路由零中文由守卫证明 | APPROVED 错误码覆盖非空且逐个在字典里 | APPROVED 守卫本身有非空断言，不会静默通过 | APPROVED `npx vitest run tests/server-strings-guard.test.ts tests/ui-strings-guard.test.ts` |
