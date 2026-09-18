# EV-2026-09-18-unified-floating-console

- 来源: 用户 2026-09-18，INPUT-2026-09-18-001 第 5、6a 条（原文见该文件；第 5 条「当前除了首页时对话框时悬浮的，其他页面如知识看板页面下，对话还是半遮挡的。改为全悬浮」，第 6a 条「对话框的状态灯，上传可以跟 模型，技能，工具等放在同一行」）
- 时间: 2026-09-18
- 采集者: 助手（claude-sonnet-5），在隔离工作树 `.claude/worktrees/agent-a03ec99fca83fda6c`（分支 `cr/20260918-unified-floating-console`）执行；未接触共享 3000 端口服务
- 支撑对象: `CR-20260918-unified-floating-console` CP-1、CP-2
- 可定位路径: 本文件；`src/components/DisplayScreen.tsx`、`src/components/FloatingChat.tsx`、`tests/display-screen.test.tsx`、`tests/floating-chat.test.tsx`、`tests/settings-on-display.test.tsx`、`scripts/probe-unified-floating-console.mjs`（已就绪、未执行，见「4. 局限」）

## 1. 投入实现前的调查：DEC-240 的让位机制现在还有没有必要保留

第 5 条要求非首页视图不再靠 `--jarvis-console-h` 让位，直接改法就是把四个非首页容器的
`fixed inset-x-0 top-0 z-0` + `style={{ bottom: "var(--jarvis-console-h, 0px)" }}` 换成与首页
相同的 `fixed inset-0 z-0`，不读该变量。投入实现前核对了这个让位机制最初为什么存在，
避免改掉一个还在生效的安全网：

1. **`DEC-240`（CR-20260914-settings-on-display）**：让位机制的起点。当时的证据是「控制台
   浮在展示屏上，用户手动展开对话时报告被盖约 78%」——控制台早已是 `z-20`、展示屏是
   `z-0`，记录区一展开，`--jarvis-console-h` 发布的是控制台**整体**实测高度（含记录区，
   最高 50–58vh），于是四个非首页容器在**通栏宽度**上让出这么大一块。
2. **`DEC-340`（CR-20260915-console-menu-consolidation）**：用户反馈「不是重排，是没有
   对话框的部分内容也被遮挡了」后，把发布值从「根节点整体高度」收窄成
   `collapsedConsoleHeight(rootHeight, transcriptHeight)`——只发布**收拢态**（状态行 + 面板/
   用量行 + 输入框，不含记录区）的高度。记录区展开时改靠控制台自身更高的层级
   （`z-20` > `z-0`）盖在展示屏内容之上，**只盖它自己那条 768px 宽的 footprint**，不再影响
   通栏。DEC-340 原文明确写着这一步「展示屏三个容器的让位机制不改，只是它们据以让位的
   变量此后取值更小更稳定」——即 DEC-340 当时**有意保留**了让位这件事本身，只收窄了
   让位量。
3. **源码复核**：`collapsedConsoleHeight` 的公式是 `max(0, ceil(rootHeight) - ceil(transcriptHeight))`。
   由于 `rootHeight` 本身就包含记录区的高度，记录区每增长一点，`rootHeight` 也跟着长
   同样多，两者相减后**发布值恒等于收拢态链路的高度，与记录区是否展开、展开多少无关**。

**结论**：DEC-240 要防的「记录区展开吃掉 78% 报告」这个问题，root cause 是「发布值随记录区
变化」，这一点已经被 DEC-340 的公式**独立、彻底地**解决了，且这个解法与「是否还有让位」
无关——即便让位量此刻降到 0（本 CR 的做法），发布值的公式本身没有变化，记录区展开时
的覆盖范围依旧只是控制台自己的 768px 宽 footprint，不会恢复成通栏覆盖。DEC-340 之后，
非首页视图的「让位」实际只剩下：控制台**收拢**时，让出一条与控制台收拢态footprint 完全
重合的小空白——控制台本来就画在那里，这条让位既不省视觉空间也不挡任何东西，是
DEC-340 解决问题之后留下的、不再有实质作用的残余机制。移除它，非首页视图在收拢态与
展开态下的覆盖行为，和首页今天的实际表现（首页从一开始就是零让位的 `fixed inset-0`，
跑到今天没有相关缺陷反馈）完全一致，DEC-240 原本要防的问题不会复发。

工作假设（移除让位是否会撞回 DEC-240 修的那个问题）在这一步被**确认为否**——移除是安全
的，理由已如上。若结论是"会复发"，本应如实记录在此并否决这条改法，而不是改了再说。

## 2. 机器证据

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| ⑧ 非首页视图全悬浮 | `tests/display-screen.test.tsx` | 1（覆盖 home/insight/document/settings 四种 `DisplayView`） | 每种视图容器 `className` 含 `inset-0`、不含 `inset-x-0`，且 `style` 属性为 `null`（不再读 `--jarvis-console-h`） |
| ③c 控制台入口合一行 | `tests/floating-chat.test.tsx` | 1 | `.floating-chat__status` 容器内同时含 `role="status"`、「上传」按钮、「在屏上打开：」文案、「模型/技能/工具/资料库」四个可点击按钮 |
| ⑤（改写）设置面板全悬浮 | `tests/settings-on-display.test.tsx` | 1（改写自旧版对 `bottom: var(--jarvis-console-h, 0px)` 的断言，该断言与本 CR 直接矛盾） | 设置面板容器 `className` 含 `inset-0`、`style` 属性为 `null` |

`npx vitest run`（全量）：**90 个测试文件、834 个用例全绿**（2026-09-18，本机，四个并行
fork 同时跑测试造成的资源争用曾让 `④ a registration receipt that excludes files says so`
在两次独立全量跑里各偶发一次超时/worker RPC 错误，`npx vitest run tests/floating-chat.test.tsx
-t "excludes files"` 单独跑均 758ms 内通过——判定为环境资源争用，非本 CR 引入的缺陷，
不在本 CR 改动的代码路径上）。`npx tsc --noEmit -p .`：0 错误。`node scripts/ui-contract.mjs`：
**53 项全过，0 失败**。`node scripts/check-module-graph.mjs`：112 文件扫描，0 环、0 分层违规、
0 客户端/服务端违规。`python -m unittest tests.test_governance`：**140 个用例全绿**。

## 3. 真实入口（未执行——如实登记）

`scripts/probe-unified-floating-console.mjs` 已写好待用：驱动真实 Chromium，核对①
`.floating-chat__status` 一行内同时含状态灯、上传、模型/技能/工具/资料库四个入口；②
打开「资料库」面板后，收拢态与展开一次对话后的展开态下，`.display-screen--settings`
容器的 `getBoundingClientRect().bottom` 都贴到视口高度（不留让位空白）。

**本次未执行**：本 fork 按上级会话划定的边界，不接触共享 3000 端口服务（`npm run
build:local` / `npm run serve:local`），也不运行需要它的探针脚本——4 个并行 fork 同时抢
同一个生产构建 + 服务会互相冲突。真实入口验证的执行责任交给编排本批次的上级会话，在
整合四条并行 CR 之后统一跑一次。**这一步在补上之前，本 CR 不构成 CLOSED 状态所需的完整
证据**——组件测试与静态检查只能证明"代码按预期的 DOM/CSS 断言工作"，不能替代
CLAUDE.md 要求的真实入口验收。

## 4. 局限（如实登记）

- 四个非首页视图里，「看板」（`display-screen--board`）一项没有直接的组件测试覆盖——
  按 `tests/stage-reach.test.tsx` 的既有模式，驱动到 `stage === "board"` 需要真实 SQLite +
  `DISPLAY_STAGE_EVENT` 阶段机，工作量与本 CR 的改动本身不成比例。已用代码巡检确认它与
  其余三个视图使用完全相同的编辑模式（`fixed inset-x-0 top-0 z-0` + 显式 `style` → `fixed
  inset-0 z-0`、删除 `style`），但这是人工发现项，不是机器覆盖，如实登记，不用宽松断言
  伪装成已覆盖。
- 本次全量 `vitest run` 之外，还有一次不含本文件最终改动版本的中间跑（先跑出一次同类
  资源争用超时，再单独重跑确认环境问题）；本节引用的「90 个测试文件、834 个用例全绿」
  一行取自最后一次干净的全量跑（无并发争用命中）。
