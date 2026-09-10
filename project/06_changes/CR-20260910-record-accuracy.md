# CR-20260910-record-accuracy

- 级别: L1（记录准确性修正：不改变需求、架构裁决、接口、数据结构或测试标准；不触碰 `src/`、`scripts/`、`tools/`）
- 提出人: claude（CR-20260910-ui-foundation 交付后的独立复验中发现）→ user 授权修复（2026-09-10「要的。修掉。」）
- 状态: APPROVED（R1 人工终裁完成；R2/R3/R4 四角色全 APPROVED）；**P3/P4 完成**
- 占用 ID: 无（仅修正既有记录，未创建 ID） （由 CR-20260910-risk-scaled-gates 回填，只登记本 CR **创建**的 ID，不含其引用或修订的既有 ID；DEC-001..014 的创建归属无法从现有记录复原，故未登记。）
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: 无（REQ-F-001 / REQ-NF-002 的 DEFERRED 语义不变）
- 影响模块: 无（MOD-* 边界与职责不变）
- 影响任务: 无新增任务；仅修正 `## 批准状态` 段对 TASK-049..052 的既有叙述
- 影响测试: 无新增或改写测试；仅移除 `test-results.json` 中两条与事实相反的 `known_warnings`，TEST-* 条目的 `result` 一律不动
- 当前证据: `project/05_evidence/EV-2026-09-10-record-accuracy.md`
- 方案选项:
  - A. 不修，等下一个功能 CR 顺手带走：拒绝。两条 known warning 与一行任务叙述都是**现在时的错误断言**，读者（含未来的角色 Agent）会据此做判断；且 TASK-044..048 已被另一个 CR 实际占用，误导性会随时间放大。
  - B. 直接改文件、不走 CR：拒绝。三处都在受控文件里，绕过 `06_changes` 与 `snapshot` 会让基线与账本失去对应关系。
  - C. **开 L1 CR，逐条修正到与实测一致，并按 CP 链走完 R1–R4 与 G3/G3.5/G4**：已选。
- 选择理由: 三处偏差都有可复现的实测反证（见 EV 文件），不是风格偏好。选 C 而非"L1 就不必登记 CP"，是因为 `review r1..r4` 对**没有 `## 变化点登记` 表的 CR 是静默跳过**的——CR-20260910-ui-foundation 刚刚认定"静默降级成 SKIP 比 FAIL 更危险"，本 CR 不给自己开这个口子。
- 回滚方式: 三处修改均为纯文本，`git revert` 单个提交即可整体回退；回退后重跑 `verify | check-changes | review r1..r4 | gate g1..g4` 并重新 `snapshot`。无运行时回滚面。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260910-record-accuracy` 节逐一响应 CP-1..CP-3；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: 三处断言与实测一致；`gate g3` 在移除 g3 相关 warning 后仍 PASS（证明该 warning 不是 g3 通过的前提）；全量门禁与既有测试无回归；基线重新 snapshot。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审见下节。**R1 人工终裁**：用户 2026-09-10「要的。修掉。」

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 |
|---|---|---|---|---|
| CP-1 | 测试 | `test-results.json` 的 `known_warnings` 仍称 LV-AXE 因 axe-core 未安装而 SKIP，而 axe-core 4.11.0 已是 devDep 且该规则实测 PASS。 | TEST-047, TEST-050 | 缺陷修复 |
| CP-2 | 测试 | 同一 `known_warnings` 仍称 g3 因 TEST-022 故意为红，而 TEST-022 已 `DEFERRED`、`gate g3` 实测 PASS。 | TEST-022 | 缺陷修复 |
| CP-3 | 模块开发 | 模块说明书 `## 批准状态` 段仍称 process-hardening 新增 TASK-044..047 且状态 TODO，实际为 TASK-049..052 且全部 DONE，而 TASK-044..048 已归 CR-20260910-ui-foundation。 | TASK-049, TASK-050, TASK-051, TASK-052 | 缺陷修复 |

（三个 CP 均由角色在复验中派生，无产品 CP——本 CR 不引入任何产品意图变化。R2/R3/R4 须逐项承接 CP-1..CP-3。）

## R1 四角色审查

### 产品 owner

- 观察：三处修正都不改变任何 REQ 的意图、验收标准或状态；REQ-F-001 / REQ-NF-002 的 DEFERRED 不受影响。
- 判断：`APPROVED`。产品基线零变化，本 CR 不需要产品重定义。
- 处理：确认非目标——不得借记录修正之机调整任何需求文字或验收标准。

### 架构角色

- 观察：不涉及任何 DEC 的新增、修订或废止；不触碰依赖、构建链路、数据结构与 API。
- 判断：`APPROVED`。架构裁决面为空。
- 处理：架构说明书以 `变更响应` 节如实记录"本 CR 无架构变化点"，而不是不写——保持 CP 链在架构层的可追溯性。

### 模块开发角色

- 观察：CP-3 落在本层。任务表（第 52–60 行）本身是正确的，错的只有 `## 批准状态` 段的一行叙述，同时错在编号与状态。
- 判断：`APPROVED`。修正范围可精确界定为一行，无实现代码牵连。
- 处理：**只改这一行**，不重编号、不动任何 TASK 的定义或状态字段——重编号会波及两个已 APPROVED 的评审矩阵，属 L2 以上。

### 测试角色

- 观察：CP-1 / CP-2 落在本层。两条都在 `known_warnings`（非 `tests` 数组），移除它们不改变任何 TEST 条目的 `result`。
- 判断：`APPROVED`，附一项必须执行的验证：CP-2 移除的是一条声称"g3 为红"的 warning，必须在移除后实跑 `gate g3` 证明其仍 PASS，否则等于用删记录的方式掩盖一个真实的红门。
- 处理：该验证写入 P3 出口义务；TEST-022 的暂缓义务由其自身 `DEFERRED` 条目承载，不因 warning 移除而消失。

## R1 人工终裁

用户 2026-09-10：「要的。修掉。」——授权按 L1 修正三处记录失准。四角色无 REJECTED、无遗留 CONDITIONAL（测试角色的附加验证已转为 P3 出口义务，非阻塞条件）。

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260910-record-accuracy` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 无产品面影响 | APPROVED 不触及任何 DEC | APPROVED 无模块边界变化 | APPROVED 证据文件本层修正 |
| CP-2 | APPROVED REQ-F-001 DEFERRED 不变 | APPROVED 无信任/权限面变化 | APPROVED 无实现牵连 | APPROVED g3 语义由 DEFERRED 承载 |
| CP-3 | APPROVED 无需求牵连 | APPROVED 无架构裁决牵连 | APPROVED 本层修正对象 | APPROVED 不改任何 TEST 定义 |

**R2 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。**

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260910-record-accuracy` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 范围锁定 | APPROVED 无依赖变化 | APPROVED 不落本层 | APPROVED 由测试层执行 |
| CP-2 | APPROVED 范围锁定 | APPROVED 无门禁模型变化 | APPROVED 不落本层 | APPROVED 由测试层执行 |
| CP-3 | APPROVED 叙述与表一致即可 | APPROVED 编号归属可追溯 | APPROVED 单行修正、不重编号 | APPROVED 不影响 TEST-051..054 |

**R3 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。**

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260910-record-accuracy` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 不放宽验收 | APPROVED 无构建链变化 | APPROVED 无任务牵连 | APPROVED LV-AXE 实测 PASS 为凭 |
| CP-2 | APPROVED 暂缓义务不丢 | APPROVED 无权限面变化 | APPROVED 无任务牵连 | APPROVED 移除后须实跑 g3 |
| CP-3 | APPROVED 无需求牵连 | APPROVED 无裁决牵连 | APPROVED 与任务表一致 | APPROVED TEST-* 定义零改动 |

**R4 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。**

### P3 出口义务清单

1. 移除 g3 相关 known warning **之后**实跑 `python tools/governance.py gate g3`，必须 PASS——证明该 warning 不是 g3 通过的前提（测试角色 R1 附加要求）。
2. 移除 LV-AXE warning 之后实跑 `node scripts/ui-contract.mjs --live`，LV-AXE 必须为 PASS 且该层 `0 skipped`。
3. 修正后的 `## 批准状态` 叙述必须与同文件任务表（TASK-049..052 / DONE）逐字一致。
4. `TEST-022` 的 `result` 保持 `DEFERRED`，不得因移除 warning 而改动。

## P3/P4 执行记录

- **CP-1**：删除 `known_warnings` 中 LV-AXE 的 SKIP 说明。复核 `package.json` → `devDependencies.axe-core = 4.11.0`；`ui-contract --live` → `PASS LV-AXE axe-core: no serious/critical violations`，整层 68 passed · 0 failed · 0 skipped。
- **CP-2**：删除 `known_warnings` 中"g3 故意为红"的说明。**移除后实跑 `gate g3` → PASS**（出口义务 1 已履行）；`TEST-022` 的 `result` 仍为 `DEFERRED`（出口义务 4 已履行）。
- **CP-3**：`模块任务开发说明书.md` `## 批准状态` 段该行改为 TASK-049..052 + 状态 DONE，并显式注明 TASK-044..048 归 CR-20260910-ui-foundation；与任务表第 57–60 行逐项核对一致（出口义务 3 已履行）。
- **未做的事**（有意）：不重编号任何 TASK；不改动任何 TEST 条目的 `result`；不触碰 `src/`、`scripts/`、`tools/`；`.data/` 下的历史 e2e/smoke 残留不在本 CR 范围内。
- **验证**：见本文件末「验证记录」。基线已重新 snapshot。

### P3 过程中发现并处理的一件事

三层 `变更响应` 节最初被插在各文件 `## 批准状态` 的正上方。`check-specs` 与 `review r2|r3|r4` 都放行，但 `tools/migrate_specs.py --dry-run` 判定需要重写——规范结构要求全部 `## 变更响应 · …` 节连续排在评审段之前，而不是紧贴 `## 批准状态`。已按该工具的规范排布重新落位（实测：三份文件各 10 行整段搬移，排序后内容逐字相同，无其他改动），之后 `--dry-run` 报 `already migrated`，治理单测恢复 44 全过。

**顺带暴露一个既有的测试脆弱点（未修，属独立变更）**：`tests/test_governance.py::test_053_5` 用 `subprocess.run(..., encoding="utf-8")` 收 `migrate_specs.py` 的输出，但该子进程在本机控制台按 GBK 输出；一旦它打印含中文的文件名（即"需要迁移"时），读取线程抛 `UnicodeDecodeError`、`stdout` 变成 `None`，断言随之报 `TypeError: argument of type 'NoneType'`——真实失败原因被掩盖成一个无关的类型错误。建议后续变更给该子进程显式指定编码或 `errors="replace"`。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 出口义务 1（移除 warning 后 g3 仍绿） | `python tools/governance.py gate g3` | **PASS** —— 输出显式列出 `deferred, tracked by their CR: TEST-022`，即暂缓语义由门自身承载 |
| 出口义务 2（LV-AXE 实测） | `node scripts/ui-contract.mjs --live` | **PASS LV-AXE**，整层 68 passed · 0 failed · 0 skipped |
| 出口义务 3（叙述与任务表一致） | 逐项核对第 57–60 行 | TASK-049..052 / DONE，一致 |
| 出口义务 4（TEST-022 不动） | 读 `test-results.json` | `DEFERRED`，未改动 |
| 结构自检 | `python tools/governance.py check-specs` / `migrate_specs.py --dry-run` | PASS / `already migrated` |
| 治理单测 | `python -m unittest tests.test_governance` | 44/44 |
| 门禁全量 | `check-changes` `gate g1|g2|g3|g3.5|g4` `ui` `review r1|r2|r3|r4` | 全 PASS；`review r3` 报 **6 change record(s)**（含本 CR，未被静默跳过） |
| UI 契约（静态） | `node scripts/ui-contract.mjs` | 49 passed · 0 failed · 0 warnings · 0 skipped |

`src/`、`scripts/`、`tools/`、`tests/` 零改动，故 vitest / e2e / smoke / build:verify 不重跑——同一份代码已在本会话内实跑通过（194 vitest、10 e2e、smoke、build:verify、68 live 契约），记录见 `EV-2026-09-10-record-accuracy.md`。

