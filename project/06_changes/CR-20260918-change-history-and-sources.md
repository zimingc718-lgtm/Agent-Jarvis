# CR-20260918-change-history-and-sources

- 级别: L2（三个 CP 全为双向门，均有机器检查发现——快车道）
- 提出人: 用户，INPUT-2026-09-18-001 第 1、2、6b 条（"友商，准入，客户等卡片。里面是新消息清单更新，点击后可以进入消息源链接。不放技术指标……""配置源支持自动配置官网媒体等正式来源，也支持手动添加。小按钮改为弹窗配置，不再卡片里配置。""支持对话框配置知识看板的内容，包括友商新增，准入方新增等。新增后支持自动寻找采集源。"），第 1 条"另外放一页做行业技术指标对比"的延后页面经 INPUT-2026-09-18-002 确认不在本 CR 范围（见「非目标」）
- 状态: R1 待人工终裁（本 CR 是 Wave 2 的一部分，在独立 worktree 中实现，尚未合并；范围已由用户 INPUT-2026-09-18-001/002 两轮确认，未确认的只是"怎么做"，逐条方案见下）
- 占用 ID: REQ-F-244, REQ-F-245, DEC-350, TASK-457, TASK-458, TASK-459, TEST-457, TEST-458, TEST-459
- 评审模型: 快车道（DEC-021 ①：三个 CP 均双向门且均有机器检查）
- 影响需求: **新增** REQ-F-244、REQ-F-245
- 影响模块: MOD-ENTITIES（`src/lib/entities.ts` 未改，`src/lib/entity-history.ts` 新增）、MOD-SOURCES（`src/lib/sources.ts`）、MOD-TOOLS（`src/lib/tools/entity-tools.ts`）、MOD-DASHBOARD-UI（`src/components/KnowledgeDashboard.tsx`）、新增 API 路由 `src/app/api/entities/[name]/history/route.ts`
- 影响任务: **新增** TASK-457, TASK-458, TASK-459
- 影响测试: **新增** TEST-457, TEST-458, TEST-459
- 当前证据: `project/05_evidence/EV-2026-09-18-change-history-and-sources.md`
- 方案选项:
  - CP-1（第 1 条：消息清单）
    - A. **把消息清单塞进 `entities.ts` 的 frontmatter，像 `param`/`evidence` 那样重复一行一行写**——否决。实体文件有 64KB 上限（`MAX_ENTITY_BYTES`），消息清单会随时间无界增长，而参数、证据这些字段不会——同一份文件承载"有界的当前状态"和"无界的历史流水"两种完全不同的增长特性，迟早撞上限，届时报错的不会是"写多了历史"，会是"参数写不进去了"，两件不相关的事互相拖累。
    - B. **落数据库（sqlite）**——未选用但不是否决：本项目现有的实体/知识/资料库全部是"一份文件一个对象"的纯文件系统模型（`entities.ts` 文件头注释："同 `knowledge.ts` 一个道理……回滚只是留一个文件夹，不是留一个要撤销的迁移"），引入 sqlite 单单为了一条消息历史，会让这一个模块的可回滚性和其它所有模块都不一样，代价与收益不成比例。真要为持久层做统一升级，应该是跨模块的决定，不该由这条 CR 顺手定。
    - C. **每个对象一个 JSONL 追加文件，独立于 frontmatter，读取时只取最近 N 条**（选中）：新增 `src/lib/entity-history.ts`，`fetchSource` 检测到真实变化时追加一行，不重写整份历史；`entities.ts` 的 `change`/`changeAt` 保持"最新一条"的既有语义不变，两者并存而不是互相替代。
  - CP-2（第 2、6b 条：来源的机制半）
    - A. **新写一套"自动发现"专用的抓取/搜索管线**——否决。`web_search`（REQ-F-034/DEC-027）已经是"给关键词、返回候选链接"的现成工具；重新发明一套等价的东西是纯粹的重复实现，而且会绕开既有的 SSRF 防护、失败短路、预算截断这些已经在 `web-tools.ts` 里踩过坑并修好的机制。
    - B. **登记来源这件事本身也要经过 `propose_entity_update` 式的待采纳闸**——否决。闸的意义是挡"模型自称某个值为真"（`entity-tools.ts` 文件头注释原文："模型能不能自称某个来源是权威的"）；登记一个 URL 不是在断言任何字段的值，只是"请定期看看这个地址"，`fetch_source`/巡检机制本身会独立抓取比对，一个坏链接的后果是 `failed_fetch`，不是把假数据摆上看板。让它免闸，直接复用数据层里从来没被加过闸的既有 `addSource`。
    - C. **给模型新增一个 `add_source` 工具，组合既有 `web_search` 做发现、复用既有 `addSource` 做登记**（选中）：零新增抓取/搜索代码，只新增"登记"这一步的工具外壳；`propose_entity` 的描述追加一句提示，让模型在对象被采纳后主动想到去找来源——这是提示层面的引导，不是强制触发的新机制。
  - CP-3（第 2 条：来源的界面半）
    - A. **保留卡片内联的源管理表单，只是视觉上收进一个可展开的次级区块**——否决。用户原话是"小按钮改为弹窗配置，不再卡片里配置"，明确要求配置这件事离开卡片本身，收进折叠区块仍然是"在卡片里"，不满足这句话。
    - B. **弹窗里的"自动配置来源"按钮直接在弹窗内调用模型**——否决，见下方「非目标」的详细说明：会新开一条"UI 组件绕过对话框直接触发模型"的旁路，这个应用至今没有这种先例，一次会花 token 的调用理应出现在对话历史里。
    - C. **弹窗只做手动管理，自动配置复用既有的 `onAsk` 机制把预填问题交给对话框**（选中）：与卡片上已经存在的"问 Jarvis 关于这个对象"按钮是同一条机制，不是新发明一条。
- 选择理由: 三个 CP 分别选 C。①JSONL 独立文件不动 `entities.ts` 的既有语义、不撞 64KB 上限、不引入新的持久化技术；②`add_source` 零新增网络代码，只是把数据层本来就没加过闸的能力开放给模型，风险面不因此扩大；③弹窗复用 `onAsk`，让"要不要花 token 去搜索"这件事始终经过对话框、可见于对话历史，不是一次静默的后台调用。
- 回滚方式: `git revert` 本 CR 的提交。`entity-history.ts`/新增路由/新增工具随组件一起消失，不影响任何既有数据（历史文件本身是新增的旁路数据，删除代码不会连带删除已经写下的 `.jsonl` 文件，但那些文件不再被任何代码读取，等效于消失）；`KnowledgeDashboard.tsx` 的采集源管理退回卡片内联的旧表单。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵；三层说明书各含 `变更响应 · CR-20260918-change-history-and-sources` 节逐 CP 落点（内容见 `SPEC_DRAFT.md`，由编排会话落笔）。
  - P3/P4: TASK-457/458/459 全部 DONE；TEST-457/458/459 全部 PASS。
  - **真实入口**（本 fork 未执行，交编排会话）：用户自己那台（`npm run build:local && npm run serve:local`，端口 3000）——`scripts/probe-change-history-and-sources.mjs`（已写好、`node --check` 通过）：①新建一次性对象、直接写一条历史 JSONL 后，卡片展开态能渲染出这条消息，且是指向其 URL 的可点击链接；②展开态不再直接看到内联的"添加采集源"表单，改为一个"采集源设置"按钮；③点开按钮后是一个弹窗，弹窗内含既有的手动增删表单，以及一个"自动配置来源"按钮；④点击该按钮后，对话框输入框被预填指定文本、且没有被自动发送。全程用完清理（`DELETE /api/entities/<name>`），不污染真实看板。
- 评审记录: 快车道。三个 CP 均可由单测（`entity-history.test.ts`、`sources.test.ts` 的新增用例、`entity-tools.test.ts` 的新增用例、`entity-route.test.ts` 的新增用例、`knowledge-dashboard.test.tsx` 的改写/新增用例）+ 真实入口共同核验。
- R1 终裁: 待定 | 用户 | ——（范围已经过 INPUT-2026-09-18-001/002 确认；本 CR 的方案细节待协调会话统一提请用户确认，与 Wave 1 四条 CR 相同的处理方式）

## 问题经过

用户在 INPUT-2026-09-18-001 提出（原文摘录）：

> 1. 友商，准入，客户等卡片。里面是新消息清单更新，点击后可以进入消息源链接。不放技术指标（后续另外放一页做行业技术指标对比）2. 配置源支持自动配置官网媒体等正是来源，也支持手动添加。小按钮改为弹窗配置，不再卡片里配置。

以及第 6 条（原文重复编号，按内容归为 6b）：

> 支持对话框配置知识看板的内容，包括友商新增，准入方新增等。新增后支持自动寻找采集源。

INPUT-2026-09-18-002 确认第 1 条括号里"另外放一页做行业技术指标对比"与第 7 条"友商看板"（已由 `CR-20260918-competitor-board` 实现）不是同一个页面，是第三个独立页面，超出本 CR 范围。

投入实现前的代码核对发现：

1. `entities.ts` 的 `change`/`changeAt` 只是单条"最新变更"字段，`sources.ts` 的 `Snapshot` 每次抓取都整份覆盖——这条应用此前**没有任何变更历史的数据模型**，只有"当下"。用户要的"新消息清单"因此是一项真正的新增，不是既有能力换个位置展示（与 Wave 1 几条"核实后发现已满足"的 CR 不同）。
2. `entity-tools.ts` 只有读（`list_entities`/`read_entity`）和两个受信任度限定的写（`propose_entity`/`propose_entity_update`，均需来源或进待采纳区），**没有任何工具能让模型登记一个采集源**——`addSource` 只在看板 UI 的内联表单里被调用。这是第 2、6b 两条共同缺的那块积木：不是"自动发现"本身缺机制（`web_search` 已经是通用发现工具），是"发现之后怎么登记"缺一个模型能调的入口。
3. 采集源的管理 UI（`KnowledgeDashboard.tsx`）确实是卡片内联的一段表单，随来源数量增长卡片跟着变长，与用户"小按钮改为弹窗"的诉求描述完全对应。
4. `KnowledgeDashboard.tsx` 已经有一个把问题交给对话框而不在组件里自己处理的先例——"问 Jarvis 关于这个对象"按钮（`onAsk` prop）。第 2、6b 条"自动配置/自动寻找"要不要在 UI 组件内部直接调用模型，这个先例已经给出了答案：不直接调用，交给对话框。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **消息清单**：新增 `entity-history.ts`（每对象一个 JSONL 追加文件），`fetchSource` 检测到真实变化时追加一条；新增只读路由 `GET /api/entities/[name]/history`；`KnowledgeDashboard.tsx` 卡片展开态渲染消息列表，每条是指向来源 URL 的可点击链接 | REQ-F-244, DEC-350①, TASK-457, TEST-457 | 新增 | 双向 | 机器：`tests/entity-history.test.ts`（6 例：空历史、追加读回顺序、limit 收窄、超限截断、多对象互不影响、损坏行容错）+ `tests/sources.test.ts` 新增断言（`fetchSource` 检测到变化时确实追加历史，首次建基线不追加）+ `tests/entity-route.test.ts` 新增用例（路由 401/404/200，limit 参数）+ `tests/knowledge-dashboard.test.tsx` ⑤c（消息渲染为可点击链接） |
| CP-2 | 产品 | **`add_source` 工具**：新增模型可调工具，复用既有 `addSource` 数据层能力（不新增网络/搜索代码），登记一个 URL 为对象的采集源；`propose_entity` 描述追加提示，引导模型在对象被采纳后主动用 `web_search` 找来源再登记 | REQ-F-245, DEC-350②, TASK-458, TEST-458 | 新增 | 双向 | 机器：`tests/entity-tools.test.ts` ⑫（登记成功/重复登记报错/对象不存在报错/参数缺失）+ ① 号用例同步更新（注册列表含 `add_source`，联网开关不影响其可用性）|
| CP-3 | 产品 | **来源配置改为弹窗**：`KnowledgeDashboard.tsx` 卡片内联的采集源表单收进 `Dialog`（shadcn，已装未用），卡片上只留一个"采集源设置（N）"按钮；弹窗内新增"自动配置来源"按钮，复用既有 `onAsk` 机制把预填问题交给对话框，不在弹窗内直接调用模型 | REQ-F-245, DEC-350③, TASK-459, TEST-459 | 新增 | 双向 | 机器：`tests/knowledge-dashboard.test.tsx` ⑤（改写：源表单只在弹窗打开后才在 DOM 里）+ ⑤b（自动配置来源按钮的 onAsk 断言） |

## 非目标（如实登记）

- **不做"行业硬核指标对比"页**（第 1 条括号内容）——经 INPUT-2026-09-18-002 确认是独立于本 CR、独立于 `CR-20260918-competitor-board` 的第三个页面，留给独立的 `CR-20260918-industry-spec-comparison`。
- **不让 UI 组件（弹窗或别处）直接调用模型**——第 2、6b 条"自动配置/自动寻找"字面上像是要一个"点一下就自动完成"的按钮，但这个应用至今没有任何 UI 组件绕过对话框直接发起模型调用的先例（`onAsk` 这条既有机制存在的意义正是"把问题交给对话框，不在组件里执行"）。一次会消耗 token、可能触发真实网络请求（`web_search`）的动作，理应留痕在对话历史里、由用户看见问的是什么、答的是什么，而不是一次静默的后台调用。真要做成"新建对象后台自动触发一次来源发现"，是一个需要专门设计（成本由谁承担、失败了如何提示、要不要能关掉）的产品决策，本 CR 不擅自替用户做这个决定。
- **不给"自动发现"新增独立的抓取/搜索机制**——`web_search`/`read_url` 已经是通用工具，`add_source` 只补"登记"这一步。
- **不给消息历史加存储上限或过期清理**——`entity-history.ts` 的 `MAX_HISTORY_READ` 只限制单次读取返回的条数，不限制磁盘上保留的条数。见 DEC-350①的「代价/残留风险」：这是一个接受的、如实记录的权衡，不是遗漏——真实使用场景下，一个对象的采集源变化频率受巡检间隔（分钟到小时级）与页面实际更新频率共同限制，短期内不会积累到需要担心的体量；长期若真的需要滚动清理，留给以后一条独立 CR 处理，不在这里预先设计一个没有真实数据支撑用量假设的清理策略。
- **不改动 `entities.ts` 的 `change`/`changeAt` 字段语义**——两者继续作为"最新一条"的既有摘要存在（卡片折叠态的一瞥），消息清单是新增的展开视图，不是替代。

## 并行事项说明（如实登记）

本 CR 与 Wave 1 四条 CR（`unified-floating-console`、`competitor-board`、`library-in-board`、`conference-preview-insight`）及并行的 `CR-20260918-industry-spec-comparison` 在独立 git worktree 中实现，从同一个 `main` 基点分支。本 CR 触碰的文件（`entities.ts` 未改、`sources.ts`、新增 `entity-history.ts`、`entity-tools.ts`、`KnowledgeDashboard.tsx`、新增历史路由）与已知的 Wave 1 并行改动（`DisplayScreen.tsx`、`CompetitorBoard.tsx`、`FloatingChat.tsx`）没有重叠；`KnowledgeDashboard.tsx` 与 `library-in-board`（同样改这个文件，改的是"知识库总览"板块改名「资料库」的那部分）存在同文件改动，但触碰的是不同的 `<section>`（本 CR 改的是友商/准入/客户卡片本身与其采集源表单，`library-in-board` 改的是文件顶部的总览统计板块），理论上合并顺序不敏感，仍需协调会话在实际合并时确认 diff 不冲突。四条 CR 共享的治理文档（产品需求说明书等四份 + `docs/INDEX.md` + `test-results.json`）均未在本次实现中触碰，交由协调会话在合并阶段统一处理。
