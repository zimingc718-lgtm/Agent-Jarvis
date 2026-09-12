# CR-20260911-web-reading

- 级别: L3（**新增运行依赖 `playwright-core`** —— 唯一的单向门。其余全部双向：无 schema 变更、无新增出网面、无权限模型变化）
- 提出人: user（P6 运行反馈，INPUT-2026-09-11-014：「关键词搜索 ❌ 不存在 无 search 工具 / 绕过反爬 ❌ 不存在 opencompute.org 403、tesla.com 403 / 原文 pdf 阅读等工具也不具备。看看怎么修复」）
- 状态: APPROVED（R1 人工终裁：用户在收到分析与两项待决后回复「都做吧」）→ P3/P4 完成
- 占用 ID: REQ-F-055..058, REQ-NF-014, DEC-033, TASK-093..097, TEST-097..099
- 评审模型: **R1-R4 + G2/G3/G3.5**。起草时误标为「标准档、不产出 R2–R4 矩阵」——但 CP-5 是单向门（新增运行依赖），DEC-021 ① 的快车道只豁免「全部双向门且各有机器检查」的记录，本 CR 不符合；且 L3 按 `docs/WORKFLOW.md` 本就要走完整四门。已补三张矩阵。
- 影响需求: 新增 REQ-F-055（PDF 正文读取）、REQ-F-056（抓取失败可区分 + 浏览器请求头）、REQ-F-057（浏览器读取通道）、REQ-F-058（本机搜索后端就绪与可验证）、REQ-NF-014（浏览器通道边界）；修正 `CR-20260911-tool-availability` 中「SearXNG 本机就绪」的失实记载
- 影响模块: MOD-TOOLS（`web-tools` 分流与回退、新增 `browser-fetch`、`url-guard` 请求头）、新增 **MOD-PDF**（`src/lib/pdf-text.ts`）、MOD-SETTINGS-UI（浏览器回退开关）
- 影响任务: 新增 TASK-093..097（全部 DONE）
- 影响测试: 新增 TEST-097, TEST-098, TEST-099（全部 PASS）；`tests/search-settings.test.tsx` 的保存断言随新字段更新。（逐一列出而非写 `097..099`：`cr_related_tests` 用的 `extract_ids` 不解析 `..` 范围，只会取到第一个编号，`gate g3.5 --cr` 会因此看不到真实入口证据。同样的写法在 `CR-20260911-proactive-wake` 也在，已另记。）
- 当前证据: `project/05_evidence/EV-2026-09-11-web-reading.md`
- 方案选项:
  - **搜索** — A. 用公共 SearXNG 实例：**否决**，实测 8 个实例全部不提供 JSON（200 返 HTML 或 403/429）。B. 自写 Bing/DDG/Mojeek 抓取：**否决**，Bing RSS 返回与查询无关的结果，DDG 连不上，Mojeek 无可解析结果。C. **本机 SearXNG 容器**：选中，原设计路径，代码零改动。
  - **403** — A. 补全浏览器请求头：**不足**，实测三站加头后仍 403。B. 指纹伪装 / stealth 浏览器：**否决**，属规避检测，且失效频繁。C. **真浏览器回退 + 把「需要浏览器」与「站点拒绝」讲清楚**：选中，实测能救回 tsmc.com 一类站点，对 Cloudflare 类如实报失败。
  - **PDF** — A. 引入 `pdf-parse` / `pdfjs-dist`：**否决**，为一个工具再开一道单向门。B. **`node:zlib` 手写提取**：选中，与 DEC-018 手写 zip 同一先例，实测英文 4,345 词、中文 23 万字可用。
- 选择理由: 三项根因经实测彼此独立（EV §1/§2/§3），其中两项推翻了最自然的猜测——搜索不是代码缺失而是配置缺失，403 不是 UA 问题而是 JS 人机校验。方案按「先量后改」选定：能零依赖解决的（PDF、请求头、失败分类）绝不加依赖；唯一的依赖（`playwright-core`）只为一个实测存在的收益（被拒绝的非浏览器请求），并限定为仅在被拦截时触发、可关闭。
- 回滚方式:
  - **依赖回滚（单向门的出口）**：`npm remove playwright-core`，删 `src/lib/tools/browser-fetch.ts`，`read_url` 的 `viaBrowser` 分支改为直接返回拦截说明。其余能力（PDF、请求头、失败分类、搜索）**不受影响**——浏览器通道是独立分支，不在任何主路径上。
  - 运维回滚：`docker rm -f jarvis-searxng` + 删 `.data/searxng/` + 清空 `app_settings.search.base_url`。无 schema 变更。
  - 文档回滚：删 REQ-F-055..058 / REQ-NF-014 / DEC-033 行与本 CR 的三层变更响应节。
  - 回滚后重跑 `verify | check-changes | review r1..r4` 并重新 `snapshot`。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - P3: TASK-093..097 DONE；TEST-097..099 PASS；`npm test` / `test:ui-contract` / `build:verify` / `tsc` 全绿。
  - P4 真实入口：本机 SearXNG 返回 JSON 且 `web_search` 出结果；UALink 英文 PDF 与东兴证券中文 PDF 均提取出正文；被 Cloudflare 拦截的地址如实报失败且不返回校验页。
- 评审记录: 标准档，相关角色意见见下。**R1 人工终裁**：用户 2026-09-11 报告三项缺失并要求「看看怎么修复」；助手先实测再给方案，其中明确提出两项待决——「是否启动 Docker 拉起本机 SearXNG（改动系统状态）」与「是否把 Playwright 提为运行依赖（L3 单向门）」。用户回复「**都做吧**」，两项均为明确授权。**仍提请复核**：`playwright-core` 的实测收益有限（EV §2：只救回 5 个样本站中的 1 个，对用户点名的 opencompute / tesla / iea 全部无效），若不认可这个取舍，可按「回滚方式」单独撤销依赖而保留其余全部能力。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **本机 SearXNG 就位，`search.base_url` 落库**。`web_search` 的注册条件是 `searchConfigured`，而该键在库中根本不存在，工具从不注册——用户看到的「没有搜索工具」是配置缺失而非代码缺失。容器仅绑定回环、`settings.yml` 开 `json` 格式并关 `limiter`（两者缺一 JSON 接口即不可用） | REQ-F-058、REQ-F-033 | 缺陷修复 | 双向 | 真实入口：☰「搜索设置」→「测试连接」返回「搜索服务连接正常。」；机器：`probeSearchBackend` 的既有分类逻辑 |
| CP-2 | 产品 | **PDF 按 PDF 读**。`read_url` 此前不看 `content-type`，把 791 KB 的 PDF 解成 38.9 万字符噪音并**报成功**。新增零依赖提取（`node:zlib` + 内容流读取 + TJ 字距 + ToUnicode CMap），英文样本 4,345 词、中文样本 23 万字 | REQ-F-055 | 新增 | 双向 | 机器：`tests/pdf-text.test.ts` 八条（含字距、CID、加密、扫描件）+ `tests/web-reading.test.ts` 分流三条 |
| CP-3 | 产品 | **加密 PDF 与扫描件报失败，不返回空的成功**。「假装成功」是本次最严重的故障模式：噪音会进上下文与数据库 | REQ-F-055 ③④ | 新增 | 双向 | 机器：`tests/web-reading.test.ts` ②「扫描件报失败并说明原因」 |
| CP-4 | 产品 | **拦截与拒绝分开讲**。此前只说「返回 403」，模型分不清「需要浏览器」与「页面没了」，于是反复重试同一地址直到熔断。现按 `cf-mitigated`、server 头、校验页文案（**中英文都认**——实测返回的是中文）分类，并在非拦截失败时明确告诉模型别重试 | REQ-F-056 ② | 缺陷修复 | 双向 | 机器：`tests/web-reading.test.ts` TEST-098 六条 |
| CP-5 | 模块 | **浏览器读取通道**（`playwright-core`，**唯一单向门**）：仅在被拦截时触发，默认开、可在设置中关闭。实测能救回 tsmc.com（fetch 403 → 8,579 字符），对 Cloudflare / Akamai 人机校验**无效**且如实报失败 | REQ-F-057、REQ-NF-014 | 新增 | **单向** | 机器：`tests/web-reading.test.ts` ③④⑥⑦⑧（桩 launcher 覆盖回退、仍被拦、关闭、默认、不误触发）。**站点覆盖面属真实入口发现** |
| CP-6 | 模块 | **浏览器内复用 DEC-025 地址守卫**：浏览器自行解析 DNS，不复用守卫等于绕过 SSRF 防护。每个子请求都过同一个 `assertAllowedUrl`，比 plain 路径更严（子资源也校验）；地址被拒时**不启动浏览器** | REQ-NF-014 ②、REQ-NF-009 ③ | 新增 | 双向 | 机器：`browser-fetch.ts` 在 `assertAllowedUrl` 之后才取 launcher，`tests/url-guard.test.ts` 既有断言覆盖判定本身 |
| CP-7 | 模块 | **出站请求带完整浏览器请求头**（UA / accept-language / accept 含 `application/pdf`）。实测对用户点名的三个站点**无效**，保留是因为它治得了只查空 UA 的站点，且 `accept` 含 PDF 后服务器不会拒绝我们现在能读的 PDF | REQ-F-056 ① | 小改 | 双向 | 机器：`tests/web-reading.test.ts` ⑥ 断言三个头的存在与取值 |

## 相关角色意见（标准档）

- **产品**：三项用户报告逐一有对应 CP，且各自根因不同已用实测分离。CP-5 的收益如实写入 CR 与 EV，不夸大为「已解决反爬」。
- **架构**：唯一单向门是 `playwright-core`，且被限制在一个独立分支上——删掉它不影响 PDF、搜索、请求头、失败分类任何一项，这是它可以被单独撤回的前提。CP-6 是本 CR 的安全前提：把 URL 交给浏览器而不复用守卫，等于把 DEC-025 作废。
- **模块开发**：`pdf-text.ts` 与 `browser-fetch.ts` 均为独立模块，`web-tools.ts` 只多两条分支；`playwright-core` 用动态 `import()` 懒加载，普通对话轮的模块图不变。
- **测试**：PDF 夹具在测试内用 `zlib` 现造，不入库二进制；浏览器通道用桩 launcher 测状态机，真实浏览器只在 P4 人工验证。三处覆盖缺口如实登记（CP-1 容器长期可用性、CP-2 具体文档的排版、CP-5 站点覆盖面）。

## 实施记录（2026-09-11）

- **运维**：启动 Docker Desktop；写 `.data/searxng/settings.yml`（`search.formats` 含 `json`、`server.limiter: false`）；`docker run -d --name jarvis-searxng --restart unless-stopped -p 127.0.0.1:8080:8080 searxng/searxng`；`app_settings.search.base_url = http://127.0.0.1:8080`。实测 `web_search` 返回 10 条。
- **新增**：`src/lib/pdf-text.ts`（PDF 提取 + CMap）、`src/lib/tools/browser-fetch.ts`（浏览器通道 + 守卫复用）。
- **修改**：`url-guard.ts` 导出 `DEFAULT_FETCH_HEADERS` 并用于每一跳；`web-tools.ts` 增 `detectBotChallenge` / `looksLikeChallengePage` / `browserFallbackEnabled`、`read_url` 改为按 `content-type` 分流并在被拦截时回退；`/api/settings/search` 增 `browserFallback` 字段；`SearchSettings` 增开关与限制说明。
- **依赖**：`package.json` `dependencies` 增 `playwright-core@1.63.0`（Chromium 二进制已随 `@playwright/test` 安装，无额外下载）。
- **测试**：新增 `tests/pdf-text.test.ts`（8）、`tests/web-reading.test.ts`（15），`tests/search-settings.test.tsx` +1。全量 430 PASS；`ui-contract` 53/0/0；`build:verify` PASS；`tsc` 0。
- **交付中确认的两条负面结论**（写进 EV，不藏）：① 加浏览器请求头对 opencompute / iea / tesla **完全无效**；② Playwright 有头/无头**都过不了** Cloudflare 校验，等待 25 秒仍停在「请稍候…」。用户点名的三个站点因此**仍然读不到**，工具现在会明确这么说，并建议改用其它来源或把正文贴进知识库。
- **未做**：`snapshot` 未执行——按 `docs/WORKFLOW.md` 全流程只在合并前跑一次，且本工作树同时有并行会话的多个 CR，需先确认分支归属。

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260911-web-reading` 节（逐变化点方案表 + 架构总判）+ DEC-033 + MOD-PDF 边界行 + MOD-TOOLS / MOD-SETTINGS-UI 的追加。行 = CP-1..CP-7，列 = 四角色。无 REJECTED、无空格。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 用户报的「无搜索工具」根因即此 | APPROVED DEC-033 ⑤ 仅回环绑定，无新增出网点（自审） | APPROVED 零产品代码，纯运维 + 一个键 | APPROVED 真实入口可验，沿用既有 probeSearchBackend 分类 |
| CP-2 | APPROVED 「假装成功」是最严重的一项 | APPROVED DEC-033 ② 零依赖，与 DEC-018 手写 zip 同一先例（自审） | APPROVED MOD-PDF 纯函数，可 node 单测 | APPROVED 夹具用 zlib 现造，不入库二进制 |
| CP-3 | APPROVED 空的成功比失败更有害 | APPROVED 两条分支，无额外状态 | APPROVED 与提取函数同文件，无跨模块耦合 | APPROVED 加密与扫描件各一条断言 |
| CP-4 | APPROVED 模型此前反复重试同一地址 | APPROVED DEC-033 ① 纯判定函数，可独立测（自审） | APPROVED 不改既有守卫逻辑，只加请求头与分类 | APPROVED 中英文文案、四类状态码逐条可断言 |
| CP-5 | CONDITIONAL 收益有限（5 站救回 1 站），**条件**：CR 与 EV 必须如实写明对用户点名的三站无效，且依赖可单独撤回——已满足 | CONDITIONAL 唯一单向门，**条件**：必须限制在可单独删除的分支上、懒加载、且不引入指纹伪装——已满足（自审） | APPROVED 独立文件 + 注入点，删除即回滚 | APPROVED 桩 launcher 覆盖状态机；站点覆盖面如实登记为人工发现 |
| CP-6 | APPROVED 安全前提，不可省 | APPROVED 把 URL 交给浏览器而不复用守卫等于作废 DEC-025；逐子请求校验比普通路径更严（自审） | APPROVED 先守卫后启动的顺序由代码结构保证 | APPROVED 判定本身由既有 url-guard 用例覆盖 |
| CP-7 | APPROVED 诚实标识，非伪装 | APPROVED 逐跳生效，不改重定向语义 | APPROVED 单一常量，一处引用 | APPROVED 三个头的取值可直接断言 |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260911-web-reading` 节（变化点影响矩阵 + 技术设计）+ TASK-093..097。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-097 把运维步骤写成可复现的四步 | APPROVED 与 DEC-033 ⑤ 一致 | APPROVED 无产品代码变更，如实标注（自审） | APPROVED 真实入口对应 TEST-099 ⑪ |
| CP-2 | APPROVED TASK-093 七项覆盖 REQ-F-055 ①②⑤ | APPROVED 只依赖 node:zlib | APPROVED 两遍扫描的理由写进任务（map 可能后定义）（自审） | APPROVED TEST-097 ①..⑤ 对应 |
| CP-3 | APPROVED TASK-093 ⑥ + TASK-096 ② | APPROVED 报告而非静默 | APPROVED 两处返回值分开 | APPROVED TEST-097 ⑥⑦、TEST-099 ③ |
| CP-4 | APPROVED TASK-094 三项与 REQ-F-056 ①②④ 对应 | APPROVED 判定与请求头同任务，避免半套落地 | APPROVED 纯函数，无副作用（自审） | APPROVED TEST-098 ①..⑥ |
| CP-5 | CONDITIONAL **条件**：TASK-095 ⑥ 必须显式记录 package.json 的依赖变更——已满足 | APPROVED 懒加载与注入点都在任务里 | APPROVED 单文件，删除即回滚（自审） | APPROVED TEST-099 ④⑤⑦⑧⑨ |
| CP-6 | APPROVED 顺序不可颠倒 | APPROVED TASK-095 ④⑤ 明确「先守卫后启动」与逐子请求 | APPROVED route 通配拦截，不留例外（自审） | APPROVED 由代码结构 + 既有守卫用例共同覆盖 |
| CP-7 | APPROVED TASK-094 ① | APPROVED 逐跳使用 | APPROVED 一个导出常量 | APPROVED TEST-098 ⑥ |

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260911-web-reading` 节（任务→测试派生矩阵 + 三处覆盖缺口 + 一条不写成断言的负面结论）+ TEST-097..099。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 容器长期可用性如实登记为人工 | APPROVED 「测试连接」是现成的人工入口 | APPROVED 无需新增机器检查 | APPROVED TEST-099 ⑪ + 缺口登记（自审） |
| CP-2 | APPROVED 中英文样本都有 | APPROVED 夹具现造，评审可读 | APPROVED node 环境测纯函数 | APPROVED TEST-097 八条（自审） |
| CP-3 | APPROVED 失败文案本身被断言 | APPROVED 不用宽松断言伪装覆盖 | APPROVED 与提取用例同文件 | APPROVED TEST-097 ⑥⑦、TEST-099 ③（自审） |
| CP-4 | APPROVED 中文文案是实测返回的那种 | APPROVED 四类状态码分别有断言 | APPROVED 无需网络 | APPROVED TEST-098（自审） |
| CP-5 | APPROVED 站点覆盖面缺口如实登记 | APPROVED 桩 launcher 不启动真实浏览器 | APPROVED 真实浏览器只在 P4 | APPROVED TEST-099 ④⑤⑦⑧⑨⑩ + 缺口登记（自审） |
| CP-6 | APPROVED 安全项不容许只靠代码审查 | CONDITIONAL **条件**：需说明为何不另写用例——已在派生矩阵中写明由代码结构 + 既有 url-guard 用例共同保证 | APPROVED 顺序由函数结构保证 | APPROVED 既有 url-guard 用例覆盖判定（自审） |
| CP-7 | APPROVED | APPROVED | APPROVED | APPROVED TEST-098 ⑥（自审） |

