# EV-2026-09-10-agent-tooling-requirements

- 来源：用户对话（INPUT-2026-09-10-008）+ 联网调研 + 仓库代码事实
- 时间：2026-09-10
- 采集者：Claude（产品 owner 视角整理，R1 前）
- 支撑对象：`CR-20260910-agent-tooling` 的 R1 需求变化点
- 可定位路径：本文件；`project/00_input/需求输入.md` INPUT-2026-09-10-008；下列 URL

## 1. 仓库代码事实（决定「现状」的证据）

| 事实 | 位置 | 对需求的影响 |
|---|---|---|
| 对话是**单轮管线**：拼 system + history + user → 调一次 Provider → SSE 流回 → 落库；无工具循环 | `src/lib/chat.ts` `runChatTurn` | REQ-F-029 是从零新增，不是扩展 |
| `ChatDelta` 只有 `start/delta/stopped/error/done` + `insight/insight-missing/display/skill` 尾事件；**无 `tool_call` / `tool_result`** | `src/lib/types.ts` | 步骤流（REQ-F-035）需要新事件类型 |
| 技能是**文本注入**：命中技能的那一轮把 `SKILL.md` + 白名单文件拼进 system，上限 32KB；每轮先跑一次独立路由 LLM 调用 `TurnRoute {skill, display}` | `src/lib/skills.ts` | REQ-F-021/022/027 三条挂在同一次路由调用上；删路由必须同时处理 `display` |
| `messages` 表 `role TEXT`（TS 类型 `"user" \| "assistant"`）、`content`、`status`；**无工具调用存储位** | `src/lib/store.ts` L588-596 | REQ-F-013 重写 + 数据模型变更 |
| 历史回放：`listMessages` 过滤 `status ∈ {complete, stopped}` 后**全量**回放 | `src/lib/chat.ts` `REPLAYABLE_STATUSES` | 触顶新状态 `truncated` 需进可重放集合；REQ-F-041 保留窗口 |
| 技能 HTML 捕获以「技能轮」为触发条件（REQ-F-023 ⑤） | `src/app/api/chat/stream/route.ts` `onFinal` | 工具化后「技能轮」概念消失 → 捕获改为 `save_insight` 工具 |
| 面板高度上限 50%（两次刻意收敛：65% → 50%） | `产品需求说明书.md` REQ-F-003 + CR-20260909-minimal-floating-chat 澄清 | 步骤流与之冲突 → 用户决定分情形放宽 |
| 状态灯「四态」被 CR-20260909-collapsible-panel 明文守住（「不新增可辨识状态」） | `产品需求说明书.md` REQ-F-018 | 用户决定显式破坏 → REQ-F-036 + F-018/F-014 重写 |
| 架构说明书：「新增任何运行依赖属 L3，须先经 CR」 | `架构设计说明书.md` 依赖清单 | 搜索后端选型排除需 npm 依赖的方案 |
| Docker 29.3.1 已安装，Docker Desktop 未运行 | 本机 `docker --version` / `docker info` | SearXNG 环境依赖可行，属 P3 前置 |

## 2. 联网调研（外部参考，2026-09-10 抓取）

### DeepSeek Harness（`@deepseek-ai/dsh`）

- Node.js / TypeScript，MIT，developer preview；建立在 Cordis 插件框架上，「一切皆插件」：model、tools、skills、sessions、sandbox、storage、**loop**、scheduling、UI 全为可换插件。插件形态 = 导出 `apply(ctx)`，`inject` 声明依赖，`ctx.<service>` 取服务。
- 四种预设模式：Standard（文件编辑、shell、文件 + 网页搜索、技能、planning、goals、subagents、workflows）、Code（模型写一段 TS 一次做完多步）、Minimal（bash + 编辑器）、Creator。
- 自带 compaction 能力。**是否可作为库嵌入未确认**（文档只给 CLI / Web 入口）。
- 来源：
  - https://github.com/deepseek-ai/deepseek-harness
  - https://deepseek.com/harness/en/
  - https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/
  - https://thenewstack.io/deepseek-harness-open-source-plugins/

### OpenClaw

- 常驻 gateway 守护进程（`127.0.0.1:18789`，WS 协议），多渠道（WhatsApp / Telegram / Slack / Discord / iMessage / WebChat）。
- **token 结构性开销（官方文档）**：每轮固定注入 ≈ 8000 tokens 核心指令 + 技能名录；bootstrap 文件（`AGENTS.md` / `SOUL.md` / `IDENTITY.md` / `USER.md` / `MEMORY.md`…）单个上限 20000 字符、合计 60000 字符，每轮全量注入；单条工具结果上限 16000/32000/64000 字符（按窗口），硬顶为上下文窗口 30%；5 轮对话 ≈ 单轮 13 倍成本；**时间（UTC + 时区）放在 system prompt 里**，每轮变化打掉前缀缓存，官方以「heartbeat 设为略低于 cache TTL」补救。
- 文档给出的减量手段：技能只注入名录、正文按 `read` 按需加载；「Keep skill descriptions short」；裁剪工具输出；compaction。
- 来源：
  - https://docs.openclaw.ai/concepts/architecture
  - https://docs.openclaw.ai/reference/token-use
  - https://phala.com/posts/understanding-openclaws-token-usage

### 搜索后端（无 API key 方案对比）

| 方案 | 要 key | 新增 npm 依赖 | 备注 |
|---|---|---|---|
| **SearXNG 自托管** | 否 | 零（`GET /search?q=…&format=json`） | 聚合 70+ 引擎；**JSON 输出需在 settings.yml 显式打开**；需 Docker 或等价运行时 |
| DuckDuckGo 抓取 | 否 | 要包或自解析 HTML | 单一来源，易限流、页面变更即坏 |
| DDG Instant Answer API | 否 | 零 | **不返回排名链接列表** |
| Brave / Tavily / Serper | 要 | — | 用户无 key，排除 |

- 来源：
  - https://docs.openclaw.ai/tools/searxng-search
  - https://dev.to/greatsage_sh/skip-the-search-api-bill-self-hosting-searxng-for-private-search-and-free-llmrag-web-results-p23
  - https://docs.openclaw.ai/tools/duckduckgo-search
  - https://freeapihub.com/apis/duckduckgo-instant-answer-api

## 3. 用户决策时间线（拍板项，原文见 INPUT-2026-09-10-008）

| # | 问题 | 决定 |
|---|---|---|
| D1 | 参考对象 | 方案 A：读 DeepSeek Harness 抄结构自行实现，不装包；OpenClaw 只借「主动唤醒」并以其 token 教训为反面教材（读法二） |
| D2 | REQ-F-021 独立路由调用 | 删除 |
| D3 | 「仅当轮注入」硬边界 | 取消，一轮可读多个技能 |
| D4 | 搜索后端 | 开源、无 key → SearXNG |
| D5 | 只读工具审批 | 免审批；新增写/执行类工具时审批机制为出口义务 |
| D6 | 主动唤醒 | 默认关 + 开关（D 期） |
| D7 | token 用量 | 可见，放 ☰ 菜单；usage 拿不到时**本地估算**并标注 |
| D8 | 执行过程可见性 | 对话内步骤流 + 状态灯扩展（不用展示屏） |
| D9 | 工具循环上限 | 10 步；触顶**提醒后停止**，成果保留 |
| D10 | `read_url` | 要；强制先摘要再入上下文 |
| D11 | 状态灯四态 | 显式破坏 → 五态 |
| D12 | 刷新后步骤流 | 重建 |
| D13 | web_search | 提进 A 期 |
| D14 | 面板 50% 上限 | 放宽（产品 owner 建议：有步骤流时 75%，纯对话仍 50%） |
| D15 | 回答来源 | 带引用 |
| D16 | Provider 不支持工具调用 | 提醒（产品 owner 建议：降级纯对话 + 一次性提醒） |

## 4. 审视过程中发现并纳入的缺口（三轮审视）

- 第一轮：REQ-F-023 触发条件消失；REQ-F-013 无工具调用存储位；REQ-F-028 ② 应被步骤流吸收；F-035 状态灯破坏明文约束；NF-007 压缩需兜底；F-036 usage 来源；F-029 工具异常；技能名录超预算；A 期获得感低 → web_search 提前。
- 第二轮：REQ-F-004 核心条款失效；REQ-F-005 循环中途停止；REQ-F-014 连带；REQ-F-003 面板冲突；搜索后端配置入口缺失；触顶后出口缺失；来源引用缺失；Provider 不支持工具调用；搜索后端连不上；NF-007 验收断链；5 条澄清；非目标 line 71 改写。
- 第三轮：`read_url` SSRF（内网地址、重定向）；A 期工具结果累积可能**净增** token → REQ-F-041 保留窗口；NF-010 扩展点须含 loop；非目标须显式排除 dsh Standard 模式其余能力。
