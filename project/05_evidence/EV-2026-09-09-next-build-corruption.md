# EV-2026-09-09-next-build-corruption

- 证据 ID: EV-2026-09-09-next-build-corruption
- 来源类型: 用户运行反馈 + 实测复现 + 修复验证
- 来源路径: `.next/`（损坏产物）、`.data/dev-server.log`、`scripts/smoke.mjs`、`scripts/run-e2e.mjs`、`playwright.config.ts`
- 采集时间: 2026-09-09
- 采集者: agent-jarvis-00 (Claude Code session)
- 支撑对象: CR-20260909-next-build-dir-isolation，REQ-F-001、REQ-NF-004，TASK-020，TEST-024

## 1. 用户观察（P6 运行反馈）

> 当前页面，无对话框。登录账号也报错。检查这个开发流程，找出问题。

## 2. 诊断

### 2.1 损坏证据（运行中的用户 dev server，:3000）

```
$ curl /api/auth/csrf        → HTTP 500
$ curl /api/auth/signin/google → HTTP 500

err.message: "Cannot find module './vendor-chunks/jose.js'
  Require stack:
   - .next/server/webpack-runtime.js
   - .next/server/app/api/auth/[...nextauth]/route.js"

$ ls .next/server/vendor-chunks/
  @swc.js  next.js                 ← 只有 2 个

$ cat .next/BUILD_ID
  H12_0vjCRsOQFezakcf_s            ← 生产构建 ID（dev 模式应为 "development"）
```

`.next/` 是一份生产 `next build` 产物，被运行中的 `next dev` 服务器加载。生产构建
不产出 dev 的 per-dep vendor chunks，于是 dev server 重新编译
`/api/auth/[...nextauth]` 时 `webpack-runtime.js` 找不到 `jose.js` → 500。
`jose@4.15.9` 在 `node_modules/` 中存在，不是依赖缺失。

### 2.2 成因

| # | 事实 |
|---|---|
| 1 | 本会话验证阶段执行 `npx next build` 约 7 次，用户的 `next dev`（PID 35584，:3000）自始至终在跑，二者共用 `.next/` |
| 2 | `scripts/smoke.mjs:54` 与 `scripts/run-e2e.mjs` 各 spawn `next dev`（端口不同，`.next/` 相同） |
| 3 | `playwright.config.ts`、`smoke.mjs` 均设 `JARVIS_TEST_USER_ID` → 所有测试绕过 `/api/auth/*`，auth 路由 500 对全部自动化不可见 |

### 2.3 排除项

`/api/auth/session` 返回 `{}` 200（该端点不经损坏的 vendor chunk 路径）——
一度让人误以为 auth 正常。`/api/auth/csrf` 与 `/api/auth/providers` 才暴露 500。

## 3. 立即处置（已执行并验证）

```
taskkill /F /PID 35584 /T          # 停止损坏的 dev server
rm -rf .next
next dev --port 3000               # 干净重启

$ curl /api/auth/csrf     → {"csrfToken":"a53d…"}  [200]   ✅
$ curl /api/auth/providers → {"google":{…}}          [200]   ✅
$ ls .next/server/vendor-chunks/
  @babel.js @panva.js @swc.js cookie.js jose.js next.js
  next-auth.js oauth.js object-hash.js oidc-token-hash.js
  openid-client.js preact.js preact-render-to-string.js uuid.js   ← 14 个 ✅

浏览器：点击「配置」「账号登录」→ 弹窗正常打开；无 console 错误。      ✅
```

## 4. 修复验证

| 命令 | 结果 | 摘要 |
|---|---|---|
| 交互 dev(`.next`) + `npm run build:verify`(`.next-verify`) | PASS | dev 的 `/api/auth/csrf` 与 `/` 在 build 前后均 200（此前正是该交错杀死服务器） |
| `npm run test:smoke` | PASS | 用 `.next-smoke`；新增断言 `/api/auth/csrf` 200+token、`/api/auth/providers` 含 google |
| `npm run test:e2e` | PASS | 用 `.next-e2e`；5 用例含新增「NextAuth route handler is actually loadable」 |
| `npx tsc --noEmit` | PASS | — |
| `npm test` | PASS | 21 文件 / 99 测试 |
| `node scripts/ui-contract.mjs` | PASS | 45 规则 0 FAIL 0 WARN |
| `python -m unittest tests.test_governance` | PASS | 16 |
| `python tools/governance.py verify \| ui \| check-changes` | PASS | — |

## 5. 遗留

`gate g3/g3.5/g4` 仍因 TEST-022（真实 Google 登录人工验证）为红 —— 与本 CR 无关，
见 `CR-20260909-config-preflight-and-manual-auth`。TEST-024 已 PASS。
