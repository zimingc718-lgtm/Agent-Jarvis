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

## 3. 真实入口（本 CR 交付时未执行，需用户参与）

模型排版的真实入口按 CR 文档「验收条件」五步骤执行：①用户经现有技能上传入口注册一个排版技能并在「本地文档」里选中；②本机重建重启后打开此前"可读性差"的那份真实 PDF，确认显示的是模型排版后的版本；③第二次打开确认命中缓存（`.data/document-format/` 下出现对应 `<sha256>--<skillId>--<model>.json`，且无新的 Provider 调用）；④**人工逐段对照原文，确认无漏段、无杜撰**——这是模型路线的核心风险，机器只能用"输出缩水超 60%"兜底，兜不住的部分必须人看；⑤Railway 部署后线上重复①②。

第①步依赖用户先注册一个排版技能——这是本 CR 交付时尚未存在的前提，故 R4 矩阵 CP-1 四列均为 CONDITIONAL，执行结果补记本节后转 APPROVED。

## 4. 局限（如实登记）

- 保真度兜底只有"输出/输入字符比 < 0.4"这一粗粒度信号：模型改写措辞、漏掉字数占比不大的一段而总量未明显缩水，机器发现不了——这正是用户在 INPUT-2026-09-21-002 明确接受的风险，已列为人工发现项，不用宽松断言伪装成已覆盖。
- `makeCompleter` 固定发 `max_tokens`；对 `kind === "openai"` 的 Provider 正确字段应为 `max_completion_tokens`（`adapters.ts#outputLimitField`）。本 CR 未改 `makeCompleter`——对话压缩与技能生成同样受影响，属既有共性问题，留待专门 CR。
- 缓存无清理策略：磁盘占用随文档数量线性增长（每份约与其 Markdown 同量级）。整目录可随时删除，删除后仅表现为下次打开重新排版。
- 分块上限 40（约 20 万 token 输入）；超出部分保留原文并标注，不会静默丢，但也不会被排版。
