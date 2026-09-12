# EV-2026-09-11-web-reading

- 来源：本机实测（HTTP 探测、Playwright 有头/无头对比、真实 PDF 提取、公共 SearXNG 实例枚举）+ 开发库会话记录 + 用户 2026-09-11 报告
- 时间：2026-09-11
- 采集者：Claude（产品 owner + 架构 + 测试角色，按 AGENTS.md「一人多角色须声明」）
- 支撑对象：`CR-20260911-web-reading` CP-1..CP-7
- 可定位路径：本文件；`project/00_input/需求输入.md` INPUT-2026-09-11-014

用户原话：「关键词搜索 ❌ 不存在 无 search 工具 / 绕过反爬 ❌ 不存在 opencompute.org 403、tesla.com 403 / 原文 pdf 阅读等工具也不具备」。

三项各自的根因完全不同，下面逐项给实测数据。**其中两项推翻了最自然的猜测**，这是本 CR 先测后改的理由。

## 1. 「没有搜索工具」——配置缺失，不是代码缺失

`web_search` 的实现完整存在于 `src/lib/tools/web-tools.ts`，注册条件是 `context.webEnabled && context.searchConfigured`。开发库实测：

| `app_settings` 键 | 值 |
|---|---|
| `search.enabled` | `true` |
| `search.base_url` | **不存在** |

`searchConfigured` 因此恒为 false，工具从不注册，模型侧表现为「没有搜索工具」。会话记录里 12:26:18 连续三条 `web_search` 结果均为「尚未配置搜索服务地址。」——那是工具注册后才可能出现的文案，说明更早的会话曾配置过、后来丢失；无论如何当前为未配置。

本机也确实没有后端：8080 无监听；Docker Desktop 已安装 29.3.1，但守护进程未运行。`CR-20260911-tool-availability` 记的「SearXNG 本机就绪」与事实不符，本 CR 据实更正。

### 免密钥替代后端实测（全部不可用）

| 后端 | 结果 |
|---|---|
| searx.be / searxng.site / priv.au / search.inetol.net / baresearch.org / search.rhscz.eu / opnxng.com / search.bus-hit.me | 8 个公共实例**全部不返回 JSON**：200 返回 HTML，或 403 / 429 |
| Bing `format=rss` | 200，10 条 item，但内容与查询**完全无关**（查 AIDC 供电返回手游攻略） |
| DuckDuckGo lite / html | 连接失败 |
| Mojeek | 200，5.5 KB，无可解析结果 |

**结论**：没有捷径，原设计（本机 SearXNG）是唯一可靠路径。已按此落地，见 §4。

## 2. 「绕过反爬」——不是 User-Agent 问题，加请求头无效

对三个站点各测「当前请求头（仅 accept）」与「完整浏览器请求头（UA + accept + accept-language）」：

| 站点 | 当前请求头 | 浏览器请求头 | 防护标识 |
|---|---|---|---|
| opencompute.org | 403 | **403** | `cf-mitigated: challenge`，`server: cloudflare` |
| iea.org | 403 | **403** | `cf-mitigated: challenge`，`server: cloudflare` |
| tesla.com | 403 | **403** | `server: AkamaiGHost` |

响应体含「Just a moment」「Enable JavaScript」——JS 人机校验。**改请求头对这三个站点零作用。**

### 真浏览器也过不去

用 Playwright Chromium 直接打开，有头与无头各测一轮，每轮等待校验自行完成最多 25 秒：

| 模式 | 站点 | 状态 | 等待 | 仍在校验页 |
|---|---|---|---|---|
| headless | opencompute.org | 403 | 25.5s | 是（标题「请稍候…」） |
| headless | iea.org | 403 | 25.5s | 是 |
| headed | opencompute.org | 403 | 25.5s | 是 |

Cloudflare 能识别被自动化驱动的浏览器。要过去只能做指纹伪装（stealth 补丁 / undetected 构建），**本 CR 明确不做**：那是规避检测，且极易失效。

### 但浏览器通道仍有实测价值

对 5 个站点比较「plain fetch 提取字符数」与「浏览器提取字符数」：

| 站点 | fetch | 浏览器 |
|---|---|---|
| **tsmc.com/english/news-events** | **HTTP 403** | **8,579 字符** |
| anthropic.com/news | 3,875 | 3,886 |
| arxiv.org/list/cs.AR/recent | 17,326 | 17,270 |
| openai.com/news | 2,336 | 1,415 |
| semianalysis.com | 7,742 | 103 |

**结论**：浏览器通道能救回**一部分**拒绝非浏览器客户端的站点（tsmc.com 是实测样本），但对 Cloudflare / Akamai 人机校验无效，对普通页面也没有优势。因此它被定位为**仅在被拦截时触发的回退**，且必须可关闭——而不是默认路径。这也是本 CR 是 L3 的唯一原因（新增运行依赖 `playwright-core`）。

## 3. 「PDF 读不了」——最严重，因为它「假装成功」

`read_url` 完全不检查 `content-type`，把响应字节按 UTF-8 解码后跑 HTML 剥离。对 UALink 白皮书实测：

| 项 | 值 |
|---|---|
| PDF 大小 | 791,255 字节 |
| 旧实现提取 | 389,274 字符的二进制噪音（开头 `%PDF-1.6`、`FlateDecode`、对象号） |
| 旧实现返回 | **ok = true** |

会话记录里两条 PDF 读取分别只落下 461 和 239 字符的无意义内容，且都记为成功——噪音因此进入上下文与数据库。

### 零依赖提取实测可行

用 `node:zlib` 解压 FlateDecode 流并读取文本操作符：

| 文档 | 提取字符 | 可读字符占比 | 说明 |
|---|---|---|---|
| UALink 白皮书（英文，791 KB） | 33,675（4,345 词） | 99.9% | 首「Executive Summary」到尾作者简介齐全；`UALink` 出现 87 次 |
| 东兴证券行业报告（中文，5.6 MB） | 230,992 | 81% | 需 ToUnicode CMap，见下 |

两处关键细节，都是实测逼出来的：

- **字距**：`TJ` 数组里的数字是字距调整。不区分就会把每个字距当空格，「High-Efficiency」变成「High-E fficiency」。按 ≤ -120 才判为词间空格后正常。
- **CID 字体**：中文 PDF 用 Identity-H 子集字体，2 字节是字形索引不是字符，直接按字节解码得到 `ªÎÞª¾êÞ` 一类噪音。该文档自带 7 组 ToUnicode CMap；解析并合并后中文正文正常还原（「超节点与 Scale up 网络行业：谷歌、AMD、国产超节点持续发力，打破英伟达独大格局」）。未被任何 CMap 覆盖的字体串按可读性丢弃，否则噪音会污染整份提取。

零依赖是与 DEC-018（手写 zip 解析）同一判断：`node:zlib` 已提供唯一的难点，引入 PDF 库是为一个工具开单向门。

## 4. 本机搜索后端已就位（本次实际执行的运维动作）

| 步骤 | 结果 |
|---|---|
| 启动 Docker Desktop | 守护进程 10 秒内就绪，29.3.1 / linux |
| 写 `.data/searxng/settings.yml` | `search.formats` 含 `json`、`server.limiter: false`（两者缺一 JSON 接口即不可用） |
| `docker run … -p 127.0.0.1:8080:8080 searxng/searxng` | 容器 `jarvis-searxng`，`--restart unless-stopped`，**仅绑定回环**，不对外暴露 |
| `GET /search?q=…&format=json` | HTTP 200，20 条结果 |
| 写入 `app_settings.search.base_url` | `http://127.0.0.1:8080` |
| 经 `web_search` 工具实测 | ok，10 条结果，首条 NVIDIA 800 VDC 页面 |

## 5. 设计决策与依据

| # | 决策 | 依据 | 门 |
|---|---|---|---|
| D1 | 本机 SearXNG，不用公共实例、不自写搜索抓取 | §1 实测：公共实例无 JSON，Bing/Mojeek/DDG 均不可用 | 双向（删容器与配置即回滚） |
| D2 | PDF 提取零依赖，手写 | §3 实测可行；与 DEC-018 同一先例 | 双向 |
| D3 | 合并全文档 ToUnicode CMap，不按字体逐一解析 | 逐字体需走资源字典与对象引用；子集字体码位极少冲突，收益与复杂度不成比例 | 双向 |
| D4 | 未被 CMap 覆盖的 CID 串**丢弃**而非输出 | §3：输出即噪音，会污染整份提取；丢一个标题好过毁一份文档 | 双向 |
| D5 | 加密 PDF、扫描件**报失败**，不返回空的成功 | 「假装成功」正是本次最严重的故障模式 | 双向 |
| D6 | 请求头补全（UA / accept-language / accept 含 application/pdf） | §2：治不了那三个站，但治得了只查空 UA 的站；且 accept 含 PDF 后服务器不会拒绝我们现在能读的 PDF | 双向 |
| D7 | 浏览器通道**仅在被拦截时触发**，且可关闭，默认开 | §2：普通页面无优势且更慢；tsmc.com 证明有救回价值 | **单向**（新增运行依赖 `playwright-core`） |
| D8 | 浏览器内复用 DEC-025 地址守卫，拦截每一个子请求 | 浏览器自行解析 DNS，不复用守卫等于绕过 SSRF 防护 | 双向 |
| D9 | **不做**指纹伪装 / stealth 补丁 | 属规避检测；且失效频繁，维护成本不可控 | — |
| D10 | 校验页**绝不**作为正文返回 | 否则模型会把一份安全提示当作来源去「总结」 | 双向 |

## 6. 用户授权形态（如实记录）

用户 2026-09-11 报告三项缺失并说「看看怎么修复」，在收到分析（含「搜索需要你决定是否启动 Docker」「浏览器通道是 L3 依赖决定」两问）后回复「**都做吧**」。据此：

- 启动 Docker、拉起容器、写入配置：**已明确授权**；
- `playwright-core` 提为运行依赖（L3 单向门）：**已明确授权**，但依赖可单独撤回（见 CR 回滚方式），且实测收益有限（§2），**提请复核**；
- D1–D10 其余各条由助手代拟，均为双向门，可单独撤回。

## 7. 本 CR 依赖人工发现的风险

- **PDF 提取质量**（CP-2）：机器守得住「英文/中文样本能提出正文、加密与扫描件报失败、噪音不外泄」；「某份具体 PDF 排版错乱或漏段」只有真实使用才发现。合并 CMap 的码位冲突（D3）属同类。
- **浏览器通道的站点覆盖面**（CP-5）：机器守得住状态机（拦截→回退→仍被拦则报失败）；「哪些站能救回」逐站不同，只能实测。
- **SearXNG 容器的长期可用性**（CP-1）：容器可能被停止、镜像可能更新导致配置不兼容。`probeSearchBackend` 与设置里的「测试连接」是现成的人工检查入口。
