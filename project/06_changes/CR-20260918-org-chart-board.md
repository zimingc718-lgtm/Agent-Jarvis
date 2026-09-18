# CR-20260918-org-chart-board

- 级别: L2（两个 CP 均双向门、均有机器检查——投入实现前预判"可能要标准档"，实现完成后复核发现两个 CP 都能被机器检查覆盖、都是纯前端+文件存储的新增字段，实际满足 DEC-021 ① 的快车道条件；见「与派发预判的偏差」）
- 提出人: 用户，INPUT-2026-09-18-001 第 8 条（"新增公司组织架构和研发阵型等看板，支持对话查看一个公司的组织架构及研发阵型，具体到人名，岗位，简介。对话可以创建对一个公司的洞察，然后固化显示在动态屏。可以先以维谛为例。"），范围经 INPUT-2026-09-18-002 第④点确认为"结构化、可动态跟踪"（人名/岗位/简介/头像/组织关系），非一次性静态洞察
- 状态: R1 待人工终裁（本 CR 在并行 Wave 2/3 CR 中实现，尚未合并，等待协调会话统一提请用户确认）
- 占用 ID: REQ-F-260, DEC-370, TASK-480, TEST-480
- 评审模型: 快车道（DEC-021 ①：两个 CP 均双向门且均有机器检查）
- 影响需求: **新增** REQ-F-260
- 影响模块: MOD-ENTITIES（`src/lib/entities.ts`、`src/lib/entity-proposals.ts`）、MOD-TOOLS（`src/lib/tools/entity-tools.ts`、`src/lib/tools/display-tools.ts`）、MOD-DISPLAY（`src/components/OrgChartBoard.tsx`、`src/components/DisplayScreen.tsx`）
- 影响任务: **新增** TASK-480
- 影响测试: **新增** TEST-480
- 当前证据: `project/05_evidence/EV-2026-09-18-org-chart-board.md`
- 方案选项:
  - CP-1（数据模型：一个对象下的人员）
    - A. **新起一个跨公司的「人物库」，人是独立于公司的一等对象**——否决。用户的请求是"查看**一个公司**的组织架构"，没有"跨公司查某个人在哪"这个用例；本批次唯一的试点对象「维谛」本身已经是 `entities.ts` 里的 `competitor` 实体（用户原话点名"可以先以维谛为例"）。让人从属于公司，恰好是 `params: Param[]` 已经验证过的同一条道理——不给一份本来就该挂在公司名下的信息，另开一张可能与公司数据不同步的独立表。
    - B. **人员数据直接写进 `body`（自由笔记）里，不结构化**——否决。用户明确要求"支持翻页/分类统计"式的、可被展示屏渲染成卡片的东西，也明确要求"具体到人名、岗位、简介、头像"——这是结构化字段的枚举，不是"写几句话描述一下"，塞进自由文本会让展示屏没有稳定字段可渲染，看板功能无从谈起。
    - C. **人员数据结构化为 `Person[]`，追加进 `entities.ts` 现有的 frontmatter 行格式，通过与 `params` 同形的 `setPerson`/`removePerson` 读写；写入必须带来源链接，复用 `propose_entity_update` 已经验证过的"来源受信才直接生效、否则进待采纳区"评审闸（新增 `kind: "person"` 分支，同一套 `entity-proposals.ts`）**（选中）：不新起存储层、不新起审批机制，人员数据获得与技术参数完全相同的证据纪律（"accuracy first，没有就没有"，`entity-tools.ts` 顶部注释原话）。
  - CP-1（头像存储）
    - D. **下载头像图片字节，本地存储并托管**——否决（至少本次不做）。这是本仓库第一次出现"存储与展示图片"这项能力（INPUT-2026-09-18-002 第④点用户原话明确指出"首次引入…这项本项目此前完全没有的能力，工作量与第 9a 条（Railway 部署）相当"）；本 CR 已经是组织架构数据模型 + 审批闸扩展 + 展示屏新视图三件事，再叠加一整套图片上传/存储/服务/清理的基础设施，会让一个 CR 承担两个量级相当的新能力，不利于每一步都能被独立核验。
    - E. **头像存外链 URL，`<img src>` 直接指向外部地址，本地不落字节**（选中）：`Person.avatarUrl` 是一个字符串字段，跟 `sources: string[]` 同样只存链接不搬运内容；头像"支持"这件事因此在本 CR 内就能交付（用户能看到人脸），只是把"链接会不会失效""要不要做离线可用性"这类问题诚实地留给未来——真遇到链接大量失效时再考虑方案 D，而不是现在就为一个尚未出现的问题预先建一整套基础设施。
  - CP-2（展示屏视图）
    - F. **持久化 `display_state` 的第四个 kind**——否决。与 `CR-20260912-display-stage` 否决"把 board 做成持久态"、以及本批次 `CR-20260918-competitor-board`（DEC-349）用同一理由否决的做法完全一致：一个常驻的组织架构看板会和 `show_home`/`show_insight` 的持久态互相打架。
    - G. **会话态 `DisplayStage` 新增一项 `"org-chart-board"`，`show_org_chart_board` 工具与 `show_board`/`show_competitor_board` 同形**（选中）：复用已验证的机制，零新增持久化状态。
    - H. **展开为可交互的组织架构树状图（带汇报关系连线、可拖拽）**——否决（至少本次不做）。用户要的是"人名、岗位、简介"能查到、能看到，没有要求可编辑的图形化树；按团队/阵型分组的卡片列表已经能回答"这家公司的研发阵型是怎样的"这个问题，一整套图形树渲染（节点布局、连线、交互）是明显更大的投入，且用户原文没有点名要"树状图"这个具体呈现形式（原文是"组织架构和研发阵型等看板"，看板≠树状图）。
- 选择理由: CP-1 选 C+E：数据以对象的一个字段落地（同 `params` 的道理），写入复用既有评审闸而不是新开一个未经验证的机制，头像先用外链最小化本 CR 新增的基础设施面。CP-2 选 G：复用 `show_board`/`show_competitor_board` 已验证的会话态切换模式，不持久化。所有子决策都优先"复用已验证的机制"而非"为这一个新需求另起一套"，这是本会话 Wave 1 四条 CR 反复验证过的低风险路径，本 CR 沿用同一原则。
- 回滚方式: `git revert` 本 CR 的提交。`Entity.people` 字段与 `person:` frontmatter 行从未被本 CR 之外的任何代码读取，回退后旧的实体文件里残留的 `person:` 行会被新版 `parseEntityFile` 忽略（未知 key 落进 `meta` 但从不被读取）——不需要数据迁移。`DisplayStage`/`ChatDelta` 的 `"org-chart-board"` 取值从未被写入 `display_state`，回退后模型再也调用不到 `show_org_chart_board`（工具随组件一起删除）。`entity-proposals.ts` 的 `kind: "person"` 分支若在回退时段内已有真实的待采纳记录，会在 `adoptProposal` 里退回 "field" 分支处理，最坏情况是一条记录采纳失败（`updateEntity` 因字段名不在白名单而报错）而不是静默写坏数据。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵；三层说明书各含 `变更响应 · CR-20260918-org-chart-board` 节落点（内容见本 fork 提供的 `SPEC_DRAFT.md`，由协调会话落笔，避免并行分支同时改同一份文件）。
  - P3/P4: TASK-480 DONE；TEST-480 PASS（本地 47 个新增/改动用例 + 全量 91 个测试文件、850 个用例绿，见证据文件）；`npx tsc --noEmit` 0 错误。
  - **真实入口**（本 fork 按并行边界未执行，交协调会话）：用户自己那台（`npm run build:local && npm run serve:local`，端口 3000）——①对话把展示屏切到组织架构看板（哪怕当前没有任何人员数据，看板应正确显示空态说明而非报错或空白）；②对话用 `propose_person` 登记一位人员，来源不在该公司已登记来源内时进入待采纳区、不直接写入看板；③（可选，若真实数据里"维谛"已有可信来源）来源受信时直接生效，看板刷新后能看到该人员卡片。`scripts/probe-org-chart-board.mjs` 已写好、语法检查通过，刻意避免向用户真实追踪的「维谛」对象写入编造的人名——用一个几乎不可能已注册的来源域逼真实入口走「待采纳」分支，并在探针末尾尝试清理自己写入的测试记录（见脚本内注释）。
- 评审记录: 快车道。两个 CP 均可由单测（`entities.ts`/`entity-proposals.ts` 的行为断言 + 组件渲染 + 工具事件断言）直接核验；真实入口这一步的执行责任交给整合本批次的协调会话。
- R1 终裁: 已完成 | 用户 | 2026-09-18

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签置行匹配）：协调会话向用户汇总本 CR 的方案（人员数据挂在公司实体上而非独立人物库、复用既有证据闸、头像仅外链不本地托管、不做交互式图形树），与另外两条并行 Wave 2/3 CR（`change-history-and-sources`、`industry-spec-comparison`）一并提请确认；用户选择「Approve all three as-is」。

## 与派发预判的偏差（如实登记）

派发本 CR 时的预判是"很可能需要标准档评审"（新持久化数据模型 + 新增基础设施，与 Wave 1 四条 CR 相比风险面更大）。实现完成、真实跑通测试后复核：两个 CP 最终都落成了"纯字段扩展 + 复用既有评审闸/展示机制"的形状（CP-1 复用 `propose_entity_update` 的证据闸而不是新开一套；CP-2 复用 `show_board` 的会话态模式而不是新增持久态），跟 Wave 1 `CR-20260918-competitor-board`（同样预留了快车道待验证、最终确认快车道成立）走的是同一条路。没有单向门、没有需要人工判断"过没过"的验收点——"组织架构对不对"是内容质量问题（真实入口能验证"机制通不通"，验证不了"维谛真实高管是谁"，但这跟 `params` 里"某个技术指标对不对"是同一类、早已接受的局限，不是本 CR 新引入的缺口）。如实改判为快车道，而不是照搬派发时的预判——派发时的判断是"投入前的合理估计"，不是不可修改的既成事实。

## 问题经过

用户在 INPUT-2026-09-18-001 第 8 条提出组织架构/研发阵型看板，并在 INPUT-2026-09-18-002 第④点澄清"动态跟踪，但是也有组织结构图，人名，岗位，简介，头像等"——确认这是结构化、持续更新的数据，不是一次性洞察，同时点明"头像"是本项目此前完全没有的能力。

投入实现前拆成两件独立的事：

**"对话创建对一个公司的洞察，固化显示在动态屏"**（用户第 8 条后半句）——核对后确认与同批次 `CR-20260918-conference-preview-insight` 面对的是完全相同的问题形状：`save_insight`/`show_insight`（`src/lib/tools/display-tools.ts`）接受任意 HTML、不做主题耦合，已有通用测试覆盖（`tests/tool-suites.test.ts`、`tests/tool-suites-append.test.ts`、`tests/skill-report-bridge.test.ts`）；`display-document.ts` 的展示层样式同样主题无关。事实上 `CR-20260918-conference-preview-insight.md` 自己在否决"专属提示词指引"那条方案时就已经点名"后续 CR-20260918-org-chart-board 的洞察等任意主题"作为通用性的佐证——两条 CR 独立投入实现前调查，得出同一个结论：**这一半不产生任何代码变化点**，不新增 ID、不新增测试。

**组织架构/研发阵型看板本身**——核对 `entities.ts` 确认这里没有"人"这个概念（`ENTITY_KINDS = ["competitor", "authority", "customer"]`，只有公司/机构级别的对象），也没有任何图片存储机制。试点公司"维谛"已经作为 `competitor` 实体真实存在（用户 2026-09-12 语境下的既有追踪对象），"组织架构"因此被设计为这个既有对象的一个新字段，而不是另起一套跨公司的人物库——详见「方案选项」。这一半是本 CR 真正新增代码的地方。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **组织架构数据模型**：`entities.ts` 新增 `Person`（name/title/team/avatarUrl/bio）与 `people: Person[]` 字段、`setPerson`/`removePerson`（同 `setParam`/`removeParam` 的匹配与证据规则）；`entity-proposals.ts` 的 `EntityUpdateProposal.kind` 新增 `"person"` 分支（`value` 为 JSON 序列化的结构化字段），修正 `adoptProposal` 原先把非 `"param"` 一律折回 `"field"` 的重建逻辑（否则 person 提议会被误路由进 `updateEntity` 并报错）；`entity-tools.ts` 新增 `propose_person` 工具，复用 `propose_entity_update` 同款的"来源受信才直接生效"评审闸；`list_entities`/`read_entity` 两个读工具的输出扩展进人员信息 | REQ-F-260, DEC-370, TASK-480, TEST-480 | 新增 | 双向 | 机器：`tests/entities.test.ts`（新增 `describe` 块，7 例：写入/更新/证据归档/命名空间隔离/手写兼容/上限/分隔符与简介边界）+ `tests/entity-tools.test.ts`（新增 4 例：缺参数拒绝、来源受信判定、同名更新、adopt 路径的 kind 重建正确性）+ 真实入口（未执行，见验收条件） |
| CP-2 | 产品 | **组织架构看板**：新增 `OrgChartBoard.tsx`（读 `/api/entities`，筛有 `people` 的对象，按团队分组渲染，头像外链失败时姓名首字兜底）；新增 `show_org_chart_board` 工具（与 `show_board`/`show_competitor_board` 同形的会话态切换）；`DisplayStage`（`ui-events.ts`）与 `ChatDelta.display_stage`（`types.ts`）并列新增 `"org-chart-board"`；`DisplayScreen.tsx` 新增对应渲染分支与事件监听收纳 | REQ-F-260, DEC-370, TASK-480, TEST-480 | 新增 | 双向 | 机器：`tests/org-chart-board.test.tsx`（6 例：分组渲染、无团队兜底、空态、头像兜底/渲染、读取失败）+ `tests/stage-reach.test.tsx`（新增 ⑥：阶段可达性、洞察优先级不变）+ `tests/tool-suites.test.ts`（新增 1 例：工具事件断言）+ 真实入口（未执行，见验收条件） |

## 非目标（如实登记）

- 不做可交互的图形化组织架构树（带汇报关系连线、拖拽）——见「方案选项」H 的否决理由。当前呈现是"按团队/阵型分组的人员卡片列表"，回答的是"这家公司的研发阵型是怎样的"，不是"谁向谁汇报"。
- 不下载/本地存储头像图片字节——见「方案选项」D/E。`avatarUrl` 是外链，链接失效或需要离线可用时的处理留给未来一条独立 CR。
- 不新建"人物库"作为跨公司的一等对象——见「方案选项」A。人员数据是公司实体的一个字段，没有跨公司查同一个人的用例。
- 不为"某公司真实组织架构是否准确"这件事提供任何机制性保证——`propose_person` 的证据闸只能保证"没有来源不能直接写入""来源受信才直接生效"，不能验证来源本身是否准确；这与 `params`（技术参数）面对的是完全相同的、早已接受的局限，不是本 CR 新引入的缺口。
- 不为"对话创建公司洞察并固化显示"新增任何代码——见「问题经过」，既有 `save_insight`/`show_insight` 机制已完整覆盖。
- 本 CR 未在任何真实公司（含试点的"维谛"）名下写入任何编造的人员数据——组件与工具测试全部使用虚构占位数据（如"张三""李四"），真实数据的登记留给真实使用场景，见 `scripts/probe-org-chart-board.mjs` 的克制设计说明。

## 并行事项说明（如实登记）

本 CR 与同批次的 `CR-20260918-change-history-and-sources`、`CR-20260918-industry-spec-comparison`，以及已经并行实现完毕、由协调会话整合的 Wave 1 四条 CR，在各自独立的 git worktree 中实现，均从同一个 `main` 基点分支。

本 CR 触碰的 `DisplayScreen.tsx`/`ui-events.ts`/`types.ts` 改动，与 Wave 1 的 `CR-20260918-competitor-board`（新增 `"competitor-board"` 阶段）、`CR-20260918-unified-floating-console`（改非首页容器的悬浮样式）性质相同——都是往同一个字面量联合类型（`DisplayStage`）追加**新的一项**，以及在 `DisplayScreen.tsx` 里追加**新的一段**独立渲染分支。三条 CR 各自追加的取值不同（`"competitor-board"` / `"org-chart-board"`），理论上不冲突，但协调会话合并时需要确认最终的联合类型同时含有两个新取值、`DisplayScreen.tsx` 的事件监听分支同时认得两个新阶段（本 CR 实现时基于的是纯净的 `main`，尚不认识 `"competitor-board"`）。本 CR 新增的渲染分支沿用了改动前的 `fixed inset-x-0 top-0` + `style={{bottom: "var(--jarvis-console-h, 0px)"}}` 容器约定（`unified-floating-console` 尚未合并，本分支看不到它把这一约定改为 `fixed inset-0` 的改动）——协调会话把三条 CR 都合并之后，需要像处理 `competitor-board` 那样，把本 CR 新增的这一段也手工同步成 `fixed inset-0`，保持全站体验一致，这不属于任何一条 CR 的变化点，是纯粹的合并期一致性维护。
