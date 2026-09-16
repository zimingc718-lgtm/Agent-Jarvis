# EV-2026-09-15-sweep-interval-edit

- 来源: 助手 2026-09-15 审查 `KnowledgeDashboard` 巡检间隔输入框时自行发现的编辑竞态缺陷（非用户反馈条目），在「全实现，按你建议的顺序全实现」总授权下处理
- 时间: 2026-09-15（发现、委派子代理实现）–2026-09-16（编排会话三方合并整合、机器证据与真实入口核对）
- 采集者: 助手（claude-sonnet-5），在本仓库真实工作树上执行；真实入口部分在用户自己那台服务器（端口 3000）
- 支撑对象: `CR-20260915-sweep-interval-edit` CP-1
- 可定位路径: 本文件；`src/components/KnowledgeDashboard.tsx`（`applySweep`/`commitInterval`/`scheduleIntervalSave`）、`scripts/probe-sweep-interval-edit.mjs`

## 1. 缺陷现场核对

改前的间隔输入框只有 `onBlur`/`onChange` 两个处理器，且挂载读取、后台 tick 刷新、开关保存、立即巡检刷新四处服务端数据回落都直接 `.then(setSweep)`——用服务端返回的整份 `SweepState` 覆盖本地状态。核对得：只要用户打了字但还没失焦，任一时刻这四处中的一处落地，`intervalMinutes` 就会被服务端的旧值静默换回，且没有任何提示。另外没有 Enter 提交、合法范围只在失焦保存越界报错时才看得到。

改法：`applySweep(next)` 合并函数，编辑中（`editingIntervalRef.current` 为真）时只用 `next` 更新其它字段、`intervalMinutes` 留在本地；四个入口统一改走它。`commitInterval` 作为 Enter / 失焦 / 500ms 防抖到时三路共用的唯一保存出口。

## 2. 机器证据

| 用例 | 条数 | 守住的事 |
|---|---|---|
| ㉑ Enter 立即保存 | 1 | 不等防抖，调用同步落地，有「已保存为 N 分钟」回执 |
| ㉒ 停顿约 500ms 自动保存 | 1 | 假计时器推进 499ms 未保存、推进到 500ms 保存，防抖窗口边界精确 |
| ㉓ 编辑中不被后台刷新覆盖 | 1 | 编辑中把开关打开触发一次 tick 刷新（`intervalMinutes` 服务端返回 999），刷新确实落地（`lastRun` 更新可证）但输入框仍是刚打的 45 |
| ㉔ 范围提示常驻 | 1 | 不必触发报错，加载即可见「30–1440」 |
| ㉕ 保存失败原文显示 | 1 | `saveSweep` 抛错时，错误原文（非泛化文案）出现在页面上 |
| 原有 25 条 + CR-20260915-board-tick-burst 的重渲染防抖测试 | 21 | 均未受本次改动影响，逐字回归 |

`npx vitest run tests/knowledge-dashboard.test.tsx`：**26 个用例全绿**。`npx tsc --noEmit`：**0 错误**。全量 `npx vitest run`：**799 个用例全绿**（较 CR-A 收口时的 794 增 5，即本 CR 新增的㉑–㉕）。`python tools/governance.py check-ui-route`：本 CR 的 `机器（UI）` 路线 PASS。`check-tables`/`check-doors`/`check-ids`/`check-test-commands`：均 PASS。

## 3. 真实入口（用户自己那台，端口 3000）

`npm run build:local` 重建 `.next-prod`（本次一并带上 CR-A 的产物），重启 `serve:local`
（旧进程 PID 1888 是 CR-A 收口时起的，被停掉后看护自动拉起新的），`curl http://localhost:3000/api/knowledge`
确认 200 后开始。

`node scripts/probe-sweep-interval-edit.mjs`（1440x900 真实 Chromium）：

```
range 提示常驻可见 = true
原值 = 180，测试值 = 181
刷新页面后读到的值 = 181
PASS range 提示常驻、Enter 提交立即写回真实 API 且刷新后仍在，已把值改回原样
```

核对完毕另用 `curl http://localhost:3000/api/entities/sweep` 独立确认：`intervalMinutes: 180`——
与探针脚本内部的自我核对一致，服务端真的被改回了原值，没有留下测试痕迹。

采集时间 2026-09-16（本地服务器，端口 3000），采集者：助手（claude-sonnet-5）。

（探针脚本首次运行时报错——误用了 Testing Library 的 `getByLabelText`，Playwright 的
Locator 链式方法是 `getByLabel`；改名后重跑即通过，脚本文件里的错误未曾进入 main。）

## 4. 局限（如实登记）

- 真实浏览器探针核对的是「Enter 提交 → 真实 API 持久化 → 刷新页面仍在」，即防抖与竞态两条假计时器测试证不了的那一半（保存请求真的落地）；不重复在真实浏览器里逼一次 60 秒的后台 tick 去验编辑中不被覆盖——那条路径的核心逻辑（合并而非覆盖）在假计时器测试 ㉓ 里已用「tick 落地但编辑值未变」直接断言，真实浏览器等一次真实 tick 只是把同一件事等得更慢，边际证据很小。
- `check-ui-route` 是文件级核对，不是用例级——`tests/knowledge-dashboard.test.tsx` 里 ㉑㉕ 用 `fireEvent.keyDown`/`fireEvent.change` 满足 `机器（UI）` 的驱动要求，但该检查不核对是不是这几条用例本身在驱动，是 v1 已知粒度限制（CR-20260915-process-hardening-flow 已记录同类情况）。

## 5. 落地方式记录

实现由子代理在独立 worktree 完成，编排会话审阅后整合到 `main` 派生的新分支。整合时发现该 worktree 的分叉点（`591cd471`）早于 `c48bec5`（`fix(board): 四个 prop 默认值提到模块层`，同一文件的独立修复）——直接用子代理的完整文件覆盖会静默丢掉那次修复。改用 `git merge-file` 三方合并：`KnowledgeDashboard.tsx` 无冲突自动合并（两处改动分处组件不同区域）；`tests/knowledge-dashboard.test.tsx` 在文件尾部相邻新增测试处起冲突，手工核对内容后确认两段互不相关，都保留（合并后 26/26 通过，较合并前任一方单独的用例数都多，印证两段都在）。
