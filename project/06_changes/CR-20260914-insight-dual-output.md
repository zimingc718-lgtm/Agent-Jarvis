# CR-20260914-insight-dual-output

- 级别: L3（**本项目第一次往用户磁盘写文件**。新增 REQ-F-190，并修订 REQ-F-110 ⑤ 的只读边界；新增一个工具、一条 API、一处界面动作。无 schema 变更、零新增依赖）
- 提出人: 用户 2026-09-13 答复 `CR-20260911-display-console-ux` 第 2 项待终裁时提出：「两个都要，而且支持保存到系统的本地文档库」（INPUT-2026-09-13-027）
- 状态: APPROVED（R1 人工终裁：用户 2026-09-13 直接给出该裁定，并授权按业界最佳实践把细节定完）
- 占用 ID: DEC-230, TASK-320, TEST-320
- 评审模型: **重型档**（DEC-021 ①：CP-3 写文件到用户磁盘是**单向门**——`git revert` 撤不回已经写下去的文件）
- 影响需求: 新增 REQ-F-190；**修订** REQ-F-110 ⑤（只读边界收窄为「本层无写入口」，并明列唯一例外）
- 影响模块: MOD-DISPLAY（`src/lib/insight-export.ts` 新增、`DisplayScreen`）、MOD-TOOLS（`display-tools`）、MOD-SETTINGS-UI（`DocumentSettings`）、`/api/insights/archive`、`/api/settings/documents`
- 影响任务: 新增 TASK-320
- 影响测试: TEST-320
- 当前证据: `project/05_evidence/EV-2026-09-14-insight-dual-output.md`
- 方案选项:
  - A. **HTML 仍是唯一作者产物，Markdown 由它派生**（选中）
  - B. 让模型同时写 HTML 与 Markdown 两份——否决。多花一遍 token，且**两份正文迟早对不上**：改了一份忘了另一份，谁也说不清哪份是准的。派生物就该是派生出来的。
  - C. 改用 Markdown 作为作者产物、HTML 由它渲染（即原备选 D8）——否决。展示屏现在渲染的是模型直接写的 HTML（含自带样式与图表脚本，DEC-032 ④），换掉作者形态是另一个量级的改动，而用户要的是「两个都要」，不是「换一个」。
  - D. 写进应用自己的数据目录而不是用户的文档库——否决。用户明确说的是「保存到系统的本地文档库」；写进 `.data/` 等于换个地方继续关着。
- 选择理由: 选 A。①一份正文、两种形态，不存在同步问题；②写入面被三道边界夹住（须在已配置文档根之内、永不覆盖、只新建），**每一道都有断言**；③模型与人走同一个 `archiveInsight`，不会出现「按钮守住了、工具没守住」。
- 回滚方式: **单向门，按重型档要求逐层写全**——
  1. **代码**：`git revert` 本 CR 的提交。归档按钮、`archive_insight` 工具、`/api/insights/archive` 与 `PATCH /api/settings/documents` 一并消失。
  2. **设置**：`documents.archive` 这一行留在 `app_settings` 里，旧代码不读它，无害；要彻底清除执行 `DELETE FROM app_settings WHERE key='documents.archive'`。
  3. **已写下去的文件撤不回来**——这正是它被判为单向门的原因。补偿措施是**可定位**：每份归档都带 `source: jarvis://insight/<id>` 元数据头，且文件名带日期与标题，用户可据此一次性找出全部归档文件并自行删除。
  4. 回滚后重跑 `verify`、`check-specs`、`review r1..r4` 并重新 snapshot。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行 + `## 事前验尸`；`check-doors` PASS；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260914-insight-dual-output` 节逐 CP 落点；本文件三张矩阵无空、无 REJECTED。
  - 机器检查：TEST-320 共 24 例（转换 6 + 边界 5 + 写盘 5 + 工具 4 + 界面 2 + 命名 2）全绿。
  - **真实入口**：在真实服务器上配置归档目录、点「归档到本地文档库」，文件落盘且能被 `read_document` 读回。
- 评审记录: 重型档，四角色矩阵见文末。R1 人工终裁：用户 2026-09-13 的原话即为裁定。
- R1 终裁: 已完成 | 用户 | 2026-09-13

## 问题陈述

洞察报告只活在 `insights` 表里：只能在展示屏上看，不能检索、不能编辑、不能带走，Jarvis 自己下一轮也读不回来（`search_documents` 看不见它）。

用户的原话是「两个都要，而且支持保存到系统的本地文档库」。两件事：**Markdown 这一形态**，以及**落到本地文档库这个位置**。后者比前者重要——落进文档库，报告才和其它原始资料处在同一层，此后可被检索、被引用、被模型读回。

## 为什么不是「让模型再写一份 Markdown」

两份正文一旦并存，就一定会有一份先过期。派生物就该是派生出来的：HTML 是作者产物，Markdown 由它转换。代价是转换器要自己写——它只覆盖模型实际会写出的标签子集，并遵守一条硬规矩：**认不出的标签只脱壳、不丢字**。转换可以丢格式，不能丢内容。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 架构 | **HTML→Markdown 转换器**：覆盖模型实际产出的标签子集；认不出的标签只脱壳不丢字；表格单元格竖线转义 | REQ-F-190 ①⑥, DEC-230 | 新增 | 双向 | 机器：TEST-320 ①..⑥ |
| CP-2 | 产品 | **归档目录设置**：绝对路径，且必须落在某个已配置文档根之内；未配置时说清下一步 | REQ-F-190 ③, TASK-320 | 新增 | 双向 | 机器：TEST-320 ⑬..⑰ |
| CP-3 | 架构 | **写文件到用户磁盘**：只在归档目录内新建，永不覆盖（同名加序号） | REQ-F-190 ②④, TASK-320 | 新增 | **单向** | 机器：TEST-320 ⑱..⑳（落盘、不覆盖、超限拒绝）；**且**真实入口：配置目录后点「归档」，文件真的出现（证据：TEST-320） |
| CP-4 | 模块 | **两条入口共用一份实现**：`archive_insight` 工具与 `/api/insights/archive` 都调 `archiveInsight` | REQ-F-190 ②, TASK-320 | 新增 | 双向 | 机器：TEST-320 ⑦..⑩（含「别人的洞察归档不了」） |
| CP-5 | 产品 | **人的一侧**：展示屏报告上方「归档到本地文档库」按钮，就地回话；动作不进那条不可关闭的提示条 | REQ-F-190 ⑦ | 新增 | 双向 | 机器：TEST-320 ⑪⑫ + TEST-093 ⑤（提示条里仍无任何按钮） |
| CP-6 | 产品 | **修订 REQ-F-110 ⑤**：只读边界收窄为「本层无写入口」，并明列唯一例外 | REQ-F-110 ⑤ | 大改 | 双向 | 机器：`document-tools` ⑤（`documents.ts` 仍不导出任何写函数） |

## 事前验尸（重型档要求）

假设三个月后这件事出了岔子，最可能是下面哪一条：

1. **用户的文件被覆盖了。** 最坏的结果，也是最容易发生的——只要有一处忘了查重名。防法不是小心，是 `freePath` 只在 `stat` 抛错（即文件不存在）时返回该路径，**没有任何分支能走到覆盖**；TEST-320 ⑲ 连续归档两次并断言两个路径不同、两份内容都还在。
2. **写到了文档库以外的地方。** 比如用户填了 `C:\`，或用符号链接绕出去。防法与 REQ-NF-050 ① 同一条：`realpath` 先解析再判包含，且用 `relative()` 而不是字符串前缀；TEST-320 ⑮ 断言越界目录被拒且目标目录里什么都没有。
3. **转换悄悄丢了内容。** 一份报告归档后少了一段，而没有任何人会发现——这是三条里最阴的。防法是转换器的底线规则「认不出的标签只脱壳、不丢字」，TEST-320 ② 用一个自造标签断言正文仍在。**这条只能防住「丢字」，防不住「格式变难看」**，如实登记。
4. **磁盘写满或没有权限。** 抛出的是 Node 的原始错误，会被 API 包成 400 并把原文回显给用户；这一条没有测试覆盖，如实登记为人工发现项。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块开发 | 测试 |
|---|---|---|---|---|
| CP-1 转换器 | APPROVED | APPROVED — 派生而非二次创作，避免两份正文不同步 | APPROVED | APPROVED — 底线规则「不丢字」有断言 |
| CP-2 归档目录 | APPROVED — 未配置时说清下一步 | APPROVED — 复用 realpath+relative 的包含判定 | APPROVED | APPROVED |
| CP-3 写盘 | APPROVED | CONDITIONAL — 单向门，**条件**：必须永不覆盖且写入面限定在文档根之内，两条都要有断言（已满足：TEST-320 ⑮⑲） | APPROVED | CONDITIONAL — **条件**：真实入口必须实跑，不得只有单测（已满足，见证据 §4） |
| CP-4 共用实现 | APPROVED | APPROVED — 两条入口一份实现，不会一边守住一边漏 | APPROVED | APPROVED — 含越权归档的反例 |
| CP-5 人的一侧 | APPROVED — 报告能归档这件事用户看得见 | APPROVED | APPROVED | CONDITIONAL — **条件**：不得削弱「提示条不可关闭」的既有断言（已满足：动作另起一行） |
| CP-6 修订只读边界 | APPROVED | APPROVED — 与实现相反的需求比没有更坏 | APPROVED | APPROVED — `documents.ts` 无写函数的断言仍成立 |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块开发 | 测试 |
|---|---|---|---|---|
| CP-1 转换器 | APPROVED | APPROVED | APPROVED — 纯函数，无 IO，可单独测 | APPROVED |
| CP-2 归档目录 | APPROVED | APPROVED | APPROVED — 校验放在写入设置之前 | APPROVED |
| CP-3 写盘 | APPROVED | APPROVED | CONDITIONAL — **条件**：写入实现不得放进 `documents.ts`，否则 REQ-F-110 ⑤ 的机器断言当场失效（已满足：另立 `insight-export.ts`） | APPROVED |
| CP-4 共用实现 | APPROVED | APPROVED | APPROVED | APPROVED |
| CP-5 人的一侧 | APPROVED | APPROVED | APPROVED | APPROVED |
| CP-6 修订只读边界 | APPROVED | APPROVED | APPROVED | APPROVED |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块开发 | 测试 |
|---|---|---|---|---|
| CP-1 转换器 | APPROVED | APPROVED | APPROVED | APPROVED — 6 例含实体解码次序与竖线转义 |
| CP-2 归档目录 | APPROVED | APPROVED | APPROVED | APPROVED — 5 例含越界、相对路径、未配置三种拒绝 |
| CP-3 写盘 | APPROVED | APPROVED | APPROVED | CONDITIONAL — **条件**：真实入口证据须标 `entry: user`（DEC-210 ③），不得用一次性服务器充数 |
| CP-4 共用实现 | APPROVED | APPROVED | APPROVED | APPROVED |
| CP-5 人的一侧 | APPROVED | APPROVED | APPROVED | APPROVED |
| CP-6 修订只读边界 | APPROVED | APPROVED | APPROVED | APPROVED |
