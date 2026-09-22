# EV-2026-09-21-format-skill

- 来源: 用户 INPUT-2026-09-21-002（本机验证 CR-20260921-markitdown-display 效果后反馈"可阅读性差"，否决不引入模型的启发式方案，要求改用模型排版并复用现有 SKILL.md 上传/注册机制）+ 协调会话三轮 AskUserQuestion 确认（推翻"只整理排版不改内容"、字面复用技能机制、按文件内容缓存）+ R1 终裁「同意，按方案推进」
- 时间: 2026-09-21
- 采集者: 协调会话（claude），在主仓库分支 `cr/20260921-format-skill` 上执行；未触碰生产服务与真实用户数据
- 支撑对象: `CR-20260921-format-skill` CP-1..CP-5
- 可定位路径: 本文件；`src/lib/document-format.ts`、`src/lib/markitdown.ts`、`scripts/documents_to_html.py`、`src/app/api/documents/raw/route.ts`、`src/app/api/settings/documents/route.ts`、`src/components/DocumentSettings.tsx`、`tests/document-format.test.ts`、`tests/document-settings-route.test.ts`、`tests/document-raw-route.test.ts`

## 1. 投入实现前的代码核对（决定了方案 D 的形状）

- `src/lib/skills.ts#registerSkill`：技能表里存的 `name` 是 `generateSkillDoc` 产出的 SKILL.md frontmatter 里的 `name`，不是用户敲的文件夹名——所以"写死一个技能名当排版技能"对用户不可控，改为设置项存技能 **id**（`app_settings.documents.formatSkill`）。
- `src/lib/skills.ts#readSkillDoc(dirPath)`、`store.listSkills(userId)`（返回含 `dirPath` 的 `SkillRecord`）：按 id 找到技能后读 SKILL.md 的现成路径，不需要新增 store 方法。
- `src/lib/skills.ts#makeCompleter` + `store.resolveActiveProvider(userId)`：`chat.ts#summarizeSpan`（对话压缩）与 `wake.ts`（主动唤醒）已经用这一对做"非对话轮的独立模型调用"，本 CR 第三次复用同一模式，不新造调用链。
- `src/lib/tools/budget.ts`：`DEFAULT_CONTEXT_WINDOW.deepseek = 128_000` 是上下文窗口，与单次输出上限（DeepSeek 约 8K）是两回事——一份 50 页文档的 Markdown 不可能一次排完，分块是必需的，不是优化。分块预算定 5,000 token 输入 / 7,000 token 输出。
- `src/lib/documents.ts` 的文本缓存以 `mtime:bytes` 为键；但 `railway volume files upload` 会重写 mtime，用户裁定的又是"按文件内容缓存"，故本 CR 改用 sha256(字节)。
- `src/lib/library.ts#libraryStatePath/readLedger/writeLedger`：`.data/` 下落盘 JSON 的既有惯例（env 可覆盖、坏文件当空、`mkdir -p` 后 `writeFile`），缓存目录照此办理。
- 现有聊天用 Markdown 渲染器 `src/lib/markdown.tsx` 无表格支持且标题封顶 h3-h5，不适合整份文档；渲染统一走 `scripts/documents_to_html.py --render`（与 DEC-390 同一条管线），两条展示路径不会各渲各的。

## 2. 机器证据（本地实际执行，非预测）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| CP-2/CP-3 模块（TEST-520） | `tests/document-format.test.ts` | 9 | 分块按空行打包不超预算、超大单段自成块并可见截断；正常路径拼回全文并落盘；**缩水兜底**——两段各约 4,000 token 各占一块，第一块输出被判缩水后保留原文并含 `CHUNK_KEPT_MARKER`、status=partial；completer 抛错 → unformatted 且连缓存目录都不创建；缓存命中时 completer 只调 1 次、status=cached；键随字节/技能 id/模型名任一变化；无 Provider → unformatted 点明 Provider；SKILL.md 为空 → unformatted 点名技能且不调 completer；`resolveFormatterSkill` 三态 |
| CP-4 设置路由（TEST-521） | `tests/document-settings-route.test.ts`（新建） | 6 | 未登录 401；未设置回显空且非 stale；PATCH 指向自己已注册技能保存并回显名字、指向不存在 id 400 且不写入；空串清除；指向已删技能 GET 回显 stale=true 且仍回显原 id；既无 archive 也无 formatSkill 400、只带 archive 空串仍按原逻辑清除 |
| CP-4 文档路由（TEST-521） | `tests/document-raw-route.test.ts`（扩展至 9 例） | 2 新增 | 设置了技能 → `convertToMarkdown`→`formatDocument`→`renderMarkdown`、不调 `convertToHtml`、排版完整时无页顶提示、传给排版的是抽取 Markdown 与解析到的技能、渲染的是排版结果；指向已删技能 → 走结构转换且页顶 `role="status"` 提示"已不存在"、不调 `formatDocument`；技能存在但 unformatted 时 note 上页顶 |

`npx tsc --noEmit`：**0 错误**（2026-09-21，本机，含内联 `truncateToBudget` 后的最终态）。

`npx vitest run`（全量，2026-09-21 本机）：912 例中 **909 通过、3 失败**——其中 2 例 `tests/module-graph.test.ts`（见下节，本 CR 初版引入、已修正，修正后该文件 23 例全绿）；1 例 `tests/floating-chat.test.tsx > skill intake ④` 为既有 flaky（CR-20260921-markitdown-display 收口时已用 `git stash` 复现于干净基线），与本 CR 无关。

**转换脚本两种新模式的真实（非 mock）执行**：`python scripts/documents_to_html.py --markdown <真实 PDF>` 退出码 0、56,220 字节 Markdown；`printf '# 标题\n\n第一行\n第二行\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' | python scripts/documents_to_html.py --render` 退出码 0，输出含 `<h1>` 与完整 `<table>`。

### 实现过程中被机器守卫当场拦下并修正的问题（如实登记）

1. **新增了一条 `src/lib/document-format.ts -> src/lib/tools/budget.ts` 的 lib→tools 依赖边**（为了复用 `truncateToTokens`）。`tests/module-graph.test.ts`（模块图守卫，冻结且双向精确的 lib→tools 白名单）在全量回归中当场拦下两条用例。处置：不扩大白名单，把同算法、同标记的截断逻辑内联为本地 `truncateToBudget`（`estimateTokens` 来自 `./adapters`，是允许的 lib→lib 边）。理由：白名单存在的意义就是让每条新增 lib→tools 边成为一次有意识的决定，"一个十行的排版辅助函数"不构成扩大它的理由。修正后 module-graph 23 例全绿。
2. **测试自身的三处写法错误**（非实现 bug）：缩水兜底用例的两段文字总量不足一个分块预算、被打成一块（改为两段各约 4,000 token）；全部失败用例对不存在的缓存目录 `readdirSync`（改为断言目录未被创建）；文档路由 ⑧⑨ 在同一 sqlite 里给同一用户重复注册同名技能触发 `SkillNameConflictError`（⑨ 改名）。

## 3. 真实入口（①②③ 已于 2026-09-21 本机执行，PASS；④⑤ 待执行）

- 来源: 协调会话在用户本机生产构建（合并 `main` 后重建重启，`.next-prod`）上执行；Provider 为用户自己配置的 DeepSeek（`deepseek-chat`）；文档为用户资料库里已采纳的真实 PDF `P1_ocp-specification-diablo-400-v0p5p2-2025-05-30-pdf.pdf`
- 时间: 2026-09-21
- 采集者: 协调会话（claude），经 curl 打真实路由；技能注册与选中经现有 `POST /api/skills` 与 `PATCH /api/settings/documents` 接口完成，**用户明确授权**用样例 SKILL.md 代为注册
- 支撑对象: CR-20260921-format-skill CP-1..CP-4

**前提（第①步）**：用户当时的 7 个已注册技能均为业务技能，没有排版技能；用户授权后，协调会话以含 frontmatter 的样例 `SKILL.md`（`name: 文档排版`）经 `POST /api/skills` 注册（返回 `docGenerated: true`，即沿用作者写的 frontmatter、未另调模型生成），再 `PATCH /api/settings/documents {formatSkill: <id>}` 选中；`GET` 回显 `formatSkill=a3d37d9b-…`、`formatSkillName=文档排版`、`stale=false`。

**第②步（首次打开，走模型排版）**：`curl /api/documents/raw?id=<该 PDF>` —— 43 秒返回 HTTP 200、`text/html`、59,701 字节，**页顶无提示条**（`status=formatted`）。与此前纯结构转换（同一文件、同一 route、62,039 字节）对照：

| 指标 | 结构转换（CR-20260921-markitdown-display） | 模型排版（本 CR） |
|---|---|---|
| `<h1>` / `<h2>` / `<h3>` / `<h4>` | 0 / 0 / 0 / 0 | 11 / 26 / 20 / 4 |
| `<table>` | 6 | 21 |
| 回退原文的段（`CHUNK_KEPT_MARKER`） | — | 0 |
| 前 12 个标题 | （无） | Diablo 400 Project: Rack and Power；1 Version History；2 Table of Contents；3 License；4 Open Web Foundation (OWF) CLA；5 Acknowledgements；6 Compliance with OCP Tenets；6.1 Openness；6.2 Efficiency；6.3 Impact；6.4 Scale；6.5 Sustainability |

抽样对照「3 License」段：原始抽取里 `…IS OWFa 0.9.` / `PLEASE VERIFY THE CORRECT CLA/FSA IS USED AND EXECUTED FOR THIS` / `CONTRIBUTION.` 是被 PDF 硬换行切成的三行，排版后合为一段，文字逐字保留；`Microsoft / Google / Meta` 三行保持为独立行。

**第③步（缓存）**：`.data/document-format/` 出现 `90fd6e97…--a3d37d9b-134c-41e0-b8bd-0f3c56c60273--deepseek-chat.json`（50,229 字节；`status=formatted`、`chunks=3`、`keptVerbatim=0`、排版后 Markdown 49,157 字符，对应原始抽取 56,220 字符——短 12%，主要来自目录的点线引导符与多余空白被整理掉，是否有内容丢失属④人工核对范围）。第二次打开同一文档 **5.5 秒** 返回 200、无新的 Provider 调用。5.5 秒不是缓存本身的开销：当前实现先做 markitdown 抽取（`convertToMarkdown`）再查缓存，命中时仍付了一次抽取 + 一次渲染的 Python 子进程时间——已记入第 4 节局限，属可优化项，不影响"不再调模型"这一验收点。

**第④步（人工逐段对照，待用户执行）**：模型路线的核心风险。机器只能用"输出缩水超 60%"兜底；12% 的字数差需要人确认是引导符/空白还是漏段。**待用户在展示屏或浏览器里逐段抽读后补记本节。**

**第⑤步（Railway 线上，待执行）**：两条 CR 尚未推送（用户此前裁定"先不推"），线上验证随推送后进行。

R4 矩阵 CP-1 四列仍为 CONDITIONAL，条件已收窄为④⑤。

## 4. 局限（如实登记）

- 保真度兜底只有"输出/输入字符比 < 0.4"这一粗粒度信号：模型改写措辞、漏掉字数占比不大的一段而总量未明显缩水，机器发现不了——这正是用户在 INPUT-2026-09-21-002 明确接受的风险，已列为人工发现项，不用宽松断言伪装成已覆盖。
- `makeCompleter` 固定发 `max_tokens`；对 `kind === "openai"` 的 Provider 正确字段应为 `max_completion_tokens`（`adapters.ts#outputLimitField`）。本 CR 未改 `makeCompleter`——对话压缩与技能生成同样受影响，属既有共性问题，留待专门 CR。
- 缓存无清理策略：磁盘占用随文档数量线性增长（每份约与其 Markdown 同量级）。整目录可随时删除，删除后仅表现为下次打开重新排版。
- 分块上限 40（约 20 万 token 输入）；超出部分保留原文并标注，不会静默丢，但也不会被排版。
- **缓存命中仍付一次 markitdown 抽取**：路由先 `convertToMarkdown` 再把 Markdown 交给 `formatDocument`，缓存检查发生在 `formatDocument` 内部；而缓存键只依赖文件字节、技能 id、模型名，理论上可以先查缓存再决定是否抽取。真实入口实测命中时仍需 5.5 秒（抽取 + 渲染两个 Python 子进程），不影响"不再调模型"这一验收点，属可优化项，留待后续 CR。
