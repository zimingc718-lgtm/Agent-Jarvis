# EV-2026-09-18-library-in-board

- 来源: `CR-20260918-library-in-board` 实施（隔离 worktree，Wave 1 四条 CR 之一）
- 时间: 2026-09-18
- 采集者: Claude（模块开发 + 测试角色，fork 子代理；真实入口部分由协调会话补齐）
- 支撑对象: TASK-452、TASK-453、TEST-452、TEST-453、REQ-F-242 ⑥、DEC-347
- 可定位路径: 本文件；提交见 `cr/20260918-library-in-board` 分支历史（`git log` 为准）

本文件由协调会话在收口时补建——fork 交付时的证据留在 CR 文档本身（`## 问题经过`、`## 变化点登记`），未单独创建 EV 文件；这里把单测与真实入口的确切结果集中记录一份。

## 1. 机器证据

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误（fork 自报） |
| `npx vitest run tests/knowledge-dashboard.test.tsx tests/library-panel.test.tsx` | 38/38（29 例 + 既有 9 例零回归，fork 自报） |
| `npx vitest run`（全量，协调会话在合并全部 7 条 CR 后复核） | 94 个测试文件、875 个用例全绿 |

## 2. 真实入口（协调会话已执行，结果 PASS）

- 来源: `scripts/probe-library-in-board.mjs`
- 时间: 2026-09-18
- 采集者: 协调会话（claude-sonnet-5），针对用户本机 `npm run build:local && npm run serve:local`（端口 3000，全部 7 条 2026-09-18 批次 CR 均已合并）的真实生产构建服务
- 输出:
  ```
  统一浏览共 7 条（看板板块与 ☰ 面板共用同一条 API）
  看板已挂载
  看板正文里的「资料库」板块已出现（改名生效，不再是「知识库总览」）
  REQ-F-170 无归属计数仍在：是（"共 7 条 · 无归属 7 条"）
  板块内可见卡片数：15
  「查看原文」链接：/api/documents/raw?id=资料库/AIDC-供电架构与电网/03_原文_电网/G43_gbDetailed.html
  PASS 看板里的「资料库」板块可用：REQ-F-170 计数保留、15 张卡片、原文链接=...（不足一页，未触发翻页）
  ```
- 判定: **PASS**

**局限（如实登记）**：真实数据量不足一页，分页交互本身没有被这次真实数据触发——不用假数据伪造出触发分页的场景，如实记为未覆盖的边界情形，不影响本 CR 其余核对项的判定。item 4（对话检索资料库 + 展示屏直显原件）依赖的两条既有真实入口探针（`probe-library-chat.mjs`、`probe-document-display.mjs`）未在本次收口中重跑——本 CR 未改动它们依赖的任何代码路径，风险低，但如实标注为"未重新确认"而非"已确认不受影响"。
