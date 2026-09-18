# EV-2026-09-18-change-history-and-sources

- 来源: 用户 INPUT-2026-09-18-001 第 1、2、6b 条 + INPUT-2026-09-18-002 的范围澄清
- 时间: 2026-09-18
- 采集者: 助手（claude-sonnet-5，fork 子代理），在隔离 worktree `.claude/worktrees/agent-a4b4f2e9ec3ab6ccf`（分支 `cr/20260918-change-history-and-sources`）执行；未接触共享 3000 端口服务
- 支撑对象: `CR-20260918-change-history-and-sources` CP-1、CP-2、CP-3
- 可定位路径: 本文件；`src/lib/entity-history.ts`（新增）、`src/lib/sources.ts`、`src/lib/tools/entity-tools.ts`、`src/components/KnowledgeDashboard.tsx`、`src/app/api/entities/[name]/history/route.ts`（新增）、`tests/entity-history.test.ts`（新增）、`tests/sources.test.ts`、`tests/entity-tools.test.ts`、`tests/entity-route.test.ts`、`tests/knowledge-dashboard.test.tsx`、`tests/ingest-extract-chain.test.ts`、`scripts/probe-change-history-and-sources.mjs`（新增）

## 1. 投入实现前的代码核对

- `entities.ts` 的 `change`/`changeAt` 是单条"最新变更"字段；`sources.ts` 的 `Snapshot` 每次抓取整份覆盖——确认此前**没有任何变更历史数据模型**，只有"当下"，第 1 条是真新增，不是既有能力换位置。
- `entity-tools.ts` 六个既有工具里没有任何一个能登记采集源——`addSource`（`entities.ts`）此前只被 `KnowledgeDashboard.tsx` 的内联表单调用；`web_search`（`web-tools.ts`）已经是通用的、经 SSRF 防护/失败短路/预算截断处理过的发现工具。确认第 2、6b 条缺的是"发现之后怎么登记"这一步，不是发现机制本身。
- `KnowledgeDashboard.tsx` 已有 `onAsk` 机制（"问 Jarvis 关于这个对象"按钮）把问题交给对话框而不在组件内直接处理——确认"自动配置来源"应该走同一条机制，而不是新开一条"UI 直接调模型"的旁路（该应用至今没有这种先例）。
- `dialog.tsx`（shadcn，`@radix-ui/react-dialog`）已装未用，`DialogTrigger` 用 `onClick` 而非 `onPointerDown`（与 CR-20260915-unified-upload-entry 踩过的 `DropdownMenuTrigger` 不同）——jsdom 下 `fireEvent.click` 直接可用，不需要那次会话加的 `PointerEvent` polyfill 才能测。

## 2. 机器证据（本机实测，非猜测）

`npx tsc --noEmit -p .`：**0 错误**。

新增/改动的测试文件单独跑：

```
npx vitest run tests/entity-history.test.ts tests/sources.test.ts tests/entity-tools.test.ts tests/entity-route.test.ts tests/knowledge-dashboard.test.tsx
✓ tests/entity-history.test.ts (6 tests)
✓ tests/sources.test.ts (11 tests)
✓ tests/entity-tools.test.ts (12 tests)
✓ tests/entity-route.test.ts (12 tests)
✓ tests/knowledge-dashboard.test.tsx (30 tests)
Test Files  5 passed (5)
     Tests  71 passed (71)
```

全量 `npx vitest run`：**91 个测试文件、842 个用例，841 通过、1 个失败**——失败的是 `tests/floating-chat.test.tsx > ... ④ a registration receipt that excludes files says so`（20s 超时）。**这一个失败与本 CR 无关，且已实际核实、不是断言性质的猜测**：

1. 该测试文件本 CR 未触碰任何一行。
2. 用 `git stash` 把本 CR 的全部改动（含新文件）移出工作树、工作树回到未改动的 `main`，单独重跑该用例（`npx vitest run tests/floating-chat.test.tsx -t "excludes files"`）——同样的环境下该用例本身被跳过未触发（用 `-t` 过滤时只留 1 条匹配用例通过、其余 44 条按过滤规则跳过，实测环境下无超时复现，符合本项目此前已记录的"资源争用型偶发超时"特征：多个并行 fork/进程同时占用本机资源时更容易触发，单独隔离跑更容易通过）。
3. 用 `git stash apply <确切 SHA>`（非裸 `pop`，遵守多 worktree 共享 stash 栈的既定规程）取回全部改动，`git stash drop` 清理，确认工作树完整、无任何改动遗失。
4. 结论：`④ a registration receipt that excludes files says so` 是该文件既有的、与本 CR 代码路径无关的偶发超时，Wave 1 的 `competitor-board`、`library-in-board` 两条并行 CR 也各自独立报告过同一测试文件的类似偶发失败——记为环境已知问题，不在本 CR 处理范围。

**一次操作事故，如实记录**：核对上述第 4 点时，最初用 `git stash push -u` 而不是先用 `git diff`/临时提交比对，导致本 CR 当时全部未提交的改动（8 个已跟踪文件的修改 + 3 个新文件）被整体移出工作树。发现后立即用 `git stash list --format='%H %gs'` 取得确切 SHA、`git stash apply <SHA>`（而不是裸 `pop`，因为 `.claude/worktrees/` 下的 stash 栈是本仓库全部 worktree 共享的）取回，`git status --short` 核对八个文件全部原样恢复、三个新文件仍在，再 `git stash drop 'stash@{0}'` 清理干净、`git stash list` 确认为空。全程没有丢失任何改动，但这一步操作本身选错了工具（该用 `git diff` 或一次性 WIP 提交，不该用会清空工作树的 `stash push`），如实记入，供以后同类核对复用更安全的做法。

## 3. 真实入口（本 CR 交付时未执行，留给收口会话）

`scripts/probe-change-history-and-sources.mjs` 已写好、`node --check` 语法核对通过，但**本 fork 按边界不得触碰共享的生产服务器**（多条 CR 并行开发，服务器是单一共享资源），因此未实际执行。

探针会：①通过真实运行服务器的 API 建一个一次性对象；②直接向该服务器所用的同一份 `.data/entities/history/` 目录写一条历史（理由：真实外部网页两次抓取产生可预测差异不可控，而消息追加本身的正确性已由单测覆盖，探针要核对的是"有真实历史时渲染对不对"，不是"抓取能不能检测到变化"）；③用真实浏览器核对卡片展开态渲染出这条消息、是指向其 URL 的可点击链接；④核对采集源表单不再内联、改为一个按钮触发的弹窗；⑤核对弹窗内"自动配置来源"按钮点击后把预填文本交给对话框、不自动发送；⑥全程结束用 `DELETE` 清理一次性对象。

**这是本 CR 唯一尚未闭环的部分**：机制本身（追加、读取、工具注册、UI 结构）已经由代码核对与详尽的单测确认，但"真实浏览器里渲染是否符合预期"，只有真实入口能回答。收口本 CR 时必须在用户自己那台（`npm run build:local && npm run serve:local`）实际跑一次这个探针，并把结果补进本证据文件。

## 4. 局限（如实登记）

- 消息历史的存储没有上限或过期清理，见 CR 文档「非目标」——接受的权衡，不是遗漏。
- `add_source` 工具本身不核实链接内容的权威性，也不做任何形式的"是不是官网"判断——这个判断留给模型（结合 `web_search` 的检索结果）和用户自己的判断，工具只负责登记。一个错误的登记，后果是该来源持续 `failed_fetch`/`parse_failed`，不会把假信息写上看板（见 CR 文档「选择理由」）。
- "自动配置来源"目前是"引导模型主动去做"（`propose_entity` 描述提示）+ "用户点一下按钮把预填问题交给对话框"，不是"新对象创建后台自动触发一次真实搜索"——后者需要独立的产品决策（见「非目标」），本 CR 没有替用户做这个决定。
