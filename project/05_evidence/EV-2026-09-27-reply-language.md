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

`npx tsc --noEmit`：**0 错误**（两次改动后各跑一次）。定向：首版 4 文件 34/34；加末尾提醒后 3 文件 28/28（含更新的前缀用例——同时断言 identity 与 suffix）。

`npx vitest run`（全量，最终代码，2026-09-27 本机）：105 文件 960/960 全部通过（既有 flaky floating-chat ④ 本轮未复现）。此前一轮（末尾提醒之前）为 105 文件 959/960，失败同样只有既有 flaky `tests/floating-chat.test.tsx > skill intake ④`。

## 4. 真实入口（2026-09-27 本机时区已执行，两次）

- 环境: 用户本机**正在运行**的生产构建，用户自己的 `.data`——DEC-210 ③ 的 `user` 环境。第一次构建 `UivEy7piYKVS1nN28DFYS`（只有前缀顶部一行指令），第二次 `oGAsKEmNMKu9IXML_USqp`（加末尾提醒）
- 驱动方式: 协调会话用 stdlib HTTP 客户端（`real_entry_t572.py`）：`GET/PUT /api/settings/language` 切换设置，`POST /api/chat/stream` 发送同一中文问题「列一下我有哪些技能，并用一句话说明每个技能是做什么的。」，解析 SSE；语言判定按正文（去掉加粗技能名与引号内容）里 CJK 与拉丁字母的数量。事件日志留存 scratchpad `real-entry/t572.json`
- 应答模型: DeepSeek `deepseek-chat`

| 次 | 步 | 设置 | 观察 | 判定 |
|---|---|---|---|---|
| 第一次 | ② | en | 回复以「I'll pull the registered skill list.」开头，随即「你当前注册了 10 个技能：…」整段中文（正文 CJK 387 / 拉丁 77） | **FAIL**——用户的中文提问 + 中文工具结果压过了前缀顶部的一行指令 |
| 第二次 | ① | zh（默认） | `list_skills` 照常；正文中文（CJK 357 / 拉丁 55）；3.6 s | 符合 |
| 第二次 | ② | en（`PUT` 后 `GET` 读到 en） | `list_skills` 照常；正文英文（CJK 0 / 拉丁 1435），技能名保留中文并附英文释义「客户技术准入解读 (Customer technical admission reading) — Separates hard requirements…」；3.3 s | 符合 ①③ |
| 第二次 | ③ | zh（切回） | 正文中文（CJK 327 / 拉丁 23）；3.0 s | 符合 ② |

第一次失败直接改了设计：`languageInstruction` 措辞加强（"You MUST … including when the user writes in Chinese …"），并新增 `languageReminder` 放进易变后缀——即系统提示的**末尾**，紧挨历史与用户消息；`tests/chat-stream.test.ts` 的前缀用例随之同时断言两处。这一条本来只写在「人工发现项」里（"模型是否严格遵从指令"），真实入口把它变成了必须修的事实。

顺带观察：zh 下模型在调工具前仍会先说一句英文（「I'll list the registered skills for you.」）再用中文作答——那是调用工具前的开场白，正文语言正确；如需彻底消除，下一步可在工具调用阶段的措辞上再收，本 CR 不扩。

☰ 开关本身与刷新后仍是所选值的目视由用户完成（设置持久化已由 `GET` 读回证明）。

据此 R4 矩阵 CP-1 四列由 CONDITIONAL 转 APPROVED；`test-results.json` TEST-572 `PASS`、`real_entry: true`、`entry: user`。

## 5. 局限（如实登记）

- 全局设置：Railway 上多用户共用一个回复语言；按用户分留待以后。
- 界面自身文案仍是中文：English 用户看到中文界面 + 英文回复，第二步（约 315 条文案）另立 CR。
- 模型是否严格遵从指令是提示词遵从问题，机器只能证明指令进了前缀；真实入口核一次，长期靠用户反馈。
- 工具结果里的中文（如「已存为知识条目…」）会被模型翻译转述，转述准确度未单独评估。
