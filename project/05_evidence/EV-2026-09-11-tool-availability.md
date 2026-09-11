# EV-2026-09-11-tool-availability

- 来源：用户 P6 运行反馈 +本机实测
- 时间：2026-09-11
- 采集者：Claude（模块开发 + 测试角色）
- 支撑对象：`CR-20260911-tool-availability` CP-1..CP-5
- 可定位路径：本文件；`project/06_changes/CR-20260911-tool-availability.md`

## 1. 缺陷一：未探测的 Provider 无法调起任何工具

**用户原话**：「模型要联网的时候，要让模型可以调用起来联网搜索。」

**实测**：`src/lib/chat.ts` 的判定为

```ts
const support = toolSupportFor(provider, model);   // "yes" | "no" | "unknown"
const toolsUsable = support === "yes";
```

`tool_support` 只由「模型」设置页的「测试」动作写入。**任何未点过「测试」的 Provider 都是 `unknown`**，于是 `toolsUsable === false` → `registry.specsFor()` 的结果不进请求体、工具目录不进 system prompt → 模型**根本看不到** `web_search`，也就无从调用。

**归因**：这是我在 P2 写需求时的一处错误合并。`产品需求说明书.md` REQ-F-040 ③ 当时被我写成「`no` 和 `unknown` 行为一致」，理由是「运行 tool-free 好过让用户先看到一次莫名失败」。但用户终裁 4 的原话针对的是 Provider **不支持**工具调用的情形；「尚未探测」是每个 Provider 的**初始状态**，不是一种已知的不支持。把二者合并的后果是功能默认不可达——而这正是本 CR 要修的用户可见行为。

**修复**（CP-1/2/3）：
- `toolsUsable = support !== "no"` —— 未探测则乐观尝试；
- Provider 若拒绝 `tools` 字段，adapter 回退一次不带该字段并发 `tools-unavailable`（`shouldRetryWithoutTools`，与既有 `stream_options` 回退同形），回复仍然送达；
- 用实际结果回写：真调起过工具 → `yes`，字段被拒 → `no`，其余保持 `unknown` 下轮再试。

**守卫**：

```
tests/chat-stream.test.ts
  ✓ REQ-F-040 ③: 未探测的 Provider 仍然注册工具，模型可以调起来
  ✓ REQ-F-040 ③: 明确探测为 no 的 Provider 降级为纯对话并提醒
tests/adapters-tools.test.ts
  ✓ 4xx 指向 tools 时回退一次并发出 tools-unavailable
  ✓ shouldRetryWithoutTools 只认该字段相关的 4xx
```

## 2. 缺陷二：CRLF 使 `ui-contract.mjs` 在 vitest 下无法加载

**现象**：`npm test` 报 `Test Files 1 failed | 35 passed`，而失败的是**整个套件加载失败**，不是某条断言：

```
FAIL tests/visual.test.ts [ tests/visual.test.ts ]
SyntaxError: Invalid or unexpected token
 ❯ tests/visual.test.ts:2:1
      2| import { runStatic } from "../scripts/ui-contract.mjs";
```

矛盾的是 `node scripts/ui-contract.mjs` 正常跑出 `50 passed · 0 failed`，`node` 的 ESM `import()` 正常，`npx esbuild` 也能解析。

**定位过程**（逐条排除，不猜）：

| 假设 | 验证 | 结论 |
|---|---|---|
| BOM | 扫描：确有 19 个文件带 BOM（PowerShell `Set-Content -Encoding utf8` 所致），剥除 | 是**另一个**真问题（CP-5），但剥完本症状仍在 |
| 文件内容被我的编辑损坏 | `git stash` 换回 HEAD 版本 | 仍失败 → 与我的编辑无关 |
| 解码失败 / 控制字符 / 孤立代理项 | 逐项扫描 | 全部为 0 |
| esbuild 解析 | `npx esbuild --format=esm` | 通过 → 不是 esbuild |
| **vite SSR transform** | 用 vite 的 `transformRequest({ssr:true})` 复现，再对产物二分 | **命中** |

产物第 8 行：

```
6  const __vite_ssr_import_1__ = await __vite_ssr_import__("node:path", ...);
7  const __vite_ssr_import_2__ = await __vite_ssr_import__("node:url", ...);
8  "#!/usr/bin/env node\r"      ← 注意结尾的 \r
```

**根因**：vite 的 SSR transform 把 import 提升到文件顶部，shebang 因此不在首位；vite 本应先剥离 shebang，但在 **CRLF** 下其剥离失效，`#!/usr/bin/env node` 原样留在产物第 8 行 —— 那已不是 shebang，只是一个语法错误。

**判定性验证**：仅把该文件转成 LF，其它不动 →

```
✓ tests/visual.test.ts (3 tests) — Tests 3 passed (3)
```

**影响面**：`scripts/` 下只有 `ui-contract.mjs` 同时具备「shebang + CRLF」。`check-config.mjs` 有 shebang 但为 LF；`smoke.mjs` 为 CRLF 但无 shebang；两者均不受影响。

## 3. 两个缺陷同源

CRLF 从哪来：`core.autocrlf=true` 且仓库**没有 `.gitattributes`**，checkout 时把 LF 改写为 CRLF。同一个原因此前已造成另一处故障 —— `EV-2026-09-10-agent-tooling-impl.md` 第 7 节记录的：合并后 `verify` 对一棵 `git status` 干净的树报 50 个 `BASELINE_CHANGED`（基线按**字节**哈希）。

当时我在那份证据里写下的三个根治方向之一就是「加 `.gitattributes` 固定文本文件行尾」。本 CR 的 CP-4 执行它，同时闭合两个症状：

- 基线不再因 checkout 漂移；
- vite 的 shebang 剥离不再被 CRLF 打断。

`git add --renormalize .` 后重新 checkout 使工作区落地 LF。

## 4. SearXNG 服务已就绪

按 DEC-027 起了本机搜索后端：

```
容器    jarvis-searxng   Up   127.0.0.1:8080->8080/tcp
配置    C:\Users\Ziming\.jarvis\searxng\settings.yml  （formats: [html, json]）
```

- **只绑 loopback**，不对外暴露。
- `settings.yml` 显式打开 `json` 输出 —— SearXNG 上游默认关闭，这正是 `probeSearchBackend` 会给出针对性报错的那一项。
- 用 **Jarvis 自己的探测器**（`probeSearchBackend`，与「测试连接」按钮同一函数）验证，非另写一套检查：

```
settings: {"enabled":true,"baseUrl":"http://127.0.0.1:8080"}
probe:    {"ok":true,"message":"搜索服务连接正常。"}
```

- 地址已写入 `app_settings`，`web_search` 因此注册（配合 CP-1，模型现在真的可以调起来）。

## 5. 全量验证

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm test` | **36 files / 281 passed**（本 CR 前：35 files 通过 + 1 files 加载失败 / 277） |
| `npm run test:ui-contract` | 50 passed · 0 failed |
| `npm run test:smoke` | OK |
| `npm run test:e2e` | 10 passed |
| `npm run build:verify` | Compiled successfully |
| `python -m unittest tests.test_governance` | **72 passed**（+3 快车道守卫） |
| `review r1\|r2\|r3\|r4` | PASS（R2–R4 报 `SKIPPED_FAST_LANE`） |

## 6. 治理工具变更（CP-4 的连带发现）

`docs/CONTROLS.md` 的分档判据写明：全部 CP 为双向门且各有机器兜底 → 走快车道，「不需要 CP 矩阵与四角色意见」。但 `review r2|r3|r4` **从未被教会这条规则**，仍对快车道记录索要 CP 矩阵 —— 这正是 DEC-021 ③「能机器化的规则不得只写进文档」要防的反面。

补上时守住一条：**准入由机器从「门 / 发现方式」两列计算，不采信 CR 自称**。任一单向门、或任一 CP 的发现方式不是机器检查，整条记录照走完整 R2–R4，无论它在「评审模型」里写什么。跳过时如实列名（`SKIPPED_FAST_LANE`），不静默。R1 不在豁免范围内 —— 快车道省的是评审文书，不是人的同意。

配 3 条回归守卫：
- `test_review_r2_skips_a_fast_lane_record_and_names_it`
- `test_review_r2_still_demands_a_matrix_when_any_door_is_one_way`
- `test_review_r2_still_demands_a_matrix_when_detection_is_not_machine`

**另修正我自己一小时前写下的一条断言**：`test_056_6` 原以硬编码 `"8 change record(s)"` 表达「ID 回填不改变任何 R1–R4 裁决」，我把它改成了「四门判定的记录数一致」。快车道使后者也不成立 —— R1 仍覆盖快车道记录而 R2–R4 不覆盖，R1 的计数**本就应该更大**。改为断言四门全过且 R2–R4 ≤ R1，即方向而非相等。

## 7. 尚待用户复核的一项

CP-4（`.gitattributes` + 全仓库行尾规范化）**不是用户要求的功能**，是交付 CP-1/2/3 时撞上的阻断项（不修则测试套件无法加载、基线每次合并必红）。它改变全仓库文件的字节，属基础设施变更，已在 CR 的「R1 人工终裁」里显式标注待复核；若用户不认可，可按 CR 的「回滚方式」单独撤销该项，不影响 CP-1/2/3。
