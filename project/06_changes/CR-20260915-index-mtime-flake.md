# CR-20260915-index-mtime-flake

- 级别: L1（局部修复：删掉生成内容里唯一一处非内容派生的字段。不改需求、不改架构、不改接口、不改测试基线、不新增编号——按 `docs/CONTROLS.md` 的 L1 轻量档，产出为本 CR 加证据登记）
- 提出人: 助手 2026-09-15，合并 `CR-20260915-process-hardening-flow` 后跑 `check release` 时当场撞到
- 状态: APPROVED（R1 人工终裁：用户 2026-09-15「继续跑完」承「全实现，按你建议的顺序全实现」的总授权；本条属交付过程中发现的缺陷）
- 占用 ID: 无（未创建 ID；断言落在既有 `tests/test_governance.py`）
- 评审模型: 快车道（DEC-021 ①：唯一的 CP 是双向门且有机器检查）
- 影响需求: 无
- 影响模块: MOD-GOVERNANCE（`scripts/gen-index.mjs`）
- 影响任务: **小改** TASK-434
- 影响测试: **小改** TEST-435
- 当前证据: `project/05_evidence/EV-2026-09-15-index-mtime-flake.md`
- 方案选项:
  - A. `check-index` 允许「仅这一行不同」时也判 PASS（做一个专门的豁免规则）——否决。那是给症状贴膏药：豁免规则本身还得维护，而且以后生成内容里再混进别的非内容派生字段，还得再加一条豁免。
  - B. **删掉这一行**（选中）：`docs/INDEX.md` 从此是纯内容的函数——同样的说明书内容，任何时候、任何机器上重新生成都得到同样的字节。
  - C. 把 mtime 改成基于 git 的信息（如 `git log -1 --format=%cI` 该文件的最后提交时间）——否决。那不再受「checkout 就变」影响，但引入了对 `git` 子进程的新依赖（生成器此前是纯文件系统脚本），且提交时间与「这份索引对不对」无关，纯粹是装饰信息，不值得为它加这层复杂度。
- 选择理由: 选 B。①**对症**：`check-index` 存在的目的就是「同样的输入内容 -> 同样的字节」，混入 mtime 直接违反这条承诺；②**代价最小**：删一个函数、两行调用，不影响其余任何一节的生成逻辑；③**现场验证**：`touch` 全部四个输入文件模拟 checkout 效果，改前必现 `FAIL INDEX_STALE`，改后 `OK INDEX_PASS`。
- 回滚方式: `git revert` 本 CR 的提交。`docs/INDEX.md` 重新长出「最后修改时间」这一行，`check-index` 恢复「合并后必现一次性误报」的旧行为。无数据、无迁移。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵。
  - 机器检查：`touch` 四个输入文件（模拟 git checkout/merge 重置 mtime）后 `check-index` 仍 `OK INDEX_PASS`——撤掉修复即复现 `FAIL INDEX_STALE`。
- 评审记录: 快车道。唯一的 CP 能被单测直接断言。
- R1 终裁: 已完成 | 用户 | 2026-09-15

## 问题经过

`CR-20260915-process-hardening-flow` 合并进 `main` 并收口后，例行跑 `python tools/governance.py check release` 核对全部门禁，撞到：

```
FAIL INDEX_STALE docs/INDEX.md does not match what `node scripts/gen-index.mjs` would write now
```

比对 `docs/INDEX.md` 已提交内容与 `node scripts/gen-index.mjs --stdout` 的实时输出，唯一差异是一行：

```
| 依据的输入文件最后修改时间 | 2026-09-16T00:03:36.544Z（……） |   ← 已提交
| 依据的输入文件最后修改时间 | 2026-09-16T00:12:42.153Z（……） |   ← 重新生成
```

原因：生成器把四个输入文件（三层说明书之一、`package.json`）的 `mtime` 最大值写进了生成内容本身。`git merge`（以及任何 checkout）会把被合并/检出的文件的 `mtime` 重置为操作发生那一刻——**内容一个字节没变，这一行却必然不同**。后果不是这一次偶然：**每一次涉及这四个文件之一的合并，都会让 `docs/INDEX.md` 在合并瞬间变成「过期」**，而它的内容其实是对的。一条设计成「验证内容是否最新」的检查，被自己生成的非内容字段搞成了「合并后必然误报一次」——这正是本项目反复在治的那类毛病（DEC-331 的核心洞察：机器检查得验证的是真实情况，不是自己方便写的东西）。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 模块 | **`docs/INDEX.md` 不再嵌入输入文件的 mtime**：删掉 `inputFreshness()` 及其唯一调用点，索引成为纯内容函数 | TASK-434, TEST-435（均小改） | 缺陷修复 | 双向 | 机器：`check-index`——`touch` 四个输入文件后仍 PASS（撤掉修复即复现 FAIL）；另有 `check release` 在真实仓库上由红转绿 |
