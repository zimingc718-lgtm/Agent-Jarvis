# EV-2026-09-12-stage-reach

- 来源: 用户 2026-09-12 报告两条运行反馈（「当前无法通过对话进入知识看板」「首页没有动画效果，建议回溯下」）；助手在为 `CR-20260912-sandbox-and-budget` 取真实入口证据时，端到端测试暴露同一根因的既有回归
- 时间: 2026-09-12
- 采集者: 助手（claude-opus-5），本机执行
- 支撑对象: `CR-20260912-stage-reach`（REQ-F-102、DEC-081、TASK-161、TEST-163）
- 可定位路径: 本文件；`src/components/DisplayScreen.tsx`、`src/lib/tools/display-tools.ts`、`src/lib/ui-events.ts`、`src/lib/types.ts`、`tests/e2e/`

## 1. 一个根因，三种表现

### 1.1 机制

展示屏有两个互不相干的轴，`CR-20260912-display-stage` 把第二个轴做成了组件内状态：

| 轴 | 取值 | 存放位置 |
|---|---|---|
| 屏幕应该显示什么（持久事实） | `home` / `insight` | `display_state` 表 |
| 开场是否已经过去（会话事实） | `opening` / `board` | 组件 `useState` + `sessionStorage` |

渲染顺序是：洞察 → `stage === "board"` → 标题页。于是 **`stage` 无条件压过持久轴的 `home`**。

`stage` 一旦变成 `board` 就没有任何路径改回去：`enterBoard` 只有单向调用，`rememberOpeningPlayed()` 还把结果写进 `sessionStorage`，同一标签页内此后每次渲染都直接跳到看板。

### 1.2 三种表现

| 表现 | 谁报的 |
|---|---|
| `show_home` 工具执行成功、持久态确实改成了 `home`，但用户看到的还是看板 | 端到端测试 |
| 首页开场动画看不到——首页本身就回不去了 | 用户：「首页没有动画效果」 |
| 没有任何工具能把展示屏切到看板 | 用户：「当前无法通过对话进入知识看板」 |

第三条是同一个状态机的另一半：`board` 既然不是持久态，工具就没有东西可写；而 `show_home` 又因为上面的原因改不动它。两个方向同时卡死。

### 1.3 动画本身没坏

`globals.css` 里 `jarvis-scan`（扫描线）与 `jarvis-breathe`（网格呼吸）两个 keyframes 都在，`prefers-reduced-motion` 下正确隐藏。问题不是动画不存在，而是**开场页的存活时间几乎为零**：

- 标题区上挂着 `onPointerEnter={enterBoard}`。页面加载时指针通常已经在窗口内，鼠标一动就触发；
- `window` 上还监听 `pointerdown` 与 `focusin`；
- 3 秒计时器只在完全无人操作时才生效。

`CR-20260912-display-stage` 的 CP-1 原文是「三秒是上限不是时长……指针到达标题屏、任意点击、焦点落进控制台，任一发生即切」。实现忠实照做了，是**这条决策本身在真实使用中不成立**：指针到达不等于开始工作。

## 2. 端到端测试的证据

### 2.1 修改前：main 上三条红

在**未经任何改动的 `main`** 上运行（助手先把自己的在途改动整体 stash，排除自身影响）：

```
1 failed
  [chromium] › tests\e2e\skills-display.spec.ts:167:1 › skill turn surfaces an insight …
1 passed
```

全量运行时共三条失败，失败点全部是同一句：

```
> 104 |   await expect(page.locator(".display-screen--home h1")).toHaveText("Agent-Jarvis", { timeout: 15_000 });
```

即「回首页之后标题页应该出现」——正是 §1.1 的机制。

**这三条红此前没有被发现**，因为该 CR 合并时跑的是单元测试与门禁，端到端未跑。如实记录。

### 2.2 修改后：16/16 绿

```
16 passed (2.3m)
```

包含此前红掉的三条。

## 3. 方案与既有决策的关系

`CR-20260912-display-stage` 的「方案选项」里，把看板做成第四个 `display_state` 值（方案 A）**被明确否决**，理由是：

> 那会让「看板态」变成跨会话粘住的持久状态，`show_home` / `show_insight` 与它互相打架；而开场本来就是**本次会话**的事。

这条理由仍然成立，本 CR **不推翻它**。看板仍然不进数据库。缺的不是持久化，而是**一条能到达会话态的通路**。

项目里已经有现成的同形机制：`ToolResult.events` side channel（`knowledge_pending` / `entity_pending` 就走这条），工具产出事件 → 循环透传 → 对话框转成 window 事件 → 目标组件接住。本 CR 沿用它，新增 `display_stage` 一种事件。

于是：

- `show_home` 除了清持久态，还发 `display_stage: opening`，并清掉 `sessionStorage` 的「已播过」标记——不清的话下一次渲染立刻弹回看板，等于没修；
- 新增 `show_board`，发 `display_stage: board`，同时把持久态清回 `home`——否则残留的洞察会盖住看板；
- 洞察仍然压过两个阶段（持久态优先级不变，CP-2 的核心判断保留）。

## 4. 开场可见性的处置

移除标题区的 `onPointerEnter`。保留 `pointerdown` 与 `focusin`，保留 3 秒上限。

理由：点击与打字是**明确的**开始工作，鼠标经过不是。移除后，加载页面若不立刻操作，开场至少可见 3 秒；`show_home` 之后可以重放。

**没有**加最短驻留时间。加了会让明确的点击产生「点了没反应」的延迟，代价大于收益。

## 5. 本次验证

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm test` | 68 文件 / 579 用例 PASS |
| `node scripts/ui-contract.mjs` | 53 passed · 0 failed · 0 warnings |
| `npm run test:e2e` | **16 passed**（修改前 3 failed / 13 passed） |

一条既有断言被本 CR **有意反转**，如实登记：`tests/display-stage.test.tsx` 的「③ 鼠标到达标题屏即切换，不必等满 3 秒」原本忠实断言 CP-1 的字面意思，现改为断言指针移动**不**切换，并另立一条断言点击仍然立刻切走。

另修一处测试脆弱性：`tool-suites*.test.ts` 原先用位置解构 `const [, showInsight] = createDisplayTools(store)` 取工具。新增 `show_board` 让所有下标错位，10 个用例一起红。改为按 `name` 取，以后加工具不会再波及无关用例。

## 6. 未覆盖的部分（如实登记）

- **开场观感**：3 秒是否合适、扫描线是否好看，只有真实使用能判断。机器守得住的是「指针移动不切换」「点击切换」「两个方向都可达」。
- **模型是否会在恰当时机调用 `show_board`**：工具描述写了触发场景（「打开看板」「看一下跟踪对象」），但模型的选择时机属提示层，无法机器断言。
- **本 CR 不解决看板内容为空的问题**：知识库已采纳条目为 0，看板打开后大部分区域是空的。那是另一件事（本地原文档层与知识可达性），另立 CR。
