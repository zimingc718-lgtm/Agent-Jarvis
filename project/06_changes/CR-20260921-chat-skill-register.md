# CR-20260921-chat-skill-register

- 级别: L2（标准档：全部 CP 双向门——新增一个工具与一条注册路径，代码可 `git revert`；注册产生的技能文件夹与技能表行是用户显式确认后才写入的、可在 ☰ 里删除的普通技能，与手工上传的技能形态完全一致；不改写任何既有数据）
- 提出人: user（INPUT-2026-09-21-003）
- 状态: 已合并 main（`febec93` 实现 + `6414c0a` snapshot，ledger seq 141；合并后 `verify` PASS；本机按新构建 `L-76_5FmhmscDGSAOmDAe` 重建重启）。真实入口 ①-⑤ 已于 2026-09-23 在用户运行中的本机服务上经真实 `POST /api/chat/stream`（DeepSeek `deepseek-chat`）走完，正例/反例/重名全部符合预期，R4 CP-1 转 APPROVED，见 EV §3。CLOSED 只差用户在 ☰ →「技能」里目视一次「会议纪要整理」在列表中（列表与已核对的 `GET /api/skills` 同源）
- 占用 ID: REQ-F-300, DEC-410, TASK-530, TEST-530, TEST-531
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-020（技能注册入口在拖放/点选之外多一条对话内路径）、REQ-F-030（技能工具集从三只读增一写）
- 影响模块: MOD-SKILLS / MOD-TOOLS（`skill-tools.ts` 新增 `register_skill`）
- 影响任务: 无既有任务变更，新增 TASK-530
- 影响测试: 无既有测试变更，新增 TEST-530, TEST-531
- 当前证据: `project/05_evidence/EV-2026-09-21-chat-skill-register.md`
- 方案选项:
  - A. 在对话里生成后直接注册（模型调用工具即写入）——用户否决（AskUserQuestion）：写坏的技能会被悄悄注册进去，只能事后去 ☰ 里删。
  - B. 允许模型一次生成多个文件（SKILL.md + 模板/参考资料）一起注册——用户否决：预览与确认面变大，需要附属文件时仍走既有上传入口。
  - C. 连"对话里修改/删除已有技能"一起做——用户否决：三个写动作一起设计范围与风险都更大，改/删仍用 ☰ 里已有的入口（REQ-F-031）。
  - D. **新增一个"写"工具 `register_skill`，只接受一份带 frontmatter 的 SKILL.md 正文；对话协议为"模型先在回复里给出 SKILL.md 全文 → 用户明确说注册 → 模型才调用工具"，工具以 `confirmed` 参数承载这一步并在描述里写死约定；注册路径完整复用既有 `registerSkill()`（slug、路径穿越守卫、重名 409、落盘 + 插表），`complete: null` 即可（带 frontmatter 的 SKILL.md 不触发模型生成）**——选中。
- 选择理由: 见方案 D；用户三点裁定：先预览确认再注册、只 SKILL.md、这次只做生成并注册。复用 `registerSkill()` 而不另写一条注册路径，是因为它已经是手工上传入口在用的那条：同一套 slug/穿越/重名规则，对话里注册出来的技能与拖放注册的在磁盘与表里毫无区别，`read_skill`/`search_skills`/☰ 列表/删除改名全部天然适用。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交，重建重启；工具从目录里消失，模型不再能注册技能。
  - 数据：对话里注册出来的技能就是普通技能（`.data/skills/<slug>/SKILL.md` + `skills` 表一行），回滚代码不需要清理它们；不想要的用 ☰ 里既有的删除即可。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260921-chat-skill-register` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-530 DONE；TEST-530/531 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿；模块图守卫（`tests/module-graph.test.ts`）不新增 lib→tools 边（本工具本身就在 `src/lib/tools/` 内，无此风险）。
- 真实入口: 已执行（2026-09-23，用户本机运行中的生产构建 `L-76_5FmhmscDGSAOmDAe`，由协调会话经真实 `POST /api/chat/stream` 驱动、DeepSeek `deepseek-chat` 应答，会话 `816dd238-863a-49e5-8a1a-c4fb33f76b98`：①「帮我生成一个会议纪要技能」→ 模型只调 `list_skills`/`read_skill` 对齐既有规范，回复给出完整 SKILL.md，未调 `register_skill`；②「再改改…先别注册」→ 零工具调用，只给修改稿；③「注册」→ `register_skill(confirmed=true)` ok，回复含 ☰ 位置；④ `GET /api/skills` 8→9，`.data/skills/会议纪要整理/SKILL.md` 5668 字节且为修改稿（自检清单 4 条），对话里 `read_skill` 读回逐字一致；⑤ 同名再注册→模型先自行拦下未调工具，明确要求后调用得到「已存在同名技能…未注册」原话，原文件 sha256 不变。详见 EV-2026-09-21-chat-skill-register §3；☰ 列表目视由用户完成）
  - **真实入口（必做）**：①用户在对话里说"帮我生成一个 XX 技能"，模型在回复里给出完整 SKILL.md（frontmatter + 正文）**而不调用工具**；②用户回复"注册"，模型调用 `register_skill`，回复里说明已注册及在 ☰ 里的位置；③`GET /api/skills` 与 ☰「技能」列表出现该技能，`read_skill` 能读回正文；④用户不说注册、或说"再改改"时，模型不注册（反例必须真实试一次）；⑤重名时工具返回可读的冲突说明而非报错堆栈。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：待用户拍板。
- R1 终裁: 已完成 | 用户 | 2026-09-22

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：INPUT-2026-09-21-003 的四个待确认点中三个经 AskUserQuestion 裁定（先预览确认再注册；只 SKILL.md；这次只做生成并注册），第四点"写工具是否需确认"由"先预览确认"这一裁定天然覆盖（`confirmed` 参数即用户确认的承载）。协调会话展示方案要点（对话协议、复用 `registerSkill()`、范围、既有测试⑤语义相应调整、回滚）后，用户通过 AskUserQuestion 选择「同意，按方案推进」。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 对话内可让模型生成一份技能的 SKILL.md、先给用户看全文、用户明确说"注册"后才注册；只 SKILL.md、不含改/删 | REQ-F-300（新增） | 新增 | 双向 | 真实入口：对话里生成 → 用户说注册 → ☰ 技能列表与 `GET /api/skills` 出现该技能；反例——不说注册则不注册 |
| CP-2 | 架构 | 新增写工具 `register_skill`（优先级 `management`，`skillCount === 0` 时也可用——第一个技能就是靠它创建的），参数 `name`/`description`/`body`/`confirmed`；`confirmed !== true` 一律拒绝并回复"先把 SKILL.md 全文给用户看、等用户说注册"；正文上限 32 KB（`MAX_INJECTION_BYTES`）；注册完整复用 `registerSkill()`（`complete: null`），重名/穿越走既有守卫 | DEC-410（新增） | 新增 | 双向 | 机器：`tests/skill-tools-register.test.ts` 覆盖 confirmed 缺失拒绝、正常注册落盘 + 插表、重名冲突可读说明、超长拒绝、`skillCount 0` 可用、slug 穿越守卫 |
| CP-3 | 模块 | `createSkillTools` 返回数组**追加**第 4 个元素（既有测试按位置解构前三个，不能插在中间）；工具结果文案告知模型"提醒用户可在 ☰ 技能里查看/改名/删除" | TASK-530 | 新增 | 双向 | 机器：`tests/tool-suites.test.ts` 既有 ①④ 不变仍绿 + 新增第 4 位可用性断言 |
| CP-4 | 测试 | 新增 `tests/skill-tools-register.test.ts`；扩展 `tests/tool-suites.test.ts` | TEST-530, TEST-531 | 新增 | 双向 | 机器：`npx vitest run tests/skill-tools-register.test.ts tests/tool-suites.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260921-chat-skill-register` 节后，跑 `governance.py matrix CR-20260921-chat-skill-register` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 先预览、用户说注册才写入，直接落实用户三点裁定；只 SKILL.md、不含改删，范围与裁定一致 | APPROVED 新增 REQ-F-300 落 DEC-410；REQ-F-020/031 的既有入口与行为未被改写 | APPROVED 落点单一（`skill-tools.ts` 新增一个描述符），不牵动上传路由与 ☰ 组件 | APPROVED 真实入口五步含反例（不说注册则不注册），非机器空断言 |
| CP-2 | APPROVED 未确认时的拒绝文案把约定说回给模型，用户侧看到的是"先给你看全文"而不是静默失败 | APPROVED 注册完整复用 `registerSkill()`（拖放上传同一路径），对话里注册的技能在磁盘与表里与上传的无差别；`complete: null` 不引入模型调用 | APPROVED name/description 换行压掉保护 frontmatter；`MAX_INJECTION_BYTES` 复用既有常量；`SkillNameConflictError` 映射为可读说明 | APPROVED `tests/skill-tools-register.test.ts` 8 例覆盖 confirmed 缺失、落盘插表、重名、空参数、换行、超长、无技能可用、穿越名字 |
| CP-3 | APPROVED 结果文案让模型提醒用户 ☰ 位置，与既有技能管理入口衔接 | APPROVED 追加为第 4 个元素而非插入中间，既有按位置解构的测试与调用点零改动 | APPROVED `available: () => true` 与三个只读工具的 `skillCount > 0` 规则并存，语义在测试⑤中显式写明 | APPROVED `tests/tool-suites.test.ts` 既有三例不变仍绿，⑤改写后断言长度 4 与第 4 位名称/可用性 |
| CP-4 | APPROVED 测试范围与验收条件的机器可证部分一一对应 | APPROVED `JARVIS_SKILLS_PATH` 在动态 import 前隔离，沿用 `skills-route.test.ts` 惯例，不会写进真实 `.data/skills`（用例①专门断言） | APPROVED 新增测试文件与源文件一一对应 | APPROVED 目标 21 例全绿；全量回归 920 例仅 1 例既有 flaky（floating-chat ④，已于干净基线复现），非本 CR 引入 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-530 对应验收条件①②③⑤ | APPROVED 与 DEC-410 一致 | APPROVED 单文件改动，可审阅可回滚 | APPROVED TEST-530/531 覆盖 |
| CP-2 | APPROVED 拒绝路径先于任何写入，用户不会得到半注册状态 | APPROVED 参数校验→拼 SKILL.md→大小校验→`registerSkill` 的顺序与 DEC-410 描述一致 | APPROVED TASK-530 逐项写明校验顺序与错误映射 | APPROVED TEST-530 逐项对应 |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 无新增架构决策 | APPROVED 返回数组末尾追加，`chat.ts#buildRegistry` 的注册循环无需改动 | APPROVED TEST-531 |
| CP-4 | APPROVED 无遗留 | APPROVED 无新增 mock 基础设施 | APPROVED 测试与源文件一一对应 | APPROVED 见 R2/CP-4 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 2026-09-23 真实对话正例①③、反例②、重名⑤均符合预期（EV §3）；用户「先预览、说注册才写入」的裁定在真实入口上成立 | APPROVED 真实入口证实模型遵从工具描述：无「注册」不置 confirmed；`register_skill` 复用 `registerSkill()` 的产物被 `read_skill` 与 `GET /api/skills` 原样读到 | APPROVED 落盘文件是用户确认的修改稿而非首稿（自检清单 4 条）；重名冲突文案原样回到对话且原文件哈希不变 | APPROVED TEST-530 `real_entry: true`（`entry: user`）；6 份步骤事件日志留存协调会话 scratchpad，关键数字已抄入 EV §3 |
| CP-2 | APPROVED 拒绝/冲突/超长三种用户可见文案均有断言 | APPROVED 用例③经 `read_skill` 读回，证明注册产物走的是既有读路径 | APPROVED 用例⑧证明穿越名字被既有 slug 规则收住 | APPROVED `npx vitest run tests/skill-tools-register.test.ts` 8 例全绿，已本机实测 |
| CP-3 | APPROVED | APPROVED | APPROVED | APPROVED `npx vitest run tests/tool-suites.test.ts` 13 例全绿，已本机实测 |
| CP-4 | APPROVED | APPROVED | APPROVED | APPROVED 全量回归 919/920，唯一失败为既有 flaky，非本 CR 引入 |
