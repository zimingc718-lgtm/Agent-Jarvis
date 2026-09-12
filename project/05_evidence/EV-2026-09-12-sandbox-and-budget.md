# EV-2026-09-12-sandbox-and-budget

- 来源: 助手对全项目的一次系统审视（2026-09-12），用户在阅读审视报告后指示「你说的建议和发现的问题，都可以继续处理」
- 时间: 2026-09-12
- 采集者: 助手（claude-opus-5），本机执行
- 支撑对象: `CR-20260912-sandbox-and-budget`（REQ-F-101、DEC-080、TASK-160、TEST-161、TEST-162）
- 可定位路径: 本文件；`src/components/DisplayScreen.tsx`、`src/lib/agent-loop.ts`、`src/lib/tools/budget.ts`、`src/lib/tools/web-tools.ts`、`scripts/ui-contract.mjs`

本文件记录三件事的实测依据。三件事都不是新发现的风险——前两件项目档案里早有记载，这次补的是**证明现在修的代价很小**，以及**证明当初的前提已经变了**。

## 1. 无沙箱 iframe：攻击链是旧的，前提变了两次

### 1.1 档案里已有的记载

`project/05_evidence/test-results.json` 的 `known_warnings` 里有两条并列记录：

| id | 内容 |
|---|---|
| `skill-html-unsandboxed` | DEC-015：技能生成的 HTML 在 `<iframe srcdoc>` 中渲染，**不带 sandbox**。同源脚本可读 `localStorage`、可调同源接口（如 `DELETE /api/providers/[id]`）。用户 2026-09-09 接受该风险，缓解手段只有不可关闭的提示条（REQ-F-025 ②）。**沙箱化为强制出口义务。** |
| `skill-html-unsandboxed-web-source` | CR-20260910-agent-tooling CP-20（单向门）：`read_url` 让攻击者可控的网页正文进入模型上下文，正文里的提示注入可让模型调 `save_insight`，攻击者的 HTML 于是落进同一个无沙箱同源 iframe。DEC-015 当初的前提是「用户自己拖进来的技能文件夹」——用户选择并信任的来源；本 CR 把来源扩大到**任何可搜到的网页**，前提不再成立。用户在被展示该链条与三个选项（A 联网与 save_insight 互斥 / B 先做沙箱 / C 接受）后选了 C。注入路径本身的发现方式为「发现不了」。 |

完整链条（照抄档案）：用户提问 → `web_search` → `read_url` 攻击者页面 → 页面正文里的提示注入 → 模型调 `save_insight` → 攻击者 HTML 在同源 iframe 中执行。

### 1.2 前提此后又变了一次

`CR-20260911-web-reading`（2026-09-11 合并）新增了两条入口：

- `read_url` 增加 PDF 正文提取（上限 24 MiB），可读范围从 HTML 扩到 PDF；
- 新增浏览器通道 `browser-fetch.ts`，原本 403 拒绝的站点（实测 tsmc.com：403 → 8,579 字）现在也能读到。

也就是说，`skill-html-unsandboxed-web-source` 记录的「可达源」在那次变更后**再次扩大**，但这条风险没有随之重新过一遍。本 CR 是补这一步。

### 1.3 现在修的代价：实测为零

对本机库 `.data/agent-jarvis.sqlite` 的 `insights` 表全量统计（2026-09-12）：

| 指标 | 值 |
|---|---|
| 洞察总数 | 25 |
| 正文含 `<script>` 的 | **0** |
| 单份最大 | 34 KB |
| 合计 | 235 KB |

结论：现存洞察没有一份依赖脚本，所以**加 sandbox 当下不损失任何已有功能**。

### 1.4 为什么选 `allow-scripts` 而不是空 sandbox

- 空 `sandbox=""` 当下零损失，但会挡掉将来模型生成图表脚本的可能。
- `sandbox="allow-scripts"`（**不加** `allow-same-origin`）让文档落在**不透明源**：脚本照跑，但读不到宿主的 `localStorage`，向应用接口发的请求属跨源且不带凭据，拿不到用户会话。链条的最后一环就此断掉。
- `allow-scripts` 与 `allow-same-origin` **同时出现等于没有沙箱**，这是这类改动最常见的回退方式。所以 UI 契约里对这一组合单独写了一条拒绝规则，不留给人工审查。

### 1.5 发现方式由「发现不了」变为机器可查

`scripts/ui-contract.mjs` 的 LB-09 原本写的是**反向**断言：

> the insight `<iframe>` has a sandbox attribute — DEC-015 records this as a deliberate non-goal; add it via a future CR, not silently

这条规则当初就要求「要加沙箱必须走 CR，不许悄悄加」。本 CR 就是那条 CR，规则随之反转为：必须有 sandbox，且不得含 `allow-same-origin`。

## 2. 工具循环内的上下文没有预算

### 2.1 代码位置

| 位置 | 事实 |
|---|---|
| `src/lib/chat.ts` | `assembleContext` 在进入循环**前**调用一次 |
| `src/lib/agent-loop.ts` | `const conversation = [...input.messages]`，随后 `while (true)` 里持续 `push` assistant 与 tool 行，**全程没有任何预算、窗口或 token 估算** |
| `src/lib/agent-loop.ts` 的类型注释 | 原文写着「already assembled and budgeted by `budget.ts`」——即默认入参已算好，之后不再管 |
| `src/lib/tools/web-tools.ts` | 单条网页结果上限为常量 12,000 token（见 §3） |

### 2.2 量级

以 128k 窗口、`BUDGET_SHARES.totalInput = 0.6` 计，输入预算为 **76,800 token**。

| 本轮 `read_url` 次数 | 仅工具结果的累计上限 | 是否超输入预算 |
|---|---|---|
| 3 | 36,000 | 否 |
| 6 | 72,000 | 接近 |
| **10** | **120,000** | **是** |
| 100（步数上限） | 1,200,000 | 远超 |

`MAX_TOOL_STEPS` 于 2026-09-11 由 10 提升至 100（`CR-20260911-display-console-ux` CP-1，用户直接授权）。**提升前这个风险被 10 步天然压住**：10 × 12,000 = 120,000 已经踩线，但实际很少有一轮连读 10 页。提到 100 之后，上界消失。

失败形态：循环中途 Provider 返回 400（上下文超限），不是可操作的提示。

### 2.3 为什么这里的收窄是「有压力才做」，与跨轮相反

`CR-20260912-latency-and-report-layout` 刚把**跨轮**保留窗口改成无条件生效，依据是 REQ-F-041 ① 的原文没有预算前提。本 CR 的**轮内**收窄刻意相反：

- REQ-F-041 ① 管的是「轮」，不是「步」，两者不冲突；
- 一次发送内的工具结果**全部属于当前这一个任务**。默认丢弃会破坏「读五页再汇总」这种循环存在的意义本身；
- 所以只在超预算时才逐级收窄（保留最近 3 → 2 → 1 条原文），仍放不下才停。

停的时候复用 REQ-F-029 ② 已定义的「触顶」语义：已完成结果与已生成文本保留，落库 `status=truncated`，不结束会话。并按 REQ-F-023「不静默」发一条 `notice` 说明原因与数值。

## 3. 单条结果上限是个伪装成公式的常量

### 3.1 原文

```
const searchResultCap = (): number => Math.floor(8_000 * BUDGET_SHARES.singleToolResult * 10);
```

`BUDGET_SHARES.singleToolResult` 是 0.15，语义为「占上下文窗口的 15%」。这里用 8,000 冒充窗口，再乘 10 把份额抵消掉，结果恒等于 **12,000**，与当前模型的真实窗口无关。

### 3.2 两个方向都错

| 模型窗口 | 申报份额（15%） | 实际上限 | 后果 |
|---|---|---|---|
| 8,192（本地小模型默认） | 1,228 | 12,000 | 单页结果就超过整个输入预算（4,915），一页撑爆 |
| 128,000 | 19,200 | 12,000 | 只用掉三分之二不到，白白浪费 |

### 3.3 处置

`ToolContext` 增加 `contextWindow`，`searchResultCap(window)` 改为 `budgetTokens(window, BUDGET_SHARES.singleToolResult)`。这也是 §2 修复的必要前提——轮内预算要有意义，单条上限必须先跟真实窗口挂钩。

## 4. 本次验证

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm test` | 69 文件 / 580 用例 PASS |
| `node scripts/ui-contract.mjs` | 53 passed · 0 failed · 0 warnings |

两条既有断言被本 CR **有意反转**，如实记在这里：

1. `tests/display-screen.test.tsx` TEST-093 ⑤ 原文断言 `frame.hasAttribute("sandbox")` 为 `false`（「iframe 仍无 sandbox（DEC-015 不变）」）。现改为断言有 sandbox、含 `allow-scripts`、不含 `allow-same-origin`。
2. `scripts/ui-contract.mjs` LB-09 原本在发现 sandbox 属性时 FAIL。现改为缺少 sandbox 或含 `allow-same-origin` 时 FAIL。

两条都不是「改测试迁就实现」：它们原本锁定的就是一个被明确登记为**待偿还**的状态，且原文各自写明了偿还方式是走 CR。

## 5. 未覆盖的部分（如实登记）

- **沙箱之外的注入面不变**：提示注入仍可让模型在对话里复述攻击者的话、或据其内容作答。本 CR 只切断「攻击者 HTML 取得本应用同源权限」这一环，不解决模型被网页正文误导。这一条的发现方式仍是**发现不了**。
- **轮内收窄的观感**：「某次汇总恰好需要已被省略的那一条结果」只有真实使用会遇到。机器只能守住「省略后仍是合法的 assistant/tool 配对」「未超预算时不收窄」「放不下时停在 truncated 且不静默」。
- **`allow-scripts` 的剩余面**：不透明源里的脚本仍可发起出网请求（如把 iframe 内看到的内容回传）。洞察正文本就来自模型与网页，不含用户凭据，故按双向门处理；若将来洞察会承载用户私有数据，应再评估收紧为空 sandbox。
