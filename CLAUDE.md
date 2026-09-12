# Agent-Jarvis — 会话操作规则

本文件每次会话常驻。只写**推导不出来的东西**：猜不到的命令、会咬人的坑、以及不该由我自己决定的边界。
目录结构、技术栈、依赖、标准脚本一律不写在这里——那些读代码就知道。

完整规范在 `docs/`，按需读：治理原则 `docs/AI_STANDARD.md`、流程 `docs/WORKFLOW.md`、门禁分档 `docs/CONTROLS.md`、UI 规范 `docs/UI_STANDARD.md`、本机配置与运行 `docs/LOCAL_CONFIGURATION.md`。

## 一、最重要的一条

**用户没确认的产品内容，不要自己发散。** 需求、架构、模块任务、测试矩阵、发布结论都属于此列。
先把用户原话存进 `project/00_input/需求输入.md`，再往下派生。改动落到受控说明书之前，先在 `project/06_changes/` 立 CR。

产品需求说明书当前状态为 **APPROVED**；新增或修改需求仍须走 CR 与 R1 终裁，不能直接改表。

## 二、猜不到的命令

```powershell
python tools/governance.py check p1|p2|p3|release   # 按阶段整体跑，优先用这个
python tools/governance.py verify|check-changes|check-specs|check-ids|check-doors
python tools/governance.py review r1|r2|r3|r4       # 设计阶段四门
python tools/governance.py gate g1|g2|g3|g3.5|g4    # 证据门
python tools/governance.py new-cr CR-<日期>-<slug>  # CR 骨架，13 个标签齐全
python tools/governance.py matrix CR-<日期>-<slug>  # 按 CP 表生成 R2/R3/R4 矩阵骨架
python tools/governance.py snapshot --actor <name>  # 全流程只跑一次，见第三节
npm run verify:all                                  # 类型 + 单测 + 治理单测 + 视觉 + 契约 + 冒烟
npm run config:check                                # 配置预检，会报告当前身份模式
```

`gate g3|g3.5`、`review r*`、`check p1..p3` 接受 `--cr <名>` 收窄到单个变更记录。这是**自查视角，不是交付凭证**——收口与提交一律以缺省全量结果为准。`gate g4` 与 `check release` 拒绝 `--cr`。

## 三、分支与 snapshot 的顺序不能反

一个 CR 一条分支：`git switch -c cr/<name> main`。

**`snapshot` 全流程只跑一次**，在 CR 分支上、合并前的最后一步。`ledger.jsonl` 是哈希链，两条分支各自 snapshot 会产生 `seq` 与 `prev_hash` 相同的两条记录，合并后 `verify` 报链断裂且**没有正确的手工修法**。

顺序：**先把 main 合进 CR 分支 → 再 snapshot → 再合回 main**。反过来做，基线会漏掉 main 上新增的文件，合并后报 `UNBASELINED_FILE`。

合并后立刻再跑一次 `verify`——这是唯一能发现「合并把基线合坏了」的检查。

## 四、会咬人的坑

**构建目录**：绝不在交互式 `next dev` 运行时直接 `next build`——两者共用 `.next` 会互相毁掉产物，曾导致 `/api/auth/*` 全部 500。要构建用 `npm run build:verify`（`.next-verify`）或 `npm run build:local`（`.next-prod`）。新增或修改 `next.config.*` / `postcss.config.*` 后必须重启 dev server，Next 只在启动时读一次。

**dev server 会悄悄坏掉**：长跑数小时后常驻内存涨到 GB 级，内存紧张时编译 worker 被系统杀掉，此时 **GET 路由仍返回 200，按需编译的路由返回 500**，看起来像业务 bug。判断健康要打一个按需编译的只读路由（`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/knowledge`），**不要用写操作探针**——服务半死时第二步会失败，把数据留在改坏的状态。日常建议用 `npm run build:local && npm run start:local`（生产构建，内存约为 dev 的十几分之一，代价是无热更新）。

**CR 的 `- 影响测试:` 不要写 `TEST-097..099` 范围形式**：`extract_ids` 不解析 `..`，只会取到第一个编号，`gate g3.5 --cr` 因此看不到真实入口证据。逐一列出。

**`test-results.json` 的 `known_warnings[].check`** 只接受三种谓词：`gate_red:<门>`、`dep_absent:<包>`、`manual`。写自由文本会让治理单测 FAIL。

**行尾与 BOM**：仓库用 `.gitattributes` 固定 LF。PowerShell 的 `Set-Content -Encoding utf8` 会写 BOM，vitest 的 transform 不容忍，会让整个测试文件无法解析。用 Write 工具或显式 UTF-8 无 BOM 写入。

**多会话共用一棵工作树**：说明书这类单文件是冲突高发点，曾发生过并行会话的提交整体覆盖掉未提交改动。动 git 分支前先确认没有其它会话在写。

## 五、写文档时的固定动作

- 新增 REQ / DEC / TASK / TEST 编号前先 `check-ids`，并在 CR 的 `- 占用 ID:` 里声明；并行会话同时分配时取明显高于当前最大值的区间。
- 每个变化点（CP）必须声明「门」与「发现方式」。发现方式只有三种合法答案：某条机器检查、某个真实入口操作、或 `发现不了`——填「发现不了」即按单向门处理。
- 含任一单向门 CP 的变更走重型档（完整 R1–R4 + 回滚方案）；全双向门但有人工发现项走标准档；全双向门且各有机器检查才走快车道。
- 证据文件必须写来源、时间、采集者、支撑对象、可定位路径。聊天推测不能当证据。
- 覆盖不了的地方**如实登记为人工发现项**，不要用宽松断言伪装成已覆盖。

## 六、交付纪律

- 任务标 DONE 的前提是依赖完成且必选验证**当前**通过，不是「应该能过」。
- 涉及 UI、CLI、API 的验收必须走真实入口，测试桩和纯函数断言不算。
- 改一段代码时，被取代的旧实现要在同一变更内删掉，不留新旧并存（`noUnusedLocals` 会强制一部分）。
- 不要替用户提交或推送。改完把结果说清楚，让用户自己看 `git diff`。
