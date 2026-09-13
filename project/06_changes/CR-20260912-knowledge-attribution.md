# CR-20260912-knowledge-attribution

- 级别: L2（用户 2026-09-12 裁定**不回填**历史孤儿条目，故无数据变形；工具参数为新增与必填收紧，全部 CP 双向门）
- 提出人: 助手以 AIDC 设备供应商 CTO 角色的真实入口审计（`EV-2026-09-12-cto-persona-audit` §2.1、§2.5、§2.6、§4.5），用户 `INPUT-2026-09-12-022` 认可立 CR，`INPUT-2026-09-12-023` / `-024` 裁定范围与形态
- 状态: APPROVED
- 占用 ID: REQ-F-170, REQ-F-171, DEC-150, TASK-230, TEST-230
- 评审模型: 标准档（全双向门，但 CP-2 的发现方式是真实入口操作而非机器检查——按 `docs/CONTROLS.md` 分档判据，存在依赖人工发现的 CP 即走标准档）
- 影响需求: **REQ-F-170、REQ-F-171（新增，已落表）**。原写：REQ-F-045 / REQ-F-046 须扩写或新增条文，覆盖「对话路径如何写入并读回 entity / doc_type / source_url」与「检索索引覆盖哪些字段」；新增 `list_knowledge` 亦须一条条文。**不改** REQ-F-045 ③ 对既有工具的零条目注册约束（见「本 CR 明确不做的事」）
- 影响模块: MOD-TOOLS（`src/lib/tools/knowledge-tools.ts`、`registry.ts`）、MOD-KNOWLEDGE（`src/lib/knowledge.ts`）
- 影响任务: TASK-230（DONE）
- 影响测试: TEST-230（PASS，含真实入口）；`tests/knowledge-tools.test.ts` 三处断言按新契约同步
- 当前证据: `project/05_evidence/EV-2026-09-12-cto-persona-audit.md` §2.1（写入路径无归属参数）、§2.5（读取路径不回传元数据）、§2.6（索引不含元数据，含对采集会话原始结论的更正）、§2.10（正文污染导致模型把 JSON 里的相对路径当成来源）、§4.5（无枚举工具，盘点 1 条用了 15 次搜索）、§6（规模推演）
- 方案选项:
  - A. **只补写入参数**（`save_knowledge` 增三个字段）——**已否决**：只修一半。读取路径仍不回传，模型依然无法核对自己存的东西；`byEntity` 统计能好转，但模型侧的「这条哪来的」仍答不了。
  - B. **写入 + 读取对称**——已采纳为底盘。
  - C. **B + 强制归属**——**已采纳**（用户裁定，见「已裁定」Q1）：`entity` 必填，但允许显式的 `__通用__` 值；传了不存在的对象则拒绝并回列现有对象名。
  - D. **B + 回填已有条目**——**已否决**（用户 2026-09-12 裁定不动历史数据：回填是数据变形、`git revert` 回不去，为此升重型档不值得；代价是看板统计里长期挂着「未分类」，已知并接受）。
  - E. **C + 索引覆盖元数据 + 新增 `list_knowledge`**（**选中**）：元数据的写—读—索引—枚举是同一条链，共用同一组字段与同一组测试断言。
- 选择理由: 选 E。①**四件事共用同一组字段**：写入（CP-1）、读回（CP-2）、进索引（CP-4）、枚举时返回（CP-5）动的都是 `entity` / `doc_type` / `source_url` 这三个，分成两条 CR 要交叉验证两次、还要排合并顺序（用户 `INPUT-2026-09-12-024` 据此裁定由 5 条并为 4 条分支）；②**强制归属而非可选**：可选参数解决不了「新的孤儿条目继续产生」，而这正是本 CR 要解决的问题；留 `__通用__` 一档是为了不挡住「我们自己的产能约束」这类不属于任何竞品 / 客户 / 准入方的笔记；③**不回填**：历史只有 2 条孤儿，为它升重型档不划算。
- 回滚方式: `git revert` 本 CR 的提交。`entity` 必填是**工具入参层面**的约束，回滚即恢复旧签名；已写入的元数据留在 front matter 里不影响旧读取路径（旧路径本就不读它）。检索索引在 `indexFor` 里按签名缓存、进程内重建，无落盘索引文件，回滚后下次检索自动回到旧 tokens。新增工具回滚后从注册表消失。**无迁移、无数据变形**（Q3 已裁定不回填）。
- 验收条件:
  - R1：已由用户于 2026-09-12 终裁；R2–R4 全量通过（标准档，矩阵豁免）；G3 / G3.5 通过。
  - 真实入口 ①：走 `POST /api/chat/stream` 真实对话存一条带归属的知识，由 `GET /api/knowledge` 与 `GET /api/knowledge/overview` 验证三字段落盘且 `byEntity` 计数正确——单测与纯函数断言不算（`docs/CONTROLS.md`「真实入口控制」）。
  - 真实入口 ②：对话里问「这条哪来的」，模型能答出归属对象与绝对来源 URL，与 `GET /api/knowledge` 一致。
  - 真实入口 ③：用归属对象的**中文名**检索，命中该对象下的**英文正文**条目。
  - 真实入口 ④：让模型枚举知识库，返回条数与 `GET /api/knowledge` 一致（不得靠关键词猜测）。
  - 机器检查：传不存在的对象名时拒绝且错误文本回列现有对象名；新增工具后在小窗口 Provider 下的装载名录须记录**被挤出的是哪个工具**，`CR-20260912-tool-budget` 的既有行为不得被打破。
- R1 人工终裁: **通过**（用户，2026-09-12）。这一行是终裁痕迹本身，不是对将来的承诺——四角色意见见「角色意见（R1）」，三项有条件通过的条件已并入拟定条文与 TASK。裁定登记于 `INPUT-2026-09-12-025`。
- 评审记录: R1 已通过（2026-09-12）。用户 `INPUT-2026-09-12-023`、`-024` 已裁定四项（不回填、索引并入、entity 必填留通用档、由 5 条并为 4 条分支），余下三项由助手定并列在「助手已定」节，已随 R1 一并终裁。**下一步：建 `cr/knowledge-attribution` 分支，把拟定条文落进三层说明书并声明「占用 ID」，再走 R2–R4 与证据门。**
- R1 终裁: 已完成 | 用户 | 2026-09-12

## 拟用 ID 区间（讨论定案后再正式声明到「占用 ID」）

REQ-F-170、REQ-F-171、DEC-150、TASK-230、TEST-230。当前刻意不声明占用——`check-ids` 会把「占用 ID」行里的编号当作真实预留，而说明书里尚无对应行，声明即报 DANGLING。定案时先 `check-ids` 再写入该行。

## 问题陈述（证据，非主张）

同一根因的四个面——元数据写进去了却没人用：

1. **写不进去**：`save_knowledge` 的 `parameters.properties` 只有 `title` 与 `content`（`knowledge-tools.ts:100-113`），`execute` 固定调 `saveKnowledge({ title, content, source: "model", pending: true })`。对话里再怎么明确要求归属与来源，落盘都是 `entity:"" docType:"" sourceUrl:""`。
2. **读不回来**：`read_knowledge` / `search_knowledge` 只回 title 与 content。实测一条 `entity: 维谛技术-vertiv`、`url:` 为绝对地址的条目，模型盘点时报「未归属」「来源是相对路径」——后者来自正文里那串页面 JSON 的 `UrlForCurrentLanguage`（§2.10）。
3. **搜不出来**：索引构成是 `tokenize(title + "\n" + content)`（`knowledge.ts:451`），不含元数据；而 `parseEntryFile` 把 front matter 与正文分开，所以 `维谛` 在那条英文新闻稿里只存在于 front matter 的 `entity:` 行上，检索永远碰不到。**注意**：`tokenize` 对 CJK 是按二元组切分的，中文检索本身可用——采集会话原主张「中文检索不可用」不成立，已在证据 §2.6 更正。
4. **列不出来**：有 `list_entities`、`list_documents`，**没有 `list_knowledge`**。实测为盘点仅 1 条的知识库，模型做了 15 次关键词猜测式 `search_knowledge`；§6 推演 500 条时模型根本无法枚举。

而 `/api/knowledge/overview` 的 `byEntity` / `byType` / `unowned` 全部依赖这三个字段。

## 已裁定

- **Q1｜漏填归属怎么办。** **已裁定（用户 2026-09-12）：`entity` 必填，但允许显式的 `__通用__` 值。** 传了不存在的对象则拒绝写入并回列现有对象名。派生条文时须定义 `__通用__` 在知识看板里如何呈现——它是一个真分组，不是「未分类」。
- ~~**Q3｜要不要回填。**~~ **已裁定（用户 2026-09-12）：不回填。** 现存 2 条孤儿条目保持无归属，看板长期显示「未分类」为已知代价。本 CR 因此锁定 L2 + 标准档、全双向门。
- ~~**Q4｜与 retrieval CR 的边界。**~~ **已裁定（用户 2026-09-12）：索引覆盖元数据并入本 CR**；随后（`INPUT-2026-09-12-024`）进一步裁定 **`list_knowledge` 亦并入本 CR**，`CR-20260912-knowledge-retrieval` 整条作废。

## 助手已定（不再回头问用户，R1 时一并终裁）

- **元数据头带在哪一层（原 Q2）。** `read_knowledge` 返回体在正文前带完整元数据头（entity / doc_type / source_url）；`search_knowledge` 的**命中列表只带 `entity`**，不带 source_url。理由：命中列表一次可能返回 5 条，每条带全量头就是 5 倍开销，而「这批命中分别属于谁」恰恰是列表最需要的一条，绝对 URL 可以在 `read_knowledge` 时再取。
- **`list_knowledge` 的规模行为（原 retrieval Q2）。** 从第一版就带**按对象分组的计数 + 分页**，而非先做简单版。§6 推演 500 条时全量枚举会直接撑爆上下文，现在做的成本低于以后改。
- **`list_knowledge` 的工具优先级（原 retrieval Q5）。** 定为 `essential`——缺了它模型只能靠关键词猜测，属「静默降级」，正是 `CR-20260912-tool-budget` 给 `essential` 定的判据。**代价须在证据里写明**：8k 窗口下它会挤掉一个原本装得下的工具，验收时必须记录被挤出的是哪一个。

## 本 CR 明确不做的事

- **不改 REQ-F-045 ③ 对既有工具的零条目注册约束。** 实测该条有一个连带后果：`total=0` 时 `search_knowledge` 不注册 → `misses`（内容缺口信号）永远记不到东西，恰恰在最需要缺口信号的冷启动阶段不工作（证据 §5.6）。这是**既有已批准条文的语义问题**，牵动面比本 CR 大，须单独立 CR 由用户终裁，不在本轮夹带。本 CR 只规定**新增的** `list_knowledge` 零条目时仍注册——模型要能回答「库是空的」并据此引导用户。
- **不做跨语言检索**（证据 §4.11）。中文查询命中英文正文需要同义词表或向量召回，量级远大于本 CR。只登记不做，也不另立 DRAFT 占位以免积压。

## 变化点登记

**已定稿并实施（2026-09-13）。**「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。全部 CP 双向门，均已落 TASK-230 / TEST-230。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 模块开发 | `save_knowledge` 增 `entity`（必填，允许 `__通用__`）/ `source_url` / `doc_type` 并透传至 `saveKnowledge`；对象不存在则拒绝并回列现有对象名 | REQ-F-170/171, DEC-150, TASK-230, TEST-230 | 缺陷修复 | 双向 | 机器：单测断言三字段落盘、不存在对象被拒且错误文本含现有对象名；真实入口：对话存一条后查 `/api/knowledge` |
| CP-2 | 产品 | `read_knowledge` 返回体带完整元数据头，模型能回答「这条归属谁、哪来的」 | REQ-F-170/171, DEC-150, TASK-230, TEST-230 | 新增 | 双向 | 真实入口：对话里问「这条哪来的」并核对 `/api/knowledge` |
| CP-3 | 产品 | `search_knowledge` 命中列表每条带 `entity`（不带 source_url） | REQ-F-170/171, DEC-150, TASK-230, TEST-230 | 小改 | 双向 | 机器：单测断言命中项含 entity 且不含 source_url |
| CP-4 | 架构 | 检索索引覆盖 `entity` / `docType`，可按对象中文名找回英文正文条目 | REQ-F-170/171, DEC-150, TASK-230, TEST-230 | 缺陷修复 | 双向 | 机器：单测断言按对象中文名可命中英文正文条目 |
| CP-5 | 产品 | 新增 `list_knowledge`：返回 name / title / entity / doc_type，带按对象分组计数与分页；零条目时仍注册 | REQ-F-170/171, DEC-150, TASK-230, TEST-230 | 新增 | 双向 | 真实入口：对话里盘点知识库并与 `/api/knowledge` 对数 |
| CP-6 | 架构 | `list_knowledge` 优先级 `essential`，并记录 8k 窗口下被它挤出的工具 | REQ-F-170/171, DEC-150, TASK-230, TEST-230 | 小改 | 双向 | 机器：`tool-budget` 既有装载测试 + 新工具在小窗口下的装载断言 |

## 拟新增 / 修订条文（未落表，待 R1 终裁）

`CLAUDE.md`：产品需求说明书为 APPROVED，新增或修改需求须走 CR 与 R1 终裁，**不能直接改表**。故条文正文先在此定稿，R1 拍板后再落三层说明书，且落表动作在本 CR 的分支上完成。

**REQ-F-170　知识写入带归属（MUST）**

> 描述：经对话写入的知识条目必须带归属对象、来源与类型，写进去的这三个字段必须读得回来。
> 验收标准：①`save_knowledge` 增 `entity`（必填）、`source_url`、`doc_type` 三个参数并透传至存储层；②`entity` 取值为已存在的实体 name，或字面量 `__通用__`；传入不存在的对象时**拒绝写入**，错误文本回列现有对象名（不截断成「未写入」这类无信息文本）；③`__通用__` 在知识看板中显示为一个具名分组，**不与「未分类」合并**；④`read_knowledge` 的返回体在正文前带元数据头（entity / doc_type / source_url）；⑤`search_knowledge` 的每条命中带 `entity`，不带 source_url（命中列表可返回多条，全量头不划算）；⑥既有无归属条目不回填，保持现状。

**REQ-F-171　知识可枚举与按对象检索（MUST）**

> 描述：模型必须能列出知识库里有什么，并能按用户给对象起的名字找回条目。
> 验收标准：①新增 `list_knowledge`，返回 name / title / entity / doc_type，支持按 entity 过滤与分页，并返回按对象分组的计数；②条目数超阈值时只返回分组计数 + 首页，不全量展开；③检索索引覆盖 `entity` 与 `docType`，**用对象的中文名可命中该对象下正文为外文的条目**；④`list_knowledge` 在知识库为零条目时**仍注册**（模型须能回答「库是空的」）——本条是对 REQ-F-045 ③ 的**局部例外**，不改 REQ-F-045 ③ 对既有工具的约束；⑤工具优先级为 `essential`，且须在证据中记录 8k 窗口下因它而未装载的工具名。

**DEC-150**｜覆盖需求 REQ-F-170、REQ-F-171

> 方案：元数据全链路走同一组字段。`save_knowledge` 参数化写入 → `saveKnowledge` 落 front matter → `read_knowledge` 回传元数据头 → `indexFor` 的 tokens 并入 `entity`/`docType` → `list_knowledge` 按 `entity` 分组。`KnowledgeHit` 增 `entity` 字段。
> 替代方案：A 只补写入参数（只修一半）；A3 不改索引、另给 `search_knowledge` 加 entity 过滤参数（把「按名字找」变成「先知道名字再过滤」，解决不了本问题）。
> 选择理由：四个动作动的是同一组字段与同一组断言，分开改要交叉验证两次。
> 风险：`entity` 必填是工具入参的破坏性变更，既有调用桩需同步；`__通用__` 可能被模型当作逃生口。
> 状态：待 R1

**TASK-230**（MOD-TOOLS / MOD-KNOWLEDGE）：按 DEC-150 实施 CP-1..CP-6。`knowledge.ts` 的 `KnowledgeHit` 增 `entity`；`indexFor` 第 451 行的 tokens 表达式并入元数据；`registry.ts` 注册 `list_knowledge` 并声明 `essential`。

**TEST-230**（Unit + 真实入口）：①三字段落盘；②不存在对象被拒且错误文本含现有对象名；③`__通用__` 可写入且看板分组不并入「未分类」；④`read_knowledge` 带元数据头、`search_knowledge` 命中带 entity 不带 source_url；⑤**双语 fixture**：正文为英文、`entity` 为中文的条目，用中文对象名检索可命中；⑥`list_knowledge` 分组计数与分页；⑦零条目时 `list_knowledge` 仍注册；⑧8k 窗口装载名录快照（记录被挤出的工具）。

## 角色意见（R1）

| 角色 | 判定 | 要点 |
|---|---|---|
| 产品 | 有条件通过 | `__通用__` 有被当成逃生口的风险。条件：看板须显示其占比，作为「模型在偷懒」的可观察信号——已并入 REQ-F-170 ③ |
| 架构 | 通过 | 索引缓存签名含 mtime，只改 front matter 也会正确触发重建，本 CR 无需为此做任何事；但 `KnowledgeHit` 是**导出类型**，加字段波及全部消费方，须在 TASK 里点名调用点 |
| 模块开发 | 有条件通过 | 两处隐藏 scope：①`entity` 必填是破坏性变更，既有调用桩须同步，且 `saveKnowledge` 被 `ingest_url` 复用；②CP-5 的分页形态（cursor 还是 offset、阈值多少）须在 TASK-230 定死，否则会在实现期变成即兴设计 |
| 测试 | 有条件通过 | 须新增一条双语 fixture（正文英文 + `entity` 中文）；CP-6 的「被挤出的工具」是**证据项不是断言项**，不接受用单测冒充覆盖 |

### 意见详述

**产品**｜`__通用__` 有被当成逃生口的风险。必填的本意是逼出归属，但模型在拿不准时最省力的选择就是填 `__通用__`，那等于把空字符串换了个名字。**不建议因此取消这一档**——取消会挡住真实存在的通用笔记。建议在验收里加一条可观察项：知识看板显示 `__通用__` 的占比；占比异常高本身就是「模型在偷懒」的信号，而不是等着谁去抽查。已并入 REQ-F-170 ③ 的呈现要求。

**架构**｜三点。①索引缓存是安全的：`signatureOf` 用 `file:mtimeMs:size`（`knowledge.ts:437-441`），只改 front matter 也会改 mtime，索引会正确重建，本 CR 不需要为此做任何事。②真正要动的是 `KnowledgeHit` 这个**导出类型**（`knowledge.ts:432`）——加 `entity` 会波及所有消费方，改动面比「加一个字段」看起来大，须在 TASK 里点名调用点。③索引并入元数据后，`entity` 的 slug（如 `维谛技术-vertiv`）会被 `tokenize` 切成二元组，`维谛`/`谛技`/`技术` 都会成为 token——这正是我们想要的，但也意味着对象名里的通用词（「技术」「科技」）会制造跨对象的弱命中。建议接受，BM25 的 IDF 会压低它们的权重。

**模块开发**｜可实现性通过，但指出两处隐藏 scope。①**`entity` 必填是破坏性变更**：现有所有调用 `save_knowledge` 的测试桩都要改，且 `saveKnowledge` 这个存储层函数被 `ingest_url` 复用（`knowledge.ts:235` 的 `pending?` 入参即出自该路径），改工具层参数时须确认没有顺手改动存储层签名，否则会波及 `CR-20260912-ingest-extract-chain`。②CP-5 的「分组计数 + 分页」实际是两件事，而分页的形态没定——cursor 还是 offset、阈值是多少。建议在 TASK-230 里定死，否则它会在实现期变成一次即兴设计。

**测试**｜①**⑤需要一条新的双语 fixture**（正文英文 + `entity` 中文），现有测试库里没有这种形状的条目，这是本 CR 唯一的新增测试资产，须在 TASK 里一并产出。②CP-6 的「记录被挤出的工具」是**证据项不是断言项**——断言只能说「装载数 ≤ 预算」，具体挤掉谁得人工出具快照记进证据文件。这一条我不接受用单测冒充覆盖。③真实入口 ③（中文名命中英文条目）必须走 `POST /api/chat/stream`，不能用直接调 `searchKnowledge` 的单测替代，因为要验的是模型拿到命中后能不能用——这正是 §2.5 里出过问题的地方。

## 被本 CR 吸收的 `CR-20260912-knowledge-retrieval`

该记录于 2026-09-12 建立后**未进入流程即整条作废**，范围全部并入本 CR（用户裁定见 `INPUT-2026-09-12-023`、`-024`）。其文件已删除——原因不是隐藏历史，而是评审门禁从 CP 登记表与「级别」判定一条记录的去向，**从不读「状态」**（`governance.py:781-789`），所以一条 REJECTED 却仍带 CP 表的记录会在 R2–R4 永久报红且无法转绿（它永远不会做 P2），而 `CLAUDE.md` 规定收口以缺省全量结果为准。该门禁缺陷已登记于 `CR-20260912-r1-signoff-marker`。

被吸收的内容如下，不另存文件：

- **原 CP-2「新增 `list_knowledge` 枚举工具」** → 本 CR **CP-5**。
- **原 CP-3「新工具的优先级与预算占用」** → 本 CR **CP-6**。
- **原 CP-4「零条目时的工具可见性」** → **未移交，整体退出本轮**：它牵动既有已批准条文 REQ-F-045 ③，须单独立 CR 由用户终裁，见本 CR「本 CR 明确不做的事」。
- **原「问题陈述」中被复核推翻的那条主张**：采集会话原主张「中文检索不可用 / 检索只对英文原文里逐字出现的词有效」，复核后不成立——`tokenize`（`knowledge.ts:338-356`）对 CJK 按二元组切分，中文检索本身可用（实测「散热」在中文条目正文出现 4 次，属可命中形态）；真正的缺陷是索引取 `title` 与 `content` 而不含元数据。`浸没` / `冷板` 的 0 命中**不是缺陷**（两词在库内正文里均不出现）。该更正已写入证据 §2.6，并构成本 CR CP-4 的依据。

## R2 / R3 / R4 评审矩阵

未产出。方案定案、CP 表定稿、三层说明书写入变更响应节后，再跑 `governance.py matrix CR-20260912-knowledge-attribution`。

## 实施记录（2026-09-13）

- **2026-09-13 补**：REQ-F-170 ③ 此前只落到工具层——`save_knowledge` 接受并校验 `__通用__`，存储层照存，但看板从没显示过它（卡片按已跟踪对象取数，而总览那行的「无归属」取的是空串桶，与它是两回事）。现在总览显示为「· 通用 N 条」，与无归属并列；为零时不显示，那不是信号是噪声。两处字面量由一条断言钉住不漂移。
- `knowledge.ts`：索引 tokens 由 `title\ncontent` 扩为并入 `entity` 与 `docType`（`sourceUrl` 不进——URL 多是噪声 token）；`KnowledgeHit` 增 `entity`；新增 `readPendingKnowledge`（显式命名而非给 `readKnowledge` 加布尔开关）。
- `knowledge-tools.ts`：`save_knowledge` 增 `entity`（必填）/`source_url`/`doc_type`，对象不存在即拒绝并回列现有对象名；导出 `GENERAL_ENTITY = "__通用__"`；`read_knowledge` 正文前置元数据头；`search_knowledge` 命中带归属；新增 `list_knowledge`（分组计数 + `offset` 分页，`essential`，零条目仍注册）。
- 既有 `tests/knowledge-tools.test.ts` 按新契约更新三处断言：工具数、空库注册集合（现为 `save_knowledge` + `list_knowledge`）、检索输出格式。
- 新增 `tests/knowledge-attribution.test.ts`（11 例，含正文英文 + `entity` 中文的双语 fixture）。
- **真实入口实测**：一轮对话调用 `save_knowledge` 并带全部三个字段，`GET /api/knowledge` 显示 `entity=维谛技术-vertiv`、`docType=厂商新闻稿`、绝对 URL；另一轮搜「维谛」命中 1 条（改前 0 条），`read_knowledge` 后模型答出正确归属与绝对 URL——改前它报「未归属」并把正文里的相对路径当来源。
- 全量：`tsc --noEmit` 0、`vitest run` 80 files / 687 tests、`ui-contract` 53/0、G3 与 G3.5 通过。
