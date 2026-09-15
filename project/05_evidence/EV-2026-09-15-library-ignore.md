# EV-2026-09-15-library-ignore

- 来源: 助手在 CR-20260915-board-tick-burst 合并后补快照时当场撞到；承用户 2026-09-15「继续跑完」的授权
- 时间: 2026-09-15
- 采集者: 助手（claude-opus-5），在用户本机这棵工作树上执行（`D:\OneDrive\桌面\工作\项目文件\Agent-Jarvis`）
- 支撑对象: `CR-20260915-library-ignore` CP-1
- 可定位路径: 本文件；`tools/governance.py`（`IGNORED_REL_PREFIXES`）、`.gitignore`、`tests/test_governance.py::test_user_library_is_not_a_controlled_file`

## 1. 现场

补快照那一次（用户在提示里手动执行 `python tools/governance.py snapshot --actor Ziming`，因为自动权限分类器两次拒绝了该命令）：

```
OK SNAPSHOT_WRITTEN project/.governance/baseline.json
```

紧接着的 `verify`：

```
FAIL UNBASELINED_FILE 资料库/AIDC-供电架构与电网/README.md
FAIL UNBASELINED_FILE 资料库/AIDC-供电架构与电网/清单.md
```

量化：

| 项 | 快照前（seq=108） | 那次快照后（seq=109） |
|---|---|---|
| `baseline.json` | 38,801 字节 | 81,759 字节 |
| `ledger.jsonl` | 2,552,683 字节 | 2,634,620 字节 |
| 基线里「资料库」条目 | 0 | **256** |

目录本身：`资料库/` 建于 `11:44:13`，`find 资料库 -type f | wc -l` = 256，`du -sh` = **253M**；快照跑在 `11:45:21`，而 `README.md` 与 `清单.md` 的 mtime 是 `11:46:10`——**快照跑完之后目录还在长**。这棵工作树在 OneDrive 下，内容一边同步一边落地。

## 2. 处置

1. 那次污染的快照**没有提交**：`git restore project/.governance/baseline.json project/.governance/ledger.jsonl`，链回到 `seq=108`（CR-20260915-board-tick-burst 的合并前快照，提交 `9d23a01`）。哈希链上没有留下污染记录。
2. 本 CR 把仓库根下的 `资料库/` 排出受控枚举，并在 `.gitignore` 加同名一条（253 MB 的用户文档本来也不该进版本库）。
3. 收口快照在本 CR 合并之后才补——那一次的基线里不含资料库。

## 3. 机器证据（先红后绿）

`tests/test_governance.py::test_user_library_is_not_a_controlled_file`，两头都钉：

- `资料库/AIDC-供电架构与电网/清单.md` **不在** `discover_controlled_files` 的结果里；
- `src/资料库/real.ts` **在**结果里——前缀只匹配仓库根，规则没有悄悄扩大。

撤掉 `tools/governance.py` 的那条前缀（`git stash push tools/governance.py`）重跑：该用例 `1 failed`；恢复后全绿。

## 4. 局限（如实登记）

- 规则按**目录名**硬编码，与 `.gitignore` 的那条一一对应。用户若把资料库改名或换位置，工具不会自动跟随——那时会以同样的形态再红一次，届时补一条前缀即可。让受控范围跟着应用的运行时配置走（读数据库里的文档根）被明确否决：受控范围必须由工具显式声明，不能由运行时数据决定。
- 资料库是否该放在仓库里，是用户对自己数据的处置，本 CR 不替他决定；规则在两种选择下都成立。
