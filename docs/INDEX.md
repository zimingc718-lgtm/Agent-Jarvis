# 测试与需求索引

本文件由 `node scripts/gen-index.mjs` 生成（`npm run docs:index`）。**请勿手工编辑** — 改动请改生成器后重新生成。

`python tools/governance.py check-index` 重跑生成器（`node scripts/gen-index.mjs --stdout`）并与本文件逐字节比对；不一致就说明某本说明书或 `package.json` 改了，但本文件没有跟着重新生成——按提示跑 `npm run docs:index` 后提交。

| | |
|---|---|
| 生成命令 | `npm run docs:index` |
| 规模 | REQ 100 条 · TEST 168 条（主矩阵） · TASK 163 条 · tests/**/*.test.ts(x) 90 个 |

---

## 一、需求 ↔ 测试 ↔ 文件

口径：REQ 取自 `产品需求说明书.md` 的「功能需求」「非功能需求」两节表格（不含 `## 变更响应 · CR-*` 节的重复提及）；REQ → TEST 取自 `测试说明书.md` 「测试矩阵」节「覆盖需求」列的反查；TEST → 文件按该行「命令」列展开：`npm run <script>` 递归查 `package.json`（深度上限 4），`npm test -- <词>` / `vitest run <路径>` 按子串匹配 `tests/**/*.test.ts(x)` 的文件名（vitest 本身按子串过滤，多命中不是解析 bug），非 vitest 入口标 `<tag>`。解析不到的用 ⚠ 标出并保留原始问题文字——这不是本生成器的疏漏，是被索引文档自身的缺口，必须能被看见。

共 100 条 REQ。

| REQ | 名称 | 状态 | 覆盖 TEST → 解析到的文件/入口 |
|---|---|---|---|
| REQ-F-001 | Google 登录 | DEFERRED | **TEST-001** → `auth-config.test.ts`, `auth.test.ts`<br>**TEST-002** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`<br>**TEST-021** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`<br>**TEST-022** → &lt;人工&gt;（原文：人工执行；结果写入 `test-results.json`（`verification: manual` + `verified_by` + `verified_at`））<br>**TEST-024** → &lt;e2e&gt;, &lt;smoke&gt; |
| REQ-F-002 | 底部悬浮输入条 | APPROVED | **TEST-011** → `floating-chat.test.tsx`, `provider-routes.test.ts`<br>**TEST-048** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`, `theme-toggle.test.tsx`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx` |
| REQ-F-003 | 展开式对话面板 | APPROVED | **TEST-011** → `floating-chat.test.tsx`, `provider-routes.test.ts`<br>**TEST-012** → `visual.test.ts`<br>**TEST-030** → &lt;e2e&gt;, `floating-chat.test.tsx`<br>**TEST-031** → &lt;e2e&gt;, `floating-chat.test.tsx`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-077** → &lt;governance&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-004 | 文本流式回复 | APPROVED | **TEST-008** → `chat-stream.test.ts`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-068** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts`<br>**TEST-081** → `compaction.test.ts` |
| REQ-F-005 | 停止生成 | APPROVED | **TEST-009** → &lt;e2e&gt;, `chat-stream.test.ts`<br>**TEST-029** → &lt;e2e&gt;, `chat-stream.test.ts`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-067** → `chat-stream.test.ts` |
| REQ-F-006 | Provider 启用与优先级 | APPROVED | **TEST-005** → `providers.test.ts`<br>**TEST-011** → `floating-chat.test.tsx`, `provider-routes.test.ts`<br>**TEST-025** → `chat-stream.test.ts`, `providers.test.ts`, `settings-models.test.tsx`<br>**TEST-026** → `chat-stream.test.ts`<br>**TEST-048** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`, `theme-toggle.test.tsx`<br>**TEST-049** → &lt;e2e&gt;, `providers.test.ts`, `settings-models.test.tsx` |
| REQ-F-007 | 独立模型设置页 | APPROVED | **TEST-005** → `providers.test.ts`<br>**TEST-006** → `provider-routes.test.ts`<br>**TEST-010** → &lt;e2e&gt;, `provider-routes.test.ts`, `settings-models.test.tsx`<br>**TEST-016** → `provider-routes.test.ts`<br>**TEST-021** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`<br>**TEST-049** → &lt;e2e&gt;, `providers.test.ts`, `settings-models.test.tsx`<br>**TEST-065** → `provider-routes.test.ts` |
| REQ-F-008 | Provider 认证模式 | APPROVED | **TEST-005** → `providers.test.ts`<br>**TEST-010** → &lt;e2e&gt;, `provider-routes.test.ts`, `settings-models.test.tsx`<br>**TEST-049** → &lt;e2e&gt;, `providers.test.ts`, `settings-models.test.tsx` |
| REQ-F-009 | 凭据服务端加密 | APPROVED | **TEST-003** → `crypto.test.ts`<br>**TEST-010** → &lt;e2e&gt;, `provider-routes.test.ts`, `settings-models.test.tsx`<br>**TEST-017** → `store.test.ts`<br>**TEST-023** → `api-guard.test.ts`, `config-check.test.ts`, `runtime-config.test.ts` |
| REQ-F-010 | OpenAI 接入 | APPROVED | **TEST-006** → `provider-routes.test.ts`<br>**TEST-007** → `adapters-stream.test.ts`, `adapters.test.ts` |
| REQ-F-011 | DeepSeek 接入 | APPROVED | **TEST-006** → `provider-routes.test.ts`<br>**TEST-007** → `adapters-stream.test.ts`, `adapters.test.ts` |
| REQ-F-012 | 本地模型接入 | APPROVED | **TEST-006** → `provider-routes.test.ts`<br>**TEST-007** → `adapters-stream.test.ts`, `adapters.test.ts`<br>**TEST-064** → `adapters-stream.test.ts`, `adapters.test.ts` |
| REQ-F-013 | 最近会话保存 | APPROVED | **TEST-004** → `store-singleton.test.ts`, `store.test.ts`<br>**TEST-008** → `chat-stream.test.ts`<br>**TEST-014** → `chat-stream.test.ts`<br>**TEST-015** → `conversation-routes.test.ts`<br>**TEST-061** → `migrations.test.ts`<br>**TEST-062** → `conversation-routes.test.ts`, `store-singleton.test.ts`, `store.test.ts` |
| REQ-F-014 | 克制的浅色简约视觉 | APPROVED | **TEST-012** → `visual.test.ts`<br>**TEST-018** → &lt;ui-contract&gt;<br>**TEST-019** → &lt;e2e&gt;, `theme-toggle.test.tsx`<br>**TEST-032** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`<br>**TEST-047** → &lt;typecheck&gt;, `visual.test.ts`<br>**TEST-048** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`, `theme-toggle.test.tsx`<br>**TEST-049** → &lt;e2e&gt;, `providers.test.ts`, `settings-models.test.tsx`<br>**TEST-077** → &lt;governance&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-015 | 全屏动态展示屏首页 | APPROVED | **TEST-021** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`<br>**TEST-032** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`<br>**TEST-040** → &lt;e2e&gt;, `display.test.ts`, `settings-on-display.test.tsx`<br>**TEST-041** → &lt;e2e&gt;<br>**TEST-048** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`, `theme-toggle.test.tsx`<br>**TEST-094** → `corner-menu.test.tsx`, `search-settings.test.tsx`, `skill-list.test.tsx` |
| REQ-F-016 | 回复 Markdown 渲染 | APPROVED | **TEST-020** → &lt;e2e&gt;, `markdown.test.tsx`<br>**TEST-028** → &lt;e2e&gt;, `floating-chat.test.tsx`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-076** → `floating-chat.test.tsx` |
| REQ-F-017 | 开始新对话 | APPROVED | **TEST-029** → &lt;e2e&gt;, `chat-stream.test.ts`<br>**TEST-030** → &lt;e2e&gt;, `floating-chat.test.tsx`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx` |
| REQ-F-018 | 连接状态指示灯 | APPROVED | **TEST-027** → &lt;e2e&gt;, `floating-chat.test.tsx`, `visual.test.ts`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-077** → &lt;governance&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-019 | 收起对话面板 | APPROVED | **TEST-031** → &lt;e2e&gt;, `floating-chat.test.tsx`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-077** → &lt;governance&gt;, &lt;ui-contract&gt;, `visual.test.ts`<br>**TEST-095** → `floating-chat-hover.test.tsx`, `floating-chat.test.tsx` |
| REQ-F-020 | 技能上传与注册 | APPROVED | **TEST-035** → `skills-route.test.ts`, `skills.test.ts`<br>**TEST-038** → &lt;e2e&gt;<br>**TEST-043** → `zip.test.ts`<br>**TEST-044** → &lt;e2e&gt;, `floating-chat.test.tsx`<br>**TEST-045** → `skills-route.test.ts`, `skills.test.ts`<br>**TEST-451** → `floating-chat.test.tsx` |
| REQ-F-021 | 按发送路由技能 | SUPERSEDED | **TEST-034** → `skills-route.test.ts`, `skills.test.ts`<br>**TEST-038** → &lt;e2e&gt; |
| REQ-F-022 | 技能内容注入 | SUPERSEDED | **TEST-035** → `skills-route.test.ts`, `skills.test.ts`<br>**TEST-069** → `skills-route.test.ts`, `skills.test.ts` |
| REQ-F-023 | 技能 HTML 产出捕获 | ? | **TEST-036** → &lt;人工&gt;（原文：是）<br>**TEST-038** → &lt;e2e&gt;<br>**TEST-070** → `display-document.test.ts`, `display-screen.test.tsx`, `display-stage.test.tsx`, `display.test.ts`, `settings-on-display.test.tsx`, `tool-suites-append.test.ts`, `tool-suites.test.ts` |
| REQ-F-024 | 洞察结果存储与读回 | APPROVED | **TEST-037** → `display.test.ts`, `settings-on-display.test.tsx`<br>**TEST-038** → &lt;e2e&gt;<br>**TEST-070** → `display-document.test.ts`, `display-screen.test.tsx`, `display-stage.test.tsx`, `display.test.ts`, `settings-on-display.test.tsx`, `tool-suites-append.test.ts`, `tool-suites.test.ts` |
| REQ-F-025 | 技能 HTML 渲染安全边界（当前非目标） | APPROVED | **TEST-040** → &lt;e2e&gt;, `display.test.ts`, `settings-on-display.test.tsx`<br>**TEST-070** → `display-document.test.ts`, `display-screen.test.tsx`, `display-stage.test.tsx`, `display.test.ts`, `settings-on-display.test.tsx`, `tool-suites-append.test.ts`, `tool-suites.test.ts` |
| REQ-F-026 | 动态展示屏内容与持久化 | APPROVED | **TEST-039** → `display.test.ts`, `settings-on-display.test.tsx`<br>**TEST-040** → &lt;e2e&gt;, `display.test.ts`, `settings-on-display.test.tsx`<br>**TEST-041** → &lt;e2e&gt;<br>**TEST-135** → `display-stage.test.tsx` |
| REQ-F-027 | 对话指令控制展示屏 | SUPERSEDED | **TEST-041** → &lt;e2e&gt;<br>**TEST-042** → `chat-stream.test.ts`, `skills-route.test.ts`, `skills.test.ts` |
| REQ-F-028 | 技能可见性 | APPROVED | **TEST-046** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`<br>**TEST-076** → `floating-chat.test.tsx` |
| REQ-F-029 | 工具调用循环 | APPROVED | **TEST-063** → `adapters-stream.test.ts`, `adapters.test.ts`<br>**TEST-067** → `chat-stream.test.ts`<br>**TEST-078** → &lt;e2e&gt;, &lt;smoke&gt;<br>**TEST-092** → `agent-loop-truncated.test.ts`, `agent-loop.test.ts`, `registry-args.test.ts`, `tool-suites-append.test.ts`, `tool-suites.test.ts` |
| REQ-F-030 | 技能作为工具 | APPROVED | **TEST-069** → `skills-route.test.ts`, `skills.test.ts` |
| REQ-F-031 | 技能管理 | APPROVED | **TEST-074** → `skills-route.test.ts`, `skills.test.ts` |
| REQ-F-032 | 展示屏工具化 | APPROVED | **TEST-070** → `display-document.test.ts`, `display-screen.test.tsx`, `display-stage.test.tsx`, `display.test.ts`, `settings-on-display.test.tsx`, `tool-suites-append.test.ts`, `tool-suites.test.ts`<br>**TEST-445** → `document-raw-route.test.ts`, `document-tools.test.ts`, `library-gate.test.ts`<br>**TEST-446** → `display-screen.test.tsx` |
| REQ-F-033 | 联网搜索工具 | APPROVED | **TEST-072** → `web-tools.test.ts` |
| REQ-F-034 | 网页读取工具 | APPROVED | **TEST-072** → `web-tools.test.ts` |
| REQ-F-035 | 对话内步骤流 | APPROVED | **TEST-076** → `floating-chat.test.tsx` |
| REQ-F-036 | 状态灯执行阶段 | APPROVED | **TEST-077** → &lt;governance&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-037 | token 用量可见 | APPROVED | **TEST-062** → `conversation-routes.test.ts`, `store-singleton.test.ts`, `store.test.ts`<br>**TEST-064** → `adapters-stream.test.ts`, `adapters.test.ts`<br>**TEST-075** → `settings-models.test.tsx` |
| REQ-F-038 | 搜索后端配置入口 | APPROVED | **TEST-062** → `conversation-routes.test.ts`, `store-singleton.test.ts`, `store.test.ts`<br>**TEST-075** → `settings-models.test.tsx` |
| REQ-F-039 | 回答来源引用 | APPROVED | **TEST-073** → `sources.test.ts` |
| REQ-F-040 | Provider 工具能力探测与降级 | APPROVED | **TEST-061** → `migrations.test.ts`<br>**TEST-062** → `conversation-routes.test.ts`, `store-singleton.test.ts`, `store.test.ts`<br>**TEST-065** → `provider-routes.test.ts` |
| REQ-F-042 | 自动上下文压缩 | APPROVED | **TEST-079** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts`<br>**TEST-080** → `compaction.test.ts`<br>**TEST-081** → `compaction.test.ts`<br>**TEST-083** → &lt;e2e&gt; |
| REQ-F-043 | 压缩可见与可展开 | APPROVED | **TEST-082** → &lt;ui-contract&gt;, `floating-chat.test.tsx`<br>**TEST-083** → &lt;e2e&gt; |
| REQ-F-060 | 主动唤醒 | APPROVED | **TEST-100** → `wake.test.ts`<br>**TEST-101** → `wake.test.ts`<br>**TEST-102** → `wake-route.test.ts`<br>**TEST-103** → &lt;ui-contract&gt;, `floating-chat.test.tsx`, `wake-settings.test.tsx`<br>**TEST-104** → &lt;e2e&gt; |
| REQ-F-061 | 唤醒产出的呈现与隔离 | APPROVED | **TEST-101** → `wake.test.ts`<br>**TEST-102** → `wake-route.test.ts`<br>**TEST-103** → &lt;ui-contract&gt;, `floating-chat.test.tsx`, `wake-settings.test.tsx`<br>**TEST-104** → &lt;e2e&gt; |
| REQ-F-070 | 本地跟踪对象 | APPROVED | **TEST-120** → `entities.test.ts`<br>**TEST-122** → `entity-route.test.ts`<br>**TEST-125** → `sources.test.ts`<br>**TEST-126** → `ingest-extract-chain.test.ts`, `ingest.test.ts`<br>**TEST-127** → `extract.test.ts`, `ingest-extract-chain.test.ts`<br>**TEST-129** → `sweep-route.test.ts`, `sweep.test.ts`<br>**TEST-442** → `knowledge-dashboard.test.tsx`<br>**TEST-443** → `entities.test.ts`, `knowledge-dashboard.test.tsx`<br>**TEST-444** → `knowledge-dashboard.test.tsx` |
| REQ-F-071 | 知识看板呈现 | APPROVED | **TEST-122** → `entity-route.test.ts`<br>**TEST-123** → `knowledge-dashboard.test.tsx`<br>**TEST-135** → `display-stage.test.tsx` |
| REQ-F-072 | 实体写入与证据 | APPROVED | **TEST-121** → `entity-tools.test.ts`<br>**TEST-122** → `entity-route.test.ts`<br>**TEST-127** → `extract.test.ts`, `ingest-extract-chain.test.ts`<br>**TEST-447** → `entity-proposal-card.test.tsx`, `entity-tools.test.ts`, `floating-chat.test.tsx` |
| REQ-F-050 | 洞察追加与参数容错 | APPROVED | **TEST-092** → `agent-loop-truncated.test.ts`, `agent-loop.test.ts`, `registry-args.test.ts`, `tool-suites-append.test.ts`, `tool-suites.test.ts`<br>**TEST-096** → &lt;e2e&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-051 | 模型输出截断可见 | APPROVED | **TEST-091** → `adapters-tools-limit.test.ts`, `adapters-tools.test.ts` |
| REQ-F-052 | 展示屏基础样式与主题 | APPROVED | **TEST-093** → `display-document.test.ts`, `display-screen.test.tsx`<br>**TEST-096** → &lt;e2e&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-053 | ☰ 菜单改为侧边抽屉 | APPROVED | **TEST-094** → `corner-menu.test.tsx`, `search-settings.test.tsx`, `skill-list.test.tsx`<br>**TEST-096** → &lt;e2e&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-054 | 对话面板悬停态 | APPROVED | **TEST-095** → `floating-chat-hover.test.tsx`, `floating-chat.test.tsx`<br>**TEST-096** → &lt;e2e&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-F-055 | PDF 正文读取 | APPROVED | **TEST-097** → `pdf-text.test.ts`<br>**TEST-099** → `search-settings.test.tsx`, `web-reading.test.ts` |
| REQ-F-056 | 抓取失败可区分 | APPROVED | **TEST-098** → `web-reading.test.ts`<br>**TEST-099** → `search-settings.test.tsx`, `web-reading.test.ts` |
| REQ-F-057 | 浏览器读取通道 | APPROVED | **TEST-099** → `search-settings.test.tsx`, `web-reading.test.ts` |
| REQ-F-058 | 本机搜索后端就绪 | APPROVED | **TEST-099** → `search-settings.test.tsx`, `web-reading.test.ts` |
| REQ-F-044 | 本地知识库 | APPROVED | **TEST-084** → `knowledge.test.ts`<br>**TEST-087** → `knowledge-route.test.ts`<br>**TEST-088** → &lt;ui-contract&gt;, `floating-chat.test.tsx`, `knowledge-list.test.tsx`<br>**TEST-089** → &lt;e2e&gt;<br>**TEST-122** → `entity-route.test.ts`<br>**TEST-124** → `knowledge-attribution.test.ts`, `knowledge-dashboard.test.tsx`, `knowledge-list.test.tsx`, `knowledge-route.test.ts`, `knowledge-tools.test.ts`, `knowledge.test.ts`<br>**TEST-126** → `ingest-extract-chain.test.ts`, `ingest.test.ts` |
| REQ-F-045 | 知识检索工具 | APPROVED | **TEST-085** → `knowledge.test.ts`<br>**TEST-086** → `knowledge-tools.test.ts`<br>**TEST-089** → &lt;e2e&gt;<br>**TEST-122** → `entity-route.test.ts`<br>**TEST-124** → `knowledge-attribution.test.ts`, `knowledge-dashboard.test.tsx`, `knowledge-list.test.tsx`, `knowledge-route.test.ts`, `knowledge-tools.test.ts`, `knowledge.test.ts` |
| REQ-F-046 | 知识固化入口 | APPROVED | **TEST-084** → `knowledge.test.ts`<br>**TEST-086** → `knowledge-tools.test.ts`<br>**TEST-087** → `knowledge-route.test.ts`<br>**TEST-088** → &lt;ui-contract&gt;, `floating-chat.test.tsx`, `knowledge-list.test.tsx`<br>**TEST-089** → &lt;e2e&gt;<br>**TEST-124** → `knowledge-attribution.test.ts`, `knowledge-dashboard.test.tsx`, `knowledge-list.test.tsx`, `knowledge-route.test.ts`, `knowledge-tools.test.ts`, `knowledge.test.ts`<br>**TEST-260** → `proposal-id.test.ts`<br>**TEST-448** → `knowledge-tools.test.ts`, `knowledge.test.ts` |
| REQ-F-041 | 工具结果保留窗口 | APPROVED | **TEST-068** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts`<br>**TEST-150** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts` |
| REQ-F-080 | 本机生产运行与单管理员模式 | APPROVED | **TEST-140** → &lt;build:local&gt;, `auth-config.test.ts`, `auth.test.ts`, `config-check.test.ts`, `single-admin.test.ts` |
| REQ-F-090 | 报告列宽与居中 | APPROVED | **TEST-151** → `display-document.test.ts` |
| REQ-F-091 | 保留窗口无条件生效 | APPROVED | **TEST-150** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts` |
| REQ-F-101 | 渲染隔离与轮内预算 | APPROVED | **TEST-161** → `loop-budget.test.ts`<br>**TEST-162** → `web-result-cap.test.ts` |
| REQ-F-102 | 展示屏三态互相可达 | APPROVED | **TEST-163** → `stage-reach.test.tsx` |
| REQ-F-110 | 本地原文档 | APPROVED | **TEST-170** → `documents.test.ts`<br>**TEST-171** → `document-tools.test.ts`<br>**TEST-172** → &lt;e2e&gt; |
| REQ-F-120 | 运行时状态可见 | APPROVED | **TEST-180** → `runtime-visibility.test.ts`<br>**TEST-181** → `runtime-visibility.test.ts`<br>**TEST-182** → &lt;e2e&gt; |
| REQ-F-130 | 超预算时收紧而非拒绝 | APPROVED | **TEST-190** → `context-degrade.test.ts` |
| REQ-F-140 | 技能产出的宿主适配 | APPROVED | **TEST-200** → `skill-report-bridge.test.ts` |
| REQ-F-150 | 技能按需分页读取 | APPROVED | **TEST-210** → `skill-paging.test.ts` |
| REQ-F-170 | 知识写入带归属 | APPROVED | **TEST-230** → `knowledge-attribution.test.ts` |
| REQ-F-171 | 知识可枚举与按对象检索 | APPROVED | **TEST-230** → `knowledge-attribution.test.ts` |
| REQ-F-180 | 证据管线一轮内闭合 | APPROVED | **TEST-240** → `ingest-extract-chain.test.ts` |
| REQ-F-190 | 洞察双产物与归档 | APPROVED | **TEST-320** → `insight-archive.test.tsx`, `insight-export.test.ts` |
| REQ-F-200 | 设置界面上动态屏 | APPROVED | **TEST-330** → `settings-on-display.test.tsx`<br>**TEST-440** → `floating-chat.test.tsx` |
| REQ-F-210 | 能力不足与失败时按优先级下沉 | APPROVED | **TEST-360** → `chat-stream.test.ts` |
| REQ-F-220 | 资料库与采纳流 | APPROVED | **TEST-390** → `library.test.ts`, `skills-library.test.ts`<br>**TEST-400** → `library-routes.test.ts`<br>**TEST-410** → `library-panel.test.tsx` |
| REQ-F-230 | 采纳后方可对话查阅 | APPROVED | **TEST-420** → `library-gate.test.ts` |
| REQ-F-241 | 待采纳内容默认收拢 | APPROVED | **TEST-441** → `knowledge-list.test.tsx` |
| REQ-F-242 | 统一浏览 | APPROVED | **TEST-449** → `library-panel.test.tsx`, `library-routes.test.ts`, `library.test.ts`, `skills-library.test.ts`<br>**TEST-452** → `knowledge-dashboard.test.tsx`, `library-panel.test.tsx` |
| REQ-NF-050 | 本地读取的边界 | APPROVED | **TEST-170** → `documents.test.ts` |
| REQ-NF-060 | 单轮成本护栏与可见性 | APPROVED | **TEST-250** → `turn-budget.test.ts` |
| REQ-NF-061 | 流式超时看沉默，不看总时长 | APPROVED | **TEST-370** → `adapters-stream.test.ts` |
| REQ-NF-001 | 本机运行 | APPROVED | **TEST-013** → &lt;smoke&gt;<br>**TEST-023** → `api-guard.test.ts`, `config-check.test.ts`, `runtime-config.test.ts` |
| REQ-NF-002 | 认证隔离 | DEFERRED | **TEST-001** → `auth-config.test.ts`, `auth.test.ts`<br>**TEST-004** → `store-singleton.test.ts`, `store.test.ts`<br>**TEST-015** → `conversation-routes.test.ts`<br>**TEST-016** → `provider-routes.test.ts` |
| REQ-NF-003 | 官方授权边界 | APPROVED | **TEST-005** → `providers.test.ts` |
| REQ-NF-004 | 真实入口验证 | APPROVED | **TEST-013** → &lt;smoke&gt;<br>**TEST-024** → &lt;e2e&gt;, &lt;smoke&gt;<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-078** → &lt;e2e&gt;, &lt;smoke&gt; |
| REQ-NF-005 | 不可信归档处理边界 | APPROVED | **TEST-043** → `zip.test.ts`<br>**TEST-045** → `skills-route.test.ts`, `skills.test.ts`<br>**TEST-074** → `skills-route.test.ts`, `skills.test.ts` |
| REQ-NF-006 | 前端 UI 视觉基础 | APPROVED | **TEST-047** → &lt;typecheck&gt;, `visual.test.ts`<br>**TEST-048** → &lt;e2e&gt;, `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx`, `theme-toggle.test.tsx`<br>**TEST-049** → &lt;e2e&gt;, `providers.test.ts`, `settings-models.test.tsx`<br>**TEST-050** → &lt;e2e&gt;, &lt;ui-contract&gt;, `floating-chat.test.tsx`, `markdown.test.tsx`<br>**TEST-058** → &lt;check-dev-server&gt;<br>**TEST-077** → &lt;governance&gt;, &lt;ui-contract&gt;, `visual.test.ts` |
| REQ-NF-007 | 每轮上下文预算 | APPROVED | **TEST-061** → `migrations.test.ts`<br>**TEST-068** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts`<br>**TEST-079** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts`<br>**TEST-133** → `tool-budget.test.ts` |
| REQ-NF-008 | 提示词前缀稳定性与工具动态注册 | APPROVED | **TEST-066** → `agent-loop-truncated.test.ts`, `agent-loop.test.ts`<br>**TEST-068** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts`<br>**TEST-133** → `tool-budget.test.ts` |
| REQ-NF-009 | 出网边界 | APPROVED | **TEST-071** → `url-guard.test.ts`<br>**TEST-072** → `web-tools.test.ts`<br>**TEST-125** → `sources.test.ts` |
| REQ-NF-010 | 内核可扩展性 | APPROVED | **TEST-063** → `adapters-stream.test.ts`, `adapters.test.ts`<br>**TEST-066** → `agent-loop-truncated.test.ts`, `agent-loop.test.ts` |
| REQ-NF-012 | 压缩的成本与失败边界 | APPROVED | **TEST-079** → `budget.test.ts`, `loop-budget.test.ts`, `tool-budget.test.ts`, `turn-budget.test.ts`<br>**TEST-080** → `compaction.test.ts`<br>**TEST-083** → &lt;e2e&gt; |
| REQ-NF-013 | 知识库边界 | APPROVED | **TEST-084** → `knowledge.test.ts`<br>**TEST-086** → `knowledge-tools.test.ts`<br>**TEST-087** → `knowledge-route.test.ts` |
| REQ-NF-014 | 浏览器通道边界 | APPROVED | **TEST-099** → `search-settings.test.tsx`, `web-reading.test.ts` |
| REQ-NF-020 | 唤醒成本边界 | APPROVED | **TEST-100** → `wake.test.ts`<br>**TEST-101** → `wake.test.ts`<br>**TEST-104** → &lt;e2e&gt; |
| REQ-NF-030 | 看板边界 | APPROVED | **TEST-120** → `entities.test.ts`<br>**TEST-121** → `entity-tools.test.ts` |
| REQ-NF-011 | 搜索后端不可用降级 | APPROVED | **TEST-066** → `agent-loop-truncated.test.ts`, `agent-loop.test.ts`<br>**TEST-072** → `web-tools.test.ts` |
| REQ-NF-040 | 免登录模式的边界 | APPROVED | **TEST-140** → &lt;build:local&gt;, `auth-config.test.ts`, `auth.test.ts`, `config-check.test.ts`, `single-admin.test.ts` |

### 1.1 没有任何 TEST 覆盖的 REQ

没有。100 条 REQ 全部在「测试矩阵」的「覆盖需求」列里至少出现过一次。

### 1.2 「覆盖需求」列引用了、但需求说明书未定义的 REQ 编号

没有悬空引用。

---

## 二、测试入口一览

`package.json` 里跑测试/门禁的 script，各自的实际命令、展开后落到的文件/入口，以及按结构性判据推出的层。**层的判据是结构，不是关键词**：e2e = 落在 `tests/e2e/*.spec.ts` 或调用 `scripts/run-e2e.mjs`（不是 `grep -i playwright`——`tests/knowledge.test.ts` 正文里出现过「Playwright 只跑一个 worker」这句测试数据描述，关键词匹配会把它误判成 e2e）；组件 = 文件头 `@vitest-environment jsdom` 或 import 了 `@testing-library/*`；路由 = import 了一个 `src/app/api/**/route.ts`；其余落到「脚本子进程」（无本地 import，靠 `execFileSync` 拉子进程）或「单元」。一个 script 可能跨层，按并集列出。

| script | 实际命令 | 层 | 解析到的文件/入口 |
|---|---|---|---|
| `check:dev-server` | `node scripts/check-dev-server.mjs` | 运维探针 | &lt;check-dev-server&gt; |
| `config:check` | `node scripts/check-config.mjs` | 配置预检 | &lt;config:check&gt; |
| `governance:check-specs` | `python tools/governance.py check-specs` | 治理（Python） | &lt;governance&gt; |
| `governance:g1` | `python tools/governance.py gate g1` | 治理（Python） | &lt;governance&gt; |
| `governance:g2` | `python tools/governance.py gate g2` | 治理（Python） | &lt;governance&gt; |
| `governance:g3` | `python tools/governance.py gate g3` | 治理（Python） | &lt;governance&gt; |
| `governance:g3.5` | `python tools/governance.py gate g3.5` | 治理（Python） | &lt;governance&gt; |
| `governance:g4` | `python tools/governance.py gate g4` | 治理（Python） | &lt;governance&gt; |
| `governance:p2` | `python tools/governance.py check p2` | 治理（Python） | &lt;governance&gt; |
| `governance:p3` | `python tools/governance.py check p3` | 治理（Python） | &lt;governance&gt; |
| `governance:release` | `python tools/governance.py check release` | 治理（Python） | &lt;governance&gt; |
| `governance:ui` | `python tools/governance.py ui` | 治理（Python） | &lt;governance&gt; |
| `governance:verify` | `python tools/governance.py verify` | 治理（Python） | &lt;governance&gt; |
| `test` | `vitest run` | 单元 + 路由 + 组件（全量 vitest，不含 e2e） | &lt;all-vitest&gt; |
| `test:adapters` | `vitest run tests/adapters.test.ts tests/adapters-stream.test.ts` | 单元 | `adapters-stream.test.ts`, `adapters.test.ts` |
| `test:auth` | `vitest run tests/auth.test.ts` | 单元 | `auth.test.ts` |
| `test:auth-config` | `vitest run tests/auth-config.test.ts` | 单元 | `auth-config.test.ts` |
| `test:auth-ui` | `vitest run tests/account-dialog.test.tsx tests/home-dialogs.test.tsx tests/floating-chat.test.tsx tests/settings-models.test.tsx tests/skill-list.test.tsx` | 组件 | `account-dialog.test.tsx`, `floating-chat.test.tsx`, `home-dialogs.test.tsx`, `settings-models.test.tsx`, `skill-list.test.tsx` |
| `test:chat-stop` | `vitest run tests/chat-stream.test.ts` | 单元 | `chat-stream.test.ts` |
| `test:chat-stream` | `vitest run tests/chat-stream.test.ts` | 单元 | `chat-stream.test.ts` |
| `test:config` | `vitest run tests/config-check.test.ts tests/runtime-config.test.ts tests/api-guard.test.ts` | 单元 + 脚本子进程 + 路由 | `api-guard.test.ts`, `config-check.test.ts`, `runtime-config.test.ts` |
| `test:conversations` | `vitest run tests/conversation-routes.test.ts` | 路由 | `conversation-routes.test.ts` |
| `test:crypto` | `vitest run tests/crypto.test.ts` | 单元 | `crypto.test.ts` |
| `test:display` | `vitest run tests/display.test.ts` | 组件 + 路由 | `display.test.ts`, `settings-on-display.test.tsx` |
| `test:e2e` | `node scripts/run-e2e.mjs` | e2e | &lt;e2e&gt; |
| `test:floating-chat` | `vitest run tests/floating-chat.test.tsx` | 组件 | `floating-chat.test.tsx` |
| `test:governance` | `python -m unittest tests.test_governance` | 治理（Python） | &lt;governance&gt; |
| `test:markdown` | `vitest run tests/markdown.test.tsx` | 组件 | `markdown.test.tsx` |
| `test:provider-crud` | `vitest run tests/provider-routes.test.ts` | 路由 | `provider-routes.test.ts` |
| `test:provider-test` | `vitest run tests/provider-routes.test.ts` | 路由 | `provider-routes.test.ts` |
| `test:providers` | `vitest run tests/providers.test.ts tests/settings-models.test.tsx` | 单元 + 组件 | `providers.test.ts`, `settings-models.test.tsx` |
| `test:settings-ui` | `vitest run tests/settings-models.test.tsx` | 组件 | `settings-models.test.tsx` |
| `test:skills` | `vitest run tests/skills.test.ts tests/skills-route.test.ts` | 单元 + 路由 | `skills-route.test.ts`, `skills.test.ts` |
| `test:smoke` | `node scripts/smoke.mjs` | 冒烟（真实 Next.js） | &lt;smoke&gt; |
| `test:store` | `vitest run tests/store.test.ts` | 单元 | `store.test.ts` |
| `test:theme` | `vitest run tests/theme-toggle.test.tsx` | 组件 | `theme-toggle.test.tsx` |
| `test:typecheck` | `tsc --noEmit` | 类型 | &lt;typecheck&gt; |
| `test:ui-contract` | `node scripts/ui-contract.mjs` | 契约（UI 静态规则） | &lt;ui-contract&gt; |
| `test:ui-contract:live` | `node scripts/ui-contract.mjs --live` | 契约（UI 静态规则） | &lt;ui-contract&gt; |
| `test:visual` | `vitest run tests/visual.test.ts` | 契约/脚本 | `visual.test.ts` |
| `test:watch` | `vitest` | 单元 + 路由 + 组件（全量 vitest，不含 e2e） | &lt;all-vitest&gt; |
| `test:zip` | `vitest run tests/zip.test.ts` | 单元 | `zip.test.ts` |
| `verify:all` | `npm run test:typecheck && npm run test && npm run test:governance && npm run test:visual && npm run test:ui-contract && npm run test:smoke && npm run governance:p3` | 冒烟（真实 Next.js） + 单元 + 路由 + 组件（全量 vitest，不含 e2e） + 契约/脚本 + 契约（UI 静态规则） + 治理（Python） + 类型 | &lt;all-vitest&gt;, &lt;governance&gt;, &lt;smoke&gt;, &lt;typecheck&gt;, &lt;ui-contract&gt;, `visual.test.ts` |

---

## 三、模块 → 目录（半自动）

`模块任务开发说明书.md`「模块任务总览」表按「模块」列（`MOD-[A-Z-]+`，逗号/斜杠均可分隔）分组，取该模块名下每条 TASK 的「任务」描述文本里形如 `src/…`、`scripts/…`、`tools/…`、`tests/…` 的路径片段，过滤掉仓库里已不存在的路径（改名/删除后的陈旧引用）——这一列是**脚本候选**，是自动抽取的，不等于最终归属。「人工映射表」是本脚本里维护的 `MODULE_PATH_OVERRIDES`，处理脚本抽不出来的情况（改名后旧路径已不在正文任何一处、或正文写的是工具套件名而非真实路径）。两列分开列，哪些是自动抽的、哪些是人工订正的一眼可辨；人工映射表里的路径同样过 `existsSync`，一旦目标又不存在会标 ⚠STALE。

| 模块 | 脚本候选（自动抽取，已过滤不存在路径） | 人工映射表（MODULE_PATH_OVERRIDES） | 关联 TASK |
|---|---|---|---|
| MOD-ADAPTER | （无） | （无） | TASK-004, TASK-013, TASK-024, TASK-061, TASK-062, TASK-063, TASK-088 |
| MOD-AGENT | `src/lib/html-text.ts` | （无） | TASK-420 |
| MOD-API | （无） | （无） | TASK-400 |
| MOD-AUTH | `scripts/check-config.mjs` | （无） | TASK-001, TASK-019, TASK-020, TASK-029, TASK-110 |
| MOD-CHAT | `scripts/serve-local.mjs`<br>`scripts/ui-contract.mjs`<br>`src/app/api/settings/documents/route.ts`<br>`src/components/DisplayScreen.tsx`<br>`src/components/DocumentSettings.tsx`<br>`src/components/FloatingChat.tsx`<br>`src/components/SkillList.tsx`<br>`src/lib/agent-loop.ts`<br>`src/lib/chat.ts`<br>`src/lib/documents.ts`<br>`src/lib/send-failure.ts`<br>`src/lib/skills.ts`<br>`src/lib/supervisor-policy.ts`<br>`src/lib/tools/budget.ts`<br>`src/lib/tools/document-tools.ts`<br>`src/lib/tools/registry.ts`<br>`src/lib/tools/web-tools.ts`<br>`src/lib/ui-events.ts`<br>`tests/e2e/knowledge-base.spec.ts` | （无） | TASK-005, TASK-010, TASK-022, TASK-025, TASK-034, TASK-035, TASK-039, TASK-043, TASK-071, TASK-072, TASK-078, TASK-079, TASK-081, TASK-086, TASK-133, TASK-134, TASK-160, TASK-170, TASK-180, TASK-190, TASK-250, TASK-360 |
| MOD-CHAT-UI | `scripts/serve-local.mjs`<br>`scripts/ui-contract.mjs`<br>`src/components/DisplayScreen.tsx`<br>`src/components/FloatingChat.tsx`<br>`src/components/SkillList.tsx`<br>`src/components/ToolPanel.tsx`<br>`src/components/ui`<br>`src/lib/chat.ts`<br>`src/lib/display.ts`<br>`src/lib/markdown.tsx`<br>`src/lib/send-failure.ts`<br>`src/lib/skills.ts`<br>`src/lib/store.ts`<br>`src/lib/supervisor-policy.ts`<br>`src/lib/tools/budget.ts`<br>`src/lib/tools/display-tools.ts`<br>`src/lib/tools/skill-tools.ts`<br>`src/lib/types.ts`<br>`src/lib/ui-events.ts`<br>`tests/setup.ts` | `src/app/page.tsx`<br>`src/app/layout.tsx`<br>`src/lib/ui-events.ts` | TASK-007, TASK-008, TASK-009, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-023, TASK-024, TASK-025, TASK-026, TASK-027, TASK-028, TASK-030, TASK-033, TASK-034, TASK-038, TASK-041, TASK-043, TASK-047, TASK-048, TASK-075, TASK-076, TASK-080, TASK-085, TASK-092, TASK-102, TASK-135, TASK-161, TASK-180, TASK-200, TASK-210, TASK-330, TASK-440, TASK-441, TASK-447, TASK-451 |
| MOD-DB | `scripts/check-config.mjs`<br>`src/lib/display.ts`<br>`src/lib/store.ts` | （无） | TASK-002, TASK-013, TASK-019, TASK-021, TASK-033, TASK-036, TASK-059, TASK-060, TASK-079 |
| MOD-DISPLAY | `scripts/ui-contract.mjs`<br>`src/app/api/display/route.ts`<br>`src/components/DisplayScreen.tsx`<br>`src/components/FloatingChat.tsx`<br>`src/components/ToolPanel.tsx`<br>`src/components/ui`<br>`src/lib/agent-loop.ts`<br>`src/lib/display-document.ts`<br>`src/lib/insight-export.ts`<br>`src/lib/tools/budget.ts`<br>`src/lib/tools/display-tools.ts`<br>`src/lib/tools/registry.ts`<br>`src/lib/tools/web-tools.ts`<br>`src/lib/types.ts`<br>`src/lib/ui-events.ts` | （无） | TASK-037, TASK-045, TASK-048, TASK-068, TASK-090, TASK-135, TASK-140, TASK-160, TASK-161, TASK-320, TASK-330, TASK-410, TASK-445, TASK-446, TASK-449, TASK-453 |
| MOD-DOCS | `src/app/api/settings/documents/route.ts`<br>`src/components/DocumentSettings.tsx`<br>`src/lib/chat.ts`<br>`src/lib/documents.ts`<br>`src/lib/tools/document-tools.ts` | （无） | TASK-170, TASK-445, TASK-453 |
| MOD-ENTITY | `src/lib/entities.ts`<br>`src/lib/entity-proposals.ts`<br>`src/lib/extract.ts`<br>`src/lib/sources.ts`<br>`src/lib/sweep.ts` | （无） | TASK-120, TASK-121, TASK-123, TASK-125, TASK-127, TASK-129, TASK-132, TASK-443 |
| MOD-GOVERNANCE | `scripts/check-config.mjs`<br>`scripts/check-dev-server.mjs`<br>`scripts/check-module-graph.mjs`<br>`scripts/gen-index.mjs`<br>`src/lib/sweep.ts`<br>`tests/module-graph.test.ts`<br>`tests/sweep.test.ts`<br>`tools/migrate_r1_signoff.py`<br>`tools/migrate_specs.py` | （无） | TASK-049, TASK-050, TASK-051, TASK-052, TASK-053, TASK-054, TASK-055, TASK-056, TASK-057, TASK-058, TASK-110, TASK-280, TASK-290, TASK-300, TASK-310, TASK-340, TASK-350, TASK-380, TASK-430, TASK-431, TASK-432, TASK-433, TASK-434 |
| MOD-KNOWLEDGE | `scripts/migrate-legacy-knowledge-notes.mjs`<br>`src/lib/entity-proposals.ts`<br>`src/lib/extract.ts`<br>`src/lib/ingest.ts`<br>`src/lib/knowledge.ts`<br>`src/lib/library.ts`<br>`src/lib/sources.ts`<br>`src/lib/tools/knowledge-tools.ts`<br>`src/lib/tools/registry.ts` | （无） | TASK-082, TASK-084, TASK-123, TASK-126, TASK-127, TASK-230, TASK-240, TASK-260, TASK-390, TASK-448, TASK-449, TASK-450 |
| MOD-OPS | `scripts/serve-local.mjs`<br>`src/components/FloatingChat.tsx`<br>`src/lib/chat.ts`<br>`src/lib/send-failure.ts`<br>`src/lib/supervisor-policy.ts`<br>`src/lib/tools/budget.ts` | （无） | TASK-180 |
| MOD-PDF | `src/lib/pdf-text.ts` | （无） | TASK-093 |
| MOD-PROVIDER | （无） | （无） | TASK-003, TASK-011, TASK-021, TASK-022 |
| MOD-PROVIDERS | （无） | （无） | TASK-370 |
| MOD-SETTINGS-UI | `src/app/api/settings/documents/route.ts`<br>`src/components/CornerMenu.tsx`<br>`src/components/DocumentSettings.tsx`<br>`src/components/SkillList.tsx`<br>`src/components/ui`<br>`src/lib/chat.ts`<br>`src/lib/display.ts`<br>`src/lib/documents.ts`<br>`src/lib/insight-export.ts`<br>`src/lib/sweep.ts`<br>`src/lib/tools/document-tools.ts`<br>`src/lib/ui-events.ts` | （无） | TASK-006, TASK-012, TASK-016, TASK-021, TASK-027, TASK-031, TASK-038, TASK-043, TASK-045, TASK-046, TASK-048, TASK-074, TASK-085, TASK-091, TASK-096, TASK-102, TASK-124, TASK-129, TASK-130, TASK-132, TASK-134, TASK-170, TASK-320, TASK-442, TASK-443, TASK-444, TASK-452 |
| MOD-SKILLS | `src/components/FloatingChat.tsx`<br>`src/lib/skills.ts`<br>`src/lib/tools/skill-tools.ts` | （无） | TASK-033, TASK-035, TASK-039, TASK-042, TASK-067, TASK-073, TASK-131, TASK-210 |
| MOD-STORE | `src/components/FloatingChat.tsx`<br>`src/lib/store.ts`<br>`src/lib/tools/display-tools.ts`<br>`src/lib/tools/skill-tools.ts` | （无） | TASK-200, TASK-360 |
| MOD-TOOLS | `scripts/ui-contract.mjs`<br>`src/components/DisplayScreen.tsx`<br>`src/components/FloatingChat.tsx`<br>`src/lib/agent-loop.ts`<br>`src/lib/chat.ts`<br>`src/lib/display-document.ts`<br>`src/lib/entity-proposals.ts`<br>`src/lib/extract.ts`<br>`src/lib/insight-export.ts`<br>`src/lib/knowledge.ts`<br>`src/lib/skills.ts`<br>`src/lib/store.ts`<br>`src/lib/tools/browser-fetch.ts`<br>`src/lib/tools/budget.ts`<br>`src/lib/tools/display-tools.ts`<br>`src/lib/tools/knowledge-tools.ts`<br>`src/lib/tools/registry.ts`<br>`src/lib/tools/skill-tools.ts`<br>`src/lib/tools/url-guard.ts`<br>`src/lib/tools/web-tools.ts`<br>`src/lib/types.ts`<br>`src/lib/ui-events.ts` | `src/lib/tools/display-tools.ts`<br>`src/lib/tools/skill-tools.ts`<br>`src/lib/tools/web-tools.ts` | TASK-064, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-077, TASK-083, TASK-089, TASK-094, TASK-095, TASK-096, TASK-097, TASK-122, TASK-132, TASK-133, TASK-134, TASK-140, TASK-160, TASK-161, TASK-190, TASK-200, TASK-210, TASK-230, TASK-240, TASK-250, TASK-260, TASK-320, TASK-445, TASK-447, TASK-453 |
| MOD-UI-FOUNDATION | `src/components/ui`<br>`src/lib/utils.ts` | （无） | TASK-044, TASK-048 |
| MOD-WAKE | `src/lib/wake.ts`<br>`tests/e2e/proactive-wake.spec.ts` | （无） | TASK-100, TASK-101, TASK-103 |
| MOD-ZIP | `src/lib/zip.ts` | （无） | TASK-040, TASK-042 |

### 3.1 「模块」列不是 `MOD-*` 记法的 TASK（未计入上表）

| TASK | 模块列原文 |
|---|---|
| TASK-032 | 治理工具 |
| TASK-128 | 无代码模块（仓库内容） |
