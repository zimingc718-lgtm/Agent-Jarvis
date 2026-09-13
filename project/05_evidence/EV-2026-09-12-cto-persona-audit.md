# EV-2026-09-12-cto-persona-audit

- 来源: 用户 2026-09-12 要求「新建一个 agent，假设你是这个平台的使用者，你的角色是 AIDC 的 CTO……自己模拟人来操作这个系统，看看这个系统有哪些缺漏，bug，或者待优化的地方」
- 时间: 2026-09-12（13:06–14:06 本机时间）
- 采集者: 助手（claude-opus-5）以 AIDC 设备供应商 CTO 角色运行的子代理，本机执行，全部数据取自真实入口
- 采集方式: 11 轮真实对话（`POST /api/chat/stream`，6 个会话）+ 管理面板全部 API（知识库 / 实体 / 洞察 / 展示屏 / 技能 / 配置 / 巡检）。无测试桩、无硬编码响应
- 环境: 生产构建（`.next-prod`，单管理员免登录）、OpenAI gpt-5（优先级 0）+ DeepSeek、SearXNG 127.0.0.1:8080 在线
- 期末残留状态: 实体 6 个（友商 4、客户 1、规则与准入方 1）、知识库已采纳 1 条 / 待采纳 2 条、实体提议 2 条、洞察 1 条已推上展示屏。未删除任何技能与 Provider，未改源码，未执行 git / 构建 / snapshot
- 支撑对象: `CR-20260912-knowledge-attribution`、`CR-20260912-ingest-extract-chain`、`CR-20260912-turn-budget-continue`、`CR-20260912-proposal-id-collision`、`CR-20260912-knowledge-retrieval`
- 可定位路径: 本文件；原始 SSE 与 API 返回留存于采集会话临时目录 `scratchpad/cto-run/`（`r1..r11.sse`、`r*.meta`、`resp_*.json`）；代码位置逐条在下文标注

## 0. 一处必须先说的采集缺陷（界定本文件的可信范围）

采集脚本前 8 轮用 Python 默认 stdout（Windows cp936/GBK）写 `payload.json`，却标称 `content-type: application/json`。服务端按 UTF-8 解析，非法字节被替换为 U+FFFD，**模型实际收到的是部分乱码**。

验证：`payload.json` 首字节 `ce d2`（GBK 的「我」），源文件 `m8.txt` 同一字为 `e6 88 91`（UTF-8）。

据此**撤回**三条一度成立的结论，不得计入任何 CR：

| 撤回的结论 | 撤回理由 |
|---|---|
| 「模型把 AIDC 理解成充电桩（OCPP / BMS / GB/T 20234）」 | 乱码输入所致；编码修正后重测，领域理解完全正确 |
| 「模型不肯调用工具」 | 编码修正后同一问题触发 38 次工具调用 |
| 「模型忽略指令」 | 部分由乱码造成；残余部分见 §5.8，按待优化登记而非缺陷 |

下文第 1–9 节结论均取自编码修正后的干净 UTF-8 轮次（r9/r10/r11）或与编码无关的管理 API 调用。此采集缺陷本身另见 §2.8。

## 1. 能力上限的实测（决定了这些缺陷值得修）

提问：两相浸没的 PFAS/GWP 法规风险 vs 冷板 CDU 单点可靠性，明年往哪押产能。

模型读取了 EUR-Lex Regulation (EU) 2024/573 原文 PDF（23.7 万字）与 ECHA SEAC 的 PFAS 意见稿 PDF（46.6 万字），产出这一条逐字引用：

> `heat transfer fluids for 2-phase immersion cooling for 13.5 years after EiF`

（两相浸没传热流体，自生效起豁免 13.5 年。）这是决策级细节。

已生效的证据护栏经实测确认有效：`extract_fields` 强制 `quote` 且必须在条目正文中逐字存在，否则拒绝写入；`save_knowledge` 只能提议进待采纳区，采纳前不参与检索。

交付链 `list_skills` → `read_skill(报告生成)` → `save_insight` → `show_insight` → 展示屏一次跑通。

## 2. 确认的缺陷

### 2.1 `save_knowledge` 无法归属对象、无法记来源

对话里明确要求「归属到友商实体『维谛技术 Vertiv』（name 为 维谛技术-vertiv），每条带原始来源 URL」，`GET /api/knowledge` 返回：

```json
{"name":"vertiv-为-nvidia-gb300-nvl72-提供的电力与散热参考架构-simready-资产-字段模板-厂商",
 "bytes":1438,"source":"model","entity":"","docType":"","sourceUrl":""}
```

根因在工具定义 `src/lib/tools/knowledge-tools.ts:100-113`——`save_knowledge` 的 `parameters.properties` 只有 `title` 与 `content`，`execute` 调用 `saveKnowledge({ title, content, source: "model", pending: true })`，**没有任何途径写入 `entity` / `sourceUrl` / `docType`**。

而存储层与 `/api/knowledge/overview` 的 `byEntity` / `byType` / `unowned` 统计全部依赖这三个字段。

影响：经对话存入的每一条知识都是无归属、无来源、无类型的孤儿；知识看板的分组统计结构性地只能显示「无归属」。这是「喂料与固化」的主路径。

### 2.2 `ingest_url` → `extract_fields` 被「待采纳」状态死锁

`ingest_url` 存为 pending，`extract_fields` 读不到 pending 条目，同一轮内连续失败两次，`summary` 只有「未写入」三个字。手工采纳 `POST /api/knowledge/pending/vertiv-develops-energy-efficient-cooling-and-power-reference` 后重试立即成功：

```
[TOOL_RESULT] {"name":"extract_fields","ok":false,"summary":"未写入"}                       ← 采纳前
[TOOL_RESULT] {"name":"extract_fields","ok":true,"summary":"写入 4 个字段：维谛技术-vertiv"}  ← 采纳后
```

影响：产品设计的唯一证据合规管线，首次使用必然失败，且没有任何提示告知用户需要中间插一次人工采纳。

### 2.3 模型编造的失败原因被当作「证据」永久落库

§2.2 失败后，模型的自述进入了实体提议的 `locator`（证据定位）字段：

```
id=-vertiv-20260912174032  field=能力小结  locator=页面需登录；仅标题与站内导航可见
id=-vertiv-20260912174121  field=待确认    locator=页面需登录，正文不可见；导航可见但不作为证据来源
```

**同一轮内模型自己的 `read_url` 对该页两次均 `ok:true`**，「页面需登录」是编的。

`extract_fields` 有 quote 逐字校验，但 `propose_entity_update` 这条旁路没有同等约束，字段名也无白名单（接受了「待确认」「导航」这类非字段）。

影响：护栏被旁路绕过，知识资产被污染，且污染项在采纳前一直挂在看板上。

### 2.4 实体提议 ID 由 ASCII 片段生成，纯中文字段名的提议互相覆盖（静默丢数据）

`extract_fields` 报告「写入 4 个字段」，`GET /api/entities` 实际只新增 2 条提议。存活的两条 id：

```
id=-vertiv-20260912174330        field=液冷方案
id=-vertiv-800vdc-20260912174330 field=800VDC 电源支持
```

根因 `src/lib/entity-proposals.ts:91-95`：

```js
id: `${input.name}-${input.field}-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`
  .toLowerCase()
  .replace(/[^0-9a-z-]/g, "-")
  .replace(/-{2,}/g, "-"),
```

实体 slug `维谛技术-vertiv` 被剥成 `-vertiv`；字段名同样只留 ASCII——「液冷方案」无 ASCII 故为空，「800VDC 电源支持」留下 `800vdc`。时间戳只截到秒（`slice(0,14)` = YYYYMMDDHHMMSS）。**同一实体、同一秒、字段名均为纯中文的提议 id 完全相同，互相覆盖。**

代码注释写的是「时间戳让同一参数的两条提议不撞」——作者防住了同字段重复，**没有防住同一秒内的不同中文字段**。

影响：中文字段名是本产品的常态（「液冷方案形态」「标准组织席位」「CDU 单点故障冗余设计」均无 ASCII），批量抽字段会静默丢失绝大部分结果，而 UI 报的是「成功写入 N 个」。

### 2.5 读取工具不返回知识条目的归属 / 来源 / 类型元数据

| | API 实际存储 | 模型看到并报告的 |
|---|---|---|
| entity | `维谛技术-vertiv` | 「未归属」 |
| sourceUrl | `https://www.vertiv.com/en-us/about/...`（绝对） | 「/en-ca/about/news-and-events/...（相对路径，未存绝对 URL）」 |

`GET /api/knowledge/overview` 同时返回 `{"total":1,"byEntity":{"维谛技术-vertiv":1},"unowned":0}`。模型报出的相对路径来自页面正文里的 HTML 链接，说明它只拿到了 body，没拿到 metadata。

影响：模型无法按对象组织知识、无法核对来源、无法回答「这条哪来的」。归属做了但用不上。

### 2.6 `search_knowledge` 搜不到条目的归属对象名（索引不含元数据）

同一轮 SSE 内连续四次调用：

```
{"query":"Vertiv"} → "知识检索到 1 条"
{"query":"维谛"}   → "知识检索无结果：维谛"
{"query":"浸没"}   → "知识检索无结果：浸没"
{"query":"冷板"}   → "知识检索无结果：冷板"
```

另：`query:"*"` 返回无结果，`query:" "` 返回「参数缺失」。

**采集者当时给出的解释（「检索只对英文原文里逐字出现的词有效」/「中文检索不可用」）经复核不成立，已更正如下。** 复核过程与结论：

1. `tokenize`（`src/lib/knowledge.ts:338-356`）对 CJK 是**按二元组切分**的：`flushCjk` 把 CJK 连续段切成 `slice(i, i+2)` 的 bigram，单字段则整体入队。中文检索本身是实现了的。经验证：`散热` 在中文条目正文中出现 4 次，属可命中形态。
2. 索引的构成是 `docs = entries.map((entry) => ({ id: entry.name, tokens: tokenize(`${entry.title}\n${entry.content}`) }))`（`knowledge.ts:451`）——**只含 title 与 content，不含 `entity` / `docType` / `sourceUrl`**。
3. 而 `parseEntryFile`（`knowledge.ts:138`）把 front matter 与正文分开。实测该条目全文中「维谛」只出现 1 次，且就在 front matter 的 `entity: 维谛技术-vertiv` 行上，正文（英文新闻稿）里一次都没有。

故**真正的缺陷是：归属、类型、来源三个元数据字段存了但没进检索索引**，因此无法按归属对象名找回条目——与 §2.5「存了但读不回」同源，都是元数据写入后无人使用。

而 `浸没` / `冷板` 的 0 命中经核**不是缺陷**：两个词在库内两条条目的正文里均不出现（`grep -c` 均为 0）。库里只有英文正文的条目时，用中文近义词检索本就应当无结果。跨语言检索（中文查询命中英文正文）是一项尚不存在的能力，属能力缺口而非缺陷，见 §4.11。

影响：用户按自己给对象起的中文名检索自己的知识资产，检索不到。外文来源占比越高越严重——因为此时归属字段是唯一的中文抓手。

### 2.7 单轮累计成本无上限、且不可见：1,028,825 input token 换来 768 字截断答案

> **2026-09-12 根因更正。** 本节原写「`applyRetentionWindow` 按用户轮计，同一轮内 38 个工具结果一条都不会被裁，实测超预算 13 倍」。复核调用方后该结论**不成立**：工具循环从不调用 `applyRetentionWindow`，它在每次 provider 调用前调 `fitToolLoopContext`（`budget.ts:318-335`，DEC-080），该函数按 `totalInput` 份额（128k × 0.6 ≈ 76.8k）检查并按 `IN_TURN_RETENTION_STEPS = [3,2,1]` 逐级收窄。**单次请求的预算是守住了的。**
>
> 1,028,825 是**会话累计值**：`addUsage` 把本轮每一次内部 provider 调用都累加进去（REQ-F-037 ②），而 `MAX_TOOL_STEPS = 100` 允许一轮内发起上百次调用。38 次调用 × 平均约 27k ≈ 1.03M，与「每次都在预算内」完全自洽。
>
> 原判断来自只读 `budget.ts:188-201` 而未追到调用方。据此撤回「修订 REQ-F-041 ①」的提议——该条管跨轮回放，与轮内收窄各管一段。
>
> **真实缺陷因此收敛为四条，均仍然成立：**
> ① 一轮的**累计**成本没有上限——单次守住不等于一轮守住，100 次 × 76.8k 中间没有一处看总账；
> ② 一轮的累计成本**不可见**——只并进会话总数，1.6 美元的一次提问作为事件看不见；
> ③ 输出截断不会自动续写（11 轮里 5 轮被截断）；
> ④ 收窄时的占位是裸标记，模型丢掉了自己读过什么。

§1 那一轮计量：**1,028,825 input token + 35,261 output token**（约 1.6 美元），答案被输出上限截断在 **768 字**，提问的两半里 CDU 可靠性那半完全未答（模型已读完 Vertiv XDU 手册，没来得及给结论）。

机制（复核后的正确版本）：

```js
// src/lib/agent-loop.ts:105  —— 每次 provider 调用前都过一遍
while (true) {
  let outgoing = conversation;
  if (input.contextWindow) {
    const fit = fitToolLoopContext(conversation, input.contextWindow);   // budget.ts:318
    ...
```

`fitToolLoopContext` 按 `budgetTokens(contextWindow, BUDGET_SHARES.totalInput)`（128k × 0.6 ≈ 76.8k）判定，超了就按 `IN_TURN_RETENTION_STEPS = [3,2,1]` 只保留最近 3 / 2 / 1 条工具结果，仍放不下才中止本轮。**所以每一次请求都在预算内。**

无界的是它上面那一层：`MAX_TOOL_STEPS = 100`（`agent-loop.ts:18`）允许一轮内发起上百次 provider 调用，而 `addUsage` 把每一次都累加进会话总量（REQ-F-037 ②）。38 次 × 平均约 27k ≈ 1.03M。**中间没有任何一处在看这一轮的总账，界面上也只有会话累计值，看不到「这一次提问花了多少」。**

另有一处信息损失：收窄时 `narrowToolResults`（`budget.ts:286-295`）把被裁的结果替换成裸常量 `OMITTED_RESULT = "[结果已省略]"`，而 `ToolResult` 本来就带一个 `summary` 字段（步骤行在用）。模型因此在综合阶段不知道自己读过什么——这正是本产品最值钱的能力所依赖的。

11 轮里 **5 轮**收到「回复因达到模型输出上限而被截断」。notice 提示「可以让我继续」但**不会自动续写**，用户需再花一轮（而那一轮要重发全部上下文）。gpt-5 的 reasoning token 吃掉大部分输出预算：有一轮 8192 output token 只换到 1,574 字可见正文。

### 2.8 请求体非法 UTF-8 被静默替换为 U+FFFD，不返回 400

`content-type: application/json` 而 body 为 GBK 字节时，服务不报错，替换非法序列后照常入库并送给模型。`/api/conversations/<id>/messages` 中 user 消息含 U+FFFD，助手消息正常。

影响：**低**。浏览器永远发 UTF-8，真实 UI 用户碰不到；只影响脚本与集成调用方。列入本文件的理由是排查成本——本次采集自己被它坑掉 8 轮（见 §0）。

### 2.9 检索未命中记录（misses）会丢失或被覆盖

先后两次读 `/api/knowledge/overview`：

- 第一次：`["F-gas 修订 数据中心","GPU 降频 液冷 失效","PFAS 液冷"]`（同一轮实际发生 6 次未命中，只记下 3 条，时间戳集中在 8 ms 内）
- 第二次：8 条，**上面 3 条一条都不在**

影响：知识看板的「缺口信号」不可靠。8 ms 内 6 进 3 出形似并行写的读-改-写竞争，跨轮整批消失形似容量上限——**两种机制均未证实，丢失本身已确认**。

### 2.10 `ingest_url` 存下的正文含页面脚本数据与大段空行（复核时发现）

由主会话在复核 §2.6 时直接读取落盘条目发现，非采集会话原有主张。

`.data/knowledge/vertiv-develops-energy-efficient-cooling-and-power-reference.md` 的正文**第一行**是该页的前端语言切换数据，其后是数十行空白：

```
---
title: Vertiv develops energy-efficient cooling and power reference architecture for the NVIDIA GB300 NVL72 platform, available
source: file
created: 2026-09-12T17:39:21.793Z
entity: 维谛技术-vertiv
doc_type: 新闻稿
url: https://www.vertiv.com/en-us/about/news-and-events/corporate-news/vertiv-develops-...
---

{"IsDifferent":true,"HomePageUrl":null,"PageDoesNotExist":false,"UrlForCurrentLanguage":"/en-ca/about/news-and-events/corporate-news/vertiv-develops-energy-efficient-cooling-and-power-reference-architecture-for-the-nvidia-gb300-nvl72/","IsStartPage":false,"CountryCode":"USA","LanguageCode":"en"}
（其后约二十行仅含空格的行）
```

两点连带后果，均可由本条直接解释：

1. 这串 JSON 进了检索索引（§2.6 第 2 点：索引取 `title\ncontent`），是噪声 token。
2. §2.5 中模型报出的「来源是相对路径 `/en-ca/about/...`」正来自这串 JSON 的 `UrlForCurrentLanguage` 字段——模型并非凭空编造，而是正文里确实只有这一个像 URL 的东西，而真正的绝对 URL 在它读不到的 front matter 里。

另：`title` 以 `..., available` 结尾，是 `<title>` 被截断后的残句。

影响：入库正文的信噪比直接决定后续检索与引用质量，而这条是 `ingest_url` 唯一一次真实抓取的产物。

11 轮中遇到 1 次：SSE 流共 144 字节，只有 `start` 事件后连接正常关闭，curl 退出码 0。

```
event: start
data: {"type":"start","conversationId":"8edf0f0b-...","messageId":"1de275aa-..."}
```

`GET /api/conversations/8edf0f0b-.../messages` 显示第 15 条是 user 消息，**后面没有任何 assistant 消息**。协议里有 `{type:"error"}`（`src/lib/types.ts:56`）但未发出。发生时该会话已积累约 25k 字工具结果、input 约 48k token。同一条消息重发即成功。

**未定位触发条件，无服务端日志佐证，疑似与上下文超预算相关。按「疑似」登记，不足以单独支撑 CR 的验收条件。**

## 4. 能力缺口（设计上不存在的环节）

| # | 缺口 | 实测依据 | 用户只能怎么绕 |
|---|---|---|---|
| 4.1 | 没有「把本轮研究成果固化下来」的动作 | 最贵那轮 1M token、38 次工具调用、读完两份法规 PDF，产出 **0** 条知识 | 同一轮里额外命令「用 ingest_url 把读过的每个 URL 都入库」再逐条人工采纳；与 §2.2 死锁叠加后实际做不完 |
| 4.2 | 交付物引用了不存在的条目 | 洞察正文写「〔条目：SEAC 2026-03-10 PFAS 限制意见稿〕」「〔条目：Regulation (EU) 2024/573〕」，库里均不存在 | 无法绕。对以「可追溯」为卖点的产品，简报引用追不到源 |
| 4.3 | 没有身份 / 行业配置 | `DEFAULT_SYSTEM_PROMPT`（`src/lib/chat.ts:33`）仅两句通用话；`/api/settings/*` 只有 search / documents / wake | 每个新会话开头手打自我介绍，占 input，漏一次就跑偏 |
| 4.4 | 模型看不见审批队列 | 2 条待采纳知识 + 2 条实体提议挂着，模型答「未发现任何待采纳的提议」；无 `list_pending` 类工具 | 自己打 `/api/knowledge`、`/api/entities`；模型会因此重复提议 |
| 4.5 | 没有 `list_knowledge` 工具 | 有 `list_entities`、`list_documents`，无知识枚举工具；为盘点仅 1 条的知识库，模型做了 15 次关键词猜测式 `search_knowledge` | 无法绕。500 条时模型无法枚举，只能靠碰运气的关键词 |
| 4.6 | 洞察不可浏览 | `GET /api/insights` 不给 `conversationId` 即 400；`src/components/` 下无洞察列表组件，只有 `DisplayScreen` 显示当前一条；洞察对象仅 `[id, kind, html, createdAt]`，无标题、无来源、无主题 | 必须记住是哪个会话生成的再按 conversationId 查 |
| 4.7 | 「定时巡检」只是变更探测，不是自动更新 | `src/lib/sweep.ts` 只算 URL 内容基线差异并写 `health`/`changed`/`change`，不入库、不抽字段、不提议 | 收到「某页变了」后回到对话手工重跑 ingest_url + extract_fields + 两次采纳 |
| 4.8 | 友商字段的语义模型是错的 | 实体 param 三态在 UI 上是「我方满足 / 我方不满足 / 未判定」（`KnowledgeDashboard.tsx:46`），这是「客户或准入方提要求、我方是否达标」的模型；param 只有 name/value/status，**无来源字段、无 as-of 日期** | 把日期与出处塞进 value 字符串（实测填成「N+1? 待查」），无法按来源或时效筛选 |
| 4.9 | 知识条目无去重 | 已采纳的 `vertiv-develops-energy-efficient-cooling-and-power-reference` 与后来 ingest 的同一文章 en-ca 变体 slug 相同 | 人工比对再决定采纳；30 个友商定期巡检会失控 |
| 4.10 | 无**单轮**成本可见性，交互对话无任何上限 | **采集会话原主张「无成本可见性」，经主会话复核不成立，已更正**：REQ-F-037 已实现，☰ 抽屉「搜索设置」条目下方常驻一行「本会话用量：输入 X / 输出 Y tokens」（`src/components/SearchSettings.tsx:114-119`，数据来自 `store.addUsage`）。真正缺的是三件：① **单轮**花费不可见——那次 1,028,825 token 只是并进了会话累计值，作为单个事件看不见；② 交互对话**无任何上限或预警**，而后台唤醒有 `dailyTokenCap: 20000`（实测该轮为其 51 倍）；③ 这行用量挂在「搜索设置」条目下，与搜索无关，且须先打开 ☰ 才看得到 | 每轮前后各开一次 ☰ 读累计值相减，才能推出这一轮花了多少 |
| 4.11 | 无跨语言检索 | 检索是 BM25 + CJK 二元组的**字面**匹配（`knowledge.ts:338-356`、`377`、`451`），没有同义词、译名或向量召回。英文正文的条目用中文近义词（`浸没`、`冷板`）检索必然 0 命中（§2.6 复核确认这是当前设计的正确行为，不是缺陷） | 检索时改用外文原词；或在入库时人工补一段中文摘要进正文 |

## 5. 待优化（交互摩擦与文案）

1. **输出上限偏低且不自动续写**：见 §2.7。
2. **单轮内工具结果不裁剪**：见 §2.7。
3. **工具失败缺可执行的错误文本**：`extract_fields` 失败只说「未写入」，`ingest_url` 传了不存在的 entity 只说「未入库」。模型两次靠猜并最终编造理由（§2.3）。把原因回给模型（「条目在待采纳区」「对象 X 不存在，现有：…」）后，§2.2 与 §2.3 大概会自愈。
4. **`extract_fields` 的成功文案不实**：说「写入 4 个字段」，实际是**提议**（事件为 `entity_pending`）且只有 2 条落地。应为「已提议 N 个字段，待采纳」。
5. **sweep 汇总把失败说成「没有变化」**：
   ```json
   {"reason":"采集 1 个源，没有变化。",
    "results":[{"health":"failed_fetch","detail":"抓取失败：HTTP 404"}]}
   ```
   404 与「没有变化」是相反的两件事。看板自身注释已写明「没有源时，这张卡的安静不代表任何事实」，同一道理在这行汇总里漏掉了。
6. **冷启动给的是白板而非一条路**：`total=0` 时 `search_knowledge` 因 `available: (context) => context.knowledgeCount > 0` 根本不注册，`misses` 因此永远记不到东西——恰恰是最需要「缺口信号」的阶段它不工作。首轮问「该从哪开始」，得到一份 12 周方法论，其中 8 类对象本系统一类都表示不了（只有客户 / 友商 / 规则与准入方三类）。
7. **条目 slug 不可读**：`vertiv-为-nvidia-gb300-nvl72-提供的电力与散热参考架构-simready-资产-字段模板-厂商`——中英混杂、40+ 字符、在「厂商」后被截断丢掉了「：Vertiv」。
8. **库空时模型自由发挥**：明确要求「不要方法论、不要字段模板、不超过 10 行」，仍产出 105 行字段模板（干净 UTF-8 轮次仍部分发生）。属模型行为，产品侧可在系统提示里约束「库空时优先入库，不产模板」。

## 6. 规模推演（500 条知识 / 30 个竞品实体）

最先崩的三处，均由本次实测外推：

- **检索先崩**：无 `list_knowledge`，模型只能关键词猜测（盘点 1 条用了 15 次搜索）；而按归属对象名这个最自然的抓手检索不到任何东西（§2.6），外文来源的条目又无跨语言召回（§4.11）——500 条里靠关键词碰运气找出 3 条相关的，靠不住。
- **审批队列先崩**：当前节奏是「1 条知识 = 1 次采纳，1 个字段 = 1 次采纳」。30 实体 × 10 字段 × 季度巡检 ≈ 每季 300+ 次人工点击，而模型看不见队列、会重复提议、条目无去重。
- **单轮上下文先崩**：实体列表与提议列表 API 把 entity 与 summary 全量重复返回（读单个实体时同一份数据出现两次）；30 个实体带 params 的 `GET /api/entities` 会显著变大，而它是 `list_entities` 每轮都可能拉的东西。

`show_board` / 知识看板的两栏设计（「什么变了」vs「我们有什么」）方向经实测是对的，撑得住规模的是这个信息架构；撑不住的是它下面的检索与审批吞吐。

## 7. 两条被主动排除的「发现」

- `src/lib/sweep.ts` 里的 NUL 字节：是有意的键分隔符，不是缺陷。
- 非 UTF-8 请求体处理：已按 §2.8 登记为低影响，不作为独立缺陷主张。
