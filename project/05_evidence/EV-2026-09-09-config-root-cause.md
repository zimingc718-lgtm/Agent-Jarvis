# EV-2026-09-09-config-root-cause

- 证据 ID: EV-2026-09-09-config-root-cause
- 来源类型: 用户运行反馈 + 代码审查 + 实测复现
- 来源路径: `src/lib/auth.ts`、`src/lib/store.ts`、`src/app/page.tsx`、`playwright.config.ts`、`scripts/smoke.mjs`
- 采集时间: 2026-09-09
- 采集者: agent-jarvis-00 (Claude Code session)
- 支撑对象: CR-20260909-config-preflight-and-manual-auth，REQ-F-001、REQ-F-009，TASK-019，TEST-022、TEST-023

## 1. 用户观察（P6 运行反馈）

用户在真实运行中打开账号弹窗，看到：

```
Agent-Jarvis 账号
尚未登录 Agent-Jarvis。
Google OAuth configuration required
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL
```

## 2. 证据链

### 2.1 直接原因

```
$ ls .env*
.env.local.example        （只有模板）
```

Next.js 只自动加载 `.env.local`。文件不存在 → 四个变量全未设置 →
`getGoogleOAuthConfig`（`src/lib/auth.ts:20-26`）如实列出全部四项。

**结论：UI 行为正确，非缺陷。** 这是 `CR-20260908-floating-llm-chat` 刻意移除
"假 Google client 兜底"后的 fail-loud 表现。

### 2.2 第二层（实测复现）

以 OAuth 齐全、`JARVIS_SECRET_KEY` 留空、并用 `JARVIS_TEST_USER_ID` 模拟已登录态
启动真实 dev server：

```
HTTP status for / : 500
⨯ Error: JARVIS_SECRET_KEY is required to open the store.
      at createStore (src/lib/store.ts:68)
```

`src/app/page.tsx` 的 store 访问被 `auth.ok` 门控，因此该故障**只在登录成功后**
出现，未登录时完全不可见。

### 2.3 流程层（代码事实）

```
playwright.config.ts:24    JARVIS_TEST_USER_ID: "e2e-user"              ← 不设 GOOGLE_*
scripts/smoke.mjs:58       JARVIS_TEST_USER_ID: "smoke-user"
scripts/smoke.mjs:62       GOOGLE_CLIENT_ID: "smoke-google-client-id"   ← 假值
tests/auth.test.ts         纯单元
tests/auth-config.test.ts  纯单元
```

REQ-F-001 的正向验收（"用户必须通过 Google 登录进入受保护页面"）**从未被验证**，
只验证了未登录被阻断与缺配置被阻断两个负向场景。违反 AI_STANDARD 原则 12
（真实入口对应）。

## 3. 已排除的嫌疑（实测，非推测）

| 嫌疑 | 验证方式 | 结论 |
|---|---|---|
| `.env.local.example` 的 UTF-8 BOM (`ef bb bf`) 会污染首行键名 | 在临时目录写带 BOM 的 `.env.local`，用 `@next/env` 的 `loadEnvConfig` 加载并打印 `process.env.NEXTAUTH_URL` | BOM 被正确剥离，读到 `http://localhost:3000`。**无影响** |
| `isRealValue` 误杀用户填的值 | 阅读 `src/lib/auth.ts:65-70` | 仅拒绝空/空白与 `missing-` 前缀；本场景四项皆未设置，未触达该判断。**无关** |

## 4. 修复与验证

| 命令 | 结果 | 摘要 |
|---|---|---|
| `npx tsc --noEmit` | PASS | 无类型错误 |
| `npm test` | PASS | 21 文件 / 99 测试（含新增 runtime-config 6、api-guard 5、config-check 6） |
| `npm run config:check` | EXPECTED_FAIL(exit 1) | 仅报缺 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`（其余四项已由骨架填好） |
| `node scripts/ui-contract.mjs` | PASS | 45 规则 0 FAIL 0 WARN |
| `npm run test:smoke` | PASS | 真实入口不回归 |
| `npm run test:e2e` | PASS | 4 Chromium 用例 |
| `npm run build` | PASS | 10 路由 |
| `python -m unittest tests.test_governance -v` | PASS | 16（含人工验证项 3 条新测） |
| `python tools/governance.py gate g3` | **BLOCKED（预期）** | `manual verification pending … TEST-022` |

## 5. 诊断工具自身的三个陷阱（编写预检时发现并修掉）

写 `scripts/check-config.mjs` 时连续踩到三个会让**诊断本身说谎**的行为，均已修复并被 TEST-023 覆盖：

1. `@next/env` 是 CommonJS，ESM 下 `import { loadEnvConfig }` 得到 `undefined`；初版被
   `catch {}` 静默吞掉，结果把"加载器没跑"报成"变量全缺"。已改为 `default` 互操作
   并把 `loaderError` 显式输出到报告里。
2. `@next/env` 一旦看到自己设置的 `__NEXT_PROCESSED_ENV` 标记就跳过加载。已清标记 + `forceReload=true`。
3. `NODE_ENV=test` 时 `@next/env` **故意不读** `.env.local`（正是 vitest 的默认环境）。
   已在预检中强制以 development 语义加载。

另外发现一个对用户同样有价值的事实：**dotenv 不覆盖已存在的环境变量，而"已导出但为空"
也算存在**。因此 shell 里的 `GOOGLE_CLIENT_ID=` 会静默遮蔽一份正确的 `.env.local`。
预检现在把这种情况报为「遮蔽」而不是「缺失」，并提示 `unset`。

## 6. 未完成项

TEST-022（真实 Google 登录）需用户本人执行，步骤见
`docs/LOCAL_CONFIGURATION.md`「Verifying real login (TEST-022)」。完成后在
`test-results.json` 的 TEST-022 条目填入 `result: "PASS"`、`verified_by`、
`verified_at`，`gate g3` 即恢复通过。在此之前 G3 如实阻断 —— 这是本轮刻意引入的
控制，不是缺陷。
