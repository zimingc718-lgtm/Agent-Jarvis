# CR-20260927-architecture-doc

- 级别: L1（快车道：全部 CP 双向门且各有机器检查——新增一份文档、一条守卫测试、CLAUDE.md 一条纪律；不改运行时代码、不改数据、`git revert` 即回滚）
- 提出人: user（INPUT-2026-09-27-001）
- 状态: P2-P4 完成，待 snapshot 与合并（R1 由用户原话直接终裁；`tests/architecture-doc.test.ts` 6 例全绿，`tsc` 0 错误；无真实入口路线——纯文档与守卫）
- 占用 ID: DEC-440, TASK-560, TEST-560
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: 无（流程与文档控制，不覆盖产品需求；与 MOD-GOVERNANCE 的 DEC-020/021 同类）
- 影响模块: MOD-GOVERNANCE（新增受控文档 `docs/ARCHITECTURE.md` 与守卫测试）；CLAUDE.md 交付纪律
- 影响任务: 无既有任务变更，新增 TASK-560
- 影响测试: 无既有测试变更，新增 TEST-560
- 当前证据: `project/05_evidence/EV-2026-09-27-architecture-doc.md`
- 方案选项:
  - A. 只把架构图保存为一份静态文件（HTML 或图片），靠人记得更新——不选：本项目已两次证明"只写规则不写检查"会失效（TASK-033 Ⅰ、known_warnings 过期），图会在第一次新增模块时开始撒谎。
  - B. **Markdown（含 mermaid，GitHub 可直接渲染）入库为 `docs/ARCHITECTURE.md`；一条守卫测试逐项核对源码清单（`src/lib`、`src/lib/tools`、`src/components`、`src/app/api/**/route.ts`、SQLite 表、npm 与 Python 运行依赖）都出现在文档里；CLAUDE.md 交付纪律加一条"动了模块 / 路由 / 表 / 依赖 / 部署形态就同一 CR 更新"；可分享页面由该文件派生**——选中。
  - C. 在 `tools/governance.py` 里加一条 `check-architecture`，比较 CR 触碰的文件与文档是否同时变化——不选：治理脚本零 `src/` 依赖的边界要为此开口子，而 vitest 守卫已在全量测试与 `verify:all` 里，效果相同、成本更低。
  - D. 直接把图画进架构设计说明书——不选：说明书按 CR 累积「变更响应」节，不适合承载一张需要整体重绘的图；且说明书「技术栈与部署形态」一节本身已漂移，校正它是另一条纯文档 CR。
- 选择理由: 用户原话「保存到项目里」「新功能或者新重构变化后，更新这个架构图」两个要求分别落成"入库"与"机器守卫 + 纪律"。守卫只证明名字出现，不证明层与箭头画对——这一点写进文档的维护规则，由评审承担。
- 回滚方式:
  - 代码：`git revert` 本 CR 合并提交；文档、测试、CLAUDE.md 那一条同时消失，运行时零影响。
  - 数据：无。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260927-architecture-doc` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-560 DONE；TEST-560 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：用户原话即裁定。
- R1 终裁: 已完成 | 用户 | 2026-09-27

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：用户 2026-09-27 要求「给出这个项目的架构图」，协调会话绘制并发布后，用户明确指示「帮我保存到项目里，当新功能或者新重构变化后，更新这个架构图。」——两个要求没有留下需要裁定的设计分叉（形式按仓库既有做法：Markdown 入库 + 机器守卫 + 纪律一条），故以该原话作 R1 终裁，未另发 AskUserQuestion。架构设计说明书「技术栈与部署形态」一节的漂移未纳入本 CR，待用户另行指定。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 架构图成为仓库内受控文档 `docs/ARCHITECTURE.md`（分层总览、一次发送的路径 mermaid、数据落点、本机 / Railway 部署、治理层、与说明书的差异、维护规则、附录清单），可分享页面由它派生 | DEC-440（新增） | 新增 | 双向 | 机器：`tests/architecture-doc.test.ts` ⑥（文首日期与 main 提交号、维护规则节存在） |
| CP-2 | 架构 | 守卫测试逐项核对源码清单：`src/lib/*.ts`、`src/lib/tools/*.ts`、`src/components/*.tsx`、`src/app/api/**/route.ts`、`CREATE TABLE IF NOT EXISTS` 的每张表、`package.json` 运行依赖与 `requirements.txt` 每个包，都必须出现在文档里；进入全量测试与 `verify:all` | DEC-440 | 新增 | 双向 | 机器：`npx vitest run tests/architecture-doc.test.ts` ①-⑤ |
| CP-3 | 模块 | CLAUDE.md「六、交付纪律」新增一条：动了模块 / 路由 / 表 / 依赖 / 部署形态就在同一 CR 更新 `docs/ARCHITECTURE.md`，先改图再改清单，改后更新文首日期与提交号并重新发布页面 | TASK-560 | 新增 | 双向 | 机器：CLAUDE.md 受基线哈希管辖（`verify`）；内容由 CP-2 的测试兜底 |
| CP-4 | 测试 | 新增 TEST-560（6 例） | TEST-560 | 新增 | 双向 | 机器：`npx vitest run tests/architecture-doc.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260927-architecture-doc` 节后，跑 `governance.py matrix CR-20260927-architecture-doc` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 用户两句原话分别落成入库与随变更更新；Markdown + mermaid 在 GitHub 直接可读，可分享页面由它派生 | APPROVED 新增 DEC-440，与 DEC-020/021 同属流程控制；文档第 5 节如实登记说明书漂移，校正另立 CR 不混入 | APPROVED 文档六节 + 附录清单，落点单一 `docs/ARCHITECTURE.md` | APPROVED TEST-560 ⑥ 守住文首日期 / 提交号与维护规则节 |
| CP-2 | APPROVED 「新功能或新重构后更新」由机器兜底而非靠人记得，符合本项目两次事故后的原则 | APPROVED 守卫放在 vitest 而不是治理脚本，治理脚本零 `src/` 依赖的边界不动；清单来源全部从文件系统与源码枚举，不手写 | APPROVED 枚举逻辑 40 行、无新依赖；失败时列出全部缺失项而非第一个 | APPROVED 6 例覆盖模块 / 组件 / 路由 / 表 / 依赖 / 文首 |
| CP-3 | APPROVED 纪律写明触发条件与顺序（先改图再改清单），并引用用户原话 | APPROVED CLAUDE.md 受基线哈希管辖，改动经 snapshot 留痕 | APPROVED 一条 bullet，放在既有交付纪律之间 | APPROVED 内容由 CP-2 的测试兜底，无需单独测试 |
| CP-4 | APPROVED 无用户可见行为，无真实入口路线 | APPROVED 无新增 mock 或基础设施 | APPROVED 单文件 | APPROVED 全量 952/952 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-560 ① | APPROVED 与 DEC-440 ① 一致 | APPROVED 单文件可审阅可回滚 | APPROVED TEST-560 ⑥ |
| CP-2 | APPROVED 无需求层遗留 | APPROVED 与 DEC-440 ② 一致 | APPROVED TASK-560 ② 写明枚举来源与断言方式 | APPROVED TEST-560 ①-⑤ |
| CP-3 | APPROVED 无需求层遗留 | APPROVED 与 DEC-440 ③ 一致 | APPROVED TASK-560 ③ | APPROVED 见 CP-2 |
| CP-4 | APPROVED 无遗留 | APPROVED 无新增架构决策 | APPROVED 测试与文档一一对应 | APPROVED 见 R2/CP-4 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 文档存在、文首带 2026-09-27 与 `16a3e5b`，守卫 ⑥ 通过 | APPROVED 第 5 节的漂移登记与说明书现文逐条对得上 | APPROVED 无残留旧图（说明书「总体架构」六行文字保留原样，校正另立 CR） | APPROVED `npx vitest run tests/architecture-doc.test.ts` 6/6，已本机实测 |
| CP-2 | APPROVED 守卫在全量测试里，`verify:all` 同样覆盖 | APPROVED 枚举到 39 个 lib 模块、10 个工具模块、24 个组件、36 条路由、10 张表、17 个 npm 依赖 + 2 个 Python 包，全部命中 | APPROVED 失败信息为缺失清单，已在开发中验证过一次红（缺项即报） | APPROVED 全量 103 文件 952/952 |
| CP-3 | APPROVED | APPROVED | APPROVED CLAUDE.md diff 仅一条 bullet | APPROVED 由 CP-2 兜底 |
| CP-4 | APPROVED | APPROVED | APPROVED | APPROVED 全量回归 952/952，`tsc` 0 错误 |
