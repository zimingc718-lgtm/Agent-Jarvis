# CR-20260927-reply-language

- 级别: L2（标准档：全部 CP 双向门——一个全局设置键、一条路由、一个 ☰ 开关、提示词里一行指令；不改数据含义，`git revert` 即回滚；回复语言是否真的切换须人在真实对话里看一次）
- 提出人: user（INPUT-2026-09-27-002 第一步）
- 状态: P2-P4 与真实入口完成，待 snapshot 与合并（R1 由用户四点裁定终裁；R1-R4 全 PASS；新增测试 8 例；`tsc` 0 错误；全量 105 文件 960/960 全部通过（既有 flaky floating-chat ④ 本轮未复现）；TEST-572 三步已于 2026-09-27 在用户运行中的本机服务（分支构建 `oGAsKEmNMKu9IXML_USqp`）上经真实 `POST /api/chat/stream` 走完——第一次尝试暴露「只在前缀顶部放一行指令不够」，加了末尾提醒后通过，见 EV §4；合并 main 且 `verify` PASS 后转 CLOSED）
- 占用 ID: REQ-F-330, DEC-450, TASK-570, TEST-570, TEST-571, TEST-572
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-014（☰ 外观分组多一个「语言」开关）、REQ-NF-008 ①（稳定前缀多一行、只随设置变化）
- 影响模块: MOD-CHAT（`chat.ts` 前缀 identity）、MOD-API（`/api/settings/language`）、MOD-SETTINGS-UI（`LanguageToggle`、`page.tsx` 装配）、MOD-GOVERNANCE（`docs/ARCHITECTURE.md` 同步——首次由守卫测试驱动）
- 影响任务: 无既有任务变更，新增 TASK-570
- 影响测试: 无既有测试变更，新增 TEST-570, TEST-571, TEST-572
- 当前证据: `project/05_evidence/EV-2026-09-27-reply-language.md`
- 方案选项:
  - A. 回复语言跟随每条消息的语言，不加设置——用户否决（裁定②取 ☰ 开关）：用中文问英文资料时会来回跳。
  - B. **☰「外观」里加「语言」开关（中文 / English），存服务端全局设置 `ui.language`（默认 zh，裁定③）；`runChatTurn` 把 `languageInstruction(language)` 并入稳定前缀的 identity；`<html lang>` 跟随；工具描述与工具结果保持中文，由指令要求模型照样读、按目标语言作答（裁定④）**——选中。界面文案的双语是第二步，另立 CR。
  - C. 把语言写进 `DEFAULT_SYSTEM_PROMPT` 常量、靠环境变量切换——不选：改语言要重启，且 Railway 与本机会各自一套。
  - D. 第一步就把 474 条工具文案一并英文化——用户否决（裁定④）：工具行为要重跑真实入口，而模型读中文文案照样能用英文作答。
- 选择理由: 四点裁定直接给出形态；放进稳定前缀而不是易变后缀，是因为它只在用户切换时变、切换之间字节相同（REQ-NF-008 ①）；全局键沿用搜索 / 唤醒 / 文档设置的既有做法，多用户各自语言留待以后。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交，重建重启；开关消失，前缀回到只有 identity 一行。
  - 数据：`app_settings` 里的 `ui.language` 成为无人读取的一个键，不影响其它设置；无需迁移。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260927-reply-language` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-570 DONE；TEST-570/571 PASS，TEST-572 真实入口 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿（含 `tests/architecture-doc.test.ts`——本 CR 新增模块 / 路由 / 组件都要写进 `docs/ARCHITECTURE.md`）。
- 真实入口: 已执行（2026-09-27 本机时区，用户运行中的本机服务，分支构建 `oGAsKEmNMKu9IXML_USqp`，由协调会话经真实 `POST /api/chat/stream` 与 `GET/PUT /api/settings/language` 驱动、DeepSeek `deepseek-chat` 应答；同一中文问题「列一下我有哪些技能，并用一句话说明每个技能是做什么的。」三次：①默认 zh → 中文正文（正文 CJK 357 / 拉丁 55），`list_skills` 照常；②`PUT en` 后 `GET` 读到 en（持久化）→ 英文正文（去掉加粗技能名后 CJK 0 / 拉丁 1435），技能名保留中文并附英文释义，`list_skills` 照常；③`PUT zh` → 中文正文（CJK 327 / 拉丁 23）。首次尝试（只有前缀顶部一行指令、构建 `UivEy7piYKVS1nN28DFYS`）在 en 下以英文开头随即滑回中文，判 FAIL；加末尾提醒 `languageReminder` 后重建重跑通过。☰ 开关与刷新后状态的目视由用户完成。详见 EV-2026-09-27-reply-language §4）
  - **真实入口（必做）**：①English 下中文提问得英文回复、工具照常；②切回中文得中文回复；③刷新页面后开关仍是所选值（服务端持久化）。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：用户四点裁定。
- R1 终裁: 已完成 | 用户 | 2026-09-27

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：用户 2026-09-27 原话「Jarvis应该支持英文。」；协调会话摸底（无 i18n 机制、约 1,160 条中文字串、系统提示词为英文）后就范围 / 语言选择 / 默认 / 工具文案四点发起 AskUserQuestion，用户逐点选择推荐项：对话 + 界面分两步、☰ 语言开关持久化、默认中文、工具文案保持中文由模型按目标语言作答。本 CR 是第一步（回复语言），视四点裁定为终裁；第二步（界面文案）另立 CR。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 用户可在 ☰「外观」里选择 Jarvis 的回复语言（中文 / English），默认中文，选择持久化到服务端、刷新与换浏览器后一致；工具描述与结果仍是中文，模型按所选语言作答 | REQ-F-330（新增） | 新增 | 双向 | 真实入口：切 English 后中文提问得英文回复且工具照常，切回得中文（证据：TEST-572） |
| CP-2 | 架构 | 全局设置键 `ui.language`（`src/lib/language.ts`：`readLanguage` / `writeLanguage` / `languageInstruction`）；`runChatTurn` 把语言指令并入稳定前缀 identity；`GET/PUT /api/settings/language`，只接受 zh / en，非法 400 | DEC-450（新增） | 新增 | 双向 | 机器：`tests/language-settings-route.test.ts` + `tests/chat-stream.test.ts` 新增用例（证据：TEST-570、TEST-571） |
| CP-3 | 模块 | `LanguageToggle` 组件（与 `ThemeToggle` 同形态，服务端保存，失败回退，`<html lang>` 跟随，派发 `jarvis:language-changed`）；`page.tsx` 在「外观」分组挂载并传 SSR 初值；`docs/ARCHITECTURE.md` 同步新增模块 / 路由 / 组件 | TASK-570 | 新增 | 双向 | 机器：`tests/language-toggle.test.tsx` + `tests/architecture-doc.test.ts`（证据：TEST-571） |
| CP-4 | 测试 | 新增 TEST-570（路由 5 例）、TEST-571（组件 2 例 + 前缀 1 例）、TEST-572（真实入口） | TEST-570, TEST-571, TEST-572 | 新增 | 双向 | 机器：`npx vitest run tests/language-settings-route.test.ts tests/language-toggle.test.tsx tests/chat-stream.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260927-reply-language` 节后，跑 `governance.py matrix CR-20260927-reply-language` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 直接落实四点裁定：开关、持久化、默认中文、工具文案不动；开关旁写明界面文案是下一步，不让用户误以为整站已英文化 | APPROVED 新增 REQ-F-330 落 DEC-450；REQ-F-014 外观分组只多一个开关，既有主题开关不变 | APPROVED 落点为一个 lib 模块、一条路由、一个组件、一行前缀改动 | APPROVED 验收含真实入口三步（英文作答且工具照常、切回中文、刷新保持），机器对照 TEST-570/571 |
| CP-2 | APPROVED 非法值 400 而非静默忽略；库里意外值按默认读，不会把界面卡死 | APPROVED 指令放稳定前缀：切换之间字节相同，符合 REQ-NF-008 ①；全局键沿用既有设置做法，多用户各自语言登记为局限 | APPROVED `language.ts` 只依赖 `Store` 类型，客户端组件可安全 import；`chat.ts` 改动一行 | APPROVED TEST-570 五例覆盖默认 / 持久化 / 非法 / 意外值；TEST-571 前缀用例断言两种指令互斥 |
| CP-3 | APPROVED 与主题开关同形态，用户不用学第二种控件；保存失败回退到原值并显示原因 | APPROVED SSR 初值经 `readLanguage(getStore())` 传入，首帧即正确；`<html lang>` 在客户端跟随，不改 layout 的 store 边界 | APPROVED `docs/ARCHITECTURE.md` 同步了模块 / 路由 / 组件三处与附录，守卫测试通过——这是维护规则第一次被机器强制 | APPROVED TEST-571 组件两例 + TEST-560 守卫 |
| CP-4 | APPROVED 无用户可见行为之外的测试 | APPROVED 沿用既有 env 隔离与 next-auth mock 惯例 | APPROVED 两个新测试文件 + 一例并入既有文件 | APPROVED 定向与全量见 EV §3 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-570 对应验收条件①②③ | APPROVED 与 DEC-450 一致 | APPROVED 五项落点逐条可审阅可回滚 | APPROVED TEST-570/571/572 |
| CP-2 | APPROVED 无需求层遗留 | APPROVED 与 DEC-450 ①②③ 一致 | APPROVED TASK-570 ①②③ | APPROVED TEST-570 + TEST-571 前缀例 |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 与 DEC-450 ④ 一致 | APPROVED TASK-570 ④⑤ | APPROVED TEST-571 组件例 + TEST-560 |
| CP-4 | APPROVED 无遗留 | APPROVED 无新增基础设施 | APPROVED 测试与源文件一一对应 | APPROVED 见 R2/CP-4 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-09-27 真实入口三步通过：en 下中文提问得英文正文且工具照常，切回得中文，设置持久化（EV §4） | APPROVED 首次尝试证明一行指令不够，指令 + 末尾提醒两处并存后模型遵从；两处都只随设置变化，前缀缓存不受影响 | APPROVED 修正只加了一个纯函数 `languageReminder` 与 `chat.ts` 两行，测试同步断言后缀 | APPROVED TEST-572 `real_entry: true`（`entry: user`）；两次运行的事件日志留存协调会话 scratchpad，关键数字已抄入 EV §4 |
| CP-2 | APPROVED 非法值与意外值文案有断言 | APPROVED 前缀用例经 `runChatTurn` 全链路，证明指令在 identity 段、随设置切换 | APPROVED 路由五例全绿，已本机实测 | APPROVED `npx vitest run tests/language-settings-route.test.ts tests/chat-stream.test.ts` |
| CP-3 | APPROVED 提示文案与状态文案有断言 | APPROVED `<html lang>` 跟随与事件派发有断言 | APPROVED 守卫测试通过证明架构图已同步 | APPROVED `npx vitest run tests/language-toggle.test.tsx tests/architecture-doc.test.ts` |
| CP-4 | APPROVED | APPROVED | APPROVED | APPROVED 全量回归见 EV §3 |
