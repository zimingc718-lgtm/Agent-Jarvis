# CR-20260909-next-build-dir-isolation

- 级别: L2
- 提出人: user（"当前页面，无对话框。登录账号也报错。检查这个开发流程，找出问题。"）
- 状态: APPROVED
- 评审模型: pre-R1234（旧 G0/G1/G2/G3/G3.5/G4；CR-20260909-consensus-review-gates 起改为 R1–R4 + G3/G3.5/G4，不追溯本 CR）
- 影响需求: REQ-NF-004（真实入口验证）、REQ-F-001（登录可用）
- 影响模块: MOD-AUTH（构建/验证流程层面）
- 影响任务: TASK-020
- 影响测试: 新增 TEST-024（NextAuth 路由处理器可加载性）
- 当前证据: `project/05_evidence/EV-2026-09-09-next-build-corruption.md`
- 方案选项: A. 只清一次 `.next` 重启；B. `NEXT_DIST_DIR` 隔离每个非交互入口 + 新增 `/api/auth/*` 真实断言 + 流程文档；C. 改用 `next start`（生产模式）跑 smoke/e2e
- 选择理由: 选 B。A 治标；C 改动大且丢失 dev 模式的真实性。根因是"验证流程本身在破坏用户的运行环境"——会话内多次 `npx next build` 直接打在用户运行中的 `next dev` 的 `.next/` 上，且 smoke 与 e2e 也共用 `.next/`。隔离构建目录是最小且彻底的修复。
- 回滚方式: 删除 `next.config.mjs`；回退 `scripts/smoke.mjs`、`playwright.config.ts`、`tests/e2e/human-workflow.spec.ts`、`package.json`、`.gitignore`、`docs/WORKFLOW.md`、`project/02_solution/架构设计说明书.md`（DEC-009）、`project/03_modules/模块任务开发说明书.md`（TASK-020）、`project/04_tests/测试说明书.md`（TEST-024）；`npm run clean` 清目录；重跑 `verify` 并重新 snapshot。无 schema 变更。
- 验收条件:
  - 交互式 `next dev`（`.next/`）运行时执行 `npm run build:verify`（`.next-verify/`），dev server 的 `/api/auth/csrf` 与 `/` 前后均保持 200。
  - `npm run test:smoke` 断言 `/api/auth/csrf` 返回 200 + `csrfToken`、`/api/auth/providers` 暴露 google provider。
  - `npm run test:e2e` 断言 `/api/auth/signin` 返回 200（非 500）。
  - `.next*` 全部被 `.gitignore` 忽略；`npm run clean` 清除。
  - `npm test`、`node scripts/ui-contract.mjs`、`python tools/governance.py verify|ui|check-changes` 通过。
- 评审记录:
  - 架构角色：确认 `next.config.mjs` 仅新增 `distDir`（从 env 读取，默认 `.next`），不改变任何构建产物或运行时行为；隔离目录对交互开发透明。记入 DEC-009。APPROVED。
  - 测试角色：确认 TEST-024 用 `/api/auth/csrf`（无需真实 Google 凭据）即可捕获 `vendor-chunks` 类模块解析失败，补上了 MOD-AUTH 唯一未被真实 HTTP 覆盖的路由。APPROVED。
  - 开发角色：确认 `build:verify` 成为唯一验证构建入口，WORKFLOW 明令禁止对交互 dev 直接 `next build`。APPROVED。

## 根因

用户运行中看到"无对话框 / 登录报错"。诊断（详见证据文件）：

`.next/` 是一份**生产构建与 dev 混合、且缺失 auth vendor chunks** 的损坏产物。
`.next/server/vendor-chunks/` 只剩 `@swc.js`、`next.js`，缺 `jose.js` / `next-auth.js`
/ `openid-client.js` 等。`/api/auth/csrf`、`/api/auth/signin/google` 实测均返回
**HTTP 500 `Cannot find module './vendor-chunks/jose.js'`**。首页在 dev server
重编译时也间歇 500 → 用户看不到弹窗。

成因链：

1. 本会话验证循环内 `npx next build` 执行约 7 次，每次都**重写用户运行中的
   `next dev` 服务器所用的同一个 `.next/`**（生产布局），使其 webpack 运行时
   与磁盘 vendor chunks 不一致。
2. `scripts/smoke.mjs` 与 `scripts/run-e2e.mjs` 各自 spawn `next dev`（不同端口、
   **同一 `.next/`**），彼此及与交互 dev 互相污染。
3. `/api/auth/[...nextauth]` **从无真实 HTTP 测试**（全部走 `JARVIS_TEST_USER_ID`
   旁路），所以整个 auth 子系统 500 对 `npm test` + smoke + e2e + 5 个 gate 完全
   不可见 —— 与 TEST-022 同类缺口，但此项无需 Google 凭据即可覆盖。

## 修复

| 项 | 内容 |
|---|---|
| `next.config.mjs`（新增） | `distDir = process.env.NEXT_DIST_DIR \|\| ".next"` |
| `scripts/smoke.mjs` | `NEXT_DIST_DIR=.next-smoke`；补 `NEXTAUTH_URL`、修正 `GOOGLE_CLIENT_ID` 为合法域名形；断言 `/api/auth/csrf` 200 + token、`/api/auth/providers` 含 google |
| `playwright.config.ts` | `NEXT_DIST_DIR=.next-e2e`；补 `GOOGLE_CLIENT_*` |
| `tests/e2e/human-workflow.spec.ts` | 新增用例：`/api/auth/csrf` 200、`/api/auth/signin` 非 500 |
| `package.json` | `build:verify`（→`.next-verify`）、`clean`（清全部构建目录） |
| `.gitignore` | `.next-*/` |
| `docs/WORKFLOW.md` | 「构建目录隔离」章节：禁止对交互 dev 直接 `next build` |

## 立即处置（已执行）

停止损坏的 dev server（PID 35584）→ `rm -rf .next` → 干净重启 → `/api/auth/csrf`
恢复 200、14 个 vendor chunks 齐全（含 `jose.js`）、弹窗正常打开。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019PmfK8ePNkNZmrtMS2CQGP

## R4 评审意见

**复盘迭代（CR-20260909-next-build-dir-isolation）**（迁移自 `测试说明书.md`）

| 角色 | 检查重点 | 反馈 | 处理结果 | 结论 |
|---|---|---|---|---|
| 测试角色 | `/api/auth/[...nextauth]` 从无真实 HTTP 覆盖 | 全套测试走 `JARVIS_TEST_USER_ID` 旁路，NextAuth 路由处理器整体 500（`vendor-chunks/jose.js` MODULE_NOT_FOUND）对 `npm test`+smoke+e2e+gates 完全不可见（原则 12） | 新增 TEST-024：smoke 断言 `/api/auth/csrf`/`providers`，e2e 断言 `/api/auth/signin` 非 500 | APPROVED |
| 架构角色 | `.next` 污染来源 | `next build`（含验证循环）与交互 `next dev` 共用 `.next/`；smoke 与 e2e 各起 `next dev` 也共用 `.next/` | DEC-009：`NEXT_DIST_DIR` 隔离，`build:verify` 用 `.next-verify/`，smoke/e2e 各自目录 | APPROVED |
| 开发角色 | 验证流程本身是破坏源 | 会话内多次 `npx next build` 直接打在用户运行中的 dev server 的 `.next/` 上 | WORKFLOW「构建目录隔离」章节禁止该操作；`npm run build:verify` 为唯一验证构建入口 | APPROVED |
