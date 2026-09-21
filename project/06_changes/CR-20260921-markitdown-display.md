# CR-20260921-markitdown-display

- 级别: L2（标准档：全部 CP 双向门——代码改动可 `git revert`，Railway 部署配置改动可回滚到上一次成功部署；无真实用户数据被改写或删除，与 CR-20260918-per-user-data-isolation 的风险类别不同）
- 提出人: user（INPUT-2026-09-21-001）
- 状态: R1 待人工终裁
- 占用 ID: REQ-F-280, DEC-390, DEC-391, TASK-510, TASK-511, TEST-510, TEST-511
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: REQ-F-110（本地文档展示，方式改写）、REQ-F-220/REQ-F-230（资料库展示，方式改写）
- 影响模块: MOD-DOCUMENTS（新增 markitdown 封装）
- 影响任务: 无既有任务变更，新增 TASK-510/511
- 影响测试: 无既有测试变更，新增 TEST-510/511
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
  - **真实入口（本地 + Railway 各一次）**：①本机打开一份此前被 Edge 拦截的真实 PDF（本次会话已确认的那份"资料库"文档），确认展示屏/新标签页能正常显示转换后的 Markdown 内容，不再触发浏览器拦截；②Railway 重新部署后，确认构建成功（`railway logs --build` 看到 markitdown/Python 依赖安装成功、`next build` 成功）且线上同一份文档能正常打开；③抽查转换结果与原 PDF 逐段核对内容一致（不是机器能断言的事，人工目测抽查至少 2 份）。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：待用户拍板。
- R1 终裁: 未完成（用户拍板后改为：已完成 | 用户 | YYYY-MM-DD）

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
