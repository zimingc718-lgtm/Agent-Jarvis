# EV-2026-09-15-board-card-lifecycle

- 来源: 用户 INPUT-2026-09-15-029 第 2/3/4/5a 条（友商卡片可删；新增改用 `+` 卡片；规则与准入方、客户比照同一套行为）
- 时间: 2026-09-15（需求提出、实现）–2026-09-16（编排会话说明书落点、机器证据与真实入口核对）
- 采集者: 助手（claude-sonnet-5），在本仓库真实工作树上执行；真实入口部分在用户自己那台服务器（端口 3000）
- 支撑对象: `CR-20260915-board-card-lifecycle` CP-1、CP-2
- 可定位路径: 本文件；`src/lib/entities.ts`（`deleteEntity`/`ARCHIVE_DIR`）、`src/components/KnowledgeDashboard.tsx`（卡片删除按钮、`addCard`）、`scripts/probe-board-card-lifecycle.mjs`

## 1. 现场核对

`DELETE /api/entities/[name]` 路由与 `deleteEntity` 函数在本 CR 之前就已存在且能工作——缺的从来不是后端能力，是看板 UI 没有暴露删除入口，以及删除本身是硬删（`rm`），点错无法挽回。新增入口同理：`POST /api/entities` 早已存在，缺的是「新增」在 UI 上占了列表下方一整行常驻空间，不是用户要的卡片形态。

两个 CP 都改动局限在存量能力"怎么被用户摸到"这一层，不新增路由、不改请求形状、不改数据结构。

## 2. 机器证据

| 用例 | 条数 | 守住的事 |
|---|---|---|
| `entities.test.ts` ⑥ 删除是归档不是硬删 | 1 | 文件移进 `archive/`，内容原样可读，`listEntities`/`readEntity` 都不再看见它 |
| `entities.test.ts` ⑦ 归档撞名不覆盖 | 1 | 与 `saveEntity` 同一套 `uniqueName` 去重逻辑，两次删除同名对象各自留档 |
| `entities.test.ts` ⑧ 不存在的名字返回 false | 1 | 边界情况不抛异常、不创建多余目录 |
| `knowledge-dashboard.test.tsx` ㉖ 删除按钮先确认再发请求 | 1 | `window.confirm` 拦在真正的 DELETE 请求之前，确认后走既有路由，notice 显示「已删除」 |
| `knowledge-dashboard.test.tsx` ㉗ 取消确认框不发请求 | 1 | 卡片原样留着，`act` 未被以 DELETE 调用 |
| `knowledge-dashboard.test.tsx` ⑨/⑫/⑬（改写） | 3 | 空看板提示文案更新；三条泳道各自能新增，默认收拢成 `+`；空名不发请求，取消按钮能收回卡片 |

`npx vitest run tests/entities.test.ts tests/entity-route.test.ts tests/knowledge-dashboard.test.tsx`：**65 个用例全绿**（entities.test.ts 26、entity-route.test.ts 11、knowledge-dashboard.test.tsx 28）。`npx tsc --noEmit`：0 错误。全量 `npx vitest run`：**804 个用例全绿**（较 CR-B 收口时的 799 增 5：entities.test.ts 3 条 + knowledge-dashboard.test.tsx 2 条）。`node scripts/check-module-graph.mjs`：0 环 0 违规。`node scripts/ui-contract.mjs`：53 项全过。`python tools/governance.py check-ui-route`：本 CR 两条 `机器（UI）` 路线均 PASS。`check-tables`/`check-doors`/`check-ids`/`check-test-commands`/`check-hygiene`：均 PASS。

## 3. 真实入口（用户自己那台，端口 3000）

`npm run build:local` 重建 `.next-prod`，重启 `serve:local`（旧进程 PID 10660 是当天早些时候起的，
被停掉后看护自动拉起新的，第 3 次退避 10s 后稳定），`curl http://localhost:3000/api/knowledge`
确认 200 后开始。

`node scripts/probe-board-card-lifecycle.mjs`（1440x900 真实 Chromium，自建探针卡片「探针临时对象-<时间戳>」）：

```
新增前收拢=true，新卡片出现=true，提交后自动收回=true
确认删除后卡片已从看板消失=true
PASS 新增默认收拢成 +、提交后出现新卡片且自动收回；删除经确认后卡片从看板移除
```

核对完毕另用两条独立命令确认服务端真实状态：`curl http://localhost:3000/api/entities` 显示该探针
条目已不在看板列表里；`.data/entities/archive/探针临时对象-<时间戳>.md` 文件确实存在——两者与探针
脚本内部的自我核对一致。探针脚本第一次运行时报错——Playwright 的 `getByLabel`/`getByRole` 默认做
子串匹配而非精确匹配，「新增友商」误命中了「取消新增友商」按钮（strict mode violation），补
`exact: true` 后通过。

采集时间 2026-09-16（本地服务器，端口 3000），采集者：助手（claude-sonnet-5）。

## 4. 局限（如实登记）

- 归档目录目前没有配套的「恢复」UI——用户的原话只要求「支持删除」，恢复是文件系统层面的能力（把文件搬回 `root/`），此 CR 不建面向用户的恢复入口，理由见 CR 文档「方案选项」A/B 的否决记录。
- `check-ui-route` 是文件级核对，不是用例级——本 CR 新增的两条 `机器（UI）` 断言与既有断言混在同一测试文件里，是 v1 已知粒度限制（CR-20260915-process-hardening-flow 已记录同类情况）。
