# CR-20260928-ui-strings-i18n

- 级别: L2（标准档：全部 CP 双向门——一个纯数据字典模块、一个 React 上下文、组件里的字面量改为查表；不改数据含义与任何接口，`git revert` 即回滚；英文措辞是否得当须人在真实界面里看，登记为人工发现项）
- 提出人: user（INPUT-2026-09-28-001；INPUT-2026-09-27-002 第二步）
- 状态: CLOSED（2026-09-28 闭环：TASK-580 DONE，TEST-580/581 PASS、TEST-582 真实入口 PASS（`entry: user`）、TEST-571 修订后 PASS；L2 标准档，R1 由用户三点裁定终裁，R2–R4 全 PASS、R4 CP-1 由 CONDITIONAL 转 APPROVED；`tsc` 0 错误，全量 108 文件 968/968，治理单测 140 通过；TEST-582 于 2026-09-28 在用户运行中的本机服务（分支构建 `oQB8g1T-1e2Lr14uWjeiT`）上经真实 `GET /` 与 `GET/PUT /api/settings/language` 走完，见 EV §4；snapshot ledger seq 146 后快进合入 main（`6523c17`），合并后 `verify` PASS；本机服务已在跑本 CR 的构建，无需再重建）
- 占用 ID: REQ-F-340, DEC-460, TASK-580, TEST-580, TEST-581, TEST-582
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-330（☰「语言」开关从只决定回复语言扩为同时决定界面语言，开关旁提示文案随之改写）
- 影响模块: MOD-SETTINGS-UI（24 个组件 + `page.tsx` 的全部界面文案改走字典；新增 `LanguageProvider`；模块级接口辅助函数不再拼中文回退文案）、MOD-GOVERNANCE（`docs/ARCHITECTURE.md` 同步；新增守卫测试；`scripts/ui-contract.mjs` 改在字典解析后的源码上匹配，规则不变）
- 影响任务: 无既有任务变更，新增 TASK-580
- 影响测试: TEST-571（`tests/language-toggle.test.tsx` 改为在 `LanguageProvider` 内渲染，开关提示文案断言更新）；新增 TEST-580, TEST-581, TEST-582
- 当前证据: `project/05_evidence/EV-2026-09-28-ui-strings-i18n.md`
- 方案选项:
  - A. 每个组件内联 `language === "en" ? "…" : "…"`——用户否决（裁定①）：改动散在 24 个文件，没有单点能核对两边是否齐全，以后新增文案容易漏一边。
  - B. **集中字典 + Provider：新增 `src/lib/i18n.ts`（zh 表为键源，en 表在类型上必须同键；`t(language, key, vars)` 以 `{name}` 插值）与 `LanguageProvider` / `useLanguage` / `useT`；`page.tsx` 用 SSR 读到的语言渲染首屏并把初值传给 Provider，☰ 开关经上下文切换即时生效；24 个组件 + `page.tsx` 的 449 处中文字面量全部改走字典；新增守卫测试扫描界面源码，出现未走字典的中文即红（裁定③）；不加依赖**——选中。
  - C. 引入 i18n 库（next-intl / i18next）——用户否决（裁定①）：多一个依赖与配置层，本项目是单页 + 全局设置，用不上路由级 locale。
  - D. 连服务端回到界面的错误与提示文案（`src/lib` 非工具约 290 处 + API 路由约 80 处）一起做——用户否决（裁定②）：要逐条判断哪些面向用户，工作量约翻倍且触及 `chat.ts`、`agent-loop.ts` 等核心模块；登记为下一步候选。
  - E. 只守字典 zh / en 键集一致、不扫组件——用户否决（裁定③）：允许零散中文残留，只能靠人工发现。
- 选择理由: 三点裁定直接给出形态；字典与上下文都不依赖 `node:sqlite`，服务端组件与客户端组件用同一个 `t`；守卫用 TypeScript 自己的语法树扫描字符串 / 模板 / JSX 文本，注释不算，避免正则误报；沿用第一步的全局设置 `ui.language`，一个开关同时决定回复语言与界面语言，不新增设置键。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交，重建重启；界面回到中文字面量，开关回到只决定回复语言。
  - 数据：无——不新增设置键、表或文件；`ui.language` 仍由第一步的路由读写。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260928-ui-strings-i18n` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-580 DONE；TEST-580/581 PASS，TEST-582 真实入口 PASS；TEST-571 更新后 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿（含既有组件测试——默认中文下逐字不变——与 `tests/architecture-doc.test.ts`）。
- 真实入口: 已执行（2026-09-28 本机时区，用户运行中的本机服务，分支构建 `oQB8g1T-1e2Lr14uWjeiT`，由协调会话经真实 `GET /`（首屏 HTML）与 `GET/PUT /api/settings/language` 驱动；①默认 zh → 首屏含全部 10 个中文界面哨兵词、0 个英文（HTML 33467 字节）；②`PUT en` 后 `GET` 读到 en（持久化，即刷新所读）→ 首屏含全部 10 个英文哨兵词、0 个中文界面哨兵词（HTML 33703 字节，剩余 CJK 1865 个全部来自用户数据与转写记录）；③`PUT zh` → 首屏恢复 10 个中文哨兵词、0 个英文。☰ 开关即时切换（不刷新）与刷新后状态的目视由用户完成。详见 EV-2026-09-28-ui-strings-i18n §4）
  - **真实入口（必做）**：①默认中文首屏与现状一致；②切 English：☰ 与各面板即时变英文（不刷新），`GET /` 首屏 HTML 为英文且不含界面中文；③切回中文恢复；④刷新后仍是所选语言。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：用户三点裁定。
- R1 终裁: 已完成 | 用户 | 2026-09-28

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：用户 2026-09-28 原话「继续，开始第二步界面文案双语。」；协调会话摸底（界面 449 处中文字面量分布、服务端另有约 370 处）后就机制 / 范围 / 守卫三点发起 AskUserQuestion，用户逐点选择推荐项：集中字典 + Provider、只做浏览器渲染的界面文案、严格守卫。视三点裁定为终裁。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | English 下，☰ 菜单、对话控制台、展示屏、知识看板、各设置面板及其提示 / 错误文案全部为英文，中文下与现状逐字一致；用户数据（技能名、知识标题、实体名等）与品牌名保持原文；☰「语言」开关一处同时决定界面与回复语言，切换即时生效不刷新，刷新后首屏即为所选语言 | REQ-F-340（新增） | 新增 | 双向 | 真实入口：切 English 后首屏与面板为英文、切回中文恢复、刷新保持（证据：TEST-582） |
| CP-2 | 架构 | 集中字典 `src/lib/i18n.ts`（zh 表为键源，en 表类型上必须同键；`t(language, key, vars)` 以 `{name}` 插值，`_one` 单数变体）；`LanguageProvider` / `useLanguage` / `useT` 上下文，SSR 初值由 `page.tsx` 传入，`<html lang>` 由 Provider 跟随；`LanguageToggle` 改经上下文切换；不加依赖 | DEC-460（新增） | 新增 | 双向 | 机器：`tests/i18n-dictionary.test.ts` + `tests/language-provider.test.tsx`（TEST-580） |
| CP-3 | 模块 | 24 个组件 + `page.tsx` 共 449 处中文字面量（摸底数；守卫另找出 36 个与表达式相邻的 JSX 片段）改走字典，模块级标签表改为键表，接口辅助函数改返回 `status` / 空消息由组件成句（测试缝签名不变），日期格式化随语言取区域；`scripts/ui-contract.mjs` 在字典解析后的源码上匹配；`docs/ARCHITECTURE.md` 同步新增模块 / 组件 | TASK-580 | 大改 | 双向 | 机器：`tests/ui-strings-guard.test.ts` 扫描界面源码不得出现未走字典的中文（TEST-581）+ 既有组件测试默认中文逐字不变 + `tests/architecture-doc.test.ts` |
| CP-4 | 测试 | 新增 TEST-580（字典与 Provider）、TEST-581（守卫扫描）、TEST-582（真实入口）；TEST-571 改在 Provider 内渲染 | TEST-580, TEST-581, TEST-582, TEST-571 | 新增 | 双向 | 机器：`npx vitest run tests/i18n-dictionary.test.ts tests/language-provider.test.tsx tests/ui-strings-guard.test.ts tests/language-toggle.test.tsx` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260928-ui-strings-i18n` 节后，跑 `governance.py matrix CR-20260928-ui-strings-i18n` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 直接落实三点裁定：一个开关同时决定界面与回复语言，English 下全部界面文案为英文、中文下逐字不变，用户数据与品牌名保持原文 | APPROVED 新增 REQ-F-340 落 DEC-460；REQ-F-330 的开关语义扩展而不新增设置键 | APPROVED 落点为一个纯数据字典、一个上下文、24 个组件的查表改写；无新增路由、表、依赖 | APPROVED 验收含真实入口四步（切英文首屏与面板即英文、切回、刷新保持），机器对照 TEST-580/581 |
| CP-2 | APPROVED 切换即时生效不刷新；无 Provider 时默认中文，与现状一致 | APPROVED `en` 表以 `satisfies` 在编译期同键；`t` 纯函数、无 React、无 `node:sqlite`，服务端与客户端共用；`_one` 单数变体避免英文复数硬伤 | APPROVED `LanguageToggle` 改经上下文、状态文案按切换后的语言渲染；`MenuSection` 改收字典键，服务端渲染的标题也随切换更新 | APPROVED TEST-580 六例覆盖键集 / 占位符 / 插值 / `_one` / 无 Provider 默认 / 切换重渲染与 `<html lang>` |
| CP-3 | APPROVED 改写后守卫扫描零残留（唯一白名单是数据键 `__通用__`）；中文下既有组件测试全部照旧通过 | APPROVED 接口辅助函数不再拼中文回退：改返回 `status` 或空消息，由组件按当前语言成句，测试缝签名不变；UI 契约静态检查改在字典解析后的源码上匹配，规则本身不变 | APPROVED 脚本按字面量 / 模板 / JSX 文本三类批量替换 391 处，其余手工与第二遍脚本补齐；模块级标签表改为键表；日期取 `useLocale()`；`docs/ARCHITECTURE.md` 同步 `i18n.ts` 与 `LanguageProvider` | APPROVED TEST-581 守卫 + 既有组件测试 + TEST-560 架构图守卫 + UI 契约 3 例 |
| CP-4 | APPROVED 无用户可见行为之外的测试 | APPROVED 守卫用 TypeScript 语法树而非正则，注释不算 | APPROVED 三个新测试文件 + TEST-571 改在 Provider 内渲染 | APPROVED 定向与全量见 EV §3 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-580 对应验收条件①②③ | APPROVED 与 DEC-460 一致 | APPROVED 五项落点逐条可审阅可回滚 | APPROVED TEST-580/581/582 |
| CP-2 | APPROVED 无需求层遗留 | APPROVED 与 DEC-460 ①②③ 一致 | APPROVED TASK-580 ①② | APPROVED TEST-580 |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 与 DEC-460 ④⑤ 一致 | APPROVED TASK-580 ③④⑤ | APPROVED TEST-581 + TEST-560 + 既有组件测试 |
| CP-4 | APPROVED 无遗留 | APPROVED 无新增基础设施 | APPROVED 测试与源文件一一对应 | APPROVED 见 R2/CP-4 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-09-28 真实入口通过：en 下首屏 10/10 个英文哨兵词、0 个中文界面哨兵词，切回中文恢复，设置持久化（EV §4） | APPROVED 首屏由服务端按 `ui.language` 渲染，切换后同一 `GET /` 立刻是另一种语言，证明 SSR 初值链路（`readLanguage` → `translator` / Provider）成立 | APPROVED 剩余 CJK 全部来自技能名 / 知识标题 / 转写记录，界面词零残留 | APPROVED TEST-582 `real_entry: true`（`entry: user`）；事件日志留存协调会话 scratchpad `real-entry/t582.json`，关键数字已抄入 EV §4 |
| CP-2 | APPROVED 字典与 Provider 六例全绿 | APPROVED `<html lang>` 跟随与切换重渲染有断言 | APPROVED `tsc` 0 错误，`satisfies` 同键在编译期强制 | APPROVED `npx vitest run tests/i18n-dictionary.test.ts tests/language-provider.test.tsx` |
| CP-3 | APPROVED 守卫零残留（白名单仅 `__通用__`） | APPROVED UI 契约 3 例在字典解析后通过，规则未改 | APPROVED 架构图守卫通过证明已同步 | APPROVED `npx vitest run tests/ui-strings-guard.test.ts tests/visual.test.ts tests/architecture-doc.test.ts` |
| CP-4 | APPROVED | APPROVED | APPROVED | APPROVED 全量回归见 EV §3 |
