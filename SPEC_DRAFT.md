# SPEC_DRAFT — CR-20260918-library-in-board

本文件是 CR-20260918-library-in-board 对六份共享受控文件的**逐字提议内容**，供编排会话在合并阶段落笔。
本 fork 按编排边界不直接编辑这六份文件（四条并行 Wave-1 CR 同时改同一份文件会冲突）。
落笔顺序建议：① 产品需求说明书 → ② 架构设计说明书 → ③ 模块任务开发说明书 → ④ 测试说明书 → ⑤ test-results.json → ⑥ `npm run docs:index` 重新生成 `docs/INDEX.md`（不手工编辑）。

---

## ① project/01_specification/产品需求说明书.md

**定位**：REQ-F-242 所在行（当前在「功能需求」表，约第 102 行，`| REQ-F-242 | 统一浏览 | ...`）。

**操作**：整行替换为（新增 ⑥ 子款 + 状态列追加一次 R1 记录；①-⑤ 原文一字不动）：

```
| REQ-F-242 | 统一浏览 | MUST | 资料库已采纳原件与知识库真实条目分属两个来源，用户应该有一处能一起看，而不必分别打开两个面板拼凑全貌。 | ①「资料库」动态屏面板新增**浏览**模式，与既有**审批**模式（默认打开）并列，互不影响彼此已取到的数据；②浏览列表合并两类卡片：已采纳的资料库原件（结构化字段：类型/大小/更新时间/原文链接）与真实知识条目（source 不是资料库索引卡的那些）——**索引卡本身不重复出现**，已采纳原件只以库卡的身份出现一次；③**分页**：每页固定条数，与既有 `/api/library` 审批接口的"不分页"设计并存但不互相影响（该接口的不分页是"本目录全选"场景的既有设计，浏览场景相反需要分页，两条路由各自成立）；④列表附**类型统计**（复用既有 `byType`/"未分类"分桶口径）；⑤排序近似"模型推荐的优先级"：挂了归属对象的条目排前，组内按更新时间新旧排——不是逐条调用模型打分，258+ 条量级下不现实，如实记为启发式近似而非模型评分；⑥**知识看板（board）正文内嵌入同一套浏览视图**（CR-20260918-library-in-board）：与 ☰ 面板共用同一份组件实现（`LibraryBrowseView`/`loadBrowseFromApi`），不是另起一套渲染逻辑；看板原「知识库总览」板块改名「资料库」，REQ-F-170 ②③ 的「无归属/通用」计数与「内容缺口」板块原样保留，仅「按类型」统计被同一组件自带的、覆盖面更大的类型统计取代；用户不必离开看板去 ☰ 菜单才能看到可浏览的资料库内容。 | APPROVED（CR-20260915-knowledge-library-merge，R1 用户 2026-09-15 总授权终裁：INPUT-2026-09-15-031 第 5 条"支持对话修改分类"引出重新分类需要一处能看见分类结果的地方，随之扩展为统一浏览；⑥ CR-20260918-library-in-board，R1 用户 2026-09-18"按流程开始第一波的 CR"总授权终裁，INPUT-2026-09-18-001 第 3 条） |
```

**不新增 REQ**：item 4（对话检索资料库 + 展示屏直显原件）核实后确认已被 REQ-F-032 ⑤、REQ-F-110、REQ-F-230 三条既有 APPROVED 需求完整覆盖，不修订、不新增条目。理由见 CR 文档「问题经过」。

---

## ② project/02_solution/架构设计说明书.md

**2.1 决策日志新增一行**（定位：DEC-345/DEC-343/DEC-344 所在的决策日志表末尾附近，按编号顺序追加）：

```
| DEC-347 | REQ-F-242 ⑥ | **看板内嵌「资料库」浏览：复用既有组件，不新起实现**（CR-20260918-library-in-board）：①`LibraryPanel.tsx` 的 `LibraryBrowseView`/`loadBrowseFromApi`/`BrowsePageView` 改为 `export`，`KnowledgeDashboard.tsx` 直接 `import` 并复用——看板与 ☰ 资料库设置面板的「浏览」模式渲染同一份组件、同一条取数逻辑，不是各写一份看起来相似实则各自维护的卡片样式；②看板内的浏览状态（`browseOffset`/`browsePage`/`browseError`）与看板既有的 `overview`/`board` 状态并列、互不驱动——不挂 `KNOWLEDGE_CHANGED_EVENT`，只随翻页触发，因为它是独立于"巡检/变更"节奏的一段只读浏览；③原「知识库总览」板块改名「资料库」，REQ-F-170 ②③ 要求的"无归属/通用"计数与"内容缺口"两块原样保留在同一 `<section>` 内，只是"按类型"统计 box 被 `LibraryBrowseView` 自带的、覆盖面更大的类型统计（含已采纳原件，不止知识条目）取代；④组件从"服务单一宿主"变为"被两个宿主共用"后，对响应形状漂移的容忍度补了一层防御性兜底（`page.cards ?? []` 等），不能再假设调用方只有一个、测试桩只有一种写法。 | A. 在 `KnowledgeDashboard.tsx` 里另起一套卡片渲染逻辑，不复用 `LibraryPanel.tsx`；B. 看板板块只放一个跳转链接，点开才导航到 ☰ 资料库面板 | A：两份实现会随时间独立演化，样式与字段迟早漂移，且 `listBrowseCards`/分页/类型统计的产出格式已经很适合直接渲染，没有理由重新设计一遍。B：用户原话是"知识库"板块要"变成"资料库、"实际展示"内容，链接出去是绕过看板去另一个地方看，不满足"嵌入"这个要求 | 组件从服务一个宿主变为两个，任何一处的 props/取数约定变化都会同时影响两块 UI；已通过导出时的注释与新增的防御性兜底降低意外面 | APPROVED（R1 已终裁；用户 2026-09-18「按流程开始第一波的 CR」总授权，随本 CR 名称与范围一并提出） |
```

**2.2 新增变更响应小节**（定位：紧接现有最后一条 `## 变更响应 · CR-...` 小节之后追加）：

```markdown
## 变更响应 · CR-20260918-library-in-board

### 变化点影响矩阵

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 看板「资料库」板块 | DEC-347 | 新增 | 新增 DEC-347 |

item 4（对话检索资料库 + 展示屏直显原件）核实后确认无缺口，未产生新 DEC——已由 DEC-343（`show_document` 工具 + 原件字节路由）与既有的 `rootsOf`/采纳闸设计（CR-20260915-library-adoption）完整覆盖，逐条证据见 CR 文档「问题经过」。
```

---

## ③ project/03_modules/模块任务开发说明书.md

**3.1 任务表新增两行**（定位：TASK-449/TASK-450 所在任务表末尾附近，按编号顺序追加；列顺序为 `TASK | 模块 | 任务 | 状态 | 依赖 | 关联需求 | 关联测试`）：

```
| TASK-452 | MOD-SETTINGS-UI | **看板「资料库」板块改名 + 内嵌统一浏览**（DEC-347，CP-1）：①`LibraryPanel.tsx` 的 `LibraryBrowseView`/`loadBrowseFromApi`/`BrowsePageView` 改为 `export`，并在 `LibraryBrowseView` 内补防御性兜底（`page.cards ?? []`、`page.byType ?? {}`、`page.limit || BROWSE_LIMIT`）；②`KnowledgeDashboard.tsx` 新增 `browseOffset`/`browsePage`/`browseError` 状态与独立 `useEffect`（不挂 `KNOWLEDGE_CHANGED_EVENT`），把原「知识库总览」`<section>` 改名「资料库」并嵌入 `LibraryBrowseView`；REQ-F-170 ②③ 的「无归属/通用」计数与「内容缺口」板块原样保留，仅「按类型」统计被同一组件自带的类型统计取代。 | DONE | TASK-449 | REQ-F-242 ⑥ | TEST-452 |
| TASK-453 | MOD-DOCS / MOD-TOOLS / MOD-DISPLAY | **核实：对话检索资料库 + 展示屏直显原件（item 4）**：核对 `search_documents`/`read_document`/`list_documents`（REQ-F-110）经 `rootsOf` 合并资料库根、`adoptionGate`（REQ-F-230）采纳闸生效；`show_document`（REQ-F-032 ⑤）+ `/api/documents/raw` 经同一条校验路径把资料库原件摆上展示屏。结论：**已满足，未产生代码改动**——不新建"资料库专用"检索/展示工具。 | DONE（结论：已满足，无需建设） | 无 | REQ-F-032 ⑤, REQ-F-110, REQ-F-230 | TEST-420, TEST-445, TEST-446（既有测试，本任务未新增 TEST 编号） |
```

**3.2 新增变更响应小节**：

```markdown
## 变更响应 · CR-20260918-library-in-board

### 变化点影响矩阵

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 看板「资料库」板块 | TASK-452 | 新增 | 新增 TASK-452（依赖 TASK-449，不改其内容） |

### 已有覆盖复核（非本 CR 变化点，如实登记）

item 4 对应 TASK-453（核实性质，非建设性质）：`search_documents`/`read_document`/`list_documents`
（REQ-F-110，`document-tools.ts` 的 `rootsOf` 已合并资料库根）、采纳闸（REQ-F-230）、`show_document`
+ `/api/documents/raw`（REQ-F-032 ⑤，DEC-343）在 `CR-20260915-library-adoption`／
`CR-20260915-document-display` 就已完整实现并测试覆盖，本 CR 核实后确认无缺口，未新增 TASK 对应的
产品代码，只记录核实过程本身。
```

---

## ④ project/04_tests/测试说明书.md

**4.1 测试矩阵新增一行**（定位：TEST-449/TEST-450 所在测试矩阵表末尾附近；列顺序为 `TEST | 名称 | 覆盖需求 | 模块/任务 | 用例描述 | 命令 | 真实入口`）：

```
| TEST-452 | UI/看板「资料库」板块改名与内嵌浏览（机器（UI）） | REQ-F-242 ⑥ | MOD-SETTINGS-UI / TASK-452 | ①板块 `aria-label` 从「知识库总览」变为「资料库」，旧名不再出现；②REQ-F-170 ②③ 的「共 N 条 · 无归属 N 条」摘要行原样保留；③给定 `loadBrowse` mock 返回含库内原件与知识条目两类卡片时，标题、"查看原文"链接（指向 `/api/documents/raw?id=...`）真的渲染出来；④`library-panel.test.tsx` 既有 9 例零回归（组件导出可见性变化不影响原调用方行为）。 | `npx vitest run tests/knowledge-dashboard.test.tsx tests/library-panel.test.tsx` | 否（jsdom + `fireEvent`/mock，非真实浏览器） |
```

**TEST-453**（`scripts/probe-library-in-board.mjs`，真实入口）**暂不写入本表**——按 DEC-250「真实入口的三种账」，脚本已写好但按编排边界未在本分支执行，是「未执行」而非「已执行未过」。建议编排会话在生产构建上实际跑过一次、确认 PASS 后，再把下面这一行补进矩阵（先占位，`命令` 列即最终要用的命令）：

```
| TEST-453 | UI/看板「资料库」板块——真实浏览器 | REQ-F-242 ⑥ | MOD-SETTINGS-UI / TASK-452 | 真实浏览器打开看板正文，核对「资料库」板块渲染、REQ-F-170 计数保留、卡片与"查看原文"链接可用、分页换批。 | `node scripts/probe-library-in-board.mjs`（需 `JARVIS_BASE_URL`，默认 `http://localhost:3000`；需先 `npm run build:local && npm run serve:local`） | 是（待执行） |
```

**4.2 新增变更响应小节**：

```markdown
## 变更响应 · CR-20260918-library-in-board

### 变化点影响矩阵

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 看板「资料库」板块 | TEST-452 | 新增 | 新增 TEST-452；真实入口 TEST-453 已写好脚本，按编排边界未执行，见下 |

### 已有覆盖复核（非本 CR 变化点，如实登记）

item 4（用户原话"确认现在对话是否支持检索资料库的内容，并在展示屏上直接显示原始资料"）核实后确认
**已满足，非本 CR 变化点**：`TEST-420`①②⑥（`tests/library-gate.test.ts`）已经覆盖"资料库采纳后可被
`search_documents`/`read_document` 检索与读取"以及"`show_document` 同一道闸，未采纳挡在展示状态改动
之前、采纳后能展示"；`TEST-445`/`TEST-446`（`document-tools.test.ts`/`document-raw-route.test.ts`/
`display-screen.test.tsx`）覆盖原件字节路由与展示屏渲染。均在 `CR-20260915-library-adoption`／
`CR-20260915-document-display` 就已成立，本 CR 未新增测试，只在此处指明证据来源——这一段的写法直接
沿用 `CR-20260915-document-display` 处理同类"已满足"发现时的先例（见该 CR 在本文件的"已有覆盖复核"
小节）。

### 人工发现项

无新增。TEST-453（真实入口，`scripts/probe-library-in-board.mjs`）待编排会话在生产构建上执行一次，
执行前按 DEC-250 记「未执行（按四条并行 CR 的编排边界，本分支不得启动/访问共享生产服务）」。
```

---

## ⑤ project/05_evidence/test-results.json

**5.1 `tests` 数组追加一条**（TEST-452，已实际跑过、真实 PASS；追加位置：数组末尾或按 ID 顺序插入）：

```json
{
  "id": "TEST-452",
  "result": "PASS",
  "command": "npx vitest run tests/knowledge-dashboard.test.tsx tests/library-panel.test.tsx",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "看板「资料库」板块改名与内嵌浏览（REQ-F-242 ⑥）。全量 38/38（knowledge-dashboard 29 例 + library-panel 9 例零回归）。真实入口 TEST-453（scripts/probe-library-in-board.mjs）已写好，按四条并行 Wave-1 CR 的编排边界未在本分支执行，见 CR 文档与测试说明书「变更响应 · CR-20260918-library-in-board」。"
}
```

**TEST-453 暂不写入** `tests` 数组——尚未实际执行，写入会与本文件其余条目"只登记已发生的执行结果"的口径不一致（`result` 字段现有取值仅 `PASS`/`SUPERSEDED`/`DEFERRED`，没有"待执行"这个态）。编排会话实际跑过 `scripts/probe-library-in-board.mjs` 并确认 PASS 后，比照 TEST-445/449 等既有 real_entry 条目的写法补一条。

**5.2 `change_records` 数组追加一条字符串**（按现有列表的追加顺序，加在末尾）：

```json
"CR-20260918-library-in-board"
```

**5.3 `executed_commands` 数组追加**（本 fork 实际执行过的命令，按现有"命令  (结果)"字符串格式）：

```json
"npx tsc --noEmit  (OK 无输出)",
"npx vitest run tests/knowledge-dashboard.test.tsx tests/library-panel.test.tsx  (OK 38/38 通过)"
```

---

## ⑥ docs/INDEX.md

**不手写内容**——本文件声明"由 `node scripts/gen-index.mjs` 生成，请勿手工编辑"，`check-index` 会做逐字节比对。
待上面 ①③④ 三份说明书的改动落笔后，编排会话执行一次 `npm run docs:index` 让生成器自己产出新版本，
不在本文件里预先写死任何 INDEX.md 的具体行——那样做反而可能与生成器实际产出不一致，制造一次新的
`check-index` 红。

---

## 落笔后自检清单（供编排会话）

- [ ] `python tools/governance.py check-ids` —— 确认 DEC-347/TASK-452/TASK-453/TEST-452/TEST-453 无重号（与另外三条并行 CR 的占用 ID 不重叠）。
- [ ] `python tools/governance.py check-tables` —— 四处表格改动列数与表头一致。
- [ ] `python tools/governance.py check-specs` / `check-changes` / `check-doors` —— 三层说明书变更响应节均出现 CP-1 编号；CR 文档的门/发现方式声明齐全。
- [ ] `npm run docs:index` 后 `python tools/governance.py check-index` —— 确认重新生成后与生成器输出逐字节一致。
- [ ] 四条并行 Wave-1 CR 的 `main 合并各分支 → snapshot → 合并回 main` 顺序按 CLAUDE.md 第三节执行，snapshot 全流程只跑一次。
