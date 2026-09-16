# CR-20260915-process-hardening-flow

- 级别: L2（五个 CP 全为双向门：新增的检查删掉即回到今天的行为，两处字节修复 `git revert` 即退。没有 schema、没有迁移、没有不可逆动作）
- 提出人: 助手 2026-09-15，用户要求「先分析需求与变更点」「优化这个 AI coding 流程脚本，补救仅是其次」后，按三个只读审计的证据起草
- 状态: R1 待人工终裁
- 占用 ID: DEC-330, DEC-331, DEC-332, TASK-430, TASK-431, TASK-432, TASK-433, TASK-434, TEST-430, TEST-431, TEST-432, TEST-433, TEST-434, TEST-435
- 评审模型: 快车道（DEC-021 ①：五个 CP 全为双向门，且每个 CP 的发现方式都是一条机器检查）
- 影响需求: 无（流程控制，不覆盖产品需求——与 DEC-270/DEC-300 同类）
- 影响模块: MOD-GOVERNANCE（`tools/governance.py`、`tests/test_governance.py`）；新增脚本 `scripts/check-module-graph.mjs`、`scripts/gen-index.mjs`；新增测试 `tests/module-graph.test.ts`；`src/lib/sweep.ts`、`tests/sweep.test.ts` 各一处字节级修复
- 影响任务: **新增** TASK-430..435
- 影响测试: **新增** TEST-430..435
- 当前证据: `project/05_evidence/EV-2026-09-15-process-hardening-flow.md`
- 方案选项:
  - A. 逐条手工修复今天发现的具体缺陷（巡检间隔改不了、展示屏遮挡、27 条 UI 缺口……），不动检查本身——否决。用户原话「为什么项目流程的脚本没有发现？关键是优化这个 AI coding 流程脚本，补救仅是其次」：只补现象，下一个同形状的缺陷仍然会被判定为「已覆盖」放行。
  - B. **把「为什么没发现」的六个机制逐一做成检查**（选中）：不去猜哪句话该不该判成 UI，而是让 CP 自己声明、检查只核对声明是否兑现；不去猜命令能不能跑，直接解析给出结论；不去猜文件里有没有裸字节，扫描给出结论。
  - C. 引入第三方静态分析（madge 判环、ESLint 自定义规则判分层）——否决。这类工具能做 B 方案的一部分，但新增运行时依赖本项目按 L3 处理，而 B 方案零依赖版本（正则扫描）已经把三份只读审计验证过的具体案例全部盖住，犯不上为通用化再引入依赖与其学习成本。
- 选择理由: 选 B。①**对症**：七条根因（见「问题陈述」）逐条对应一条新检查或一处修复，不是泛泛的「加强测试」；②**用证据校准，不用直觉**——`check-ui-route` 的关键词法先被证伪（45 命中 18 误伤，40% 假阳性），才改成作者自声明 + 机器核验；`check-test-commands` 的解析规则被自己的第一版逼着从「必须指向文件」放宽成「script 名字存在即可」，因为 `test:e2e` 这类合法入口第一版会被错杀；③**零新增依赖**：全部用已有的正则解析风格（`table_cells`、`extract_ids`）与一次 `git ls-files --eol` 子进程调用；④**今天全部检查在真实仓库上都是绿的**（除等待合并的两处历史修复），新规则从今天起对新内容生效，不去追溯改写已关闭的历史记录。
- 回滚方式: `git revert` 本 CR 的提交。六条新检查从 `STAGE_GATES` 与 CLI 里消失，`tools/governance.py`/`tests/test_governance.py` 回到改前内容；`sweep.ts`/`sweep.test.ts` 的字节修复独立可revert（若单独回滚，`check-hygiene` 会重新报出这两个文件，如实反映）。无数据、无迁移。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵；三层说明书各含 `变更响应 · CR-20260915-process-hardening-flow` 节逐 CP 落点。
  - P3/P4: TASK-430..435 全部 DONE；TEST-430..435 全部 PASS；`npm run verify:all`、`python -m pytest tests/test_governance.py`、`python tools/governance.py check release` 全绿。
  - 六条新检查在真实仓库上必须先展示「改前能抓到什么」——`check-hygiene` 改前能抓到 `sweep.ts`/`sweep.test.ts` 的字面 NUL；`check-test-commands` 改前能抓到 5 条已知破损命令；`check-ui-route`/`check-index`/`check-module-graph` 各有一次构造违规输入、确认先红后绿的记录（证据文件 §3）。
- 评审记录: 标准档。R1 四角色独立评审后由用户终裁；R2/R3/R4 按 CP 表逐格裁决。用户「全实现，按你建议的顺序全实现」总授权，本 CR 属该顺序的第一条。
- R1 终裁: 已完成 | 用户 | 2026-09-15

## 问题陈述

用户在这轮反馈里连续撞到两个「测试全绿、门禁全过，问题仍在」的例子：定时巡检的间隔改不了（`CR-20260911-scheduled-sweep` CP-1）、展开对话框时展示屏被整幅遮挡（`CR-20260914-settings-on-display` CP-4）。三份只读审计（CP 发现方式分层、需求↔测试↔文件索引、依赖图与源码卫生）把「为什么没发现」拆成七条根因：

| # | 根因 | 量化证据 |
|---|---|---|
| R1 | 机器检查可以指向一条用户走不到的路径（路由/单元层），CP 一句话说的是界面 | 关键词命中 45 行，人工复核后 27 行确属误判（`scheduled-sweep` CP-1、`settings-on-display` CP-4 都在其中） |
| R2 | 验收句子（"仍整幅可见"）与断言（style 里引用了某个 CSS 变量）不同形 | 同上 27 行的共同形状 |
| R3 | CP 不点名 TEST id 时，任一兄弟测试通过即抵扣该路线 | 352 行 CP 中 **103 行（37%）**未点名任何 TEST |
| R4 | 用户口头提的问题没有落 INPUT，收口时没人回头核对 | `需求输入.md` 28 条里不含「巡检间隔改不了」 |
| R5 | TEST 的「命令」列本身指不到任何脚本或文件 | 5 条命令列坏（TEST-037/065/066/070/072），REQ-NF-011 靠的两条全在此列 |
| R6 | TEST 编号点对了，命令却早已漂移到别处 | `TEST-011` 的命令列指 `test:floating-chat`，真实断言在 `provider-routes.test.ts` |
| R7 | CP 行写「真实入口」，但所属 CR 头部没有登记结果的地方 | 机器口径下 **43 条**（人工审计口径 25 条，差额主要是 `CR-20260910-agent-tooling` 一类老 CR——只在验收条件散文里提过「真实入口冒烟」，从未写成 `- 真实入口:` 行，人工读的时候容易看漏） |

统一的病灶：**治理层验证的是自述之间是否自洽（编号存在、结果自称 PASS），从未验证自述本身是否属实（编号背后的文件是否真的做了它声称的事）。** 下面五个 CP 分别在这条链上补一次「真的打开文件核对」；R4（口头反馈没有 INPUT 编号）不是代码缺口，不进 CP 表，处置见文末「流程纪律更新」。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 模块 | **源码字节卫生**：`check-hygiene` 扫 `src/tests/scripts/tools` 下的字面控制字符、UTF-8 BOM、`git ls-files --eol` 脱管；`sweep.ts`/`tests/sweep.test.ts` 的字面 NUL 改为转义写法 | DEC-330, TASK-430 | 缺陷修复 | 双向 | 机器：TEST-430（改前对两个已知文件报 FAIL，改后全绿；构造夹具验证控制字符/BOM/跳过资料库三种情形） |
| CP-2 | 架构 | **模块依赖图**：`check-module-graph`（`scripts/check-module-graph.mjs` + `tests/module-graph.test.ts`）验 `src/lib` 无环（含 type-only 边）、`lib→tools` 不超出已知 13 条例外、`components` 到不了任何服务端模块（排除 type-only） | DEC-330, TASK-431 | 新增 | 双向 | 机器：TEST-431（真实仓库 0 环 0 越界；构造成环/跨层/type-only 三组夹具验证方向不反） |
| CP-3 | 模块 | **自述可核，不止自洽**（一）：`check-test-commands` 解析「命令」列，必须指向真实文件或已注册 script；`check_real_entry` 增 `REAL_ENTRY_CLAIM_UNREGISTERED`——CP 自称「真实入口」而 CR 头部没有登记行时计入 advisory | DEC-331, TASK-432 | 新增 | 双向 | 机器：TEST-432（改前抓到 5 条已知破损命令，改后全绿）、TEST-433（真实仓库报出 advisory；构造「有登记/无登记」两组夹具验证方向） |
| CP-4 | 产品 | **自述可核，不止自洽**（二）：CP 的发现方式写 `机器（UI）：TEST-xxx` 即声明该路线断言了用户可见/可操作的行为；`check-ui-route` 打开点名的文件核对确有 `fireEvent`/`userEvent`/`page.click` 一类调用，标记本身不靠关键词猜 | DEC-331, TASK-433 | 新增 | 双向 | 机器：TEST-434（真实仓库 0 处标记必过；构造真 UI/假 UI/未点名/未打标四组夹具验证判定方向） |
| CP-5 | 模块 | **生成式索引**：`scripts/gen-index.mjs` 产出 `docs/INDEX.md`（需求↔测试↔文件、测试入口分层、模块↔目录半自动映射）；`check-index` 比对已提交内容与重新生成的内容一致；`测试说明书.md` 里 5 条破损命令列与 `TEST-011` 的漂移一并修正 | DEC-332, TASK-434 | 新增 | 双向 | 机器：TEST-435（先手改一个字符验证能抓到不一致，复原后 PASS） |

## 风险登记

1. **R7 的机器口径（43）大于人工审计口径（25）**——已在「问题陈述」说明差额来源（`CR-20260910-agent-tooling` 一类老 CR 从未写过 `- 真实入口:` 行）。这不是检查的 bug，是人工审计在大规模老 CR 上的正常遗漏，机器口径更可信，予以采纳。
2. **`check-ui-route`/`check-index`/`check-module-graph` 今天在真实仓库上都是零覆盖或零违规起步**——新规则不追溯改写历史，27 条已知 UI 缺口中的具体修复归其自然归属的后续 CR（CR-A/CR-B 顺路补 UI 测试）；5 条破损命令的修复已含在本 CR CP-5。

## 流程纪律更新（非变化点，说明性）

两条写进 `CLAUDE.md`/`docs/WORKFLOW.md`/`docs/CONTROLS.md` 的纪律，对应 R4：口头反馈没有留下可回查的记录，不是代码缺口，机器管不住「有没有照做」，如实归入文档而不硬造一个门禁去测「人有没有守规矩」。

1. **用户口头反馈先落 `需求输入.md` 的 INPUT 编号，再动手**——哪怕当场就能改。这条本身就是这次事故的直接教训：巡检间隔改不了这件事，用户之前提过，但没有 INPUT 编号，收口时没人回头核对。
2. **触达 UI 的 CR 收口前列出真实入口的操作步骤清单**——`docs/WORKFLOW.md` 补一节最小格式：路径、步骤、期望结果。
3. **`docs/CONTROLS.md` 补 `机器（UI）` 标记的书写约定**，与 CP-4 的机制对应。
