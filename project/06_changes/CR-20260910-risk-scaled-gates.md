# CR-20260910-risk-scaled-gates

- 级别: L3（改治理模型本身：变更分档判据、CP 表结构、门禁集合。与 CR-20260909-consensus-review-gates、CR-20260910-process-hardening 同级）
- 提出人: user（INPUT-2026-09-10-007）
- 状态: APPROVED（R1 人工终裁完成；R2/R3/R4 四角色全 APPROVED）；**P3/P4 完成**
- 评审模型: R1-R4 + G3/G3.5/G4
- 占用 ID: DEC-021, TASK-053..058, TEST-055..060
- 影响需求: 无产品需求变更（本 CR 不触碰 REQ-*）；治理约束记入 `docs/AI_STANDARD.md` 与 `docs/CONTROLS.md`
- 影响模块: MOD-GOVERNANCE
- 影响任务: 新增 TASK-053..058
- 影响测试: 新增 TEST-055..060；TEST-051..054 作回归门
- 当前证据: `project/00_input/需求输入.md` 的 INPUT-2026-09-10-007；`project/05_evidence/EV-2026-09-10-process-overhead.md`
- 方案选项:
  - A. 只写文档规则，不做检查命令：拒绝。用户明确要求机器核验；且本 CR 要闭合的五个盲区里有四个正是「只有人记得、机器不查」造成的。
  - B. 引入外部流程工具（如 ADR 工具链 / 策略引擎）：拒绝。会新增外部依赖与第二个 CLI 入口，违反 CR-20260910-process-hardening 的 CP-9 既有约束。
  - C. 用并行（多 agent / 多分支）提升效率：拒绝。实测治理开销是**每 CR 近似常数**（220–450 行），与变更大小无关；并行只是让同样的开销并发发生，还要额外付协调成本。
  - D. **按可逆性分档 + 把分档判据与五个盲区全部做成 `governance.py` 子命令**：已选。
- 选择理由: 实测数据（EV 文件）显示瓶颈是「每 CR 固定开销」而非并行度：ui-foundation 441 行治理 / 2847 行代码 = 0.15:1，而 test-subprocess-encoding 是 16.8:1、record-accuracy 是 225:0。分档能把后两类降到快车道；机器检查能把「靠人记得」的规则变成「不跑不过」。两者合起来才成立——**放松流程的前提是机器接管了被放松的那部分**。
- 回滚方式: 全部改动在 `tools/`、`scripts/`、`tests/`、`docs/`、`project/` 下，`git revert` 单个合并提交即可。**但注意 CP-1 是单向门**：在新分档下已按快车道放行的变更，不会因为规则回滚而被重新评审。因此本 CR 合入后若要撤回，必须同时人工复查该期间走过快车道的全部 CR。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（含新增的「门」与「发现方式」两列）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260910-risk-scaled-gates` 节逐一响应 CP-1..CP-12；三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-053..058 全部 DONE；TEST-055..060 全部 PASS 且**每条含阳性用例**（构造违规 → 断言阻断），不得只测通过路径；五个盲区各有一条能复现原始事故的回归守卫；全量门禁与既有 194 vitest / 44 治理单测 / 49 静态契约 / 68 实时契约无回归；基线重新 snapshot。
- 评审记录: R1 四角色独立评审见下节。**R1 人工终裁**：用户 2026-09-10「好的。按你建议的继续。」

## 变化点登记

本表首次启用「门」与「发现方式」两列——本 CR 自身即这两列的第一个试用例。「发现方式」只有三种合法答案：某条机器检查、某个真实入口操作、或 `发现不了`；填 `发现不了` 即风险登记项，必须按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 变更分档判据从「改了哪个目录」改为「**撤回代价**」：双向门 + 有机器兜底走快车道，单向门走完整 R1–R4。三档写入 `CONTROLS.md`。 | 目标 1 | 大改 | **单向** | 发现不了——已按快车道放行的变更不会因规则回滚被重审，故本 CR 自身必须按重型处理 |
| CP-2 | 产品 | 每个 CP 必须声明「门」与「发现方式」；`发现方式=发现不了` 时「门」必须为单向。 | 目标 2 | 新增 | 双向 | 机器：`governance.py check-doors` |
| CP-3 | 产品 | 新增的流程规则必须同时交付可执行检查命令；只写进文档的规则不算交付。 | 目标 3 | 新增 | 双向 | 机器：`check-doors` 要求每条新规则在 R4 绑定 TEST-* |
| CP-4 | 产品 | 五个已暴露的检测盲区必须逐个闭合，且各有一条能复现原始事故的回归守卫。 | 目标 4 | 缺陷修复 | 双向 | 机器：TEST-055..060 的阳性用例 |
| CP-5 | 架构 | ID 占用改为 CR 头部机器可读字段 `- 占用 ID:`，实现「开 CR 时先占号」；两个 CR 不得声明重叠区间，声明的 ID 必须在对应说明书表中存在。 | DEC-021, 盲区 ① | 新增 | 双向 | 机器：`governance.py check-ids` |
| CP-6 | 架构 | `known_warnings` 从自由文本升级为可核验结构：`{text, check}`，`check` ∈ `gate_red:<gate>` / `dep_absent:<pkg>` / `manual`（`manual` 须带 `reviewed_at`，超期报陈旧）。 | DEC-021, 盲区 ② | 大改 | 双向 | 机器：`governance.py check-warnings` |
| CP-7 | 架构 | 新检查全部挂在既有 `governance.py`，不新增第二个 CLI 入口（延续 process-hardening CP-9）；运行时检查（dev server）走 `scripts/`，与 `ui-contract.mjs` 同类。 | DEC-021 | 约束 | 双向 | 机器：`check-ids` 断言 `package.json` 未新增 CLI 入口 |
| CP-8 | 架构 | 盲区 ④（ledger 分叉）**不新增代码**：`check_ledger` 已覆盖 `LEDGER_BAD_SEQUENCE` / `LEDGER_BROKEN_CHAIN` / `LEDGER_HASH_MISMATCH`。本 CR 只补「先合 main → 再 snapshot → 再合回」的顺序规则与合并检查清单。 | 盲区 ④ | 不变（仅文档） | 双向 | 机器：既有 `verify`（合并后立即复验） |
| CP-9 | 模块 | 17 个既有 CR 需回填「占用 ID」字段；回填以脚本生成候选 + 人工逐条核对，不得手改出错，且**回填本身不得改变任何既有 ID 的归属**。 | 盲区 ①, TASK-055 | 新增 | 双向 | 机器：`check-ids` 对全部 CR 生效；人：回填前后 `review r1..r4` 结果必须一致 |
| CP-10 | 模块 | 4 条自由文本 `known_warnings` 迁移为结构化；旧格式仍可解析但判为 `UNVERIFIABLE` 并列出，避免一刀切阻断历史数据。 | 盲区 ②, TASK-056 | 小改 | 双向 | 机器：`check-warnings` 同时报可核验与不可核验两类 |
| CP-11 | 测试 | 每条新检查必须有**阳性用例**（构造违规输入 → 断言阻断），不得只测通过路径——只测通过路径的检查等于没有检查。 | 目标 3, 原则 15 | 新增 | 双向 | 机器：TEST-055..060 各含阳性用例；治理单测总数须净增 |
| CP-12 | 测试 | dev server 一致性检查必须打**真实运行的服务器**（原则 12 真实入口），断言其返回的 CSS 含 Tailwind 工具类；服务器未运行时须显式 SKIP 而非静默通过。 | 盲区 ④/⑤, TASK-057 | 新增 | 双向 | 真实入口：`node scripts/check-dev-server.mjs` 打 3000 端口 |

（产品 CP-1..CP-4，架构派生 CP-5..CP-8，模块派生 CP-9..CP-10，测试派生 CP-11..CP-12。R2/R3/R4 须逐项承接。）

## 盲区 ⑤ 的处置说明

`review r1..r4` 目前对没有 `## 变化点登记` 表的 CR **静默跳过**。这不是"L1 不需要 CP 链"的实现，而是"机器没说话"——我在 CR-20260910-record-accuracy 里正是因为不愿给自己开这个口子，才给一个 L1 硬套了完整 CP 链，付出 225 行。

处置：`review r*` 改为**如实报告**跳过项（`SKIPPED_BY_LEVEL CR-x (L1, 无 CP 链)`），并在 `check-doors` 中断言"跳过的 CR 其级别必须真的是 L1 且全部 CP 为双向门"。这样 L1 才能名正言顺地轻，而不是靠静默。

## R1 四角色审查

### 产品 owner

- 观察：用户输入包含两个并列约束——提效，以及「保证实现的真实、测试的准确、每个需求都有清晰的回应与实现」。后者是对前者的**限制条件**：提效不得以放松证据标准为代价。
- 判断：`APPROVED`。分档方案满足这个限制：快车道减少的是**评审文字**，不减少任何机器检查与真实入口证据；恰恰相反，快车道的准入条件就是"该变更被机器覆盖"。
- 处理：明确非目标——不放宽 `UI-GOV-001`、不放宽真实入口要求（原则 12）、不放宽逐条断言（原则 15）；不减少任何既有测试。

### 架构角色

- 观察：CP-1 是本 CR 唯一的单向门，且它单向的原因很特殊——**规则本身可以回滚，但按旧规则已放行的变更无法追溯重审**。这类"规则类单向门"在现有 DEC 体系里没有先例。
- 判断：`APPROVED`，附条件：① 新增 **DEC-021** 统一记录三件事——分档判据、CP 表两列的语义、`known_warnings` 的可核验结构；② 分档判据必须可机器判定，不能留"由评审者感觉决定"的口子，否则快车道会被滥用。
- 处理：两项转为 P2 交付物。`check-doors` 必须能对每个 CP 独立判定门类，而不是对整个 CR 打一个标签——ui-foundation 的实例证明一个 CR 里两种门是常态（95% 双向 + 一条依赖链单向）。

### 模块开发角色

- 观察：CP-9 的回填面是 17 个 CR 文件，是本 CR 最大的手工面，也是最容易悄悄改错归属的地方。CP-6 的 `known_warnings` 迁移只有 4 条，风险小。
- 判断：`APPROVED`，附条件：回填必须有**不变量守卫**——回填前后对全部 CP 模型 CR 跑 `review r1..r4`，结果必须逐字一致（沿用 TEST-054 向后兼容硬门的做法）。
- 处理：条件转为 P3 出口义务。任务拆分为 TASK-053（分档与 `check-doors`）/054（`check-ids`）/055（17 个 CR 回填）/056（`check-warnings` + 迁移 4 条）/057（`check-dev-server.mjs`）/058（`check-specs` 与 `migrate_specs` 合流 + `review` 如实报告跳过），每个可独立提交与回滚。

### 测试角色

- 观察：本 CR 的产物**全部是检查器**。检查器最典型的失败模式是"只在通过路径上被验证过"——写完跑一遍绿了就交付，从没验证过它真的能拦住违规。今天的 `known_warnings` 就是活例：它不是被检查器放过的，是**根本没有检查器**。
- 判断：`APPROVED`，附两项强制要求：① 每条新检查必须有阳性用例，构造违规输入并断言具体错误码（`CHECK_IDS_DUPLICATE` 这类），不接受只断言"退出码非零"；② 五个盲区各要有一条**能复现原始事故**的回归守卫——TASK-044..048 撞号、LV-AXE 过期断言、说明书节位置不合规、dev server 供给旧 CSS、L1 被静默跳过。
- 处理：两项转为 P3 出口义务，派生 TEST-055..060。`check-dev-server` 必须打真实服务器（原则 12），服务器未起时显式 SKIP——静默通过等于假覆盖。

## R1 反馈闭环状态

- 已闭合：提效不得放松证据标准（产品）；一个 CR 内两种门并存必须逐 CP 判定（架构）；回填需不变量守卫（模块）；检查器必须有阳性用例（测试）。
- 四角色无 REJECTED；三项 CONDITIONAL 均已转为 P2 交付物或 P3 出口义务，无遗留条件。
## R1 人工终裁

用户 2026-09-10：「好的。按你建议的继续。」——在完整看过 12 个 CP、六个任务、以及三项需确认事项（盲区 ④ 主动缩小范围不重复造检查、TASK-055 需回填 17 个 CR、测试角色的阳性用例与事故回归两条强制要求带来的工作量）后拍板。

CP-1 是单向门，按本 CR 自己提出的判据必须由人终裁——此条已满足。四角色无 REJECTED、无遗留 CONDITIONAL，允许进入 P2。

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260910-risk-scaled-gates` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 判据不放宽任何证据标准 | APPROVED DEC-021 ① 成文，三档可机器判定 | APPROVED 逐 CP 判定可实现 | APPROVED TEST-055 ① 可验 |
| CP-2 | APPROVED 两列语义由产品定义 | APPROVED DEC-021 ② 取值受限 | APPROVED 解析同既有 CP 表 | APPROVED 阳性用例可构造 |
| CP-3 | APPROVED 文档-only 规则不算交付 | APPROVED 无架构面新增 | APPROVED 由 R4 绑定强制 | APPROVED TEST 绑定即证据 |
| CP-4 | APPROVED 五个盲区范围锁定 | APPROVED 逐盲区映射到具体检查 | APPROVED 四任务分担 | APPROVED 事故回归可复现 |
| CP-5 | APPROVED 开 CR 即占号，符合意图 | APPROVED 字段解析同 13 标签 | APPROVED 三错误码边界清晰 | APPROVED 撞号可复现 |
| CP-6 | APPROVED 证据可核验是硬要求 | APPROVED 双形态兼容不破历史 | APPROVED 谓词集合有限可实现 | APPROVED 需断言真执行门 |
| CP-7 | APPROVED 不扩散工具入口 | APPROVED 延续 DEC-020 单入口约束 | APPROVED 运行时检查走 scripts 合理 | APPROVED 静态可审 |
| CP-8 | APPROVED 不重复造检查 | APPROVED 既有 check_ledger 已覆盖三码 | APPROVED 零代码改动 | APPROVED 既有 verify 作回归 |
| CP-9 | APPROVED 回填不改归属 | APPROVED 无架构影响 | APPROVED 不变量守卫已定 | APPROVED 前后对照为硬门 |
| CP-10 | APPROVED 历史数据不被一刀切 | APPROVED 混合数组可解析 | APPROVED 仅 4 条，风险小 | APPROVED UNVERIFIABLE 须列出 |
| CP-11 | APPROVED 质量下限不降 | APPROVED 阳性用例属检查器契约 | APPROVED 单测面可控 | APPROVED 本条即测试角色主张 |
| CP-12 | APPROVED 真实入口不放宽 | APPROVED 运行时检查边界清楚 | APPROVED 无 src 依赖 | APPROVED SKIP 须显式，禁静默 |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260910-risk-scaled-gates` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 范围未扩散 | APPROVED 与 DEC-021 一致 | APPROVED TASK-053 ① | APPROVED TEST-055 ① |
| CP-2 | APPROVED 两列为强制 | APPROVED 取值合法性可查 | APPROVED TASK-053 ②③④ | APPROVED TEST-055 ②③④⑤ |
| CP-3 | APPROVED 无文档-only 规则 | APPROVED 无架构牵连 | APPROVED 任务均绑 TEST | APPROVED 派生矩阵按子项列行 |
| CP-4 | APPROVED 盲区逐个有主 | APPROVED 无重复实现 | APPROVED TASK-054/056/057/058 | APPROVED TEST-056..060 |
| CP-5 | APPROVED 占号前置合理 | APPROVED 字段位置一致 | APPROVED TASK-054 三错误码 | APPROVED TEST-056 ②③④ |
| CP-6 | APPROVED 证据结构升级 | APPROVED 谓词可执行 | APPROVED TASK-056 ①②③ | APPROVED TEST-057 ②③④ |
| CP-7 | APPROVED 入口不扩散 | APPROVED 单 CLI 入口保持 | APPROVED 仅加脚本别名 | APPROVED 静态审查 |
| CP-8 | APPROVED 不重复造轮子 | APPROVED 判定为不变 | APPROVED 零代码，仅文档 | APPROVED 既有回归承接 |
| CP-9 | APPROVED 17 个 CR 只增字段 | APPROVED 无架构影响 | APPROVED TASK-055 三子项 | APPROVED TEST-056 ⑤ 不变量硬门 |
| CP-10 | APPROVED 不强改历史 | APPROVED 双形态 | APPROVED TASK-056 ④ | APPROVED TEST-057 ⑤ |
| CP-11 | APPROVED 不降质量 | APPROVED 契约的一部分 | APPROVED 单测随任务交付 | APPROVED 每条检查含阳性 |
| CP-12 | APPROVED 真实入口保持 | APPROVED 运行时边界 | APPROVED TASK-057 | APPROVED TEST-058 ③ |

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260910-risk-scaled-gates` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 验收不放宽 | APPROVED 判据可测 | APPROVED 任务绑定明确 | APPROVED TEST-055 ① |
| CP-2 | APPROVED 两列强制可验 | APPROVED 取值域可断言 | APPROVED 实现边界清楚 | APPROVED TEST-055 含 4 条阳性 |
| CP-3 | APPROVED 规则必有测试 | APPROVED 无遗漏面 | APPROVED 任务可测 | APPROVED TEST-055..060 全绑定 |
| CP-4 | APPROVED 盲区闭合可验收 | APPROVED 无重复检查 | APPROVED 四任务对应 | APPROVED 五条事故回归逐一列明 |
| CP-5 | APPROVED 撞号不再可能 | APPROVED 检查点正确 | APPROVED 三错误码可测 | APPROVED TEST-056 ② 复现真实事故 |
| CP-6 | APPROVED 过期断言不再可能 | APPROVED 谓词语义明确 | APPROVED 可实现 | APPROVED TEST-057 ② 复现 g3 过期断言 |
| CP-7 | APPROVED 无入口扩散 | APPROVED 约束可静态审 | APPROVED 仅一个脚本别名 | APPROVED 静态断言 |
| CP-8 | APPROVED 范围诚实缩小 | APPROVED 既有覆盖已确认 | APPROVED 无新代码 | APPROVED 既有 verify 回归 |
| CP-9 | APPROVED 归属不变 | APPROVED 无架构风险 | APPROVED 回填可复核 | APPROVED TEST-056 ⑤ 逐字一致 |
| CP-10 | APPROVED 历史可读 | APPROVED 兼容策略明确 | APPROVED 4 条迁移 | APPROVED TEST-057 ⑤ 不阻断 |
| CP-11 | APPROVED 阳性用例是底线 | APPROVED 检查器契约 | APPROVED 单测净增可查 | APPROVED 禁止只断言退出码 |
| CP-12 | APPROVED 真实入口 | APPROVED 无桩 | APPROVED 服务器未起显式 SKIP | APPROVED TEST-058 ③ 禁静默通过 |

**R2/R3/R4 结论：四角色全部 APPROVED，无 REJECTED、无空格、无遗留 CONDITIONAL。**

## P3/P4 执行记录

- **TASK-053**：三档判据（快车道/标准/重型）与「撤回代价」三问写入 `docs/CONTROLS.md`；`AI_STANDARD` 新增 **原则 18**；新增 `governance.py check-doors`，**逐 CP** 校验「门」「发现方式」，四类阻断码 `CHECK_DOORS_MISSING_COLUMN` / `_BAD_VALUE` / `_UNDETECTABLE_TWO_WAY` / `_MISSING_ROLLBACK`。
- **TASK-054**：CR 头部新增 `- 占用 ID:` 字段（`cr_template` 同步，含七列 CP 表骨架）；新增 `check-ids`，三类阻断码 `CHECK_IDS_OVERLAP` / `_DANGLING` / `_DUPLICATE`。
- **TASK-055**：17 个既有 CR 全部回填「占用 ID」，共登记 **71 个 ID**，零重叠零悬空。**只登记本 CR 创建的 ID**，不含引用或修订的既有 ID；DEC-001..014 的创建归属无法从现有记录复原，未登记并已在字段中注明。不变量守卫通过：回填前后 `review r1..r4` 均为 8 条记录、逐字一致。
- **TASK-056**：`known_warnings` 升级为 `{text, check}`；新增 `check-warnings`，谓词 `gate_red:<gate>`（实跑该门）/ `dep_absent:<pkg>`（实查 `package.json`）/ `manual`（`reviewed_at` 超 90 天报陈旧）。迁移 5 条（4 条自由文本 + `skill-html-unsandboxed`），当前 **0 条 UNVERIFIABLE**。
- **TASK-057**：新增 `scripts/check-dev-server.mjs` + `npm run check:dev-server`。打真实运行的服务器，取首页引用的样式表并断言其含编译后的工具类与 token。退出码 **PASS=0 / FAIL=1 / SKIP=2**——服务器未运行时显式 SKIP，不伪装成通过。
- **TASK-058**：`check-specs` 改为复用 `migrate_specs.migrate_spec` 的产物比对（`SPECS_NOT_CANONICAL`），消除两套结构规则各说各话；`review r1..r4` 对无 CP 表的记录由静默跳过改为 `SKIPPED_BY_LEVEL` 点名报告，并断言其级别确为 L1，否则 `REVIEW_R1_BLOCKED`。

### 实施中发现并修掉的四个缺陷（三个是我自己的，一个是既有的）

1. **`_table_rows` 不认转义竖线**（既有潜伏缺陷）。`| CP-3 | … `check p1\|p2\|p3` … |` 被 `split("|")` 拆出额外单元格，其后每列错位——`门` 列读到了 `release`。此前无人发现，因为在此之前没有任何代码读第 2 列以后的内容。已改为只按未转义竖线切分，并留回归守卫 `test_055_6`。
2. **重复定义误判**（我的）。`TASK-044` 在「任务总览表」与「技术设计表」各一行是设计如此；扫全文件会误报。已限定到基线表（`模块任务总览` / `测试矩阵` / `架构决策`），守卫 `test_056_5`。
3. **`SystemExit` 接不住**（我的）。`migrate_spec` 对无法归类的小节抛 `SystemExit`，它不派生自 `Exception`，会直接掀掉整道门而不是报一条 finding。已显式捕获，且仅在名称检查全过后才做规范化比对，避免重复报错淹没真实违规。
4. **早退路径把静默放了回来**（我的）。当**没有任何** CR 带 CP 表时，`check_review` 在报告 `skipped`/`illegitimate` 之前就早退——等于在另一条分支上重新制造了本 CR 要除掉的静默。由 `test_060_2` / `test_060_3` 抓出并修复。

第 4 条尤其说明测试角色那两条强制要求的价值：**只测通过路径的话，这个 bug 会原样交付**。

### 新发现的既有缺陷

`check-ids` 上线后立即报出 **DEC-019 缺登记**：架构决策表有 DEC-001..018、020、021，唯独 DEC-019 只以 `### DEC-019` 小节形式存在于 ui-foundation 的变更响应节，不在基线登记表里——查决策表的人找不到它。已补入登记行并注明来源。

### 未做的事（有意）

- 不重复造 ledger 分叉检查（CP-8）：`check_ledger` 的 `LEDGER_BAD_SEQUENCE` / `_BROKEN_CHAIN` / `_HASH_MISMATCH` 已覆盖，本 CR 只补合并顺序的流程规则。
- 7 个既有 CR 的 CP 表未回填「门/发现方式」两列：它们均已 CLOSED，其门类判定无前向效力。`check-doors` **点名列出**这 7 条而非静默跳过。回填属独立变更。
- 「矩阵只填有话说的格子」（早前讨论中提出的减噪方案）未纳入本 CR——它会改变 `review r2|r3|r4` 的判定语义，超出 R1 已批准的范围。

## 验证记录

| 检查 | 结果 |
|---|---|
| 治理单测 | **67/67**（44 → 67，新增 23 条，每条新检查均含阳性用例） |
| 前端单测 | **198/198**（28 文件，新增 `tests/check-dev-server.test.ts` 4 条） |
| 类型检查 | `tsc --noEmit` 通过（新增 `scripts/check-dev-server.d.mts`） |
| UI 契约（静态） | 49 passed · 0 failed · 0 warnings · 0 skipped |
| 新增三道门 | `check-doors` / `check-ids` / `check-warnings` 全 PASS，遗留项逐条点名 |
| dev server 真实入口 | PASS（真实服务器）/ FAIL（陈旧 CSS，附根因与修法）/ SKIP=2（无服务器） |
| 既有门禁 | `verify` `check-changes` `check-specs` `ui` `g1` `g2` `g3` `g3.5` `g4` `review r1..r4` 全 PASS |
| 不变量 | 回填前后 `review r1..r4` 逐字一致（8 条记录） |
