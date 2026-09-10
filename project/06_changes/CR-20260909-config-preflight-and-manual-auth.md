# CR-20260909-config-preflight-and-manual-auth

- 级别: L2
- 提出人: user（"Google OAuth configuration required … 检查根因"）
- 状态: APPROVED
- 评审模型: pre-R1234（旧 G0/G1/G2/G3/G3.5/G4；CR-20260909-consensus-review-gates 起改为 R1–R4 + G3/G3.5/G4，不追溯本 CR）
- 影响需求: REQ-F-001（正向验收改为人工验证项）、REQ-F-009（缺密钥的失败方式）、REQ-NF-001（本机可配置性）
- 影响模块: MOD-AUTH、MOD-DB、MOD-CHAT-UI、MOD-SETTINGS-UI
- 影响任务: TASK-019
- 影响测试: TEST-001、TEST-002 覆盖边界澄清；新增 TEST-022（人工验证真实 Google 登录）、TEST-023（配置预检 + 存储守卫）
- 当前证据: `project/05_evidence/EV-2026-09-09-config-root-cause.md`、`project/05_evidence/test-results.json`
- 方案选项: A. 只告诉用户建 `.env.local`；B. 建骨架 + 把缺配置的失败方式全部改为具名阻断态 + 可执行预检 + 把真实登录列为受管人工验证项；C. 放宽 `JARVIS_SECRET_KEY` 的 fail-fast 让应用先跑起来
- 选择理由: 选 B。A 只解决一次；C 会退回"静默降级"，违反 AI_STANDARD 原则 14（安全配置显式失败）。根因诊断显示真正的问题不是"用户没建文件"，而是"缺配置的失败方式不一致"（OAuth 体面阻断、存储密钥 500）以及"REQ-F-001 正向路径从未被验证"。
- 回滚方式: 删除 `src/lib/runtime-config.ts`、`src/lib/api-guard.ts`、`src/components/ConfigWarning.tsx`、`scripts/check-config.mjs`、`.gitignore` 及新增测试 `tests/{runtime-config,api-guard,config-check}.test.ts`；回退 `src/lib/auth.ts`（恢复本地 `isRealValue`）、`src/app/page.tsx`、`src/components/{AccountDialog,SettingsDialog}.tsx`、8 个 store 路由的守卫插入、`tools/governance.py` 的 `check_g3`、`tests/test_governance.py`、`package.json`；恢复本轮改动的受控说明书与 `test-results.json`；重跑 `verify` 并重新 snapshot。`.env.local` 为本地未受控文件，删除即可。无 schema 变更。
- 验收条件:
  - `npm run config:check` 能区分「未设置」「被同名环境变量遮蔽」「`missing-` 占位」，且不受 `NODE_ENV=test` 与 `__NEXT_PROCESSED_ENV` 影响。
  - 缺 `JARVIS_SECRET_KEY` 时：首页与设置弹窗显示具名阻断态（不再 500）；`/api/providers`、`/api/conversations/recent`、`/api/chat/stream` 等 store 路由返回 503 且消息含变量名。
  - `python tools/governance.py gate g3` 在 TEST-022 未完成人工验证时**如实阻断**；标 PASS 但缺 `verified_by`/`verified_at` 时同样阻断。
  - `npm test`、`npm run build`、`node scripts/ui-contract.mjs`、`npm run test:smoke`、`npm run test:e2e` 全部通过。
- 评审记录:
  - 产品 owner：确认 REQ-F-001 正向验收由"自动化 PASS"改为"受管人工验证项"是**收紧**而非放宽；接受 G3 在人工项完成前保持红色。APPROVED。
  - 架构角色：确认两个配置门（OAuth / 存储）互相独立且都在触达资源前检查，`storageUnavailable()` 在鉴权之后调用以免泄露配置信息给未认证调用方。APPROVED。
  - 模块开发角色：确认 `isRealValue` 提取到 `runtime-config.ts` 共享后 `auth.ts` 行为不变（`auth-config.test.ts` 未改动仍通过）。APPROVED。
  - 测试角色：确认 TEST-023 覆盖了三种误报来源，且 `check_g3` 的人工验证分支有 3 条治理单测（pending / 无署名 / 有署名）。APPROVED。

## 根因（三层）

| 层 | 事实 | 处置 |
|---|---|---|
| 直接 | `.env.local` 不存在，仓库只有 `.env.local.example`。Next 仅自动加载前者 → 四个变量全空 → 账号弹窗如实列出。**UI 无 bug**。 | 生成 `.env.local` 骨架（两个密钥已用 CSPRNG 填好），新增 `npm run config:check` 预检 |
| 第二层 | 只补 4 个 OAuth 变量仍会挂：登录成功后首页首次访问 store 因缺 `JARVIS_SECRET_KEY` 抛错 → 已实测 **HTTP 500**。未登录时被 `auth.ok` 门控所以看不见。 | `getStorageConfig` + `ConfigWarning` 具名阻断；`storageUnavailable()` 让 8 个 store 路由返回 503 |
| 流程 | 真实 Google 登录从未被任何自动化跑过：`playwright.config.ts` 不设 `GOOGLE_*`，`smoke.mjs` 用假 client id，其余为纯单测。REQ-F-001 正向验收无证据 —— 违反 AI_STANDARD 原则 12。 | 新增 TEST-022 人工验证项；`gate g3` 识别 `verification: manual`，未完成或无署名即阻断；发布阻断条件补入该项 |

## 已排除的嫌疑（均经实测，不是原因）

- `.env.local.example` 的 UTF-8 BOM：`@next/env` 正确剥离，首行键名不受影响。
- `isRealValue` 误杀：只拒绝空值与 `missing-` 前缀，本场景四项皆未设置，未走到该判断。

## 顺带修正的诊断可信度问题（三处，均已测试覆盖）

1. `@next/env` 是 CJS，ESM 下 `import` 的具名导出为 `undefined`；原实现被 `catch {}` 静默吞掉 → 会把"加载器坏了"报成"变量全缺"。现改用 `default` 互操作并显式上报 `loaderError`。
2. `@next/env` 见到 `__NEXT_PROCESSED_ENV` 缓存标记即跳过加载 → 预检需清标记并 `forceReload`。
3. `NODE_ENV=test` 时 `@next/env` **故意不读** `.env.local` → 预检强制以 development 语义加载。

## 遗留

`gate g3` 当前为红：TEST-022 待人工执行。步骤见 `docs/LOCAL_CONFIGURATION.md`「Verifying real login」，完成后在 `test-results.json` 回填 `verified_by`/`verified_at` 即恢复绿。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019PmfK8ePNkNZmrtMS2CQGP
