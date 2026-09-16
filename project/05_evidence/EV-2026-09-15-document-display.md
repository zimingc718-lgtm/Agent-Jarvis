# EV-2026-09-15-document-display

- 来源: 用户 INPUT-2026-09-15-029 第 7/8 条（指令打开对应展示屏；对话支持显示资料库资料与洞察报告；从资料库材料调出内容支持回复）
- 时间: 2026-09-15（需求提出）–2026-09-16（实现、说明书落点、机器证据与真实入口核对）
- 采集者: 助手（claude-sonnet-5），在本仓库真实工作树上执行；真实入口部分在用户自己那台服务器（端口 3000）
- 支撑对象: `CR-20260915-document-display` CP-1、CP-2
- 可定位路径: 本文件；`src/lib/tools/document-tools.ts`（`show_document`）、`src/app/api/documents/raw/route.ts`、`src/components/DisplayScreen.tsx`（document 视图）、`scripts/probe-document-display.mjs`

## 1. 现场核对：第 8 条三句话，两句已经成立

回代码核对第 8 条列出的三件事：

1. **「展示洞察的报告」**——`show_insight` 工具（REQ-F-032 ②）在本 CR 之前就已存在，不需要任何改动。
2. **「从资料库的材料里调出内容支持回复」**——`search_documents`/`read_document`（REQ-F-110）在 `CR-20260915-library-adoption` CP-5 就已把资料库并入文档根，采纳闸也已生效；`tests/library-gate.test.ts`（TEST-420）①②④⑤原有测试直接证明这一点，本 CR 未新增测试，只在此复核。
3. **「对话支持显示某篇资料库的资料」**——这句和第 7 条「指令打开对应的动态展示屏」是本 CR 真正要补的能力：模型此前没有任何工具能把一份具体文档摆到展示屏上给用户看。

## 2. 机器证据

| 用例 | 条数 | 守住的事 |
|---|---|---|
| `document-tools.test.ts` ①（改写）+ ②b | 2 | 四个工具（含新增的 `show_document`）都注册；成功时只改 `display_state`，失败时复用 `read_document` 的报错文案与越界防护 |
| `library-gate.test.ts` ⑥ | 1 | `show_document` 走与 `read_document` 同一道资料库采纳闸——未采纳/已拒绝一律拒绝，采纳后能展示 |
| `document-raw-route.test.ts` ①–⑤ | 5 | 未登录 401；原样字节 + 正确 `Content-Type`；越界/不存在 404 且不回显真实路径；不在可读扩展名白名单内 400；资料库未采纳 403、采纳后 200 且 `Content-Type` 正确 |
| `display-screen.test.tsx` ⑥⑦ | 2 | 可内嵌格式渲染 `<iframe>` 且 `sandbox` 为空字符串；不可内嵌格式（.docx）不渲染 `iframe`，给出回退说明与新标签页链接 |

`npx vitest run tests/document-tools.test.ts tests/library-gate.test.ts tests/document-raw-route.test.ts tests/display-screen.test.tsx`：**25 个用例全绿**。`npx tsc --noEmit`：0 错误。全量 `npx vitest run`：**813 个用例全绿**（较 CR-C 收口时的 804 增 9）。`node scripts/check-module-graph.mjs`：0 环 0 违规（含新路由文件，110 files scanned）。`node scripts/ui-contract.mjs`：53 项全过。`check-tables`/`check-doors`/`check-ids`/`check-test-commands`/`check-hygiene`：均 PASS。

## 3. 真实入口（用户自己那台，端口 3000）

`npm run build:local` 重建 `.next-prod`，重启 `serve:local`（第 4 次退避 10s 后稳定），
`curl http://localhost:3000/api/knowledge` 确认 200 后开始。用真实资料库里已采纳的一份 PDF
（Open Compute Project 的 Diablo 400 规格书，4.97 MB，用户之前审批通过的真实数据，未新建任何
夹具）：

```
待采纳文档直接访问原件路由：状态码=403，被拦=true
已采纳 PDF 直接访问原件路由：状态码=200，Content-Type 正确=true，字节以 %PDF- 开头=true
模型调用后展示屏切到 document 视图=true，iframe src=/api/documents/raw?id=...P1_ocp-specification-diablo-400-v0p5p2-2025-05-30-pdf.pdf，src 能取到 PDF 字节=true
PASS 未采纳文档被拦；已采纳 PDF 原件路由能取到真实字节；模型调用 show_document 后展示屏切换，iframe 指向的地址能取到同一份 PDF
```

第三项是本 CR 真正的新证据：探针在真实对话框里发了一句话让模型调用 `show_document`
（DeepSeek，真实 API 调用），观察到——① 模型确实发起了工具调用；② 展示屏确实从其它视图
切到了 `document` 视图；③ 切换后 `iframe` 的 `src` 确实能被真实取到 PDF 字节，不是空链接或
错误页。这一条链路（模型决策 → 工具执行 → 状态改变 → 前端渲染 → 浏览器取字节）是 jsdom
单测完全证不了的，也是本 CR 与此前几条 CR（用户点击驱动）性质不同的地方——这里没有按钮可点，
真实入口就是「让模型真的调一次」。

采集时间 2026-09-16（本地服务器，端口 3000），采集者：助手（claude-sonnet-5）。

## 4. 局限（如实登记）

- `.docx` 等无浏览器原生查看器的格式，本 CR 只给「新标签页打开」的回退，不做格式转换或提取式预览——理由见 CR 文档「非目标」。
- jsdom 的 `<iframe>` 不真的发网络请求，单测只能验证 `src` 属性指向正确的 URL，验不了「浏览器真的渲染出内容」本身，这一段完全交给真实入口。
- `check-ui-route` 未覆盖这两个 CP——两者都不是「点击驱动」的交互（CP-1 由模型调用触发，CP-2 由展示状态直接决定），机器发现方式如实登记为 `机器`（非 `机器（UI）`），理由见 CR 文档「级别」一行。
