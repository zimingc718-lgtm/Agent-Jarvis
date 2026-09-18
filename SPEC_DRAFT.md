# SPEC_DRAFT — CR-20260918-change-history-and-sources

本文件是四份受控说明书的**待落笔内容**，供编排会话在合并阶段手工落进对应文件——本 CR 按 fork 边界不直接编辑
`产品需求说明书.md` / `架构设计说明书.md` / `模块任务开发说明书.md` / `测试说明书.md` / `docs/INDEX.md`。

落笔前先 `check-ids` 核对 REQ-F-244/245、DEC-350、TASK-457/458/459、TEST-457/458/459 仍未被其它并行 CR 占用
（本 CR 的占用区间是编排会话预先划定的 REQ-F-244..247 / DEC-350..354 / TASK-457..464 / TEST-457..464，与
`competitor-board`(REQ-F-243/DEC-349/TASK-456/TEST-456)、`library-in-board`(DEC-347/TASK-452-453/TEST-452-453)、
`unified-floating-console`(DEC-348/TASK-454-455/TEST-454-455)、`industry-spec-comparison`(REQ-F-250+/DEC-360+/
TASK-470+) 均不重叠）。

---

## 目标文件一：`project/01_specification/产品需求说明书.md`

### 1a. `## 功能需求` 表新增两行（表头：`| ID | 名称 | 优先级 | 描述 | 验收标准 | 状态 |`）

```
| REQ-F-244 | 对象卡片消息清单 | MUST | 友商/准入方/客户卡片展开后，显示该对象采集源检测到的变更历史，而不只是最新一条；每条消息可点击进入其来源链接。 | ①卡片展开态渲染一个消息列表区块，与技术参数、采集源分列；②列表按时间倒序，每条消息文本是一个可点击的链接，`href` 指向该条变化的来源 URL、新标签页打开；③没有历史时显示明确的空状态文案，不留白也不报错；④既有的 `change`/`changeAt`（卡片折叠态的最新一条摘要）行为不变，消息列表是新增的展开视图，不是替代。 | APPROVED（CR-20260918-change-history-and-sources，R1 已终裁：INPUT-2026-09-18-001 第 1 条） |
| REQ-F-245 | 采集源弹窗配置 + 登记工具 | MUST | 采集源的管理离开卡片本身、收进弹窗；模型能在对话中登记一个发现的来源为采集源。 | ①卡片展开态不再直接显示采集源的增删表单，改为一个标明当前来源数的按钮；②点击该按钮打开一个弹窗，弹窗内是既有的来源列表（可立即采集/移除）与添加表单，行为与改动前的卡片内联版本完全一致；③新增模型可调用的 `add_source` 工具，登记一个 URL 为指定对象的采集源，不核实其内容、不构成任何字段的直接写入；④弹窗内新增"自动配置来源"按钮，点击后把一句预填问题交给对话框（复用既有 `onAsk` 机制），不在弹窗内直接发起模型调用；⑤`propose_entity` 的工具描述追加提示，引导模型在对象被采纳后主动查找并登记来源。 | APPROVED（CR-20260918-change-history-and-sources，R1 已终裁：INPUT-2026-09-18-001 第 2、6b 条） |
```

### 1b. 新增小节 `## 变更响应 · CR-20260918-change-history-and-sources`

锚点：插在既有最后一个 `## 变更响应 · CR-*` 小节之后、`## 批准状态` 之前（用 `re.search(r"(?m)^## 批准状态$")`
定位，不要用字符串 `.replace`）。

```markdown
## 变更响应 · CR-20260918-change-history-and-sources

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 消息清单 | REQ-F-244（新增） | 新增 | 新增 REQ-F-244 |
| CP-2 add_source 工具 | REQ-F-245（新增） | 新增 | 新增 REQ-F-245 |
| CP-3 来源弹窗配置 | REQ-F-245（新增） | 新增 | 同上，不重复占号 |

**为什么 CP-2、CP-3 合并进同一条 REQ**：两者是同一件事（"来源怎么被添加"）的机制半与界面半，
分开写会让两条 REQ 各自读起来都不完整——CP-2 没有 CP-3 就是一个只有对话能用、界面上摸不到的
工具，CP-3 没有 CP-2 就是一个弹窗但按钮点了什么都不会发生。
```

### 1c. `## 批准状态` 节追加一行

```
- 用户确认：2026-09-18，CR-20260918-change-history-and-sources（L2）R1：用户在 INPUT-2026-09-18-001 第 1、2、6b 条要求对象卡片显示消息清单、采集源改为弹窗配置且支持自动发现，范围经 INPUT-2026-09-18-002 排除第 1 条括号内的行业指标对比页（留给独立 CR）；该确认即为本 CR 的推进授权。新增 **REQ-F-244**、**REQ-F-245**。逐 CP 方案见「变更响应 · CR-20260918-change-history-and-sources」。
```

---

## 目标文件二：`project/02_solution/架构设计说明书.md`

### 2a. DEC 表新增一行（表头 7 列：`DEC-ID | 关联需求 | 决策正文 | 否决方案 | 否决理由 | 代价/残留风险 | 批准状态`，
紧接在本批次其它并行 CR 占用的最大 DEC 编号之后——若届时 DEC-347/348/349 已被占用则顺接实际最大编号，DEC-350 本身的号不变）

```
| DEC-350 | REQ-F-244, REQ-F-245 | **消息历史用独立 JSONL 文件，不进 frontmatter；来源登记复用既有无闸能力开放给模型；弹窗内的自动配置复用既有 onAsk 机制**（CR-20260918-change-history-and-sources）：①新增 `src/lib/entity-history.ts`：`appendHistoryEntry`/`readHistory`，一个对象一个 `.jsonl` 追加文件，`fetchSource`（`sources.ts`）检测到真实变化（非首次建基线）时追加一条，`entities.ts` 的 `change`/`changeAt` 字段语义不变、两者并存；新增只读路由 `GET /api/entities/[name]/history`（复用既有认证/存储守卫模式）；`KnowledgeDashboard.tsx` 卡片展开时懒加载并渲染为可点击链接列表。②新增工具 `add_source`（`entity-tools.ts`），直接调用数据层从未加过闸的 `addSource`——登记一个 URL 不是断言任何字段的值，是"请定期看看这个地址"，`fetch_source`/巡检独立抓取比对，坏链接的后果是 `failed_fetch`，不是假数据上板；`available: () => true`（不随联网开关变化，因为登记本身不发起网络请求）；`propose_entity` 描述追加一句提示。③`KnowledgeDashboard.tsx` 的采集源管理从卡片内联表单收进 `Dialog`（shadcn，此前已装未用）；弹窗新增"自动配置来源"按钮，复用卡片上已经存在的 `onAsk` 机制（"问 Jarvis 关于这个对象"用的同一条）把预填问题交给对话框，不在弹窗内直接调用模型。 | A.（CP-1）消息历史塞进 frontmatter，像 `param`/`evidence` 一样重复行；B.（CP-1）落 sqlite；C.（CP-2）新写一套独立的自动发现抓取/搜索管线；D.（CP-2）来源登记也经 `propose_entity_update` 式待采纳闸；E.（CP-3）保留卡片内联表单，只是折叠进次级展开区块；F.（CP-3）弹窗内"自动配置来源"直接调用模型 | A：实体文件有 64KB 上限，历史无界增长迟早把"有界状态"和"无界流水"两种增长特性挤在同一份文件里，报错时表现为不相关的参数写不进去；B：本项目所有模块都是"一份文件一个对象"的纯文件系统模型，单为一条历史引入 sqlite 会让这一个模块的可回滚性与其它模块不一致，代价与收益不成比例，且不该由这条 CR 顺手替全项目做持久层决定；C：`web_search` 已是经 SSRF 防护/失败短路/预算截断处理过的通用发现工具，重新发明是纯粹的重复实现；D：闸挡的是"模型自称某值为真"，登记 URL 不是断言任何事实，`fetch_source` 独立核验；E：用户原话明确要求配置离开卡片本身，折叠区块仍是"在卡片里"；F：这个应用至今没有 UI 组件绕过对话框直接触发模型调用的先例，一次会花 token、可能触发真实网络请求的动作理应留痕在对话历史里。 | ①`entity-history.ts` 的存储不设上限或过期清理，只有单次读取的返回条数上限（`MAX_HISTORY_READ`）——真实使用场景下巡检间隔与页面实际更新频率共同限制了短期增长速度，长期若需要留给独立 CR；②`add_source` 不核实链接权威性，判断留给模型与用户，错误登记的后果是持续的采集失败状态，不是假数据；③"自动配置来源"目前是"引导 + 用户点按钮预填对话"，不是"新对象创建后自动后台触发搜索"，后者是需要独立设计（成本、失败提示、可否关闭）的产品决策，本 CR 未替用户做这个决定；④`KnowledgeDashboard.tsx` 与并行的 `CR-20260918-library-in-board` 同文件改动，触碰的是不同 `<section>`，理论不冲突，需编排会话合并时确认。 | APPROVED（R1 已终裁；INPUT-2026-09-18-001 第 1、2、6b 条 + INPUT-2026-09-18-002） |
```

### 2b. 新增小节 `## 变更响应 · CR-20260918-change-history-and-sources`（锚点同 1b）

```markdown
## 变更响应 · CR-20260918-change-history-and-sources

快车道（DEC-021 ①）：三个 CP 均双向门且均有机器检查。**无 schema 变更、零新增运行依赖、无新增出网面**——
`add_source` 不发起网络请求，历史读写是本地文件系统操作。

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 消息清单 | DEC-350① | 新增 | 新增 DEC-350 |
| CP-2 add_source 工具 | DEC-350② | 新增 | 同上，不重复占号 |
| CP-3 来源弹窗配置 | DEC-350③ | 新增 | 同上，不重复占号 |
```

### 2c. `## 批准状态` 节追加一行

```
- CR-20260918-change-history-and-sources（R2，快车道）：新增 **DEC-350**（消息历史独立 JSONL 文件；add_source 工具复用既有无闸能力；来源弹窗内的自动配置复用既有 onAsk 机制）。逐 CP 方案见「变更响应 · CR-20260918-change-history-and-sources」。
```

---

## 目标文件三：`project/03_modules/模块任务开发说明书.md`

### 3a. 任务总览表新增三行（表头 7 列：`任务 ID | 模块 | 任务 | 状态 | 依赖 | 覆盖需求 | 覆盖测试`）

```
| TASK-457 | MOD-ENTITIES / MOD-SOURCES / MOD-DASHBOARD-UI | **消息清单**（DEC-350①，CP-1）：新增 `src/lib/entity-history.ts`（`appendHistoryEntry`/`readHistory`，每对象一个 `.jsonl` 追加文件）；`sources.ts` 的 `fetchSource` 在检测到真实变化时追加一条（首次建基线不追加）；新增只读路由 `src/app/api/entities/[name]/history/route.ts`；`KnowledgeDashboard.tsx` 卡片展开时懒加载渲染为可点击链接列表，折叠态既有的 `change` 单行摘要不变。 | DONE | 无 | REQ-F-244, DEC-350 | TEST-457 |
| TASK-458 | MOD-TOOLS | **add_source 工具**（DEC-350②，CP-2）：`entity-tools.ts` 新增 `add_source`（复用既有 `addSource` 数据层函数，零新增网络代码），`propose_entity` 描述追加自动寻源提示。 | DONE | 无 | REQ-F-245, DEC-350 | TEST-458 |
| TASK-459 | MOD-DASHBOARD-UI | **来源弹窗配置**（DEC-350③，CP-3）：`KnowledgeDashboard.tsx` 把卡片内联的采集源表单收进 `Dialog`（shadcn `@radix-ui/react-dialog`，此前已装未用），新增"自动配置来源"按钮复用既有 `onAsk` 机制。 | DONE | TASK-458（弹窗内的自动配置文案指向 add_source 承担的能力） | REQ-F-245, DEC-350 | TEST-459 |
```

### 3b. 新增小节 `## 变更响应 · CR-20260918-change-history-and-sources`（锚点同上）

```markdown
## 变更响应 · CR-20260918-change-history-and-sources

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 消息清单 | TASK-457 | 新增 | 新增 TASK-457 |
| CP-2 add_source 工具 | TASK-458 | 新增 | 新增 TASK-458 |
| CP-3 来源弹窗配置 | TASK-459 | 新增 | 新增 TASK-459（依赖 TASK-458） |
```

---

## 目标文件四：`project/04_tests/测试说明书.md`

### 4a. 测试矩阵新增三行（表头 7 列：`测试 ID | 类型 | 覆盖需求 | 覆盖模块/任务 | 断言目标 | 命令 | 必选`）

```
| TEST-457 | Unit（含机器（UI）） | REQ-F-244 | MOD-ENTITIES / TASK-457 | ①`entity-history.ts` 6 例：空历史返回空数组、追加读回按新到旧、`limit` 只影响单次读取、超限按上限截断、多对象互不影响、损坏/截断行容错（`tests/entity-history.test.ts`）；②`fetchSource` 检测到真实变化时追加一条历史、首次建基线不追加（`tests/sources.test.ts` 新增断言）；③历史路由 401/404/200、`limit` 查询参数生效（`tests/entity-route.test.ts` ⑧）；④卡片展开后消息渲染为可点击链接、`href` 指向来源 URL（`tests/knowledge-dashboard.test.tsx` ⑤c）。 | `npx vitest run tests/entity-history.test.ts tests/sources.test.ts tests/entity-route.test.ts tests/knowledge-dashboard.test.tsx` | 是 |
| TEST-458 | Unit | REQ-F-245 | MOD-TOOLS / TASK-458 | `add_source` 登记成功（含返回的 `sources` 字段）、重复登记转述数据层 409、对象不存在报错、参数缺失报错；工具注册列表含 `add_source` 且不随联网开关变化（`tests/entity-tools.test.ts` ⑫ + ① 号用例同步更新）。 | `npx vitest run tests/entity-tools.test.ts` | 是 |
| TEST-459 | 机器（UI） | REQ-F-245 | MOD-DASHBOARD-UI / TASK-459 | ①弹窗打开前，内联的添加采集源表单不在 DOM 里；点击"采集源设置（N）"按钮后弹窗打开、既有增删/立即采集行为不变（`tests/knowledge-dashboard.test.tsx` ⑤，改写）；②弹窗内"自动配置来源"按钮点击后 `onAsk` 收到预填文本，不在组件内发起任何请求（`tests/knowledge-dashboard.test.tsx` ⑤b）。 | `npx vitest run tests/knowledge-dashboard.test.tsx` | 是 |
```

### 4b. 新增小节 `## 变更响应 · CR-20260918-change-history-and-sources`（锚点同上）

```markdown
## 变更响应 · CR-20260918-change-history-and-sources

| 变化点 | 本层落点 | 分类 | 派生/修订 |
|---|---|---|---|
| CP-1 消息清单 | TEST-457 | 新增 | 新增 TEST-457 |
| CP-2 add_source 工具 | TEST-458 | 新增 | 新增 TEST-458 |
| CP-3 来源弹窗配置 | TEST-459 | 新增 | 新增 TEST-459 |

**真实入口**：`scripts/probe-change-history-and-sources.mjs`（已写好，`node --check` 通过，按并行编排边界未在本分支执行——不得触碰共享的 3000 端口生产服务）。核对：一次性对象 + 直接写入的历史 JSONL 在真实浏览器里渲染为可点击链接；来源表单确实收进弹窗而非内联；弹窗内"自动配置来源"按钮把预填文本交给对话框、未自动发送。全程用完清理。留给合并会话或用户在 `build:local`/`serve:local` 上执行。

### 已知失败（与本 CR 无关，如实登记）

全量 `npx vitest run` 里，`tests/floating-chat.test.tsx > ... ④ a registration receipt that excludes files says so`
偶发 20s 超时——本 CR 未触碰该文件；用 `git stash`（按确切 SHA `apply`，非裸 `pop`）把本 CR 改动移出工作树、
单独在未改动的 `main` 上核实同一用例，判定为环境资源争用型偶发失败，Wave 1 的 `competitor-board`、
`library-in-board` 两条并行 CR 也各自独立报告过同一文件的类似偶发失败。详细核实过程见
`EV-2026-09-18-change-history-and-sources.md` 第 2 节。
```

### 4c. `## 批准状态`（或本文件等价的登记节）追加一行

```
- CR-20260918-change-history-and-sources（R4）：新增 **TEST-457/458/459**（消息清单、add_source 工具、来源弹窗配置；真实入口探针已写未跑）。逐 CP 方案见「变更响应 · CR-20260918-change-history-and-sources」。
```

---

## 目标文件五：`project/05_evidence/test-results.json`

### 5.1 `tests` 数组追加三条（均已实际跑过、真实 PASS）

```json
{
  "id": "TEST-457",
  "result": "PASS",
  "command": "npx vitest run tests/entity-history.test.ts tests/sources.test.ts tests/entity-route.test.ts tests/knowledge-dashboard.test.tsx",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "消息清单（REQ-F-244）。真实入口 scripts/probe-change-history-and-sources.mjs 已写好，按并行编排边界未在本分支执行，见测试说明书「变更响应 · CR-20260918-change-history-and-sources」。"
},
{
  "id": "TEST-458",
  "result": "PASS",
  "command": "npx vitest run tests/entity-tools.test.ts",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "add_source 工具（REQ-F-245）。"
},
{
  "id": "TEST-459",
  "result": "PASS",
  "command": "npx vitest run tests/knowledge-dashboard.test.tsx",
  "real_entry": false,
  "date": "2026-09-18",
  "entry": "assistant",
  "notes": "来源弹窗配置（REQ-F-245）。真实入口同 TEST-457，待编排会话在 build:local/serve:local 上执行。"
}
```

### 5.2 `change_records` 数组追加一条字符串

```json
"CR-20260918-change-history-and-sources"
```

### 5.3 `executed_commands` 数组追加

```json
"npx tsc --noEmit -p .  (OK 0 错误)",
"npx vitest run  (841/842 通过，1 个已核实的既有偶发超时，见证据文件第 2 节)"
```

---

## 目标文件六：`docs/INDEX.md`

**不手写内容**——由 `npm run docs:index` 生成，`check-index` 做逐字节比对。待四份说明书全部落笔后统一重新生成一次
（与其它并行 Wave-1/Wave-2 CR 共用同一次重新生成，不必每条 CR 各生成一次）。

---

## 落笔前后的核对清单（给编排会话）

1. `python tools/governance.py check-ids` —— 确认 REQ-F-244/245、DEC-350、TASK-457/458/459、TEST-457/458/459 与其它并行 CR 的占用 ID 不重叠。
2. `python tools/governance.py check-tables` —— 各处表格改动列数与表头一致。
3. `python tools/governance.py check-specs` / `check-changes` / `check-doors` —— 三层说明书变更响应节均出现 CP-1/CP-2/CP-3 编号。
4. `npm run docs:index` 后 `python tools/governance.py check-index`。
5. **`KnowledgeDashboard.tsx` 与 `CR-20260918-library-in-board` 的合并顺序**：两条 CR 都改这个文件，本 CR 改的是友商/准入/客户卡片本身（消息列表 + 采集源弹窗），`library-in-board` 改的是文件顶部"知识库总览"改名"资料库"的板块——不同 `<section>`，理论不冲突，但合并第二条时务必 `git merge main` 后跑一次 `npx tsc --noEmit` + 相关测试确认没有真实冲突或语义踩踏（例如两者是否都在文件顶部新增了 import，import 顺序/去重需要人工确认一次）。
6. 与 Wave 1 四条 CR、并行的 `CR-20260918-industry-spec-comparison` 一起，`main 合并各分支 → snapshot → 合并回 main` 顺序按 CLAUDE.md 第三节执行，snapshot 全流程只跑一次。
