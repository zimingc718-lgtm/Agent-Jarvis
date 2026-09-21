# CR-20260921-markitdown-display

- 级别: L2（标准档：全部 CP 双向门——代码改动可 `git revert`，Railway 部署配置改动可回滚到上一次成功部署；无真实用户数据被改写或删除，与 CR-20260918-per-user-data-isolation 的风险类别不同）
- 提出人: user（INPUT-2026-09-21-001）
- 状态: P3/P4 完成，待合并（R1-R4 全 PASS；本机真实入口已完成——真实生产构建上打真实 `/api/documents/raw`，携带此前被 Edge 拦截的真实 PDF，返回 text/html、含真实表格、不含原始 PDF 字节；Railway 生产部署的真实入口验证待合并后执行，见「验收条件」）
- 占用 ID: REQ-F-280, DEC-390, DEC-391, TASK-510, TASK-511, TEST-510, TEST-511
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-110（本地文档展示，方式改写）、REQ-F-220/REQ-F-230（资料库展示，方式改写）
- 影响模块: MOD-DOCUMENTS（新增 markitdown 封装）
- 影响任务: 无既有任务变更，新增 TASK-510/511
- 影响测试: 无既有测试变更，新增 TEST-510, TEST-511
- 当前证据: `project/05_evidence/EV-2026-09-21-markitdown-display.md`
- 方案选项:
  - A. 继续用自写的 `pdf-text.ts`/`docxXmlToText` 做原始字节直传（现状）——否决：本次问题的直接起因就是浏览器把生产域名下的 PDF 二进制当高风险下载拦截（Microsoft Edge SmartScreen 文件信誉检查，与站点信誉是两层独立机制，已用本机 localhost 复现排除"新域名信誉"这个此前的误判），且自写 PDF 提取器不还原表格/版式，用户主动要求换更好的方案。
  - B. 只在浏览器端加"下载后手动信任"提示，不改动服务端——否决：治标不治本，每份新文件、每个用户都要重新点一次"仍然保留"，且已验证组织策略托管的 Edge 可能整体关闭这个选项，不可靠。
  - C. **`/api/documents/raw` 对 PDF/DOCX 改用 markitdown 转换后的 Markdown 渲染显示，原始字节仍可按需下载**——选中：从根子上避免浏览器把响应当"PDF 下载"处理（不再触发文件类型信誉检查），转换过程只做结构转换（标题/列表/表格），不做语义改写，满足用户"尽量保持原文"的要求；markitdown 本身对表格/版式的还原明显好于自写提取器（本次会话已用真实 PDF 实测，55,925 字符的结构化 Markdown，含 Markdown 表格）。
- 选择理由: 见方案 C；用户已就"直接把 markitdown 接入生产运行时"（而非另写纯 TypeScript 提取逻辑）与"只整理排版、不用模型改写措辞"两点通过 AskUserQuestion 明确拍板。
- 回滚方式:
  - 代码：`git revert` 本 CR 的合并提交，重建重启（`npm run build:local && npm run serve:local`），`/api/documents/raw` 立刻恢复原始字节直传；不涉及任何已持久化数据格式变更（`.data/` 下没有新增或改写任何文件），因此代码回滚没有数据层残留需要清理。
  - Railway 部署：若新增的 Python 运行时导致构建失败或体积/构建时间显著恶化，`railway rollback`（或重新指向上一次成功的 GitHub 提交并重新部署）即可恢复；Python 依赖只影响构建产物，不影响已挂载存储卷上的任何数据。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260921-markitdown-display` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: TASK-510/511 DONE；TEST-510/511 PASS；`npx tsc --noEmit` 0 错误；`npx vitest run` 全量绿。
  - **真实入口（本地 + Railway 各一次）**：①**已完成**——本机重建重启生产构建后，真实 curl 打 `/api/documents/raw`，携带此前被 Edge SmartScreen 拦截过的真实 PDF 的 id，返回 HTTP 200、`Content-Type: text/html`（不再是 `application/pdf`），响应体含 6 个真实 `<table>` 元素与文档真实标题文本，且确认不含原始 PDF 的 `%PDF` 字节标记；②**待执行**——Railway 重新部署后，确认构建成功（`railway logs --build` 看到 markitdown/Python 依赖安装成功、`next build` 成功）且线上同一份文档能正常打开，结果记入 `EV-2026-09-21-markitdown-display.md`；③**已完成一部分**——本机这次转换的文档已人工核对与原 PDF 逐段一致（真实标题「Diablo 400」、6 个表格均正确转换），Railway 部署后再抽查至少 1 份作为第二次独立核对。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：待用户拍板。
- R1 终裁: 已完成 | 用户 | 2026-09-21

签署经过（如实登记，紧邻上一行但不在同一行，避免混入 `review r1` 的严格签署行匹配）：协调会话给用户展示了方案概要（`/api/documents/raw` 对 PDF/DOCX 改用 markitdown 转换后的 Markdown 渲染显示，原始字节仍可下载，HTML/纯文本保持原样；Railway 部署新增 Python 运行时依赖），用户通过 AskUserQuestion 选择「同意，按方案推进」。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 文档展示（本地文档 + 资料库）改为 markitdown 转换后的 Markdown 渲染，原始字节仍可下载；只整理排版结构，不做语义改写 | REQ-F-280（新增） | 新增 | 双向 | 真实入口：本机打开一份已知会被 Edge 拦截的真实 PDF，确认改用 Markdown 渲染后能正常显示 |
| CP-2 | 架构 | 新增 `src/lib/markitdown.ts`：子进程调用 `markitdown` CLI 做 PDF/DOCX → Markdown 转换，超时/失败时如实报错并保留"下载原始字节"的兜底入口，不静默回退成旧的自写提取器（避免用户以为转换生效了、实际读到的还是旧格式） | DEC-390（新增） | 新增 | 双向 | 机器：`tests/markitdown.test.ts` 覆盖成功/超时/CLI 缺失/非 PDF-DOCX 直通四种路径 |
| CP-3 | 架构 | 生产运行时新增 Python 3 + `markitdown[pdf]` 依赖（Railway Railpack 构建配置改动，需要新增 `requirements.txt` 或等价声明让 Railpack 识别 Python）——项目此前"零新增运行依赖"的惯例在此被有意打破，用户已知情并要求这样做 | DEC-391（新增） | 新增 | 双向 | 真实入口：Railway 重新部署，`railway logs --build` 确认 Python + markitdown 安装成功、`next build` 成功、线上路由真实可用 |
| CP-4 | 模块 | `/api/documents/raw` 路由分支：PDF/DOCX 扩展名先过 `markitdown.ts` 转换、失败时返回明确错误（而不是回退成原始字节，避免"看起来能用但其实是旧行为"）；HTML/纯文本扩展名保持原样直传（不受 Edge 文件类型拦截影响，无需改动） | TASK-510 | 新增 | 双向 | 机器：改造后的路由测试覆盖 PDF/DOCX 走新路径、HTML/txt 路径不变 |
| CP-5 | 测试 | 新增 `tests/markitdown.test.ts`（模块单测）与改造 `tests/documents-raw-route.test.ts`（路由集成，如原文件不存在则新建） | TEST-510, TEST-511 | 新增 | 双向 | 机器：`npx vitest run tests/markitdown.test.ts tests/documents-raw-route.test.ts` |

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260921-markitdown-display` 节后，跑 `governance.py matrix CR-20260921-markitdown-display` 生成矩阵骨架，再逐格填裁决。

## R2 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 展示方式改为结构化渲染，原始字节仍可下载，符合「尽量保持原文」的用户裁定 | APPROVED 新增 REQ-F-280 对应 DEC-390 的转换设计，未触碰既有 REQ-F-110/220/230 的内容层含义 | APPROVED 落点单一（`/api/documents/raw`），不牵动 `read_document`/`search_documents` 工具消费路径 | APPROVED 真实入口步骤（本机打开一份真实拦截过的 PDF）已在 CR 文档「验收条件」写明，非机器空断言 |
| CP-2 | APPROVED 转换失败时明确报错并给出 `raw=1` 出口，不会让用户以为功能生效实际读到旧格式 | APPROVED 两段式（markitdown 抽取 + python-markdown 渲染）全留在 Python 侧，转换链路单一语言、单一可测试入口脚本，理由见 DEC-390 | APPROVED `execFile` 传参数数组不经 shell，`absPath` 已经过 `resolveWithinRoots` 校验，无新增注入面 | APPROVED `tests/markitdown.test.ts` 覆盖成功/解释器缺失/真实失败不重试/超时/空输出五类路径，全部 mock 不依赖真实环境 |
| CP-3 | APPROVED 用户已知情并要求直接引入 Python 到生产运行时，接受「零新增运行依赖」惯例被打破 | APPROVED `railpack.json` 显式钉 provider 为 node、避免 Railpack 因 `requirements.txt` 存在而误判成 Python 项目（已查证 Railpack 官方文档明确的已知坑） | APPROVED 部署配置改动与应用代码解耦，`requirements.txt`/`railpack.json` 不影响本机开发环境 | CONDITIONAL 机器测试无法证明 Railway 真实构建成功——条件为按「验收条件」在真实部署上核对 `railway logs --build`，结果补记入 EV 文档 |
| CP-4 | APPROVED HTML/纯文本扩展名不受影响，改动面精确限定在 PDF/DOCX 这两类会被浏览器当文件下载的类型 | APPROVED 复用既有 `buildInsightDocument`（洞察展示的 HTML 包装函数），未新增一套并行的展示层包装逻辑 | APPROVED 路由内一处 `if (CONVERTIBLE_EXTENSIONS.has(ext) && !wantsRawBytes)` 分支，改动集中、无散落判断 | APPROVED `tests/document-raw-route.test.ts` 改造后的用例逐一覆盖：采纳闸在前、转换在后、`raw=1` 出口、转换失败 502 |
| CP-5 | APPROVED 测试范围与验收条件的机器可证部分一一对应 | APPROVED 沿用既有 `web-reading.test.ts` 建立的「外部边界全 mock」惯例，未引入新的测试基础设施 | APPROVED 新增测试文件命名与既有 `document-raw-route.test.ts` 一致，未产生第二套平行命名 | APPROVED 13 个新增/改造用例全部通过，`npx vitest run` 全量 895 个用例仅 1 个与本 CR 无关的既有 flaky 用例（已用 git stash 复现于干净基线，如实登记非本 CR 引入） |

## R3 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-511 精确对应 REQ-F-280 的验收条件①②③ | APPROVED 落点与 DEC-390 一致，未产生额外的隐藏模块边界 | APPROVED `/api/documents/raw` 是本层唯一改动文件，改动范围可审阅、可回滚 | APPROVED TEST-511 覆盖 TASK-511 的全部分支（转换成功/失败/`raw=1`/既有非转换路径不变） |
| CP-2 | APPROVED TASK-510 的封装边界（转换失败即报错、不静默降级）直接落实产品对「如实报错」的要求 | APPROVED `convertToHtml`/`describeMarkitdownFailure` 两个导出函数职责单一，与 DEC-390 的设计描述一致 | APPROVED 新增 `src/lib/markitdown.ts` + `scripts/documents_to_html.py` 两个文件，无跨目录散落 | APPROVED TEST-510 六个用例逐一对应 TASK-510 列出的分类边界 |
| CP-3 | APPROVED 部署配置改动对用户可见行为无直接影响，属于「让 CP-1/CP-2 能在生产上运行」的基础设施任务，未单独占用任务号 | APPROVED 与 DEC-391 描述一致，`railpack.json`/`requirements.txt` 均已落盘且通过 JSON 语法校验 | APPROVED 两个配置文件均为仓库根级声明式文件，非需要单测覆盖的可执行代码 | CONDITIONAL 同 R2/CP-3，条件为真实部署验证，非本层遗漏 |
| CP-4 | APPROVED 与 CP-1 是同一件事在模块层的落点，未重复占号 | APPROVED 路由改造未新增额外的架构决策，沿用 DEC-390 的转换设计 | APPROVED TASK-511 明确写出四个分支（转换成功/失败/`raw=1`/非转换类型），改动可对照验收 | APPROVED TEST-511 逐分支覆盖，见 R3/CP-1 |
| CP-5 | APPROVED 无产品层遗留问题 | APPROVED 测试改造未引入新的 mock 基础设施，复用既有 `vi.mock`/`vi.importActual` 惯例 | APPROVED `tests/markitdown.test.ts`/`tests/document-raw-route.test.ts` 与其覆盖的源文件一一对应，无交叉覆盖真空 | APPROVED 见 R2/CP-5 |

## R4 评审矩阵

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 验收条件①②③均有对应的真实入口或人工核对步骤，非纯机器断言充数 | APPROVED TEST-511 验证的是 DEC-390 设计的实际接线效果，不是重新断言设计本身 | APPROVED TEST-511 与 TASK-511 一一对应，见 R3 | APPROVED `npx vitest run tests/document-raw-route.test.ts` 7 例全绿，已本机实测 |
| CP-2 | APPROVED 转换失败的用户可见文案（`describeMarkitdownFailure`）逐条有测试覆盖，不会把内部错误堆栈泄露给用户 | APPROVED TEST-510 覆盖 DEC-390 特别强调的「真实失败不掩盖」这条设计约束（用例③） | APPROVED TEST-510 与 TASK-510 一一对应，见 R3 | APPROVED `npx vitest run tests/markitdown.test.ts` 6 例全绿，已本机实测；另有一次不经 mock 的真实脚本调用（`python scripts/documents_to_html.py`，退出码 0，58,351 字节 HTML 含真实表格），证明 mock 断言的行为与真实子进程行为一致 |
| CP-3 | CONDITIONAL 与其余三列同一条件——真实 Railway 部署验证 | CONDITIONAL DEC-391 的设计正确性（`railpack.json` 钉 node provider + 追加 pip install）已可机器/人工核对配置文件本身，但「Railway 真实构建是否真的成功」只有真实部署能回答，条件同测试列 | CONDITIONAL 部署配置文件本身无代码可测，「是否真的部署得起来」同样是条件，条件同测试列 | CONDITIONAL 机器测试无法覆盖「Railway 真实构建是否成功」这件事，按 CR 文档「验收条件」在合并后的真实部署步骤中执行，结果记入 `EV-2026-09-21-markitdown-display.md` 后本条转 APPROVED，此前 R1 终裁不视为已满足全部验收条件 |
| CP-4 | APPROVED 同 R4/CP-1 | APPROVED 同 R4/CP-1 | APPROVED 同 R4/CP-1 | APPROVED 同 R4/CP-1 |
| CP-5 | APPROVED 测试范围完整覆盖 CP-1..CP-4 的机器可证部分 | APPROVED 无遗留 mock 债务，`vi.importActual` 保留了 `describeMarkitdownFailure` 的真实实现而不是整体 mock 掉 | APPROVED 无遗留覆盖真空 | APPROVED 全量回归 `npx vitest run` 895 例，仅 1 例既有 flaky（已排除与本 CR 相关），非本 CR 引入的新回归 |
