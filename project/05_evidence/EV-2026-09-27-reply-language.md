# EV-2026-09-27-reply-language

- 来源: 用户 2026-09-27「继续。Jarvis应该支持英文。」（INPUT-2026-09-27-002）；四点 AskUserQuestion 裁定（对话 + 界面分两步 / ☰ 语言开关持久化 / 默认中文 / 工具文案保持中文）
- 时间: 2026-09-27 / 28
- 采集者: 协调会话（claude），分支 `cr/20260927-reply-language`；测试经 `JARVIS_DB_PATH` 隔离，未触碰生产数据
- 支撑对象: `CR-20260927-reply-language` CP-1..CP-4（INPUT-2026-09-27-002 第一步）
- 可定位路径: 本文件；`src/lib/language.ts`、`src/lib/chat.ts`（identity 一行）、`src/app/api/settings/language/route.ts`、`src/components/LanguageToggle.tsx`、`src/app/page.tsx`、`src/lib/ui-events.ts`、`docs/ARCHITECTURE.md`、`tests/language-settings-route.test.ts`、`tests/language-toggle.test.tsx`、`tests/chat-stream.test.ts`

## 1. 摸底与裁定

仓库没有任何 i18n 机制：`<html lang="zh-CN">` 写死于 `layout.tsx`，中文字串约 1,160 条（`src/components` 315、`src/lib` 非工具 289、`src/lib/tools` 474、`src/app` 84），`DEFAULT_SYSTEM_PROMPT` 为英文。用户裁定第一步只做回复语言：一个 ☰ 开关决定模型用中文还是英文作答，默认中文，工具描述与结果保持中文由模型自行读。

## 2. 设计与代码核对

- **指令进稳定前缀而非易变后缀**：`buildStablePrefix` 的 identity 改为 `[DEFAULT_SYSTEM_PROMPT, languageInstruction(language)].join("\n")`。它只在用户切换时变、切换之间字节相同，符合 REQ-NF-008 ①；放后缀语义等价但把"只在切换时变"的东西混进了每轮都变的段。
- **全局键 `ui.language`**：搜索 / 唤醒 / 文档设置全是全局 `app_settings`，沿用；缺省与任何非法值一律读作 `zh`，写入只接受 `zh` / `en`（否则 `LanguageSettingError` → 400）。多用户各自语言登记为局限。
- **`language.ts` 只 `import type { Store }`**：客户端组件 `LanguageToggle` 可以直接 import 它拿 `HTML_LANG` 与类型，不会把 `node:sqlite` 拉进浏览器包。
- **开关与 `ThemeToggle` 同形态**，差别在保存位置（服务端）与失败回退；`<html lang>` 由组件在客户端设置，不改 `layout.tsx` 的 store 边界；`page.tsx` 用 `readLanguage(getStore())` 传 SSR 初值。
- **架构图同步是守卫驱动的**：新增 `language.ts`、`/api/settings/language`、`LanguageToggle` 后 `tests/architecture-doc.test.ts` 会红，`docs/ARCHITECTURE.md` 三处 + 附录随之更新——CR-20260927-architecture-doc 立的规矩第一次被机器强制。
- 一处施工失误如实记：用 bash heredoc 打补丁时 `"\n"` 被转成真实换行，`tsc` 报 `Unterminated string literal`；改为经文件写入的脚本修复。教训已在 [[governance-gotchas]] 类记忆里有同类条目（heredoc 与转义）。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-570 | `tests/language-settings-route.test.ts` | 5 | 401；默认 zh；PUT en 持久化并可切回；非法值 / 坏 JSON / 空体 400 且不改设置；库里意外值按默认读 |
| TEST-571 | `tests/chat-stream.test.ts`（+1，文件合计 21）+ `tests/language-toggle.test.tsx`（2） | 3 | 默认前缀含「回复语言：中文」、设置 en 后含 `Reply language: English` 且互斥；开关两选项与 SSR 初值、点 English 保存 / 派发 `jarvis:language-changed` / `<html lang>` 变 `en`；保存失败回退并显示服务端说明，点当前值不发请求 |
| TEST-560（既有守卫） | `tests/architecture-doc.test.ts` | 6 | 新增模块 / 路由 / 组件已写进 `docs/ARCHITECTURE.md` |

`npx tsc --noEmit`：**0 错误**。定向 4 文件 **34/34**。

`npx vitest run`（全量，2026-09-28 本机）：105 文件 / 960 例，**959 通过、1 失败**——失败为既有 flaky `tests/floating-chat.test.tsx > skill intake ④`（27 s 超时，此前多次收口均出现并已在干净基线复现），与本 CR 无关；本 CR 涉及的 4 个文件全绿。

## 4. 真实入口（待执行）

在用户运行中的本机服务上：①切到 English 后用中文提一个会调工具的问题，回复为英文且工具照常；②切回中文，回复为中文；③刷新后开关仍是所选值。执行后补记并登记 TEST-572。

## 5. 局限（如实登记）

- 全局设置：Railway 上多用户共用一个回复语言；按用户分留待以后。
- 界面自身文案仍是中文：English 用户看到中文界面 + 英文回复，第二步（约 315 条文案）另立 CR。
- 模型是否严格遵从指令是提示词遵从问题，机器只能证明指令进了前缀；真实入口核一次，长期靠用户反馈。
- 工具结果里的中文（如「已存为知识条目…」）会被模型翻译转述，转述准确度未单独评估。
