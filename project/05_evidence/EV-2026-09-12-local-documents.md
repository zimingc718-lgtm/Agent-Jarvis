# EV-2026-09-12-local-documents

- 来源: 用户 2026-09-12「对话也无法搜索本地的资源，这个问题要解决」，以及随后两条澄清——分层架构（Agent 对话 → agent.md → skill 层 → 工具层 → 本地原文档 / 联网知识）与「我说的知识库，不是规格化的知识数据库，是本地的原文档」
- 时间: 2026-09-12
- 采集者: 助手（claude-opus-5），本机执行
- 支撑对象: `CR-20260912-local-documents`（REQ-F-110、REQ-NF-050、DEC-090、MOD-DOCS、TASK-170、TEST-170/171/172）
- 可定位路径: 本文件；`src/lib/documents.ts`、`src/lib/tools/document-tools.ts`、`src/app/api/settings/documents/route.ts`、`src/components/DocumentSettings.tsx`

## 1. 缺的不是一个工具，是一整层

### 1.1 现状核对

改动前全部 18 个工具：

```
extract_fields  fetch_source  ingest_url  list_entities  list_skills
propose_entity  propose_entity_update  read_entity  read_knowledge  read_skill
read_url  save_insight  save_knowledge  search_knowledge  search_skills
show_home  show_insight  web_search
```

对 `src/lib/tools/` 全目录 grep `readFile` / `readdir`：**零命中**。工具层碰得到的文件只有知识库、实体库、技能库三个由 Jarvis 自己管理的目录，没有任何一个能读用户磁盘上的原件。

### 1.2 现有「知识库」正是用户说的不是的那个东西

| 维度 | 现有知识库 | 用户要的本地原文档 |
|---|---|---|
| 内容 | 带 frontmatter 的结构化条目 | 用户自己的 PDF / Word / 文本原件 |
| 来源 | 模型提议，用户采纳后才可检索 | 用户放在文件夹里，无需任何动作 |
| 原件 | 不保留——`ingest_url` 的描述原文：「只存正文与原链接，**不存原件**」 | 原件就是全部 |
| 位置 | `.data/knowledge/`，Jarvis 管理 | 用户自己的目录，Jarvis 只读 |

本机实测：`.data/knowledge/` 下**已采纳条目 0 条**，唯一一条内容卡在 `pending/` 从未采纳。

### 1.3 顺带确认的一个冷启动陷阱

`search_knowledge` 与 `read_knowledge` 的可用性判定是 `context.knowledgeCount > 0`。已采纳条目为 0 时，这两个工具**根本不进工具表**，模型因此连「有个知识库但它是空的」都说不出来，只能凭记忆作答而没人看得出来。

本 CR 不改知识库那两个工具（另立 CR），但**新的文档工具刻意不重复这个错误**：三个工具无条件注册，未配置目录时给出「去哪配置」的明确回复。

## 2. 可行性：零新增依赖

三块现成的东西正好拼得上：

| 需要 | 复用 | 出处 |
|---|---|---|
| PDF 正文 | `extractPdfText(bytes)` | `src/lib/pdf-text.ts`（CR-20260911-web-reading，零依赖） |
| Word 正文 | `readZipEntries(buffer)` + `word/document.xml` | `src/lib/zip.ts`（docx 就是 zip 装 XML） |
| 检索排序 | `tokenize` / `rankBm25` / `snippetFor` | `src/lib/knowledge.ts`（BM25，已导出） |
| 目录配置 | `app_settings` 表 + `getSetting`/`setSetting` | 与搜索后端同一套 |

`package.json` 的 `dependencies` **未改动**。

## 3. 路径守卫：`url-guard` 的文件系统版

这一层把用户磁盘暴露给一个会读网页的模型，所以守卫的形状照抄已经被验证过的那一个。

**核心判断：先 `realpath`，再判包含。** 顺序反过来就守不住：

| 攻击形态 | 只比字符串 | 先解析再比 |
|---|---|---|
| `资料/../私密/credentials.txt` | 前缀仍以根开头，放行 | 解析后落在根外，拒绝 |
| 根内的符号链接指向 `~/.ssh` | 路径字符串完全在根内，放行 | 解析到真实位置，拒绝 |
| 根 `/srv/docs` vs 目录 `/srv/docs-private` | `startsWith` 判为包含，放行 | `relative()` 返回 `../docs-private`，拒绝 |

包含判定用 `relative(rootReal, absReal)` 而不是 `startsWith`，第三行就是原因。

其余约束：

- 遍历时**直接跳过符号链接**。读取时守卫也会拒，但列出来本身就泄露了它的存在，而且符号链接成环会让遍历无界。
- 拒绝越界时的文案**不回显目标真实位置**（TEST-170 断言了这一点）。
- 标识形如 `目录名/相对路径`，**绝对路径从不出现在给模型的任何输出里**。
- 遍历上限：5,000 个文件、8 层深度；跳过 `node_modules` / `.git` / `.venv` 等一批目录；跳过隐藏文件。
- 单文件上限：文本 4 MiB、PDF 24 MiB、docx 24 MiB。
- 单次检索的抽取预算 48 MiB，超出的文件留到下次，并在回复里说明「还有 N 份未读入」。

**这一层没有写入口。** `src/lib/documents.ts` 不导出任何 `save*` / `write*` / `delete*` 函数，TEST-171 ⑤ 对此有断言。移除目录只是不再查找它，磁盘不动。

## 4. 工具预算：一个真实信号

三个新工具中两个是 `essential`。加进去之后 `tool-budget` 的既有断言立刻红了：

```
→ expected [ 'list_skills', 'read_skill', …(6) ] to include 'read_entity'
```

即 8k 窗口下新工具把看板依赖的 `read_entity` 挤了出去。

处置**不是改断言**，而是把文档工具的注册顺序移到实体工具之后——`fitFor` 同优先级按注册顺序排，于是小窗口下让位的是文档工具。被挤掉不等于消失：工具名录会写明「另有 N 个工具本轮未加载，因为超出该模型窗口的工具预算：…」，模型据此可以告诉用户「这个能力在，但这个模型的窗口装不下」。TEST-171 ④ 断言了这条路径。

## 5. 本次验证

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm test` | 614 用例 PASS（新增 26：TEST-170 十八条、TEST-171 八条） |
| `node scripts/ui-contract.mjs` | 53 passed · 0 failed · 0 warnings |
| `npm run test:e2e` | **18 passed**（新增 TEST-172 两条） |

真实入口（TEST-172 ①）走的是完整链路，每一环都不是预置的：

1. 从 ☰ 菜单「文档目录」输入绝对路径添加文件夹，对话框回「已添加，共 1 份可读文档」；
2. 抽屉里的摘要行显示「1 个目录」；
3. 提问后步骤流出现 `search_documents`，随后出现 `read_document`——**第二步的文档标识是桩模型从第一步的检索结果里解析出来的**，不是写死的；
4. 助手回复里出现文件原文中的「1200 kW」。

TEST-172 ② 验证移除：摘要行回到「未配置目录」，而磁盘上的文件内容原封不动。

## 6. 未覆盖的部分（如实登记）

- **agent.md 层还没有做**。用户给的分层里这一环仍缺：身份提示至今只有一句英文常量，没有写「本地优先、联网兜底」的工作顺序。模型现在**能**读本地文档（工具在名录里），但没有任何东西告诉它**应该先读**。这是下一条 CR 的事，本 CR 不声称解决了它。
- **模型的选择时机无法机器断言**。工具描述写了用途，但它在什么时候决定去查本地，属提示层。
- **读不了的格式**：旧的 `.doc` 二进制格式、扫描件 PDF（无文字层，本工具不做 OCR）、`.pptx` / `.xlsx`。前两类会给出明确原因，后两类目前直接不列入可读清单。
- **索引只在内存里**。进程重启后第一次检索会重新抽取。对本机单用户可接受，未做持久化。
- **大目录的首次检索较慢**。抽取预算 48 MiB 一到就停，回复里会说明还剩多少未读入，再检索一次继续补。这个体感只有真实使用能判断。
- **不做文件选择器**。浏览器的目录选择器给的是沙箱句柄，不是 Node 进程能读的路径，做出来会「看起来成功了却什么都找不到」。所以要求输入绝对路径，这一点在对话框里写明了。
