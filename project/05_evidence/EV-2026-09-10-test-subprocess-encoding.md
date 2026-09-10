# EV-2026-09-10-test-subprocess-encoding

- 采集者: claude
- 时间: 2026-09-10
- 来源: `CR-20260910-record-accuracy` 的 P3 过程中偶遇，随后构造确定性复现
- 支撑对象: CR-20260910-test-subprocess-encoding 的 CP-1 / CP-2

## 缺陷

`tests/test_governance.py::SpecStructureTests::test_053_5_the_migration_is_idempotent_on_the_real_specs` 以 `encoding="utf-8"` 收 `tools/migrate_specs.py` 的管道输出：

```python
result = subprocess.run(
    [sys.executable, "tools/migrate_specs.py", "--dry-run"],
    cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8",
)
self.assertEqual(result.returncode, 0, result.stderr)
self.assertIn("already migrated", result.stdout)
```

子进程是 Python，其 `sys.stdout` 在被重定向到管道时按**本机 locale 编码**（本机为 GBK/cp936）写出，不是 UTF-8。父进程按 UTF-8 严格解码，二者不一致。

**触发条件**：仅当子进程打印**含非 ASCII 的内容**时。规范已迁移时它只打印 `[dry-run] already migrated - nothing to do`（纯 ASCII），恰好不触发——所以这个缺陷长期潜伏，只在"确实需要迁移"（打印含中文的说明书文件名）时爆发，而那正是这条测试唯一有意义地失败的时刻。

## 确定性复现

把 `project/` 复制到临时根，在测试说明书末尾追加一个位置不合规的 `## 变更响应 · CR-2099-repro` 节，使迁移工具判定需要重写（于是打印中文文件名），再用与测试**完全相同**的调用方式取输出：

```
returncode: 0
stdout is None?: True
stderr is None?: False
```

父进程侧同时打印：

```
Exception in thread Thread-1 (_readerthread):
  File "C:\Python314\Lib\subprocess.py", line 1613, in _readerthread
    buffer.append(fh.read())
  File "<frozen codecs>", line 325, in decode
UnicodeDecodeError: 'utf-8' codec can't decode byte 0xb2 in position 35: invalid start byte
```

`subprocess` 的读取线程在后台崩溃，异常**不会**传播到 `subprocess.run` 的调用方；`run()` 正常返回，`returncode` 为 0，但 `stdout` 是 `None`。于是：

- `self.assertEqual(result.returncode, 0, ...)` **通过**（返回码确实是 0）
- `self.assertIn("already migrated", result.stdout)` 抛 `TypeError: argument of type 'NoneType' is not a container or iterable`

**危害**：一次真实的"规范结构已漂移"被报告成一个与编码、与结构都无关的 `TypeError`，排查者看到的第一现场是 `unittest` 的类型错误，而不是"迁移不幂等"。

## 修复验证

同一复现根下，三种调用方式对比：

| 调用 | returncode | stdout | 文本 |
|---|---|---|---|
| 现状（`encoding="utf-8"`） | 0 | **None** | —— |
| 子进程 `PYTHONIOENCODING=utf-8` | 0 | 非 None | `[dry-run] rewrote project/04_tests/测试说明书.md`（正确） |
| 仅加 `errors="replace"` | 0 | 非 None | 中文变 U+FFFD（不崩，但文本已损坏） |
| **两者同时**（已选） | 0 | 非 None | 文本正确，且 `"\ufffd" in stdout` 为 `False` |

结论：`PYTHONIOENCODING=utf-8` 让两端就同一编码达成一致，是真正的修复；`errors="replace"` 是兜底——即便将来出现别的编码不一致，也只会得到可读的替换字符和一条正常失败，而不是 `stdout=None` 加一个误导性的 `TypeError`。

## 边界

`tools/migrate_specs.py` 本身不改。它在 GBK 控制台被人直接调用时中文显示正常；强制其输出 UTF-8 会破坏交互使用体验。编码约定属于**调用方**的责任，故修复落在测试侧。
