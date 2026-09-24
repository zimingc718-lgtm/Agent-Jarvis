# EV-2026-09-21-chat-skill-register

- 来源: 用户 INPUT-2026-09-21-003（"没有技能。帮我在对话里具备生成技能的功能，并能支持注册。"）+ 三点 AskUserQuestion 裁定（先预览确认再注册；只 SKILL.md；这次只做生成并注册）+ R1 终裁「同意，按方案推进」
- 时间: 2026-09-22
- 采集者: 协调会话（claude），在主仓库分支 `cr/20260921-chat-skill-register` 上执行；未触碰生产服务；测试经 `JARVIS_SKILLS_PATH` 隔离，未写入真实 `.data/skills`
- 支撑对象: `CR-20260921-chat-skill-register` CP-1..CP-4
- 可定位路径: 本文件；`src/lib/tools/skill-tools.ts`（`register_skill`）、`tests/skill-tools-register.test.ts`、`tests/tool-suites.test.ts`

## 1. 投入实现前的代码核对（决定了方案 D 的形状）

- `src/lib/skills.ts#registerSkill`：拖放/点选上传入口用的注册路径——`slugifySkillName` 生成目录名、`resolve` 后校验每个文件不逃出技能目录、目录已存在抛 `SkillNameConflictError`、写文件、`generateSkillDoc`、`store.insertSkill`（同名再抛 `SkillNameConflictError`）。对话里注册不需要第二条路径，复用它即可。
- `src/lib/skills.ts#generateSkillDoc`：文件集里含带 frontmatter `name:` 的 SKILL.md 时"作者已写则原样采用"（CR-20260911-skill-doc-preserved），不调模型——所以新工具传 `complete: null` 是安全的，注册不产生任何模型调用。
- `src/lib/tools/skill-tools.ts#createSkillTools`：返回 `[listSkills, readSkill, searchSkills]`，三者 `available: skillCount > 0`；`tests/tool-suites.test.ts` 用 `const [list, read, search] = createSkillTools(store)` 按位置解构——新工具只能**追加**在末尾。
- `tests/tool-suites.test.ts` ⑤"没有技能时三个工具都不注册"：与"第一个技能靠对话创建"直接冲突，必须改写语义而不是让新工具也在无技能时隐藏（否则用户永远无法从零开始）。
- `src/lib/tools/registry.ts`：`TOOL_PRIORITY.management` 是文档写明的"写与配置类"优先级；`ToolContext.userId` 可直接用于 `registerSkill`。
- 模块图守卫：新工具位于 `src/lib/tools/` 内，只引用 `../skills`、`../store`，不新增 lib→tools 边（CR-20260921-format-skill 刚踩过这个守卫，本次先核对）。

## 2. 机器证据（本地实际执行，非预测）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| CP-2/CP-3（TEST-530） | `tests/skill-tools-register.test.ts` | 8 | ①`SKILLS_ROOT` 已被隔离（否则后续用例会写进真实 `.data/skills`）；②无 `confirmed` 拒绝、磁盘与表不动、拒绝文案回喂"先给用户看全文"的约定；③`confirmed=true` 落盘 `SKILLS_ROOT/<slug>/SKILL.md`、表多一行、`read_skill` 读回正文、结果含 ☰ 提示；④重名返回含"同名"的可读说明、目录数与行数不增；⑤空参数拒绝，name 中的换行被压成空格、frontmatter 第二行仍是 `name: …`；⑥正文超 32 KB 拒绝且未创建目录；⑦`skillCount 0` 时可用而三个只读工具不可用；⑧`../../evil` 名字经 slug 规则仍落在 `SKILLS_ROOT` 内 |
| CP-3（TEST-531） | `tests/tool-suites.test.ts` | 13 | 既有 ①④与"读取不存在技能"三例按位置解构前三个工具不变仍绿；⑤改写为三个只读工具无技能时不注册、数组长度 4、第 4 个名为 `register_skill` 且可用；展示工具组 9 例不受影响 |

`npx tsc --noEmit`：**0 错误**（2026-09-22，本机）。

`npx vitest run`（全量，2026-09-22 本机）：99 文件 / 920 例，**919 通过、1 失败**——失败的是 `tests/floating-chat.test.tsx > skill intake ④`（29.7 秒超时），即 CR-20260921-markitdown-display 收口时已用 `git stash` 在干净基线复现过的既有 flaky，与本 CR 无关；本 CR 涉及的两个文件 21 例全绿。

## 3. 真实入口（2026-09-23 已执行）

- 时间: 2026-09-23 08:21–08:24（本机时区，UTC−5；对应 13:21–13:24Z）
- 环境: 用户本机**正在运行**的生产构建（`.next-prod`，BUILD_ID `L-76_5FmhmscDGSAOmDAe`，08:31 构建，晚于 `skill-tools.ts` 08:26）、用户自己的 `.data/agent-jarvis.sqlite` 与 `.data/skills`——即 DEC-210 ③ 的 `user` 环境，不是一次性服务器
- 驱动方式: 协调会话用一个 60 行的 HTTP 客户端（`chat_drive.py`，stdlib）向 `POST /api/chat/stream` 发送与用户在输入框里会打的一样的文字，解析 SSE 事件流；每步的完整事件列表（`start`/`delta`/`tool_call`/`tool_result`/`turn_usage`/`done`）留存于协调会话 scratchpad `real-entry/step*.json`（6 份，共约 200 KB）。**不是**在浮窗 UI 里点击——☰ 列表的目视核对由用户完成（2026-09-23 用户在 ☰ →「技能」里看到「会议纪要整理」，回复「看到了，标 CLOSED」）
- 应答模型: 服务器解析的最高优先级提供方 DeepSeek `deepseek-chat`（备选 OpenAI `gpt-5` 未触发 failover）
- 会话: `816dd238-863a-49e5-8a1a-c4fb33f76b98`，标题即第一句话，可在 ☰ 最近会话里打开复核
- 基线: 执行前 `GET /api/skills` 8 条、`.data/skills` 8 个目录，无「会议纪要」相关技能

| 步 | 发给对话的原话 | 观察到的事件 | 判定 |
|---|---|---|---|
| ① 生成 | 帮我生成一个「会议纪要」技能：把会议记录整理成结构化纪要，含议题、决议、待办（负责人＋截止日）。 | 11.9 s；`tool_call` 只有 `read_skill(知识条目规范)` 与 `list_skills`（两只读）；回复 2,656 字，含完整 SKILL.md（name「会议纪要整理」、description、8 个小节、自检清单 7 条），结尾「说『注册』我就把它登记为技能」；**无 `register_skill`**；API 仍 8 条、目录仍 8 个 | 符合 ① |
| ② 反例 | 再改改：自检清单精简到 4 条，其它不动。先别注册。 | 6.2 s；**零 `tool_call`**；回复给出修改稿（第 8 节 7→4 条，其余原样），结尾仍在等「注册」；API 8 条、目录 8 个 | 符合 ④（不说注册则不注册） |
| ③ 注册 | 注册 | 7.1 s；`tool_call register_skill` 参数 `name=会议纪要整理`、`confirmed=true`、`body` 为修改稿；`tool_result ok=true 注册技能 会议纪要整理`；回复「已注册『会议纪要整理』✅ 可在 ☰ →『技能』里查看、改名或删除」 | 符合 ② |
| ④ 核对 | 读一下「会议纪要整理」这个技能，把它的自检清单原文念给我。 | `GET /api/skills` **9 条**，新条目 name/description 与 frontmatter 一致；磁盘 `.data/skills/会议纪要整理/SKILL.md` 5,668 字节、LF、无 NUL、sha256 前缀 `29763b3b189d31b5`，frontmatter 两行完整，8 个 `##` 小节，自检清单 **4 条＝修改稿**；对话里 3.3 s，`tool_call read_skill(会议纪要整理)` ok，念出的 4 条与磁盘逐字一致，并说明「只有 SKILL.md，没有其它附属文件」 | 符合 ③ |
| ⑤ 重名 | 再帮我注册一个同名的「会议纪要整理」技能，内容就用上面这份，直接注册。 | 2.6 s；**零 `tool_call`**：模型自行说明同名已注册、列出三种可能意图请用户选 | 模型层先拦住（工具层未被触及） |
| ⑤b 重名（明确要求调工具） | 我就是想看看系统对重名怎么回应。请用原名「会议纪要整理」和上面这份内容再调一次注册工具，把系统返回的原话告诉我。 | 7.1 s；`tool_call register_skill(name=会议纪要整理, confirmed=true)`；`tool_result ok=false 技能重名：会议纪要整理`；回复逐字引用系统文案「已存在同名技能「会议纪要整理」，未注册。请换一个名称，或让用户先在 ☰ →「技能」里删除/改名旧的那个。」并说明「不覆盖，直接拒绝」；执行后 API 仍 9 条、目录仍 9 个、SKILL.md 仍 5,668 字节 / `29763b3b189d31b5` | 符合 ⑤ |

Token 用量（`turn_usage`，DeepSeek 计）：① 5,660+13,025 入 / 62+1,674 出；② 9,002 / 1,595；③ 8,987+19,587 / 1,517+1,597；④ 10,755+23,291 / 40+196；⑤ 12,637 / 198；⑤b 11,149+23,884 / 1,541+1,697。六轮合计约 138K 入、10K 出，单轮最长 11.9 s——没有出现 INPUT-2026-09-21 期间记录过的"生成失败"（孤儿 tool 消息 / 单轮 88 万 token）现象。

两处模型措辞失准，如实记下（不影响判定，因为系统行为正确）：⑤ 里模型说「确认后按覆盖注册」——工具不能覆盖，重名一律拒绝；⑤b 里模型自述「这次传的正文被截短过」——无从核实，且该调用被拒绝、未写入，原文件哈希不变。

据此 R4 矩阵 CP-1 四列由 CONDITIONAL 转 APPROVED；`test-results.json` TEST-530 `real_entry: true`、`entry: user`。

## 4. 局限（如实登记）

- `confirmed` 是模型自述，不是系统能验证的用户动作：本 CR 把"未经确认就注册"从"工具能做到"降为"模型违反约定"，没有消除。若真实入口发现模型会抢跑，下一步应把确认移到系统侧（例如注册前向用户弹确认），那是另一条 CR。
- 只注册一份 SKILL.md；带附属文件的技能仍走上传入口（用户裁定）。
- 对话里修改/删除已有技能不在范围内（用户裁定），仍用 ☰ 内的入口（REQ-F-031）。
