# CR-20260921-format-skill

- 级别: L2（标准档：全部 CP 双向门——代码可 `git revert`；缓存文件只是派生产物，删掉即回到无缓存状态；设置项清空即回到 CR-20260921-markitdown-display 的纯结构转换行为；不改写任何原始文档或用户数据）
- 提出人: user（INPUT-2026-09-21-002，推翻 INPUT-2026-09-21-001 时"只整理排版不改内容"的裁定）
- 状态: P3/P4 完成，待合并（R1-R4 全 PASS；模块单测 9 例、设置路由 6 例、文档路由 9 例全绿，`tsc` 0 错误；模型排版本身的真实入口——需用户先经技能上传入口注册一个排版技能并在「本地文档」里选中——尚未执行，见「验收条件」）
- 占用 ID: REQ-F-290, DEC-400, DEC-401, TASK-520, TASK-521, TEST-520, TEST-521
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-280（展示方式在其之上增加一段可选的模型排版）
- 影响模块: MOD-DOCUMENTS（新增 `document-format.ts`）、MOD-UI（`DocumentSettings` 新增排版技能选择）
- 影响任务: 无既有任务变更，新增 TASK-520, TASK-521
- 影响测试: 无既有测试变更，新增 TEST-520, TEST-521
- 当前证据: `project/05_evidence/EV-2026-09-21-format-skill.md`
- 方案选项:
  - A. 不引入模型，按数字编号规律做启发式标题识别——用户否决（INPUT-2026-09-21-002）：只能救回"3 License"这类编号标题，救不回被 PDF 换行切碎的段落、错位的表格，用户看过实际效果后认为可读性仍不够。
  - B. 在路由里写死一段排版提示词、直接调模型——否决：排版规则一旦要调（保留哪些结构、语言、表格处理方式）就得改代码走 CR；用户明确要求"设置一个 skill"，即用项目已有的 SKILL.md 上传/注册机制承载排版规则，规则由用户自己维护。
  - C. 字面复用对话轮次的技能路由（`routeTurn` 按用户消息匹配技能）——否决：文档查看是一次 HTTP GET，不是对话轮次，没有"用户消息"可供匹配；强行造一条伪消息走对话轮路由，等于把展示屏请求塞进聊天状态机，耦合面大且难测。
  - D. **复用技能的"注册与 SKILL.md 内容"这一半，不复用"按对话轮路由"那一半**——选中：用户像平时一样上传一个技能（其 SKILL.md 就是排版规则），再在「本地文档」设置里指定这个技能为"排版技能"；`/api/documents/raw` 在 markitdown 抽取之后，用当前 Provider 发起一次独立模型调用（与对话压缩 `summarizeSpan`、主动唤醒 `wake.ts` 同一种非对话轮 `makeCompleter` 模式），以该技能的 SKILL.md 为指令、抽取文本为输入，拿回排版后的 Markdown 再渲染为 HTML。结果按文件内容哈希落盘缓存。
- 选择理由: 见方案 D；用户通过两轮 AskUserQuestion 明确裁定：①改用模型重新排版并接受其时长/费用/理解偏差风险；②真的要复用现有 SKILL.md 上传/注册机制；③按文件内容缓存。"选哪个技能做排版"做成设置项而不是写死名字，是因为技能注册时存下的 `name` 来自模型生成的 SKILL.md frontmatter（`registerSkill` 存 `doc.name`），不是用户敲的文件夹名，写死一个名字对用户不可控。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交，重建重启；`/api/documents/raw` 回到 CR-20260921-markitdown-display 的纯结构转换。
  - 数据：本 CR 唯一新增的持久化内容是 `.data/document-format/` 下的缓存文件（派生产物，可整目录删除）与 `app_settings` 里一条 `documents.formatSkill` 设置（清空即停用，路由退回纯结构转换）。不触碰任何原始文档、技能文件夹、知识库或实体数据。
  - 运行中止损：不删代码也能停——在「本地文档」里把排版技能设为"不使用"，下一次打开文档即不再调模型。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260921-format-skill` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-520/521 DONE；TEST-520/521 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿（既有 flaky 用例另记）。
- 真实入口: 未执行（模型排版的真实入口需要用户先经技能上传入口注册一个排版技能并在「本地文档」里选中，本 CR 交付时该技能尚未注册；转换脚本的两种新模式已本机真实执行，见测试说明书本 CR 变更响应节）
  - **真实入口（必做）**：①用户经现有技能上传入口注册一个排版技能，并在「本地文档」里选中它；②本机重建重启生产构建后，打开一份此前"可读性差"的真实 PDF（CR-20260921-markitdown-display 验证过的那份），确认展示屏显示的是模型排版后的版本（有标题层级、段落不被 PDF 换行切碎）；③第二次打开同一份文档，服务器日志确认命中缓存、未再调模型；④人工抽查排版结果与原文逐段对照，确认无漏段、无杜撰（这是模型路线的核心风险，机器测不了，必须人看）；⑤Railway 部署后线上重复①②一次。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：待用户拍板。
- R1 终裁: 已完成 | 用户 | 2026-09-21

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：协调会话向用户逐条展示方案要点（技能经现有上传机制注册、在「本地文档」设置里指定为排版技能；独立模型调用按 token 预算分块；输出缩水超 60% 保留原文并标注、整体失败退回纯结构转换；按文件字节哈希 + 技能 id + 模型名落盘缓存；下拉选"不使用"即停用），用户通过 AskUserQuestion 选择「同意，按方案推进」。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | PDF/DOCX 展示在结构转换之上增加可选的一段"按用户指定技能的 SKILL.md 由模型重新排版"；未指定技能时行为与 CR-20260921-markitdown-display 完全一致；同一文件内容第二次打开命中缓存不再调模型 | REQ-F-290（新增） | 新增 | 双向 | 真实入口：注册并选中排版技能后打开真实 PDF，确认显示的是模型排版版本；第二次打开确认命中缓存 |
| CP-2 | 架构 | 独立模型调用沿用 `makeCompleter(store.resolveActiveProvider(userId))` 的非对话轮模式；抽取文本按 token 预算分块（Provider 单次输出上限有限，一份 50 页文档不可能一次排完），逐块排版后拼接；保真度兜底——某块输出字符数低于输入的 40% 视为该块失败，保留该块原文并加可见标注，绝不静默丢内容；整体失败（Provider 不可用/全部块失败）时退回纯结构转换并在页面顶部标注"本次未经排版" | DEC-400（新增） | 新增 | 双向 | 机器：`tests/document-format.test.ts` 用注入的假 completer 覆盖分块边界、缩水兜底、整体失败退回三类路径 |
| CP-3 | 架构 | 缓存落盘在 `.data/document-format/`（可用 `JARVIS_DOCUMENT_FORMAT_CACHE_PATH` 覆盖，与 `libraryStatePath` 同一惯例），键 = sha256(文件字节) + 技能 id + 模型名；文件内容、技能、模型任一变化即视为未命中；缓存文件坏掉/缺失一律当未命中重算，不抛错 | DEC-401（新增） | 新增 | 双向 | 机器：同一 completer 假件被调用次数在第二次读取时为 0；改动文件字节/技能 id/模型名任一项后重新调用 |
| CP-4 | 模块 | 「本地文档」设置新增"排版技能"下拉（选项来自 `GET /api/skills`，含"不使用"），存 `app_settings.documents.formatSkill` = 技能 id；`/api/settings/documents` 的 `GET` 回显、`PATCH` 接受 `formatSkill` 字段（与既有 `archive` 字段同一入口）；`/api/documents/raw` 在 markitdown 分支之后按该设置决定是否走 `document-format.ts` | TASK-520, TASK-521 | 新增 | 双向 | 机器：路由测试覆盖"未设置→纯结构转换"、"设置→走排版"、"设置指向已删除技能→退回纯结构转换并回显提示" |
| CP-5 | 测试 | 新增 `tests/document-format.test.ts`；扩展 `tests/document-raw-route.test.ts` 与 `tests/document-settings-route.test.ts`（新建，此前该路由无独立测试） | TEST-520, TEST-521 | 新增 | 双向 | 机器：`npx vitest run tests/document-format.test.ts tests/document-raw-route.test.ts tests/document-settings-route.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260921-format-skill` 节后，跑 `governance.py matrix CR-20260921-format-skill` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 可选增强，未指定技能时与 REQ-F-280 行为逐字节一致；"不使用"即停用，符合用户裁定 | APPROVED 新增 REQ-F-290 落 DEC-400（管线）与 DEC-401（缓存），未改写 REQ-F-280 的既有含义 | APPROVED 落点集中在 `/api/documents/raw` 的 PDF/DOCX 分支内，不牵动 `read_document`/`search_documents` 工具路径 | APPROVED 真实入口五步骤已写明且逐条可执行，非机器空断言 |
| CP-2 | APPROVED 缩水保留原文并可见标注、整体失败页顶说明——把用户接受的"理解偏差风险"限制在"可见"而非"静默" | APPROVED 复用 `makeCompleter(resolveActiveProvider)` 非对话轮模式（与 `summarizeSpan`/`wake.ts` 同源），不新造一条模型调用链；分块 5,000/7,000 token 的依据（Provider 输出上限约 8K）已写进 DEC-400 | APPROVED 初版曾引入 `lib/document-format.ts -> lib/tools/budget.ts` 新边被模块图守卫（`tests/module-graph.test.ts`）当场拦下，已改为本地内联同算法的 `truncateToBudget`，未扩大冻结的 lib→tools 白名单 | APPROVED `tests/document-format.test.ts` 用注入 completer 覆盖分块边界、缩水兜底（两段各占一块、一块被判缩水）、全部失败退回、空 SKILL.md、无 Provider 五类路径 |
| CP-3 | APPROVED 同一份文件只付一次模型费用，直接对应用户"按文件内容缓存"的裁定 | APPROVED 键含技能 id 与模型名，换规则/换模型自动失效；`unformatted` 不写缓存，避免一次 Provider 抖动被钉死 | APPROVED 目录与 env 覆盖惯例同 `libraryStatePath`；缓存坏/缺一律当未命中，写失败不影响本次展示 | APPROVED 命中时 completer 调用次数为 1、status=cached；键随字节/技能/模型任一变化而变，均有用例 |
| CP-4 | APPROVED 下拉选项来自用户自己的技能列表，stale 时画出"已删除的技能"并 `role=alert` 提示，不无声退回 | APPROVED 设置键 `documents.formatSkill` 与 `documents.archive` 同表同形态，PATCH 同一入口，无新增存储形态 | APPROVED `PATCH` 校验技能 id 属于当前用户后才写入；`GET` stale 时仍回显原 id 供面板绘制 | APPROVED 设置路由 6 例 + 文档路由新增 2 例覆盖未设置/设置/stale/unformatted 四种分支 |
| CP-5 | APPROVED 测试范围与验收条件的机器可证部分一一对应 | APPROVED 沿用 `vi.importActual` 局部 mock 惯例，`resolveFormatterSkill`/`SETTING_FORMAT_SKILL` 走真实现 | APPROVED 新建 `document-settings-route.test.ts` 补上此前该路由无独立测试的空缺 | APPROVED 目标三文件 24 例全绿；全量回归 912 例中仅 1 例既有 flaky（floating-chat ④，已在 CR-20260921-markitdown-display 用 git stash 复现于干净基线） |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-521 对应验收条件①②④ | APPROVED 与 DEC-400 一致，无隐藏边界 | APPROVED 路由内一个 `if (formatter.skill)` 分支，两条路径共用 `respondHtml`/`conversionFailed`，无重复 | APPROVED TEST-521 逐分支覆盖 |
| CP-2 | APPROVED TASK-520 的"永不抛错、全部形态折进 status/note"直接落实"如实报错" | APPROVED 导出面（`resolveFormatterSkill`/`chunkMarkdown`/`cacheKey`/`formatDocument`）与 DEC-400 描述一一对应 | APPROVED 单文件 `document-format.ts` + 转换脚本双模式，`runPython` 三入口共用 | APPROVED TEST-520 九例对应 TASK-520 列出的每个分类边界 |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 缓存实现与 DEC-401 一致 | APPROVED `readCache` 容错、`writeCache` 失败不冒泡，均在 TASK-520 内 | APPROVED TEST-520 ④⑤⑥ 覆盖不写/命中/键变化 |
| CP-4 | APPROVED 与 CP-1 同一件事在模块层的落点，不重复占号 | APPROVED 无新增架构决策 | APPROVED TASK-521 写明 GET/PATCH/UI/路由四处改动 | APPROVED TEST-521 |
| CP-5 | APPROVED 无遗留 | APPROVED 无新增 mock 基础设施 | APPROVED 测试文件与源文件一一对应 | APPROVED 见 R2/CP-5 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | CONDITIONAL 机器测试证明的是管线逐段行为，不能证明"模型排出来的版本确实可读且无漏段"——条件为按验收条件①-⑤在真实环境执行（需用户先注册排版技能），结果记入 `EV-2026-09-21-format-skill.md` 后本条转 APPROVED | CONDITIONAL 机器测试证明的是管线逐段行为，不能证明"模型排出来的版本确实可读且无漏段"——条件为按验收条件①-⑤在真实环境执行（需用户先注册排版技能），结果记入 `EV-2026-09-21-format-skill.md` 后本条转 APPROVED | CONDITIONAL 机器测试证明的是管线逐段行为，不能证明"模型排出来的版本确实可读且无漏段"——条件为按验收条件①-⑤在真实环境执行（需用户先注册排版技能），结果记入 `EV-2026-09-21-format-skill.md` 后本条转 APPROVED | CONDITIONAL 机器测试证明的是管线逐段行为，不能证明"模型排出来的版本确实可读且无漏段"——条件为按验收条件①-⑤在真实环境执行（需用户先注册排版技能），结果记入 `EV-2026-09-21-format-skill.md` 后本条转 APPROVED |
| CP-2 | APPROVED 缩水兜底与整体失败两条用户可见文案均有用例断言 | APPROVED 分块边界（两段各约 4,000 token 各占一块）在用例③中真实成立，completer 被调 2 次 | APPROVED 模块图守卫用例（TEST module-graph）在修正后全绿，证明未新增 lib→tools 边 | APPROVED `npx vitest run tests/document-format.test.ts` 9 例全绿，已本机实测 |
| CP-3 | APPROVED | APPROVED | APPROVED | APPROVED 用例④⑤⑥全绿，已本机实测 |
| CP-4 | APPROVED stale 提示与 unformatted 页顶说明均有断言 | APPROVED | APPROVED | APPROVED `npx vitest run tests/document-settings-route.test.ts tests/document-raw-route.test.ts` 15 例全绿，已本机实测 |
| CP-5 | APPROVED | APPROVED `vi.importActual` 保留真实 `resolveFormatterSkill`，stale 路径走真代码 | APPROVED | APPROVED 全量回归 912 例，除 1 例既有 flaky 外全绿；两个 module-graph 失败为本 CR 初版引入并已修正，非遗留 |
