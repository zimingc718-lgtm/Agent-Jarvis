# CR-20260918-library-in-board

- 级别: L2（唯一 CP 是双向门且有机器检查——快车道；但改动用户可观察行为（看板板块改名并新增可浏览内容）且修订一条已批准需求，级别仍判 L2，不是 L1）
- 提出人: 用户，INPUT-2026-09-18-001 第 3、4 条（"知识库板块...展示信息也可，实际展示可以浏览的原始资料，需要分页，需要标记文章类型统计"；"确认对话支持库内检索，并在展示屏上直接显示原始资料"），随 Wave 1 四条 CR 一并经用户"按流程开始第一波的 CR"总授权推进
- 状态: APPROVED（R1 人工终裁：用户 2026-09-18「按流程开始第一波的 CR」，紧随本 CR 名称与范围一并提出的方案清单之后给出；P3/P4 完成——TASK-452 DONE，TEST-452 PASS（新增用例随现有 29 例一并跑绿，全量 38/38），typecheck 干净；**尚未合并 main / 尚未 snapshot**——本 CR 是四条并行 Wave-1 CR 之一，按编排约定由编排会话统一执行「合并各 CR 分支 → main 合入 CR 分支 → snapshot → 合并回 main」，不在本分支单独执行这两步，见 CLAUDE.md 第三节）
- 占用 ID: DEC-347, TASK-452, TASK-453, TEST-452, TEST-453
- 评审模型: 快车道（DEC-021 ①：唯一 CP 双向门且有机器检查）
- 影响需求: **修订** REQ-F-242（新增 ⑥）
- 影响模块: MOD-SETTINGS-UI（`src/components/KnowledgeDashboard.tsx`、`src/components/LibraryPanel.tsx`）
- 影响任务: **新增** TASK-452, TASK-453
- 影响测试: **新增** TEST-452, TEST-453
- 当前证据: `project/05_evidence/EV-2026-09-18-library-in-board.md`（本 fork 未创建，因证据文件不在本 fork 的受限编辑范围外，但采集所需的真实入口尚待编排会话执行——留待编排会话补齐）
- 方案选项:
  - A.（item 3）在 `KnowledgeDashboard.tsx` 里另起一套卡片渲染逻辑，不复用 `LibraryPanel.tsx` 的既有实现——否决。`listBrowseCards`/`/api/library/browse`/`LibraryBrowseView` 三层（REQ-F-242，CR-20260915-knowledge-library-merge）已经是"统一浏览"的完整实现；另起一套会让两处卡片样式与字段随时间独立漂移，且没有理由把已经工作正常的分页/类型统计逻辑重新设计一遍。
  - B.（item 3）看板板块只放一个跳转链接，点开才导航到 ☰「资料库设置」面板——否决。用户原话是"知识库"板块要"变成""资料库"、"实际展示"可浏览的内容；链接出去是绕过看板去另一个地方看，不是"嵌入"，不满足"看板里能看到"这个要求。
  - C.（item 3，选中）**导出并复用 `LibraryPanel.tsx` 的 `LibraryBrowseView`/`loadBrowseFromApi`/`BrowsePageView`，`KnowledgeDashboard.tsx` 直接 import**：看板与 ☰ 面板的"浏览"模式渲染同一份组件、同一条取数逻辑；看板内的浏览状态（`browseOffset`/`browsePage`/`browseError`）与既有的 `overview`/`board` 状态并列、不挂 `KNOWLEDGE_CHANGED_EVENT`，只随翻页触发；原「知识库总览」板块改名「资料库」，REQ-F-170 ②③ 要求的"无归属/通用"计数与"内容缺口"两块原样保留，只有"按类型"统计 box 被 `LibraryBrowseView` 自带的、覆盖面更大的类型统计（含已采纳原件，不止知识条目）取代。
  - D.（item 4）新建一套"资料库专用检索/展示"工具——未选用，因为核实后发现这一步没有缺口可建，见「问题经过」。
- 选择理由: 选 C。①不新增存储层或第二套渲染逻辑，纯粹复用 REQ-F-242 已经批准并工作正常的实现；②组件导出改动是纯类型/可见性变化，不改变任何既有调用方（`LibraryPanel.tsx` 自己的 ☰ 面板浏览模式零回归，9/9 既有用例原样通过）；③新增状态与既有看板状态解耦（不同 effect、不同触发条件），互不干扰；④REQ-F-170 ②③ 是独立于本次改动的既有批准要求，做减法前先确认其测试仍然通过，通过后才能确认"改名+嵌入"没有连带删除不该删的东西（过程中一度误删，已按下方「非目标」外的「问题经过」如实记录并改正）。item 4 未新建任何东西，因为核实（不是假设）后确认已被 REQ-F-032 ⑤、REQ-F-110、REQ-F-230 三条既有批准需求完整覆盖，见「问题经过」。
- 回滚方式: `git revert` 本 CR 的提交。`LibraryPanel.tsx` 的三处导出改回模块私有（`LibraryPanel.tsx` 自身用法不受影响，因为它是同文件内使用，导出与否不改变行为）；`KnowledgeDashboard.tsx` 的「资料库」板块连同新增的 `browseOffset`/`browsePage`/`browseError` 状态与 `useEffect` 一并消失，板块回退为改动前的「知识库总览」纯统计视图。无数据、无迁移、无 schema 变化。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵；三层说明书各含 `变更响应 · CR-20260918-library-in-board` 节，节内出现 CP-1 编号（本 fork 未直接编辑三层说明书，已把逐字提议内容写入 `SPEC_DRAFT.md`，交编排会话落笔）。
  - P3/P4: TASK-452 DONE；TEST-452 PASS。TASK-453（item 4 核实）DONE，无新增 TEST——结论与既有 TEST-420 ②⑥、TEST-445、TEST-446 一并作为支撑证据，见下「变化点登记」表后的说明。
  - **真实入口**：用户自己那台（`npm run build:local && npm run serve:local`，端口 3000）——本 fork 按编排约束不得启动/访问该服务，真实入口验证标记「待执行」：① 看板正文里的「资料库」板块渲染出可浏览卡片、分页可用、「查看原文」链接可打开（`scripts/probe-library-in-board.mjs`，已写好未执行）；② item 4 的两条既有真实入口探针 `scripts/probe-library-chat.mjs`（chat 检索+读取资料库）、`scripts/probe-document-display.mjs`（`show_document` 把资料库原件摆上展示屏）在本 CR 引入的改动下应继续 PASS——本 CR 未改动它们依赖的任何代码路径，理论上不受影响，但仍需编排会话实际跑一遍确认，不能只凭"没碰过"就当作已验证。
- 评审记录: 快车道。唯一 CP 能被单测直接断言（TEST-452，38/38 全量通过，含库存的 `library-panel.test.tsx` 9 例零回归）。
- R1 终裁: 已完成 | 用户 | 2026-09-18

## 问题经过

用户在 INPUT-2026-09-18-001 提出（原文摘录，第 3、4 条）：

> 3. 知识看板中的知识库栏目，应该修改，因为它其实是资料库，用来存储从各种来源获取的原始资料，如爬虫，上传的文件等等，而不是从对话中来的，所以，我觉得，你应该修改这个名字，甚至说，不一定需要用现在的知识库栏目形式来show，直接展示信息也可，实际展示可以浏览的原始资料，需要分页，需要标记文章类型统计，这些文章类型可以是模型自动分类，但是支持用户手动修改标签。
> 4. 你需要确认，现在对话是否支持检索资料库的内容，并在展示屏上直接显示原始资料。

**item 3** 回代码核对：知识看板（`KnowledgeDashboard.tsx`，`display_state.stage === "board"` 时的正文）里原有一个「知识库总览」`<section>`，只有统计数字（总条数、无归属数、通用分组数、内容缺口列表、按类型统计），没有任何可浏览的内容本身——用户要求的"实际展示可以浏览的原始资料，需要分页，需要标记文章类型统计"在这里完全不成立。但同一套能力在别处已经完整存在：REQ-F-242（CR-20260915-knowledge-library-merge）已经在 ☰「资料库设置」面板里实现了分页浏览 + 类型统计 + "模型自动分类、可改分类"（`classify_knowledge` 工具，REQ-F-046 ⑥），只是宿主是 ☰ 菜单里的一个独立面板，不在看板正文里。本 CR 的范围因此收窄为：把这份已经存在且已批准的浏览能力，从"只能在 ☰ 菜单打开"扩展到"看板正文里也能直接看到"，不是重新设计一套。"模型自动分类、用户手动改标签"这一半已经是 `classify_knowledge` 的既有能力（REQ-F-046 ⑥），本 CR 不重复建设，只是让分类结果在新增的浏览卡片里可见（`LibraryBrowseView` 本就渲染 `docType` 字段）。

**item 4** 回代码核对，用户要求的是"确认"而不是径直建设——核对结论是**已满足，无缺口**，证据如下（直接读代码，不是猜测）：

- **对话检索资料库内容**：`document-tools.ts` 的 `search_documents`/`read_document`/`list_documents` 三个工具（REQ-F-110，无条件注册）操作的 `rootsOf(store)` 显式合并"用户配置的文档目录" + `libraryRoot()`（`src/lib/library.ts`：`LIBRARY_LABEL = "资料库"`，与用户口中的"资料库"是同一个词、同一份数据，不是同名的两件事）；采纳闸（`adoptionGate`，REQ-F-230）只放行状态为 `adopted` 的资料库文件，被挡住的**报数**而非静默过滤。知识条目那一半由 `search_knowledge`/`read_knowledge`（REQ-F-045/046）单独覆盖，两者合起来就是"资料库"这个合并概念（REQ-F-242 合并视图）的对话侧对应物。既有单测 `tests/library-gate.test.ts`（TEST-420 ②"采纳之后同一个工具就能看见它，检索也命中"）直接断言这条路径。
- **展示屏直接显示原始资料**：`show_document(id)` 工具（REQ-F-032 ⑤，CR-20260915-document-display）经同一条 `resolveWithinRoots` + 采纳闸校验后，把 `display_state` 置为 `{kind:"document", refId:id}`；`DisplayScreen.tsx` 据此渲染原件字节路由 `/api/documents/raw`（同一份 `rootsOf` + 采纳闸，`src/app/api/documents/raw/route.ts`）——PDF/HTML/纯文本类走 `<iframe>`，其余格式给"新标签页打开"的回退，展示的是原件字节，不是提取文本。既有单测 `tests/library-gate.test.ts`（TEST-420 ⑥）、`tests/document-raw-route.test.ts`（⑤"资料库里未采纳的文件 403，采纳后 200"）、`tests/display-screen.test.tsx` 均已覆盖资料库来源的这条路径。
- **既有真实入口证据**（非本 CR 产出，CR-20260915-document-display 遗留）：`scripts/probe-library-chat.mjs`（真实浏览器 + 真实模型调用 `read_document` 读资料库文件）、`scripts/probe-document-display.mjs`（真实模型调用 `show_document`，核对展示屏切换且 iframe 真的能取到 PDF 字节）——两份探针的场景与用户第 4 条问的完全对应，说明这条能力不仅有单测，还有过真实入口验证。

结论：item 4 不新增任何代码，本 CR 的「变化点登记」不为它单独立 CP（与 CR-20260915-document-display 处理"洞察展示已被 `show_insight` 满足"的方式一致——已满足的部分记录在「问题经过」，不占用变化点编号）。TASK-453 记录的是这次核实工作本身（核对代码 + 核对既有测试与探针覆盖），状态 DONE，不产生 TEST 编号。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **看板「资料库」板块**：`LibraryPanel.tsx` 导出 `LibraryBrowseView`/`loadBrowseFromApi`/`BrowsePageView`；`KnowledgeDashboard.tsx` 复用它们把原「知识库总览」改名「资料库」并嵌入可翻页浏览卡片；REQ-F-170 ②③ 的无归属/通用计数原样保留 | REQ-F-242 ⑥, DEC-347, TASK-452, TEST-452 | 新增 | 双向 | 机器：TEST-452（`tests/knowledge-dashboard.test.tsx` ⑧b：板块改名断言、REQ-F-170 计数保留断言、卡片渲染断言、"查看原文"链接断言；全量 38/38 含 `library-panel.test.tsx` 9 例零回归）+ 真实入口（待执行）：TEST-453（`scripts/probe-library-in-board.mjs`，已写好、按编排约束未在本分支执行） |

（item 4 核实结论见上「问题经过」，未产生变化点。）

## 非目标（如实登记）

- 不重新设计"资料库/知识库"合并视图本身——`listBrowseCards`/`/api/library/browse`/`LibraryBrowseView` 是 REQ-F-242（CR-20260915-knowledge-library-merge）已批准并工作正常的实现，本 CR 只是多加一个宿主，不改它的排序、分页、类型统计逻辑。
- 不为 item 4 新建"资料库专用"检索或展示工具——核实后确认 `search_documents`/`read_document`/`show_document` 三个既有工具已经无差别地覆盖资料库来源，另建一套会是纯粹的重复实现。
- 不改变"模型自动分类、用户手动改标签"的既有实现——`classify_knowledge`（REQ-F-046 ⑥）已经是这个能力，本 CR 只是让分类结果（`docType`）在新增的看板卡片里可见，不重新设计分类交互。
- 不处理 ☰「资料库设置」面板本身的任何行为——`LibraryPanel.tsx` 除三处导出可见性变化外零改动，其审批模式、浏览模式的既有交互原样不动（9 个既有用例零回归即证据）。

## 与其它并行 Wave-1 CR 的边界（如实登记）

本 CR 在隔离 worktree（`.claude/worktrees/agent-ad3455bcfa659a2ed`，分支 `cr/20260918-library-in-board`）中完成，与同批次其余三条 Wave-1 CR（`unified-floating-console`、`competitor-board`、`conference-preview-insight`）各自独立分支、互不可见彼此的工作树改动。占用 ID 与影响文件均已按编排会话预先划定的范围（DEC-347、TASK-452/453、TEST-452/453；`KnowledgeDashboard.tsx`/`LibraryPanel.tsx`）执行，未触碰三层说明书正文、`docs/INDEX.md`、`project/05_evidence/test-results.json`——对应的逐字提议内容改写进 `SPEC_DRAFT.md`，由编排会话在合并阶段落笔，避免并行分支同时改同一份受控文件产生冲突。
