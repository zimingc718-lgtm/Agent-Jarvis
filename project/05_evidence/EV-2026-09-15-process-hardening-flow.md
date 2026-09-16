# EV-2026-09-15-process-hardening-flow

- 来源: 用户 2026-09-15 连续撞到两个「测试全绿、门禁全过，问题仍在」的例子后要求「先分析需求与变更点，再优化这个 AI coding 流程脚本，补救仅是其次」
- 时间: 2026-09-15
- 采集者: 助手（claude-opus-5 主导，两处委派 claude-sonnet-5 并行子代理起草并验证；均在本仓库真实工作树上执行）
- 支撑对象: `CR-20260915-process-hardening-flow` CP-1..CP-5
- 可定位路径: 本文件；`tools/governance.py`、`tests/test_governance.py`、`scripts/check-module-graph.mjs`、`scripts/gen-index.mjs`、`tests/module-graph.test.ts`、`docs/INDEX.md`

## 1. 三份只读审计（起草前置证据）

用户授权多代理并行后，先跑三个只读审计摸清「为什么没发现」，全部只读、未改动任何文件：

| 审计 | 范围 | 关键数字 |
|---|---|---|
| CP 发现方式分层 | `project/06_changes/*.md` 全部 65 份记录，352 行 CP | 37%（103/279）未点名任何 TEST；27 行确属「触达用户控件却只有非 UI 断言」；25 行声称真实入口但 CR 头部无登记行 |
| 需求↔测试↔文件索引 | 98 REQ、149 TEST（主矩阵后核实为 135 条干净行）、144 TASK | 5 条 TEST 命令列本身指不到任何脚本或文件；3 个孤儿测试文件；`TEST-011` 编号漂移 |
| 依赖图与源码卫生 | `src/lib` 40 文件 98 条边；`src/`/`tests/`/`scripts/`/`tools/` 全量字节扫描 | 0 环（今天）；2 处字面 NUL（`sweep.ts`、`tests/sweep.test.ts`） |

## 2. 机器口径与人工审计口径的一处已核实差异

`check_real_entry` 新增的 `REAL_ENTRY_CLAIM_UNREGISTERED` 在真实仓库上报 **43** 条，审计报告给的是 **25** 条。逐一核对差额来源：`CR-20260910-agent-tooling`（43 行 CP 里 15 行属此类）等老 CR 完全没有 `- 真实入口:` 头部行，只在验收条件的散文里提过「真实入口冒烟覆盖……」，人工审计逐份通读 65 份记录时把这类散文提及误当成了登记。机器口径按精确的行首正则匹配，更可信，予以采纳；差异已记入本证据与 CR 正文，不静默吞掉。

## 3. 六条检查，各自「先红后绿」的证据

| 检查 | 改前（真实证据） | 改后 |
|---|---|---|
| `check-hygiene` | `src/lib/sweep.ts`、`tests/sweep.test.ts` 各有一处字面 NUL 字节（复合键分隔符），`git ls-files --eol` 显示 `i/-text`——git 已把这两个文件当二进制处理 | 改为转义写法后 `i/lf`；`check-hygiene` 在真实仓库上 `OK SOURCE_HYGIENE_PASS 219 file(s) scanned` |
| `check-module-graph` | 无历史违规可复现（今天的近失事故已被修复），改用构造夹具验证：成环（含仅靠 `import type` 闭合的环）、跨层引用、组件值引用 `node:fs`，三类均被抓到；`import type` 到 `node:fs` 正确不误报 | 真实仓库 `OK MODULE_GRAPH_PASS 109 files scanned, 0 cycle(s), 0 layering violation(s), 0 client/server violation(s)` |
| `check-test-commands` | 改前对真实仓库跑，精确抓到审计发现的全部 5 条：TEST-037/065/066/070/072 | 6 处命令列修正（含 `TEST-011` 的编号漂移）后 `OK TEST_COMMANDS_PASS 135 TEST command(s) resolve` |
| `check-ui-route` | 构造夹具：`机器（UI）：TEST-xxx` 指向真驱动 UI 的测试 → PASS；指向纯断言测试 → `FAIL UI_ROUTE_NOT_DRIVEN`；未点名 TEST id → `FAIL UI_ROUTE_UNNAMED` | 真实仓库今天 0 处使用该标记，`OK UI_ROUTE_PASS 0 route(s) verified`——新规则只作用于新内容 |
| `check_real_entry`（`REAL_ENTRY_CLAIM_UNREGISTERED`） | 构造夹具：CR 头部有 `- 真实入口:` 行（任意内容）→ discharge；无该行 → 该 CR 内声明真实入口的 CP 被点名 | 真实仓库 `OK ADVISORY REAL_ENTRY_CLAIM_UNREGISTERED 43 route(s) ...`（advisory，不拦） |
| `check-index` | 手改 `docs/INDEX.md` 一个字符 → `FAIL INDEX_STALE`；复原 → `OK INDEX_PASS` | 每次三层说明书或 `package.json` 变动后跑 `npm run docs:index` 重新生成，本 CR 自身触发过两次重新生成（新增 CP 条目、修正 6 处命令列后各一次） |

## 4. 多代理并行执行的实际情况（如实记录）

用户明确授权「多 agent 工作」后，两个隔离 worktree 子代理并行承接 CP-2（模块依赖图）与 CP-5（生成式索引）：

- **CP-2 子代理**：耗时约 17 分钟后触发「600 秒无进展」看门狗判定为 stalled/failed。检查其 worktree 发现产出已基本完整（`scripts/check-module-graph.mjs`、`scripts/check-module-graph.d.mts`、`tests/module-graph.test.ts`），但停在自我修复一个字面 NUL 字节的过程中；额外发现一处 `//` 注释符丢失导致的语法错误（`# documents...` 单独一行，`.mjs` 里 `#` 不是合法注释起始）。两处修复后该产出即完全可用（23/23 测试通过，真实仓库 0 违规），**予以采纳，未重写**。
- **CP-5 子代理**：耗时约 2.5 小时（164 次工具调用）才完成，显著超出预期。中途检查其 worktree 发现已产出可用文件，遂提前提取（同样撞上一次字面 NUL 字节事故，另有一处误留的 Python 风格 `#` 注释导致的 JS 语法错误，均已修复）；子代理最终完成后，其成品在关键 bug 修复上比中途提取版本更完整（一处未转义竖线导致行被错误切分的问题），已用最终版覆盖并重新验证。

**同一形状的字面控制字符事故在本次会话里一共发生了 5 次**（本人此前在 insight-export.ts / library.ts 各一次，两个子代理本次各一次，外加撰写本文件这句话本身时又一次——都发生在注释或分隔符里试图用文字描述转义写法的时候）。这看起来是工具调用文本传输链路上的一个可复现问题，不是任何一次具体编码疏忽；已计划用 SendFeedback 报告。

## 5. 局限（如实登记）

- `check-ui-route` 与 `check-index` 今天在真实仓库上都是零覆盖/零违规起步，新规则不追溯改写历史；27 条已知 UI 缺口的具体补测归后续 CR（CR-A/CR-B 顺路补，两条恰好覆盖 `scheduled-sweep` CP-1 与 `settings-on-display` CP-4 这两个用户亲身撞到的例子）。
- `check-module-graph` 是正则扫描，不是真正的解析器：模板字面量嵌套反引号会使扫描器失步（已注释说明，未见于本仓库现有用法）。
- CLAUDE.md、`docs/WORKFLOW.md`、`docs/CONTROLS.md` 的两条流程纪律（INPUT 先落号、UI 类 CR 收口带真实入口步骤清单）机器管不住「有没有照做」，如实登记为文档而非门禁。
