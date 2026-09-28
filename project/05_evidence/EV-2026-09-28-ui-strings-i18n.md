# EV-2026-09-28-ui-strings-i18n

- 来源: 用户 2026-09-28「继续，开始第二步界面文案双语。」（INPUT-2026-09-28-001）；三点 AskUserQuestion 裁定（集中字典 + Provider / 只做浏览器渲染的界面文案 / 严格守卫）
- 时间: 2026-09-28
- 采集者: 协调会话（claude），分支 `cr/20260928-ui-strings-i18n`；测试经 `JARVIS_DB_PATH` 隔离，未触碰生产数据
- 支撑对象: `CR-20260928-ui-strings-i18n` CP-1..CP-4（INPUT-2026-09-27-002 第二步）
- 可定位路径: 本文件；`src/lib/i18n.ts`、`src/components/LanguageProvider.tsx`、`src/components/LanguageToggle.tsx`、`src/components/MenuSection.tsx`、`src/app/page.tsx`、24 个组件文件、`scripts/ui-contract.mjs`、`docs/ARCHITECTURE.md`、`tests/i18n-dictionary.test.ts`、`tests/language-provider.test.tsx`、`tests/ui-strings-guard.test.ts`、`tests/language-toggle.test.tsx`

## 1. 摸底与裁定

浏览器渲染的界面文案（`src/components` 24 个文件 + `src/app` 页面）经正则摸底共 449 处中文字面量：`KnowledgeDashboard` 108、`FloatingChat` 63、`DocumentSettings` 34、`LibraryPanel` 31、`SkillList` 26、`KnowledgeList` 23、`SearchSettings` 22、`ActionLog` 20、`DisplayScreen` 19、`WakeSettings` 17，其余 14 个文件各 1–13 处。服务端产生、经接口回到界面的中文另有约 290 处（`src/lib` 非工具模块）+ 约 80 处（API 路由），按裁定②不在本 CR 内。

## 2. 设计与代码核对

- **字典**：`src/lib/i18n.ts` 的 `zh` 表为键源（426 键，值逐字等于改写前的界面文案），`en` 表以 `satisfies Record<MessageKey, string>` 在编译期强制同键；`t(language, key, vars)` 以 `{name}` 插值，`vars.count === 1` 时取 `<key>_one` 单数变体（`docs.added`、`board.requirementsCount`、`board.unreadChanges`、`board.brokenSources`、`library.fileCount`）。纯数据、无 React、无 `node:sqlite`，服务端组件 `page.tsx`（`translator(initialLanguage)`）与客户端组件（`useT()`）共用。
- **上下文**：`LanguageProvider` 持有当前语言并设置 `<html lang>`；`page.tsx` 以 `readLanguage(getStore())` 的值注入并包住整页；无 Provider 时默认中文——既有组件测试因此不用改。`MenuSection` 改收字典键（服务端组件里渲染的标题才能随切换更新）；`LanguageToggle` 改经上下文切换，状态文案按切换后的语言渲染，保存失败回退。
- **批量改写**：脚本按三类替换——字面量 `"…"` → `t("key")`（属性位置自动改为 `attr={t("key")}`）、模板 `` `…${x}…` `` → `t("key", { … })`、JSX 文本 `>…<` → `>{t("key")}<`——共 391 处；模块级标签表（`EFFECT_LABEL`、`LIGHT_LABEL`、`FILTER_LABEL`、`PRIORITY_LABEL`、`KIND_LABEL`、`HEALTH_TEXT`、`SOURCE_LABEL`、`OUTCOME_TEXT` 等）改为键表，读取处包 `t()`；每个函数组件首行加 `const t = useT();`。其余由手工与第二遍脚本补齐。
- **守卫找出摸底漏掉的 36 个片段**：正则摸底只认「`>` 与 `<` 之间」的 JSX 文本，与表达式相邻的文本（如「会话：{title}」「共 {n} 份 · 待采纳 {p}」「待采纳（{n}）— …」）全部漏掉；语法树守卫第一次运行即逐条列出，随后收进字典（`actions.conversation`、`library.summary`、`board.pendingHeading` 等 29 键）。这正是用户裁定③要的效果。
- **接口辅助函数不再拼中文回退**：`*ViaApi` 一类模块级函数原本在服务端没给 `message` 时拼「设置失败（500）。」之类回退文案；现在改为返回 HTTP `status`（`DocumentSettings`、`DisplayScreen`）、抛带 `status` 的 `DecideFailedError`（`LibraryPanel`）或返回空消息（`KnowledgeDashboard` 巡检），由组件按当前语言成句。**测试缝签名不变**——第一版给 `decide` / `saveSweep` / `runSweepRound` 多传了 `t`，`tests/knowledge-dashboard.test.tsx` 与 `tests/library-panel.test.tsx` 六条 `toHaveBeenCalledWith` 立刻红，改回后全绿。
- **UI 契约静态检查**：`scripts/ui-contract.mjs` 的 SK-01 / LB-11 / LB-12 / LB-13 按源码里的中文匹配（`aria-label="把这条回复存入知识库"`、`已注册技能|技能注册失败`、`今日唤醒用量` 等），字面量进字典后四条全红。处置：装载组件源码时把 `t("key")` 解析回 zh 文本（无参 → `"…"`，带参 → `` `…` `` 模板，与原代码形态一致）再交给规则，**规则本身一字未改**。
- **唯一白名单**：`KnowledgeDashboard` 的 `GENERAL_ENTITY = "__通用__"` 是与 `knowledge-tools.ts` 同字面量的数据键（`tests/knowledge-dashboard.test.tsx` 把两边钉在一起），不是文案，守卫白名单只放这一项。
- **不在本 CR 内、如实登记**：`STORAGE_CONFIG_HINT`（`runtime-config.ts`）与 `describeSendFailure`（`send-failure.ts`）等服务端文案仍是中文；未登录访客首屏按中文渲染（`readLanguage` 只在 store 就绪时读）。
- **架构图**：`docs/ARCHITECTURE.md` 文首日期与 main 提交号更新，1.1 节增写字典 / Provider 的数据流，☰ 行与横切行、附录清单加 `LanguageProvider` 与 `i18n.ts`；`tests/architecture-doc.test.ts` 通过。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-580 | `tests/i18n-dictionary.test.ts` + `tests/language-provider.test.tsx` | 4 + 2 | zh / en 键集与占位符逐键一致、en 无中文（例外仅「中文」标签）、`t` 插值 / 未知占位符保留 / `_one`、`translator`；无 Provider 默认中文、SSR 初值、切换后消费者重渲染与 `<html lang>` |
| TEST-581 | `tests/ui-strings-guard.test.ts` | 2 | 扫描范围覆盖组件与页面且不含 API 路由；语法树里字符串 / 模板 / JSX 文本无中文（白名单仅 `__通用__`） |
| TEST-571（修订） | `tests/language-toggle.test.tsx` | 2 | 在 Provider 内渲染；点 English 后开关自身提示与状态文案变英文、`<html lang>` 变 en；失败回退 |
| 既有 | 全部组件测试、`tests/visual.test.ts`（UI 契约 3 例）、`tests/architecture-doc.test.ts` | — | 默认中文逐字不变；契约规则在字典解析后仍成立；架构图已同步 |

`npx tsc --noEmit`：**0 错误**（批量改写后 422 → 加 `useT` 钩子后 29 → 手工收尾后 0）。

`npx vitest run`（全量，最终代码，2026-09-28 本机）：**108 文件 968/968 全部通过**（较上一 CR 的 105 文件 960 例多 3 文件 8 例）。第一轮全量为 105 通过 / 3 失败 7 例——UI 契约 4 条规则 + 测试缝签名 6 条断言（见 §2），修正后全绿。

## 4. 真实入口（2026-09-28 本机时区已执行）

- 环境: 用户本机**正在运行**的生产构建 `oQB8g1T-1e2Lr14uWjeiT`，用户自己的 `.data`——DEC-210 ③ 的 `user` 环境
- 驱动方式: 协调会话用 stdlib HTTP 客户端（`real_entry_t582.py`）：`GET/PUT /api/settings/language` 切换设置，`GET /`（`accept: text/html`）取首屏 HTML——这正是浏览器刷新页面时拿到的东西；判定用只有界面才会产出、且首屏就渲染的 10 个哨兵词（☰ 按钮说明「打开菜单」、展示屏开场文案、「进入知识看板」、状态灯「正在检测模型连接」、上传菜单三项、「在屏上打开：」「收起对话」「把这条回复存入知识库」「新对话」），中英各一套；☰ 抽屉的内容只在打开时才渲染，不在首屏 HTML 里，第一次跑用抽屉标题作哨兵只命中 1/10，换成首屏词后重跑。用户数据里的中文（技能名、知识标题、转写记录）不计。事件日志留存 scratchpad `real-entry/t582.json`

| 步 | 设置 | 首屏观察 | 判定 |
|---|---|---|---|
| ① | zh（默认） | 中文哨兵 10/10、英文 0/10；HTML 33467 字节，CJK 1966 个；0.1 s | 与现状一致 |
| ② | en（`PUT` 后 `GET` 读到 en） | 英文哨兵 10/10、中文界面哨兵 0/10；HTML 33703 字节，剩余 CJK 1865 个全部来自用户数据与转写记录；0.0 s | 符合 ①②④ |
| ③ | zh（切回） | 中文哨兵 10/10、英文 0/10；0.0 s | 符合 ③ |

`<html lang>` 在首屏 HTML 里仍是 `layout.tsx` 写死的 `zh-CN`，由 Provider 在客户端水合后设为所选语言（与第一步的设计一致，见 EV-2026-09-27-reply-language §2）。

☰ 开关即时切换（不刷新页面）与切换后各面板文案的目视由用户完成；服务端持久化与首屏语言已由 `GET` 证明。

据此 R4 矩阵 CP-1 四列由 CONDITIONAL 转 APPROVED；`test-results.json` TEST-582 `PASS`、`real_entry: true`、`entry: user`。

## 5. 局限（如实登记）

- 全局设置：Railway 上多用户共用一个界面语言（沿用第一步）。
- 服务端回到界面的文案仍是中文：API 错误信息、对话里的系统提示条、`STORAGE_CONFIG_HINT`、发送失败说明等，English 用户会在这些位置看到中文——下一步候选。
- 未登录访客的首屏按中文渲染。
- 英文措辞是否得当（语气、术语、长度）机器判不了，靠用户在 English 下使用时反馈——人工发现项。
