# CR-20260909-consensus-review-gates

- 级别: L3（改变治理模型 / 门禁基线本身）
- 提出人: user（"门控制改为：需求&产品说明书评审，模块开发说明书评审，测试评审…每个环节评审都需要角色参与，并达成一致方可通过" → 多轮精化 → "好的。执行。"）
- 状态: APPROVED
- 影响需求: 无（不动产品需求；改的是流程控制）
- 影响模块: 无（不动 `src/`）
- 影响任务: 新增 TASK-032（治理工具：`review` 子命令 + CP 登记/评审矩阵解析）
- 影响测试: 新增 TEST-033（`governance.py review` 单元测试）
- 当前证据: `project/05_evidence/EV-2026-09-09-consensus-review-gates.md`（模型讨论与决策链）
- 方案选项:
  - A. 保持 6 门机器模型（g0/g1/g2/g3/g3.5/g4）不变
  - B. 三门共识模型（需求 / 模块 / 测试），全共识
  - C. **四设计共识门（R1 人工 + R2/R3/R4 机器）+ 保留 g3/g3.5/g4 证据门 + CP 全覆盖链 + 角色常驻清单 + ReAct 角色 Agent**
- 选择理由: 选 C。B 漏了架构层且用"共识"替代机器检查（一人扮多角色时共识会退化成橡皮图章——用户早先亲自反对过）。C 把"多角色立场化评审 + 变化点矩阵"（本会话已手搓多轮）**形式化并机器强制**：① 每层必须逐一响应上层每个变化点（CP），机器查覆盖；② 评审矩阵 = CP × 全部 4 角色，无 REJECTED 无空即过，CONDITIONAL 带条件并汇入出口义务；③ 角色带常驻关切清单（进 AI_STANDARD §8）逐条核别层方案；④ 角色 Agent 用 ReAct + 4 护栏（客观终止 / 有界工具 / CP 检查前置 / 结构化裁决）；⑤ R1 唯一人工——角色出意见、人拍板；⑥ 机器检查（verify/check-changes/g1 结构项）保留为评审前置。
- 回滚方式: 还原 `docs/WORKFLOW.md`、`docs/CONTROLS.md`、`docs/AI_STANDARD.md`（删 §8 与原则 17）、`tools/governance.py`（删 `check_review` + `review` 子命令 + CP 解析函数，恢复 `build_parser`/`run`）、`tests/test_governance.py`（删 review 用例）、删 `EV-2026-09-09-consensus-review-gates.md`、`test-results.json` 去 TEST-033、9 个旧 CR 去掉"reviewed under pre-R1234 model"行。无 schema / API / 依赖变更。重跑 `verify|gate g1|gate g2|check-changes|ui` 并重新 `snapshot`。
- 验收条件:
  - `python tools/governance.py review r1|r2|r3|r4` 可执行；无 CR 采用 CP 登记格式时四者均 `OK`（空过）。
  - `governance.py review r2` 对一个含 `## 变化点登记` 表的 CR：CP 未在架构说明书对应 `CR-<name>` 节被引用 → 报 `COVERAGE_GAP`；CR 缺 `## R2 评审矩阵` 或矩阵有 REJECTED / 空格 / 无条件的 CONDITIONAL → 报 `MATRIX_INVALID`。r3/r4 同理对模块/测试层。
  - `python -m unittest tests.test_governance` 通过（含新增 TEST-033 的 review 用例）。
  - `docs/AI_STANDARD.md` 新增 §8「角色常驻关切清单」（4 角色）+ 原则 17「共识门禁原则」。
  - `docs/WORKFLOW.md` / `docs/CONTROLS.md` 门禁表更新为 R1–R4 + G3/G3.5/G4。
  - 本 CR 走**旧模型**（现 g1-g4 + verify + check-changes + ui 全 PASS）；新模型从下一个 CR 起生效。
  - 9 个既有 CR 各加一行「reviewed under pre-R1234 model」，不追溯改造。
- 评审记录: 本 CR 为旧模型下最后一个 CR，走 g1-g4；R1「定义新治理模型」在本对话进行——用户逐轮精化并拍板「执行」。
  - 产品 owner：不动任何产品需求；改的是流程控制层。R1 的"清晰明确需求定义"模板（CP 清单 + 逐条验收 + 非目标 + 用户确认痕迹）强化了原则 3/15。结论：APPROVED。
  - 架构角色：`review` 子命令纯读 + 正则解析 CR/说明书的 markdown 表，无 schema/IO 副作用；CP 表格式复用现有 ID 提取机制；`gate` 命令面保留（g3/g3.5/g4 不变），`review` 并列新增。反馈日志 `CR-xxx.feedback.jsonl` 与 CR 正文分离、保持可读。结论：APPROVED。
  - 模块开发角色：TASK-032 单一职责（治理工具），绑定 TEST-033；`governance.py` 改动集中在新增函数 + `build_parser`/`run` 两处派发点。结论：APPROVED。
  - 测试角色：TEST-033 用临时目录构造"含 CP 表的 CR + 对应/缺失响应"两种 fixture，断言 `COVERAGE_GAP` / `MATRIX_INVALID` / `OK` 三态，符合原则 12（`review` 是真实入口）。结论：APPROVED。
  - 用户（R1 终裁）：2026-09-09 逐轮精化 A–I 并「执行」。

## 背景

本会话连续起了 5 个 CR，每个都手搓"立场化多角色评审 + 变化点矩阵"，但 `governance.py` 从不强制"四角色评审过并一致""每个变化点在每层都有响应"。用户要求把这套形式化为硬门禁 + 反馈闭环。

## 新治理模型（权威定义见 `docs/WORKFLOW.md` / `docs/CONTROLS.md` / `docs/AI_STANDARD.md §8`）

### 门禁全景

```
P0 ─G0─> P1 ─[R1 需求评审·人工终止]─> P2 ─[R2 架构评审][R3 模块评审][R4 测试评审·机器终止]─> P3 ─G3─> P4 ─G3.5─> P5 ─G4─> P6
```

| 门 | 类型 | 负责人（反馈回给） | 通过条件 |
|---|---|---|---|
| R1 需求评审 | 人工终止 | 产品 owner | 产品/架构/模块开发/测试角色 Agent 出意见 → 人拍板；CR 有 `## 变化点登记` 表 + R1 拍板痕迹（修正 1，见文末）|
| R2 架构评审 | 机器终止 | 架构角色 | 全部 CP 在架构说明书 `CR-<name>` 节被引用（覆盖）+ CR 有 `## R2 评审矩阵`（CP × 4 角色，无 REJECTED、无空、CONDITIONAL 带条件）|
| R3 模块评审 | 机器终止 | 模块开发角色 | 同 R2，对模块层 |
| R4 测试评审 | 机器终止 | 测试角色 | 同 R2，对测试层 |
| G3 实施证据 | 机器 | 模块开发角色 | `test-results.json` 全 PASS（DEFERRED 除外，见 CONTROLS 例外）|
| G3.5 真实入口 | 机器 | 测试角色 | 有 `real_entry:true` 的 PASS |
| G4 发布 | 机器 | 发布 owner | 发布说明书含"回滚" |

保留：`verify`（基线+台账）、`check-changes`（CR 13 标签）、`ui`。

### 变化点（CP）链

CR 内 `## 变化点登记` markdown 表：`| CP | 来源角色 | 一句话 | 关联 ID | 类型 |`。
- 产品 CP：R1 时产品 owner + 角色 Agent 产出。
- 角色 CP（来源角色 ≠ 产品）：任何角色任何门可派生，追加进**同一张表**。
- `review r2` 检查 `{全部 CP} ⊆ {架构说明书 CR-<name> 节引用的 CP}`；r3（→模块）、r4（→测试）同理。任何 CP 在任何层"消失" → 门不过 → 反馈本层负责人。

### 评审矩阵

R2/R3/R4 每门在 CR 内一张 `## R{2,3,4} 评审矩阵`：行 = 全部 CP，列 = 产品/架构/模块/测试**全部 4 角色**，格 = `裁决 + ReAct 证据引用`。
- 通过：无 `REJECTED` + 无空格 + 每个 `CONDITIONAL` 带条件文本。
- `CONDITIONAL` 条件 → "出口义务清单"，P3 实现前清零。
- 任一 `REJECTED` → 反馈本层负责人 → 改 → 重审。

### 角色常驻关切清单

`AI_STANDARD.md §8`，每角色一张，每条追溯到本职说明书职责或某原则。评审别层时逐条核。P6 复盘发现漏检 → 加条目（原则 7）。

### 角色 Agent = ReAct + 4 护栏

客观终止（机器 PASS 或 **3 轮**→升级人）· 有界工具（读说明书/读 src/grep/跑 governance.py/跑测试/追加评审表+反馈日志）· CP 检查前置（先机器跑覆盖，不过则直接弹回负责人）· 结构化裁决 `{角色, 轮次, 裁决, 条件[], 证据引用[]}`。
形态：默认一个 Agent 顺序换视角；**L3 变更**才 spawn 独立子 Agent。反馈日志：`project/06_changes/CR-<name>.feedback.jsonl`。

### 存量

新模型从**下一个 CR** 起生效。9 个旧 CR 各加一行「reviewed under pre-R1234 model」，不追溯。

## 修正 1（2026-09-09，用户 "5. 好的"）：R1 由三角色改为四角色

R1 需求评审参与角色由「产品 / 架构 / 测试」改为「**产品 / 架构 / 模块开发 / 测试**」——模块开发角色的"可实现性 / 无隐藏 scope / 任务是否可拆"检查必须在 R1 就介入，不等 R2 架构白干一轮。触发：起草 Skills 功能 CR 时，模块开发角色在 R1 阶段派生出 4 个实现层变化点（拆 CR、HTML 捕获回调位置等），证明该视角在需求阶段就有裁决价值。

- 收紧、无行为删减：R1 仍是人工终止，`review r1` 机器检查不变（仅查「变化点登记」表 + 拍板痕迹）。
- 已同步：`docs/AI_STANDARD.md` 原则 17、`docs/WORKFLOW.md`（R1 行 + 标准循环第 3 步）、`docs/CONTROLS.md`（R1 行）。
- `AI_STANDARD.md §8` 早已含「模块开发角色」常驻清单，无需新增。
- 首个按四角色 R1 执行的 CR：`CR-20260909-skills`。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ
