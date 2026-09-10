# EV-2026-09-10-record-accuracy

- 采集者: claude（接手 CR-20260910-ui-foundation 交付后的独立复验）
- 时间: 2026-09-10
- 来源: 在 HEAD `abdcdf2`（工作区干净）上实跑全部门禁与测试，并逐条核对说明书与证据文件的断言
- 支撑对象: CR-20260910-record-accuracy 的 CP-1 / CP-2 / CP-3

## 复验基线（三处失准都是在这次实跑中被发现的）

| 检查 | 命令 | 结果 |
|---|---|---|
| 治理门（13 道） | `verify` `gate g1` `gate g2` `gate g3` `gate g3.5` `gate g4` `check-changes` `ui` `check-specs` `review r1..r4` | 全 PASS |
| 类型 | `npm run test:typecheck` | PASS |
| 单测 | `npx vitest run` | 194/194 |
| 治理单测 | `python -m unittest tests.test_governance` | 44/44 |
| UI 契约（静态） | `node scripts/ui-contract.mjs` | 49 passed · 0 failed · 0 warnings · 0 skipped |
| UI 契约（真实浏览器） | `node scripts/ui-contract.mjs --live` | 68 passed · 0 failed · 0 skipped，连跑 3 次结果一致 |
| 冒烟 / 构建 | `npm run test:smoke` / `npm run build:verify` | PASS |
| e2e | `npm run test:e2e` | 10/10 |

## 失准点 1（CP-1）：LV-AXE 的 known warning 已与事实相反

- 断言位置：`project/05_evidence/test-results.json` → `known_warnings[2]`
- 断言原文：`ui-contract --live LV-AXE skipped: axe-core is not a dependency; install axe-core (devDep) to enable the full automated audit.`
- 实测反证：
  - `package.json` → `devDependencies.axe-core = "4.11.0"`（CR-20260910-ui-foundation P3 引入）
  - `node scripts/ui-contract.mjs --live` → `PASS LV-AXE axe-core: no serious/critical violations`，且整层 `0 skipped`
- 判定：该 warning 描述的前提（axe-core 未安装）已不成立，留存会让读者以为自动化 a11y 审计仍是空缺。

## 失准点 2（CP-2）：g3 的 known warning 已与事实相反

- 断言位置：`project/05_evidence/test-results.json` → `known_warnings[4]`
- 断言原文：`gate g3 is intentionally red until TEST-022 (real Google login) is verified by a human and attributed in this file.`
- 实测反证：
  - 同文件中 `TEST-022` 的 `result` 为 `DEFERRED`（随 REQ-F-001 一并暂缓）
  - `python tools/governance.py gate g3` → PASS；`check_g3` 自 CR-20260909 起识别 `DEFERRED` 为不阻断
- 判定：g3 已不再为红。TEST-022 的暂缓语义由该测试条目自身的 `DEFERRED` 承载，无需也不应再由一条声称门为红的 warning 重复表达。
- 保留项：REQ-F-001 恢复 Google 登录的 CR 仍须把 TEST-022 改回 `PENDING` 并实际执行——该义务记在测试说明书的 TEST-022 条目，不依赖本 warning。

## 失准点 3（CP-3）：模块说明书批准状态段的任务编号与状态过期

- 断言位置：`project/03_modules/模块任务开发说明书.md` 第 363 行（`## 批准状态` 段）
- 断言原文：`CR-20260910-process-hardening（R3）：新增 TASK-044（--cr 作用域 + check <stage>）、TASK-045（new-cr / matrix 脚手架）、TASK-046（migrate_specs.py 迁移 + check-specs 结构自检）、TASK-047（tsconfig.json 基线归一化 + verify:all）。状态 TODO。`
- 实测反证（同一文件的任务表）：
  - 第 57–60 行：process-hardening 的四个任务实际是 **TASK-049 / TASK-050 / TASK-051 / TASK-052**，状态均为 **DONE**
  - 第 52–56 行：**TASK-044..048 现归 CR-20260910-ui-foundation**，状态均为 DONE
  - `project/06_changes/CR-20260910-process-hardening.md` 状态行记录 P3/P4 已完成
- 成因：两个 CR 在并行会话中同时起草，一度都占用 TASK-044..047，后按先到先得把 process-hardening 改号到 TASK-049..052，但 `## 批准状态` 段的这行叙述没有跟着改。
- 判定：任务表本身没有重复 ID（`TASK-044..048` 各出现两次是「任务定义表 + 技术设计表」各列一次，属设计如此）。**唯一的失准是这一行叙述**，它同时错在编号和状态两处，且因为 044..048 已被另一个 CR 实际占用，误导性比普通笔误更强。

## 边界

三处均为记录与事实的偏差，不涉及任何需求、架构裁决、接口、数据结构或测试标准的变更；对应实现代码与测试结果本身在复验中全部通过，无需改动。
