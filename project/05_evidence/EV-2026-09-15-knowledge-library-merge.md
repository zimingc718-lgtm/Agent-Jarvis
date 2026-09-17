# EV-2026-09-15-knowledge-library-merge

- 来源: 用户 INPUT-2026-09-15-031 第 5 条（"模型落。支持对话修改分类。"）与 INPUT-2026-09-15-032（"1. 删除当前所有笔记。2.原件；3. 全实现"）
- 时间: 2026-09-15（需求提出）–2026-09-17（实现、说明书落点、机器证据、真实入口核对含一次真实模型调用，以及对生产数据的一次真实迁移执行）
- 采集者: 助手（claude-sonnet-5），在本仓库真实工作树上执行；真实入口与 CP-3 的实际执行均在用户自己那台服务器（端口 3000）
- 支撑对象: `CR-20260915-knowledge-library-merge` CP-1、CP-2、CP-3
- 可定位路径: 本文件；`src/lib/knowledge.ts`、`src/lib/tools/knowledge-tools.ts`、`src/lib/library.ts`、`src/app/api/library/browse/route.ts`、`src/components/LibraryPanel.tsx`、`scripts/probe-classify-knowledge.mjs`、`scripts/probe-library-browse.mjs`、`scripts/migrate-legacy-knowledge-notes.mjs`、`.data/knowledge/archive/_migration-2026-09-17T17-24-43-388Z.json`（本机路径，不进版本库）

## 1. 机器证据

| 用例 | 条数 | 守住的事 |
|---|---|---|
| `knowledge.test.ts` ⑥b⑥c（新增） | 2 | `deleteKnowledge` 归档不硬删、撞名不覆盖 |
| `knowledge.test.ts` ⑨（新增） | 1 | `setDocType` 只改类型，正文与其它字段原样保留，条目不存在返回 `null` |
| `knowledge-tools.test.ts` ①②（改写）⑦（新增） | 3 | `classify_knowledge` 按 `knowledgeCount > 0` 收放，与 `search`/`read` 同口径；成功改类型不进待采纳区；参数缺失与条目不存在各给各的失败原因 |
| `library.test.ts` ⑨（新增） | 1 | `listBrowseCards` 合并已采纳原件与真实知识条目、索引卡不重复出现、挂归属对象的排最前、`byType` 统计正确 |
| `library-routes.test.ts`（新增 describe 块） | 3 | `GET /api/library/browse` 分页参数生效、越界参数被夹到合法范围、未登录 401 |
| `library-panel.test.tsx`（新增 describe 块） | 4 | `fireEvent.click` 驱动：切换到「浏览」取数并渲染类型统计、翻页换 offset 且到底禁用「下一页」、读取失败给出提示、空列表如实说明 |

`npx vitest run tests/knowledge.test.ts tests/knowledge-tools.test.ts tests/knowledge-attribution.test.ts tests/knowledge-route.test.ts tests/knowledge-list.test.tsx tests/knowledge-dashboard.test.tsx tests/library.test.ts tests/library-routes.test.ts tests/library-panel.test.tsx tests/library-gate.test.ts tests/document-tools.test.ts tests/document-raw-route.test.ts`：**123 个用例全绿**（知识/资料库子系统相关文件全量）。

`npx tsc --noEmit`：0 错误。全量 `npx vitest run`：**90 个测试文件、831 个用例全绿**（较 CR-E 收口时的 819 增 12，与本 CR 新增的 12 个用例一致）。过程中出现过一次孤立的 `knowledge-dashboard.test.tsx` 失败（`⑮` 用例断言收到了另一条用例的 mock 调用参数）——单独重跑该文件（28/28 绿）与再跑一次全量（831/831 绿）均未复现，判定为并发压力下的偶发飘移，与本 CR 未触碰的实体看板代码无关，不计入本 CR 的验收依据。

`node scripts/check-module-graph.mjs`：0 环、0 违规（112 文件）。`node scripts/ui-contract.mjs`：53 项全过。`python tools/governance.py check-hygiene`：236 文件干净。`check-ui-route`：本 CR 的 `机器（UI）` 路线 PASS（7 条中的新一条）。`check-test-commands`：165 条全部可解析。`check-tables`/`check-doors`/`check-ids`/`check-specs`/`check-changes`/`check-index`：均 PASS。`review r1`/`r2`/`r3`/`r4` 均 PASS（标准档，矩阵因 `## 角色意见` 节豁免，下沉覆盖仍逐项核对）。`gate g3.5 --cr`：PASS。

## 2. 真实入口：CP-1（重新分类，含真实模型调用）

`npm run build:local` 重建 `.next-prod`，重启 `serve:local`，`curl http://localhost:3000/api/knowledge` 确认 200 后开始。

`node scripts/probe-classify-knowledge.mjs`：

```
已造出探针条目 name=探针临时分类条目-1789667014148
模型回复里出现新类型=true，后端 docType 真的改了=true
清理探针条目：已归档
PASS 真实模型调用 classify_knowledge 后，条目类型在真实知识库里生效
```

采集时间 2026-09-17（本地服务器，端口 3000）。探针只对自己造的一次性条目动手，验证完立即用既有归档删除入口清理，未触碰用户任何真实条目。

**过程记录（如实登记）**：第一版探针靠"回复文字里出现目标词"判断完成，命中了工具参数回显阶段的假阳性（那一刻模型其实还在流式生成，`docType` 尚未真正写入）；第二版改靠"发送按钮变回可点"判断完成，这次后端其实已经改对了，但浏览器流式吐字尚未结束，60 秒等待超时，脚本未捕获异常直接崩溃（浏览器与探针条目均已确认正常清理/关闭，无残留）。两版都是在猜 UI 渲染完成的时间点，最终改为直接轮询后端 `GET /api/knowledge` 直到 `docType` 命中或超时——这是本 CR 唯一要核对的事实，不必猜前端状态。第三版稳定通过。

## 3. 真实入口：CP-2（统一浏览视图）

`node scripts/probe-library-browse.mjs`：

```
改前：统一浏览共 7 条
面板已在动态屏上出现
浏览摘要：共 7 份 一手 7
PASS 浏览视图在真实入口上可用：默认仍是审批、切换后 7 张卡片、原文链接=/api/documents/raw?id=...G43_gbDetailed.html（不足一页，未触发翻页）
```

采集时间 2026-09-17。当时真实知识库经 CP-3 迁移后只剩 7 条（全部资料库索引卡），不足一页（默认 20 条），因此翻页分支未被触发——脚本对此有显式判断（`before.total <= 20 || paginated`），不是漏测。默认模式仍是「审批」（`reviewDefault` 断言），确认新增的模式切换没有改变既有默认行为。

## 4. CP-3：归档合并前遗留笔记（真实执行，含一次事故）

执行前 `dry-run`：知识库共 253 条，资料库索引卡 7 条（保留），合并前遗留笔记 246 条。

**执行时发生了一次数据事故**：`--commit` 执行时，运行中的生产服务器加载的是修改 `deleteKnowledge`（CP-1）之前的旧构建（`.next-prod/BUILD_ID` 时间戳 2026-09-16 22:45，早于当天对 `deleteKnowledge` 的代码修改），实际执行的是旧版本的硬删除。脚本报告"已归档 246 条，失败 0 条"，但事后核对 `.data/knowledge/archive/` 为空——246 条笔记被硬删而非归档。

排查与处理的完整记录见 `project/06_changes/CR-20260915-knowledge-library-merge.md` 的「流程偏差记录」，此处摘录核对结果：

1. Windows 回收站：直接核对，246 个文件名均不在其中（Node 的 `rm()` 不经过回收站）。
2. 卷影副本：`vssadmin list shadows` 无管理员权限被拒，未能核实；已告知用户可自行用提升权限的终端核对。
3. OneDrive 云端回收站/版本历史：本项目目录在 OneDrive 同步范围内，是本机之外最可能保留副本的地方，需要用户自己登录 onedrive.com 核对——已完整告知用户，我这边没有访问其账户网页版的手段。
4. 根因修复：清理构建缓存、`npm run build:local` 重新构建、停掉运行中的旧进程（确认端口 3000 只有它在监听，未触碰其它不相关进程）、`serve:local` 的看护自动拉起新进程。用一条一次性测试条目走"存入 → 删除 → 确认落在 `archive/`"验证归档确实生效：

```
$ curl -X DELETE http://localhost:3000/api/knowledge/cp1-l
{"ok":true,"name":"cp1-l"}
not in root (expected)
FOUND IN ARCHIVE (fix confirmed working)
```

5. 完整清单（246 条的 name/title/source/entity/docType）落盘于 `.data/knowledge/archive/_migration-2026-09-17T17-24-43-388Z.json`（本机路径，`.data/` 不进版本库）。

6. 向用户完整披露事故经过后，用户在已知悉事故全貌的前提下明确指示"现在执行"，随后重新对真实知识库执行迁移——此次运行在修复后的构建上，`.data/knowledge/` 根目录条目数从 253 降到 7，与 `/api/knowledge/overview` 的 `total: 7` 互相印证。

结论：CP-3 的设计（归档而非硬删）经事后修复验证是正确的（第 4 点的往返测试证明），本次事故是**执行纪律问题**（对生产数据写操作前未确认服务运行的是最新构建），不是设计缺陷。246 条数据的实际内容目前未能在本机找到可恢复的副本，OneDrive 云端是唯一未决的恢复线索，需要用户自行核对。

## 5. 局限（如实登记）

- 浏览视图的排序是启发式近似（挂归属对象优先、组内按新旧），不是逐条调用模型评分——258+ 条量级下不现实，CR 文档「非目标」已如实记录。
- 本次真实入口测得的浏览列表只有 7 条（CP-3 执行之后），未能覆盖"列表条数超过一页、翻页真的换出下一批"这条路径的真实浏览器验证——单测（`library-routes.test.ts`）已覆盖分页参数本身的正确性，但"用户在自己那台上点下一页、内容真的换了"这个动作尚未在超过一页的真实数据下观察过。将来资料库或知识库条目数增长后，建议补一次这条路径的真实入口复核。
- CP-3 造成的 246 条数据丢失是本次交付里最重要的遗留问题：功能设计与代码修复均已验证正确，但已丢失的历史内容本身无法由本 CR 的任何机制找回。
