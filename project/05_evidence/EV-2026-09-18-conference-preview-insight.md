# EV-2026-09-18-conference-preview-insight

- 来源: 用户 INPUT-2026-09-18-001 第 9b 条（"做个学术会议参会前瞻的洞察...参考业界最佳实践"）
- 时间: 2026-09-18
- 采集者: 助手（claude-sonnet-5，fork 子代理），在本仓库隔离 worktree 上执行代码核对
- 支撑对象: `CR-20260918-conference-preview-insight`（无 CP，本证据支撑的是"投入实现前的调查确认既有机制已完整覆盖"这一结论本身）
- 可定位路径: 本文件；`src/lib/tools/display-tools.ts`（`save_insight`/`show_insight`）、`src/lib/display-document.ts`、`tests/tool-suites.test.ts`、`tests/tool-suites-append.test.ts`、`tests/skill-report-bridge.test.ts`、`scripts/probe-conference-preview-insight.mjs`

## 1. 代码核对：既有机制的通用性

`save_insight` 工具描述原文："把 HTML 报告保存为洞察并显示在展示屏上。长报告分块：首块不带 insightId 新建，后续块带 insightId 追加。发现结构写错要整篇重写时，带 insightId 并置 mode=replace。"——参数只有 `html`/`insightId`/`mode`，没有任何主题、类型或来源限制。`show_insight` 同样只接受 `insightId`，把展示屏切到该洞察，不关心洞察内容是什么主题。

`display-document.ts` 提供的展示层样式（`.jarvis-insight h1/h2/h3/p/ul/ol` 等选择器）是标准 HTML 元素排版，未对任何特定报告类型做特殊处理。

结论：这条链路——模型生成 HTML → `save_insight` 保存 → `show_insight`/直接返回的 `insightId` 触发展示屏切换——对"学术会议参会前瞻"这个主题不需要任何专门适配。

## 2. 既有测试：已用通用内容覆盖全部代码路径

| 用例文件 | 覆盖内容 |
|---|---|
| `tests/tool-suites.test.ts` | `show_insight` 属主校验（跨会话 id 被拒）；`save_insight` 参数缺失/截断校验；③"已接受的风险如实记录：save_insight 不对 HTML 来源做任何过滤" |
| `tests/tool-suites-append.test.ts` | `save_insight` 追加模式（`mode: append`/`replace`）的完整行为 |
| `tests/skill-report-bridge.test.ts` | 技能轮报告通过 `save_insight` 落地展示屏的完整链路 |

这些用例用的是任意/占位 HTML 内容（如 `<p>x</p>`），断言的是**机制行为**（属主校验、追加/重写、截断处理）而不是**内容主题**。会议前瞻类内容会走完全相同的代码路径，不产生新分支，因此不需要为它单独再写一份内容不同、断言相同的测试。

## 3. 真实入口（收口会话已执行，结果 PASS）

- 来源: `scripts/probe-conference-preview-insight.mjs`
- 时间: 2026-09-18
- 采集者: 助手（claude-sonnet-5，收口会话），针对用户本机 `npm run build:local && npm run serve:local`（端口 3000）的真实生产构建服务
- 命令: `node scripts/probe-conference-preview-insight.mjs`（`JARVIS_BASE_URL` 默认 `http://localhost:3000`）
- 输出:
  ```
  流式在超时前结束=true
  展示屏出现 insight=true
  内容含日程相关字样=true，panel 相关字样=true，专家相关字样=true
  PASS 既有 save_insight/show_insight 机制足以支撑「学术会议参会前瞻」这类洞察，无需新增代码
  ```
- 判定: **PASS**（三项内容信号 3/3 命中，超过 ≥2/3 的通过线）

探针曾在调试过程中两次假阴性，均已定位并修正，不是产品/模型缺陷：①第一版固定 `waitForTimeout(60_000)` 早于真实生成完成（一次真实全流程约 130 秒），改为轮询"停止"按钮消失的 `waitForIdle`；②`page.locator(".jarvis-insight")` 只查主 frame，看不进洞察实际渲染所在的跨域 `<iframe sandbox="allow-scripts" title="技能洞察报告" srcDoc={...}>`（`DisplayScreen.tsx`，DEC-015 的刻意隔离设计），改为 `page.frameLocator('iframe[title="技能洞察报告"]')`。调试期间一次独立的手工轮询确认过模型确实生成了结构完整的报告（洞察 id `b2a2ae54-dd58-4e5d-9812-cbfe628122af`：执行摘要、关键发现、日程总览、专题辩论、专家图谱、风险披露、来源分级附录等十个章节），与本次最终探针的判定互相印证。

**结论**：机制本身的通用性由代码核对与既有测试确认（见 §1、§2）；模型在被要求"学术会议参会前瞻"时会自主调用既有 `save_insight`/`show_insight` 机制、产出结构合格的内容，由本次真实入口确认。本 CR 无需任何新代码，如实关闭。

## 4. 局限（如实登记）

- 若真实入口探针显示模型产出的内容结构不理想（比如漏掉某个维度、格式混乱），本 CR 的结论需要重新评估——那种情况下可能确实需要方案选项 B（在 `save_insight` 描述或系统提示词里加专属指引）或用户自己上传一个专门的技能。本 CR 目前只确认了"机制不缺"，没有确认"不指导模型也能稳定产出好内容"。
- 本 fork 工作在隔离 worktree 中，未能访问用户真实的对话历史或已注册技能列表，无法核实用户是否已经在其它场景下试过类似的洞察生成、效果如何。
