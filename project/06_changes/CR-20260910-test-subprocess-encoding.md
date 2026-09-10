# CR-20260910-test-subprocess-encoding

- 级别: L1（测试脚手架健壮性修复：断言语义、真实入口与覆盖关系全部不变；不触碰 `src/`、`scripts/`、`tools/`）
- 提出人: claude（`CR-20260910-record-accuracy` 的 P3 过程中偶遇）→ user 授权修复（2026-09-10「把 test_053_5 的编码问题也修了」）
- 状态: APPROVED（R1 人工终裁完成；R2/R3/R4 四角色全 APPROVED）；**P3/P4 完成**
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: 无
- 影响模块: 无（MOD-GOVERNANCE 的工具实现不变）
- 影响任务: 无新增任务；TASK-051 的交付物 `tools/migrate_specs.py` **不改动**
- 影响测试: TEST-053（子项「迁移幂等」）的**执行方式**修复；断言对象、命令与真实入口不变，`result` 保持 PASS
- 当前证据: `project/05_evidence/EV-2026-09-10-test-subprocess-encoding.md`
- 方案选项:
  - A. 只加 `errors="replace"`：拒绝。不再崩溃，但中文被替换成 U+FFFD，文本已损坏——把"看不懂的错误"换成"看不懂的输出"，没解决两端编码不一致这个根因。
  - B. 让 `tools/migrate_specs.py` 强制以 UTF-8 输出：拒绝。该工具在 GBK 控制台被人直接调用时中文显示正常，强制 UTF-8 会破坏交互使用；编码约定是**调用方**的责任。
  - C. 改断言，绕开 stdout（例如只断言 returncode）：拒绝。会把这条测试唯一的实质断言删掉——它存在的意义就是确认工具报告「already migrated」。
  - D. **子进程环境固定 `PYTHONIOENCODING=utf-8`（真正的修复）+ `errors="replace"`（兜底）+ 一条 `stdout is not None` 的前置断言**：已选。
- 选择理由: 复现表明父子两端对同一管道使用不同编码：子进程按本机 locale（GBK）写，父进程按 UTF-8 严格读。D 让两端就编码达成一致，因此文本正确（实测 `"�" in stdout` 为 `False`）；兜底与前置断言保证**将来任何编码不一致都表现为一条读得懂的失败**，而不是 `stdout=None` 加一个误导性的 `TypeError`。
- 回滚方式: 单文件三行改动，`git revert` 单个提交即可；回退后重跑 `verify | check-changes | review r1..r4 | gate g1..g4` 并重新 `snapshot`。无运行时回滚面。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260910-test-subprocess-encoding` 节逐一响应 CP-1/CP-2；三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: 在 EV 文件所述的确定性复现根上，修复前 `stdout is None`、修复后得到正确中文文本；`tools/migrate_specs.py` 逐字节未改；治理单测 44 全过；全量门禁无回归；基线重新 snapshot。
- 评审记录: R1 四角色独立评审见下节。**R1 人工终裁**：用户 2026-09-10「把 test_053_5 的编码问题也修了」。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 |
|---|---|---|---|---|
| CP-1 | 测试 | `test_053_5` 按 UTF-8 严格解码子进程管道，而子进程按本机 GBK 写出；一旦它打印含中文的路径，读取线程崩在后台、`stdout` 变 `None`，真实的「迁移不幂等」被掩盖成 `TypeError`。 | TEST-053 | 缺陷修复 |
| CP-2 | 模块开发 | 修复必须落在调用方（测试侧固定子进程输出编码），`tools/migrate_specs.py` 的输出编码不得改动——它在 GBK 控制台交互使用时中文显示正常。 | TASK-051 | 约束 |

（两个 CP 均由角色派生，无产品 CP。R2/R3/R4 须逐项承接 CP-1/CP-2。）

## R1 四角色审查

### 产品 owner

- 观察：不改变任何 REQ、验收标准或用户可观察行为；纯测试脚手架内部问题。
- 判断：`APPROVED`。产品基线零变化。
- 处理：确认非目标——不得借修复之机调整 TEST-053 的覆盖范围或断言强度。

### 架构角色

- 观察：不触及任何 DEC、依赖、构建链路与数据结构。唯一带架构意味的判断是"编码约定归调用方"，这与 CP-2 一致，且不改变 MOD-GOVERNANCE 的对外行为。
- 判断：`APPROVED`。
- 处理：架构说明书以 `变更响应` 节如实记录"本 CR 无架构变化点"，保持 CP 链在架构层可追溯。

### 模块开发角色

- 观察：CP-2 落在本层的约束面。`tools/migrate_specs.py` 是 TASK-051 的交付物，已 DONE 且被 TEST-051/053/054 守卫；改它的输出编码会波及交互使用与其它调用方。
- 判断：`APPROVED`，条件：**工具文件逐字节不变**，P3 须以 `git diff --stat` 证明。
- 处理：该条件转为 P3 出口义务。

### 测试角色

- 观察：CP-1 落在本层。当前失败模式的危险之处不是"会崩"，而是**崩得不像真正的原因**——`returncode` 仍是 0，第一现场是 `TypeError`。
- 判断：`APPROVED`，附两项要求：① 修复必须在 EV 所述复现根上验证"修复前 `stdout is None` / 修复后文本正确"，不能只跑一遍已迁移的仓库（那条路径是纯 ASCII，根本不触发）；② 必须留一条 `stdout is not None` 的前置断言，使将来任何编码不一致都先报出一条读得懂的失败。
- 处理：两项均转为 P3 出口义务。

## R1 人工终裁

用户 2026-09-10：「把 test_053_5 的编码问题也修了」——授权按 L1 修复。四角色无 REJECTED；模块与测试角色的条件均已转为 P3 出口义务，无遗留 CONDITIONAL。

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260910-test-subprocess-encoding` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 无产品面影响 | APPROVED 不触及任何 DEC | APPROVED 不改工具实现 | APPROVED 本层修复对象 |
| CP-2 | APPROVED 无需求牵连 | APPROVED 编码约定归调用方 | APPROVED 工具逐字节不变 | APPROVED 修复落在测试侧 |

**R2 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。**

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260910-test-subprocess-encoding` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 范围锁定 | APPROVED 无构建链变化 | APPROVED 不落本层 | APPROVED 由测试层执行 |
| CP-2 | APPROVED 无需求牵连 | APPROVED 无对外行为变化 | APPROVED TASK-051 交付物不动 | APPROVED 以 diff 为凭 |

**R3 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。**

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260910-test-subprocess-encoding` 节。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 不放宽验收 | APPROVED 无裁决牵连 | APPROVED 无任务牵连 | APPROVED 复现根上前后对照为凭 |
| CP-2 | APPROVED 范围锁定 | APPROVED 约定归调用方 | APPROVED 工具不改 | APPROVED 断言语义零改动 |

**R4 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。**

### P3 出口义务清单

1. 在 EV 所述的确定性复现根（子进程会打印含中文的路径）上验证：修复前 `stdout is None`，修复后得到正确中文文本且不含 U+FFFD。仅跑已迁移的仓库不算数——那条路径是纯 ASCII，不触发缺陷。（测试角色 R1 要求 ①）
2. 保留一条 `stdout is not None` 的前置断言，使将来任何编码不一致先报出一条读得懂的失败。（测试角色 R1 要求 ②）
3. `tools/migrate_specs.py` 逐字节不变，以 `git diff --stat` 证明。（模块角色 R1 条件）
4. TEST-053 的 `result` 保持 `PASS`，断言对象与命令不变。

## P3/P4 执行记录

- **CP-1**：`tests/test_governance.py::test_053_5` 的 `subprocess.run` 增加 ① `env` 中固定 `PYTHONIOENCODING=utf-8`（令父子两端就管道编码达成一致，这是根因修复）② `errors="replace"`（兜底：任何其它编码不一致降级为可读替换字符，而非 `stdout=None`）③ `assertIsNotNone(result.stdout, result.stderr)` 前置断言。
- **CP-2**：`tools/migrate_specs.py` 未改动，`git diff --stat` 无该文件。
- **未做的事**（有意）：不改工具输出编码；不改 TEST-053 的断言对象、命令或覆盖；不触碰 `src/`、`scripts/`、`tools/`；其余 43 条治理单测不动。
- **验证**：见下「验证记录」。基线已重新 snapshot。

## 验证记录

| 检查 | 结果 |
|---|---|
| 出口义务 1（复现根前后对照） | 修复前 `returncode=0` 但 `stdout is None`；修复后 `stdout = "[dry-run] rewrote project/04_tests/测试说明书.md"`，`"�" in stdout` 为 `False` |
| 出口义务 2（前置断言） | 已加 `assertIsNotNone(result.stdout, result.stderr)` |
| 出口义务 3（工具不变） | `git diff --stat` 不含 `tools/migrate_specs.py` |
| 出口义务 4（TEST-053 不变） | `result` 仍为 `PASS`，断言对象与命令未改 |
| 治理单测 | `python -m unittest tests.test_governance` → 44/44 |
| 门禁全量 | `verify` `check-specs` `check-changes` `gate g1|g2|g3|g3.5|g4` `ui` `review r1|r2|r3|r4` `check p3` 全 PASS |

`src/` 零改动，故 vitest / e2e / smoke / build:verify 不重跑——同一份代码已在本会话内实跑通过（194 vitest、10 e2e、smoke、build:verify、49 静态契约、68 live 契约）。
