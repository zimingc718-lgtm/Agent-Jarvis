# EV-2026-09-14-live-turns

- 来源: 用户 2026-09-14「所有的都进行，第一条你可以做个洞察，找到真实的页面地址」（承 INPUT-2026-09-13-027 的总授权）
- 时间: 2026-09-14
- 采集者: 助手（claude-opus-5），在用户自己那台服务器上执行（端口 3000，生产构建 + `serve:local`）
- 支撑对象: `CR-20260914-probe-failure-is-not-no`（DEC-260）；`CR-20260912-entity-pending` CP-2；`CR-20260912-turn-budget-continue` CP-2/CP-5；`CR-20260911-home-dashboard` CP-2；`CR-20260911-scheduled-sweep` 的前置条件
- 可定位路径: 本文件；`src/lib/adapters.ts`、`src/app/api/providers/test/route.ts`、`.data/entities/*.md`、`project/05_evidence/test-results.json`

## 1. 配采集源：三条「要用几天」的真相是「没有观察对象」

配源前，`GET /api/entities` 报 **10 个跟踪对象、健康度全部 `unconfigured`、采集源总数 0**。而 `sweep.ts` 的 `dueTargets` 第一句就是 `if (entity.sources.length === 0) continue;`——**每一轮巡检都是空转**，`sweep.last_run` 自 2026-09-12T23:58Z 起没再动过。

所以 scheduled-sweep CP-4/CP-5 与 home-dashboard CP-2 不是「要连续跑几天」，是**跑几天也不会有任何结论**。

用本机 SearXNG 搜到的真实地址（不是凭印象写的域名），逐个走 `PATCH /api/entities/<name>` 的 addSource + fetch：

| 对象 | 源 | 结果 |
|---|---|---|
| 维谛技术-vertiv | vertiv.com/en-us/about/news-and-events/corporate-news/ | fresh |
| 台达-delta | deltaww.com/en-US/press | fresh |
| 施耐德电气-schneider | se.com/ww/en/about-us/newsroom/ | fresh |
| 国家能源局-国网并网准入 | nea.gov.cn/zcfb/ | fresh |
| 字节跳动-火山引擎 | volcengine.com/ats | fresh |
| 英维克-envicool | envicool.com/news.html | **failed_fetch** |

**英维克官网对任何请求回 403**（换浏览器 UA 亦然），采集链路如实记 `failed_fetch`——**home-dashboard CP-2「源坏掉时用户能否看出来」由此真跑一次**：数据层给出 failed_fetch，看板汇总条的「N 个采集异常」与卡片的「抓取失败」都走 destructive 色（渲染由 TEST-123 ③ 断言）。随后换成官方信息披露平台巨潮资讯的该股公告页（002837），采集成功。

现在 6 个源、全部 fresh。**观察窗这才算打开**；CP-4/CP-5 从此进入「等两三天」而不是「等不到」。

## 2. 对话跑不起来：坏的是 DeepSeek，而它是默认 Provider

| 探针 | 结果 |
|---|---|
| `POST /api/chat/stream`（默认 Provider = DeepSeek，优先级 0） | 60.2s 后 `Provider stream timed out`，**一个 delta 都没到** |
| 同一条，指定 OpenAI（gpt-5） | **3.6s 答完**，`turn_usage {inputTokens: 3146, outputTokens: 10}` |
| 用**假密钥**打 `api.deepseek.com/chat/completions` | 401，0.62s |
| 用假密钥打 `api.openai.com/v1/chat/completions` | 401，0.95s |

网络与端点都正常（假密钥秒回 401）。适配器报的是 `Provider stream timed out`，而那条消息只在**读流**阶段抛出——说明上游**返回了 200 之后，60 秒一个字节都没发**。

**用户现在打开应用发消息，默认会等 60 秒再看到一句超时。** 这是此刻最要紧的用户可见故障，而它不在代码里，在 DeepSeek 那侧或那把密钥的账号状态上。

## 3. 探测失败被当成了结论（DEC-260）

| 观察 | 值 |
|---|---|
| 「测试连接」 | 两个 Provider 都 `Connection OK` |
| 工具探测 | 两个都 `no`；库里 `{"deepseek-chat":"no"}`、`{"gpt-5":"no"}` |
| 事实 | 当天用 gpt-5 真跑通了三步工具循环 |

`probeToolSupport` 把任何失败都 `return "no"`，而 `no` 写进库之后每一轮都生效。改前改后在**同一台机器上各跑一次同一条探测**：

```
改前：清空 → 测试 → {"toolSupport":"no"}      → 库里又写回 {"deepseek-chat":"no"}
改后：清空 → 测试 → {"toolSupport":"unknown"} → 库里保持 NULL
```

**踩过的一个坑值得记**：第一次「改后」实测仍然回 `no`，让我以为修复没生效。真相是停进程的命令那一次一个都没匹配到，3000 端口上跑的还是旧构建——**构建戳（DEC-210 ①）比的是提交，而我这一串改动都还没提交，所以它照样报 PASS**，帮不上忙。这一条如实写进 DEC-210 的局限。

## 4. 真实对话验掉的三条

**entity-pending CP-2**（模型自发提议 → 说一句 + 刷一次）：

```
tool_call      propose_entity_update   {"name":"台达-delta","field":"机架功率",...}
tool_result    提议更新 台达 Delta.机架功率（推断）
entity_pending {"title": "台达 Delta", "what": "update"}
```

来源不在该对象已登记的采集源内 → 进待采纳区 → 流上回 `entity_pending` → 控制台出系统消息并派发看板刷新。**另一轮**用已登记源的提议走的是「直接生效」分支、按设计不发该事件——两条分支都实跑过一次。

**REQ-NF-060 ④ / turn-budget CP-5**（单轮花费可见）：`turn_usage` 真的随流回来（6,554/492、29,674/9,728），控制台常驻那行的数据源成立。

**turn-budget CP-2**（占位带 summary）：一轮 26 次工具调用之后，真实触发了「本轮工具结果较多，较早几条已省略正文以腾出预算」。

## 5. 没验掉的，以及为什么

- **turn-budget CP-4（累计触阈）**：把 OpenAI 的 `context_window` 临时调到 6000（天花板 = 窗口 × 0.6 × 12 ≈ 43,200），一轮 26 次工具调用累计 **39,402，逼到 91% 未过线**。再调小窗口会让约 3,200 tokens 的稳定前缀装不进单次预算——那是换一个毛病去验这个毛病。验毕已把 `context_window` 恢复为 NULL。
- **turn-budget CP-3（输出截断自动续写）**：需要一次输出撞上 `max_tokens`，本轮 9,728 output 自然结束，没撞上。
- **knowledge-skills CP-3（模型是否真按技能办事）**：要几次真实的技能轮次才敢下判断，不是一轮能定的事。
- 这三条剩下的是**额度**，不是时间，也不是我能替用户决定花的。

## 6. 对用户配置做过什么（已全部恢复或如实留下）

| 动作 | 现状 |
|---|---|
| 给 6 个跟踪对象配采集源 | **保留**——这是用户要的东西 |
| 英维克的失败源换成巨潮公告页 | **保留**（留一个永远失败的源会把「采集异常」这个指示器训练成噪声） |
| 清空 `providers.tool_support` 的两条 `no` | **保留为空**——那是坏探测写下的假结论，改后不会再被写回 |
| OpenAI 的 `context_window` 临时调 6000 | **已恢复 NULL** |
| 临时文档根与归档目录（上一轮） | **已恢复**，`app_settings` 里 documents* 行为空 |
