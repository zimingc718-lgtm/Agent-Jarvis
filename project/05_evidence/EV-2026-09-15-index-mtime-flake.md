# EV-2026-09-15-index-mtime-flake

- 来源: 助手 2026-09-15，合并 `CR-20260915-process-hardening-flow` 后跑 `check release` 核对全部门禁时当场撞到
- 时间: 2026-09-15
- 采集者: 助手（claude-opus-5），在本仓库真实工作树上执行
- 支撑对象: `CR-20260915-index-mtime-flake` CP-1
- 可定位路径: 本文件；`scripts/gen-index.mjs`、`tests/test_governance.py::GeneratedIndexTests::test_435_1b_survives_a_simulated_checkout`

## 1. 现场

```
$ python tools/governance.py check release
FAIL INDEX_STALE docs/INDEX.md does not match what `node scripts/gen-index.mjs` would write now
```

`docs/INDEX.md` 是几分钟前 `CR-20260915-process-hardening-flow` 合并提交时才刚生成并提交的，合并本身**没有改动任何三层说明书或 `package.json`**（那次合并只是把 CR 分支的提交历史接到 `main` 上，四个输入文件的内容与 CR 分支上最后一次提交时完全一致）。

比对已提交内容与 `node scripts/gen-index.mjs --stdout` 的实时输出，唯一差异：

```diff
- | 依据的输入文件最后修改时间 | 2026-09-16T00:03:36.544Z（……） |
+ | 依据的输入文件最后修改时间 | 2026-09-16T00:12:42.153Z（……） |
```

两个时间戳相差约 9 分钟——恰好是从「提交那次快照」到「跑 `check release`」之间过去的时间。

## 2. 根因

`scripts/gen-index.mjs` 的 `inputFreshness()` 读四个输入文件（产品需求说明书、测试说明书、模块任务开发说明书、`package.json`）的 `mtime`，取最大值写进生成内容的表头。`git merge`（以及任何 `git checkout`）会把被检出文件的 `mtime` 重置为操作发生那一刻——**这是 git 的标准行为，不是这台机器的异常**。于是：

1. 内容层面：合并前后四个文件字节完全一致，`docs/INDEX.md` 理应仍然「新鲜」。
2. mtime 层面：四个文件的 `mtime` 在合并那一刻被同时拨到了「现在」，与 `docs/INDEX.md` 提交时记录的那个旧时间戳不再相等。
3. `check-index` 按字节比对生成内容，這一行不同即整体判「不一致」。

**后果不是这一次偶然**：只要合并、克隆、`checkout` 涉及这四个文件之一，这条检查就会在操作完成的下一刻误报一次——一条设计成「验证内容是否最新」的检查，被自己生成的非内容字段搞成了「合并后必然误报」。

## 3. 修复与验证（先红后绿）

删掉 `inputFreshness()` 函数与其唯一调用点，`docs/INDEX.md` 的表头只保留内容派生的两行（生成命令、规模统计）。

```
$ touch project/01_specification/产品需求说明书.md project/04_tests/测试说明书.md \
        project/03_modules/模块任务开发说明书.md package.json    # 模拟 checkout/merge 重置 mtime

改前：FAIL INDEX_STALE
改后：OK INDEX_PASS docs/INDEX.md matches the generator's current output
```

新增单测 `test_435_1b_survives_a_simulated_checkout`：对真实仓库的四个输入文件执行 `os.utime(path, None)`（等价于 `touch`，不改内容只拨 mtime），断言 `check-index` 仍 PASS。这条用例把「合并后不会误报」钉成了不变式，而不只是本次手工验证一遍。

`python -m unittest tests.test_governance`：139 个用例、25 个子用例全绿。

## 4. 局限（如实登记）

- 方案选项 C（改用 git 提交时间而非文件系统 mtime）被否决——那会给生成器引入对 `git` 子进程的新依赖（此前是纯文件系统脚本），且提交时间对「索引对不对」这件事本身没有信息量，纯属装饰。删掉这行是更干净的解。
