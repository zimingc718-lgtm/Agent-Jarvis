# EV-2026-09-15-console-menu-consolidation

- 来源: 用户 2026-09-15 反馈 9、10；反馈 10 的机制第一轮分析猜错（以为是重排），被用户当场纠正为「没有对话框的部分内容也被遮挡了」
- 时间: 2026-09-15
- 采集者: 助手（claude-opus-5），在本仓库真实工作树上执行；真实入口部分在用户自己那台服务器（端口 3000）
- 支撑对象: `CR-20260915-console-menu-consolidation` CP-1、CP-2
- 可定位路径: 本文件；`src/components/FloatingChat.tsx`（`collapsedConsoleHeight`）、`src/components/KnowledgeList.tsx`、`scripts/probe-console-overlay.mjs`、`scripts/probe-menu-pending-collapse.mjs`

## 1. 反馈 10 的现场核对

三个展示屏容器（`display-screen--insight`/`--board`/`--settings`）均为 `fixed inset-x-0 top-0 z-0`，让位高度取自 `var(--jarvis-console-h, 0px)`；控制台自身 `fixed inset-x-0 bottom-0 z-20`。核对得两件事：

1. **`inset-x-0` 是通栏**：让位量一旦变大，裁掉的是整行宽度，不止对话框正下方那一段。
2. **`z-20 > z-0` 早已是「浮在上面」**：记录区展开时不需要额外机制去实现覆盖，展示屏内容本就在控制台之下；缺陷完全出在「让位量算太大」这一件事上。

改前实测（用户自己那台）：`--jarvis-console-h` 随记录区展开可达 400–520px（对应 50–58vh 步骤流上限），展示屏因此让出对应大小的通栏空白。

## 2. 机器证据

| 用例 | 条数 | 守住的事 |
|---|---|---|
| `collapsedConsoleHeight`（`tests/floating-chat.test.tsx`） | 4 | 记录区未挂载=收拢态高度；挂载但高度为零=收拢态高度；正常展开=仍是收拢态高度（不随记录区变化，先红后绿：撤掉修复即返回 rootHeight）；竞态不产出负数 |
| 挂载时的接线（`tests/floating-chat.test.tsx`） | 1 | 用真实两个 ref 的测量值（打桩 `getBoundingClientRect`）验证发布值确实来自「根 − 记录区」而不是根本身 |
| 菜单待采纳收拢（`tests/knowledge-list.test.tsx`） | 2（改写）+ 1（保留） | 默认收拢——条目标题与按钮不在文档里；点徽标展开同一套控件；采纳/忽略后的行为与改前逐字一致（同一路由、同一回执文案） |

`npx vitest run tests/floating-chat.test.tsx tests/knowledge-list.test.tsx tests/settings-on-display.test.tsx`：**57 个用例全绿**。`node scripts/ui-contract.mjs`：**53 项全过**。`python -m unittest tests.test_governance`：**140 个用例、25 个子用例全绿**。`node scripts/check-module-graph.mjs`：0 环 0 违规。`python tools/governance.py check-ui-route`：本 CR 两条 `机器（UI）` 路线均 PASS。

## 3. 真实入口（用户自己那台，端口 3000）

`npm run build:local` 重建 `.next-prod`，重启 `serve:local`（旧 `next start` 子进程 PID 16844 被停掉，看护自动拉起新的），
`curl http://localhost:3000/api/knowledge` 确认 200 后开始。

**CP-1**（`node scripts/probe-console-overlay.mjs`，1440x900 真实 Chromium）：

```
折叠态：屏幕左侧内容可命中 = true，--jarvis-console-h = 176px
展开态：屏幕左侧内容可命中 = true，--jarvis-console-h = 176px
PASS 展开前后屏幕两侧内容均可命中，且 --jarvis-console-h 保持不变（未随记录区伸缩）
```

**CP-2**（`node scripts/probe-menu-pending-collapse.mjs`，同一浏览器会话；用真实待采纳数据 4 条，未点「采纳」/「忽略」本身以免改动真实知识库）：

```
收拢态：条目数=0，aria-expanded=false
展开态：条目数=4，aria-expanded=true，可见「采纳」按钮=4，可见「忽略」按钮=4
PASS 默认收拢（条目不在文档里），点徽标后展开且同一套采纳/忽略按钮按条目数一一出现
```

两条路线均 PASS。采集时间 2026-09-15（本地服务器，端口 3000），采集者：助手（claude-sonnet-5）。

## 4. 局限（如实登记）

- `check-ui-route` 目前按**文件级**核对「点名的测试文件里是否含 UI 驱动调用」，不核对「具体是不是这一条用例在驱动」——`floating-chat.test.tsx` 里有大量其它用例本就用 `fireEvent`，本 CR 新增的挂载测试本身并不需要点击（默认态已有两条历史消息、记录区已展开）。这是 `check-ui-route` v1 的已知粒度限制（CR-20260915-process-hardening-flow 的审计已记录同类情况），不是本条记录的缺陷。
- jsdom 的 `ResizeObserver` 是空实现，无法在 jsdom 内验证「记录区实际展开后重新触发一次 publish」这件事本身——只能验证挂载那一刻接线接对了。这半交给真实入口。
