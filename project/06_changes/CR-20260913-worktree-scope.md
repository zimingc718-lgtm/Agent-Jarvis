# CR-20260913-worktree-scope

- 级别: L1（治理工具的受控文件枚举多一条忽略前缀。无产品行为变化、无 schema 变更、无数据迁移）
- 提出人: 助手在为四条 CR 合并后跑 `verify` 时撞上；用户 2026-09-13 裁定「补一条轻量 CR」
- 状态: CLOSED（闭环完成：无独立任务/测试编号（L1 轻量档）；2026-09-14 合入 main 后收口。原记：APPROVED（R1 人工终裁：用户 2026-09-13 就本条改动明确裁定补记录，见「R1 人工终裁」））
- 占用 ID: 无（未创建 ID；断言落在既有 `tests/test_governance.py`）
- 评审模型: 快车道（DEC-021 ①：唯一的 CP 是双向门且有机器检查）
- 影响需求: 无
- 影响模块: MOD-GOVERNANCE（`tools/governance.py`）；`.gitignore`
- 影响任务: 无（不新增编号，按用户 2026-09-13 裁定走轻量档：只写 CR 与证据登记，不写三层说明书变更响应节）
- 影响测试: **小改** `tests/test_governance.py`（增一条断言）
- 当前证据: 本文件「问题经过」——现场可复现
- 方案选项:
  - A. 把 `.claude` 整个目录加进 `IGNORED_DIR_NAMES`——否决。那是按目录名匹配，会连带忽略项目里任何一层名叫 `.claude` 的东西；而且若将来把 Claude 的项目级配置放进 `.claude/`，它会**静默**脱离受控，这正是本项目最不能接受的失败形态。
  - B. **按相对路径前缀忽略 `.claude/worktrees`**（选中）。与 `.gitignore` 的那条一一对应，范围恰好是会话脚本区。
  - C. 让 `verify` 读 `.gitignore`——否决。受控范围与版本库忽略范围是两件事：`.data/` 不进版本库但其中若有受控文件应当被看见；把两者绑定会让「受控」这个概念从此由 `.gitignore` 定义。
- 选择理由: 选 B。①**范围恰好**：项目里别处若真有一个叫 `worktrees` 的目录，仍然受控；②**与既有习惯一致**：`IGNORED_DIR_PREFIXES` 已经是同一类特判（`.next-` 构建目录）；③**回滚即删两行**。
- 回滚方式: `git revert` 本 CR 的提交。忽略规则消失后 `verify` 回到旧行为——即嵌套检出会再次被判为未纳管。无数据、无迁移。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵；按用户裁定不写三层说明书变更响应节。
  - 机器检查：治理单测必须有一条断言，说明嵌套检出里的文件**不进**受控清单、而 `src/worktrees/` 下的文件**照常进**。没有后半句，这条规则就可能悄悄扩大范围。
- 评审记录: 快车道。唯一的 CP 能被单测直接断言。
- R1 终裁: 已完成 | 用户 | 2026-09-13

## 问题经过

四条 CR 合并进 `main` 后跑 `verify`，得到一串：

```
FAIL UNBASELINED_FILE .claude/worktrees/skill-doc-integrity/tools/migrate_specs.py
FAIL UNBASELINED_FILE .claude/worktrees/skill-doc-integrity/tsconfig.json
FAIL UNBASELINED_FILE .claude/worktrees/skill-doc-integrity/vitest.config.ts
```

Claude Code 把 worktree 开在 `.claude/worktrees/<名字>` 下，而一个 worktree 是**本仓库的第二份完整检出**。`discover_controlled_files` 按文件系统遍历，`IGNORED_DIR_NAMES` 里没有 `.claude`，于是那份检出里的每个文件都被当成「项目里多出来的、没进基线的文件」。

三点值得记下：

1. **这不是那个会话的错。** 那是 Claude Code 放 worktree 的默认位置，谁开都一样。
2. **它把一棵干净的树判成了红的**，而红的原因与本仓库的完整性毫无关系——正是「门禁误报」最伤人的形态：它会训练人忽略门禁。
3. **`.gitignore` 与受控范围此前没有对齐**，而对齐它们的正确做法不是让前者定义后者，是各自写清楚同一件事（见方案 C 的否决理由）。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 架构 | **会话 worktree 不是受控文件**：`IGNORED_REL_PREFIXES` 按相对路径前缀忽略 `.claude/worktrees`，按前缀而非目录名匹配，使项目里别处名为 `worktrees` 的目录仍然受控 | 无新增 ID | 缺陷修复 | 双向 | 机器：`tests/test_governance.py::test_session_worktrees_are_not_controlled_files`（同时断言 `src/worktrees/` 下的文件仍进清单） |

## R1 人工终裁

- 用户 2026-09-13 就这条改动裁定「补一条轻量 CR」，并同时裁定轻量档的形态：L1 且不新增编号的改动只写 CR 与证据登记，不写三层说明书的变更响应节。
- 改动本身先于本记录发生（提交 `f41bd01`），因为它在阻塞 `verify`；本 CR 是补记，不是追认一件未经同意的事——用户在得知改动内容后作出的裁定。

## 实施记录（2026-09-13）

- `tools/governance.py`：新增 `IGNORED_REL_PREFIXES`，在 `discover_controlled_files` 的遍历里按相对路径前缀跳过。
- `.gitignore`：新增 `.claude/worktrees/`。
- `tests/test_governance.py`：新增一条断言，正反两面各一句。
- 治理单测 76 通过；干净克隆里 `verify` PASS、`check release` 16 门全过。
