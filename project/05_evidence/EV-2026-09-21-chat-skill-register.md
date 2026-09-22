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

## 3. 真实入口（本 CR 交付时未执行，需用户参与）

按 CR 文档「验收条件」在真实对话里走：①"帮我生成一个 XX 技能"→ 模型给出完整 SKILL.md **而不调用工具**；②"注册"→ 模型调用 `register_skill`，回复说明已注册及 ☰ 位置；③`GET /api/skills` 与 ☰「技能」列表出现该技能，`read_skill` 读回正文；④**反例**：不说注册或说"再改改"时模型不注册；⑤重名时得到可读冲突说明。

机器测试证明的是"没有 `confirmed` 就不写入"；"模型只在用户真的说了注册之后才置 `confirmed`"是模型对工具描述的遵从，只有真实对话能核——故 R4 矩阵 CP-1 四列为 CONDITIONAL，执行结果补记本节后转 APPROVED。

## 4. 局限（如实登记）

- `confirmed` 是模型自述，不是系统能验证的用户动作：本 CR 把"未经确认就注册"从"工具能做到"降为"模型违反约定"，没有消除。若真实入口发现模型会抢跑，下一步应把确认移到系统侧（例如注册前向用户弹确认），那是另一条 CR。
- 只注册一份 SKILL.md；带附属文件的技能仍走上传入口（用户裁定）。
- 对话里修改/删除已有技能不在范围内（用户裁定），仍用 ☰ 内的入口（REQ-F-031）。
