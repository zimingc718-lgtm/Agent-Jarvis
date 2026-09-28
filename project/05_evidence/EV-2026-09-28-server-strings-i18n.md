# EV-2026-09-28-server-strings-i18n

- 来源: 用户 2026-09-28「继续」→ 四候选中选「服务端回界面文案双语」（INPUT-2026-09-28-002）；四点 AskUserQuestion 裁定（三类都做 / 入口绑定 + 错误码 / 路由扫描 + 错误码覆盖 / 摘要与唤醒一并处理）
- 时间: 2026-09-28
- 采集者: 协调会话（claude），分支 `cr/20260928-server-strings-i18n`；测试经 `JARVIS_DB_PATH` 隔离，未触碰生产数据
- 支撑对象: `CR-20260928-server-strings-i18n` CP-1..CP-4（INPUT-2026-09-27-002 第三步）
- 可定位路径: 本文件；`src/lib/i18n-core.ts`、`src/lib/i18n-server.ts`、`src/lib/i18n-request.ts`、`src/lib/coded-error.ts`、`src/lib/chat.ts`、`src/lib/agent-loop.ts`、`src/lib/wake.ts`、`src/lib/sweep.ts`、`src/lib/entities.ts` 等领域模块、`src/app/api/**/route.ts`（26 个文件）、`src/lib/send-failure.ts`、`src/lib/ui-events.ts`、`scripts/ui-contract.mjs` 不变、`docs/ARCHITECTURE.md`、`tests/i18n-server.test.ts`、`tests/server-strings-lang.test.ts`、`tests/server-strings-guard.test.ts`、`tests/ui-strings-guard.test.ts`

## 1. 摸底与裁定

`src/lib`（非工具）与 `src/app/api` 共 781 条含中文的字面量，减去界面字典与语言指令自身后约 353 条，分为：API 路由 74 处（全部是回界面的 `message`）；对话编排与工具循环约 40 处（Provider 切换 / 失败下沉、上下文压缩与溢出说明、步数与预算提示、步骤行状态、发送失败红字）；领域校验错误约 90 处（经路由回到界面，同一句在工具路径回给模型）；其余约 150 处是给模型看的提示词与工具结果（`documents.ts` 读取错误、`extract.ts`、`ingest.ts`、`read_skill`）、写进数据文件的文案（`sources.ts` 采集备注与变更历史、`skills.ts` 默认描述、排版缓存标记）、控制台诊断（`auth-guard.ts` 配置说明、`supervisor-policy.ts`）与数据标识（`library.ts` 的 `资料库/` 前缀与 CSV 列名）。用户裁定：前三类做，后一类不做。

## 2. 设计与代码核对

- **一份查表核心、两本字典**：`i18n-core.ts` 抽出第二步的 `lookup`（占位符、`_one` 单数），`i18n.ts` 改用它；`i18n-server.ts` 的 `zhServer` 为键源（171 键，值逐字等于改写前的服务端文案），`enServer` 以 `satisfies` 编译期同键。服务端字典只被服务端模块 import，浏览器包不多一个字节。
- **请求级翻译器**：`i18n-request.ts` 的 `requestTranslator()` 在路由入口读一次全局 `ui.language`（与 `page.tsx` 首屏同一个设置）绑定 `t`；存储打不开时（`JARVIS_SECRET_KEY` 缺失的 503 路径）退回中文——那条路上没有可读的设置，如实登记为局限。`runChatTurn` 用已读到的 `language` 绑定 `ts`，经 `ToolLoopInput.t` 传给 `runToolLoop`，缺省中文。
- **错误码**：`coded-error.ts` 的 `withCode` / `isCoded` / `messageFor`；八个类型化错误类（`EntityError`、`KnowledgeError`、`LibraryError`、`DocumentPathError`、`SweepSettingsError`、`WakeSettingsError`、`ZipError`、`ChatServiceError`）加 `static coded(code, params[, status])`——中文 `message` 由字典派生，所以工具路径（`propose_entity`、`save_knowledge` 等）回给模型的仍是原句；路由边界 `messageFor(t, error)` 按 `code` 用当前语言成句，非 coded 错误（工具路径专用的 `DocumentPathError` 读取错误等）原样透出。只改了会经路由回界面的抛错点；`documents.ts` 读取类、`extract.ts`、`ingest.ts`、`skills.ts` 读文件类保持字面量。
- **结果对象带码**：`validateRoot` 返回 `code`；巡检 `SweepOutcome.reasonCode`；唤醒 `WakeOutcome.messageCode`；排版 `FormatResult.noteCode`（缓存行一起存，旧行没有码时照读 `note`）；`markitdownFailureKey`；技能提议裁定 `code`；Provider 备注 `noteCode`（`ModelSettings` 按界面字典成句）。
- **提示词随语言**（裁定④）：压缩摘要 `turn.summaryPrompt`（en 版全英文并要求英文摘要）经 `summarizeSpan({ language })`；唤醒 `wake.instructions` / `wake.transcriptHeader` / `wake.transcriptEmpty` 经 `buildWakeMessages(rows, identity, language)`，提醒前缀 `wake.noticePrefix` 按写入时的语言。适配层「不支持工具调用」通知在编排层改用 `turn.toolsUnsupported` 重述，适配层字符串不再抵达界面。
- **浏览器里跑的 lib 代码**：`send-failure.ts` 由 `FloatingChat` 传入 `useT()`；`STORAGE_CONFIG_HINT` 删除，`page.tsx` 与 `SettingsDialog` 改用界面字典 `page.storageHint`；`SETTINGS_PANEL_LABEL` → `SETTINGS_PANEL_KEY`（第二步漏在 `src/lib` 里的四个面板标签，`FloatingChat` 的「在屏上打开」按钮此前仍是中文）。
- **路由改写**：26 个文件、74 处 `message` 字面量改 `t(...)`，每个用到的处理函数首行 `const t = requestTranslator();`，catch 处改 `messageFor(t, error)`；`library/browse` 与 `knowledge/overview` 的「未分类」桶按语言命名；`skills/[name]` 内部越界 `Error` 改英文技术文案（被 catch 后由 `api.skillDirEscape` 成句，本就不直出）。
- **守卫**：`tests/ui-strings-guard.test.ts` 扫描范围加 `src/app/api/**`（路由文件零中文字面量，26 文件全部通过）；新增 `tests/server-strings-guard.test.ts` 扫 `src/lib` 与 `src/app/api` 里所有 `coded("…")` / `unformatted` / `reasonCode` / `messageCode` / `noteCode` / `code` / `t` / `ts` / `tServer` / `zhMessage` / `messageFor` 命名的码，逐个核对在字典里。
- **一处施工失误如实记**：`buildWakeMessages` 原有第二个参数 `identity`，脚本按正则把 `language` 追加为第三个参数，而调用处按第二个参数传——`tests/server-strings-lang.test.ts` ③ 第一次运行即红（系统提示词开头成了「en」），改为 `buildWakeMessages(rows, undefined, language)` 后通过。
- **一处测试环境副作用如实记**：路由现在都会经 `requestTranslator()` 打开存储；`tests/library-routes.test.ts` 把 `JARVIS_DB_PATH` 放在临时目录且从不关闭存储（资料库路由此前从不碰存储），Windows 下 `afterAll` 的 `rmSync` 因 SQLite 句柄未释放报 EPERM。补 `getStore().close()` 后通过；产物行为不受影响（服务里存储本就常开）。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-590 | `tests/i18n-server.test.ts` | 4 | zh / en 键集与占位符逐键一致、en 无中文；`tServer` / `serverTranslator` / `zhMessage`；coded 错误 `message` 仍是原中文句、`messageFor` 按语言重述；非 coded 原样透出、fallback、`withCode` |
| TEST-591 | `tests/server-strings-lang.test.ts` | 4 | 默认中文四类 message 逐字不变；切 en 后为英文、切回恢复（路由字面量 / `validateRoot` code / coded `WakeSettingsError` / 带参字面量）；`buildWakeMessages` 提示词与转录标题按语言；`runToolLoop` 未知工具步骤行状态跟随 `t` |
| TEST-592 | `tests/server-strings-guard.test.ts` | 2 | 扫到的错误码非空且覆盖路由与领域模块；每个码都是服务端字典的键 |
| TEST-581（扩） | `tests/ui-strings-guard.test.ts` | 2 | 扫描范围加 API 路由（>30 文件），零中文字面量 |
| 既有 | 全部路由 / 领域 / 对话 / 唤醒 / zip 测试 | — | 默认中文逐字不变 |

`npx tsc --noEmit`：**0 错误**（核心模块落地后一次、四批补丁后一次、含新测试一次，均为 0）。

`npx vitest run`（全量，最终代码，2026-09-28 本机）：111 文件 / 978 例：976 通过，2 例在全量负载下超时（既有 flaky tests/floating-chat.test.tsx skill intake ④ 与 tests/knowledge-dashboard.test.tsx ①），两文件单独重跑 78/78 通过

## 4. 真实入口（2026-09-28 本机时区已执行）

- 环境: 用户本机**正在运行**的生产构建 `kQJFQcIfS8LGB18ZjELjh`，用户自己的 `.data`——DEC-210 ③ 的 `user` 环境
- 驱动方式: 协调会话用 stdlib HTTP 客户端（`real_entry_t593.py`）：`GET/PUT /api/settings/language` 切换设置；四条会被拒绝的请求各走一次——`POST /api/settings/documents` 相对路径（`validateRoot` 的 code）、`PUT /api/settings/wake` 间隔 0（coded `WakeSettingsError` 经 `messageFor`）、`POST /api/library/decide` 非 JSON（路由字面量）、`GET /api/actions?effects=bogus`（带参字面量）。全程只有被拒绝的请求，未写入任何数据。请求与应答日志留存 scratchpad `real-entry/t593.json`

| 步 | 设置 | 观察 | 判定 |
|---|---|---|---|
| ① default zh | zh | 四条均 400；docs「请填绝对路径。」· wake「唤醒间隔须是 1–1440 之间的整数分钟。」· decide「请求体不是合法的 JSON。」· actions「未知的 effects 取值：bogus（只接受 read / write / network）。」；0.08 s | 与现状逐字一致 |
| ② en | en | 四条均 400；docs「Enter an absolute path.」· wake「The wake-up interval must be a whole number of minutes between 1 and 1440.」· decide「The request body is not valid JSON.」· actions「Unknown effects value(s): bogus (only read / write / network are accepted).」；0.03 s | 符合 ① |
| ③ back to zh | zh | 四条均 400；docs「请填绝对路径。」· wake「唤醒间隔须是 1–1440 之间的整数分钟。」· decide「请求体不是合法的 JSON。」· actions「未知的 effects 取值：bogus（只接受 read / write / network）。」；0.03 s | 与现状逐字一致 |

对话通知（Provider 切换、上下文溢出、步数预算）与压缩摘要 / 唤醒提示词在真实服务上未单独触发——它们需要特定的模型状态才出现；机器对照为 TEST-591 ③④ 与 `tests/chat-stream.test.ts` 既有用例（默认中文逐字不变）。登记为本 CR 的人工发现项之一：English 下第一次出现这些通知时由用户看一眼。

据此 R4 矩阵 CP-1 四列由 CONDITIONAL 转 APPROVED；`test-results.json` TEST-593 `PASS`、`real_entry: true`、`entry: user`。

## 5. 局限（如实登记）

- 存储未配置时的 503 文案只能是中文：语言设置就在那个打不开的存储里。
- 写进数据文件的文案不变：采集源健康备注与变更历史（`sources.ts`）、技能默认描述、排版缓存里的旧 `note` 行——它们是写入时的文本，换语言不会回头改。
- 工具路径回给模型的文案仍是中文（裁定④），`loop.failed` 步骤行里拼进的领域错误 `message` 在工具路径也是中文。
- `library.missingItems` 等把多个名字拼进一句时用的分隔符「、」在英文句里保留。
- 英文措辞是否得当、模型是否按所选语言写压缩摘要与唤醒提醒——人工发现项。
