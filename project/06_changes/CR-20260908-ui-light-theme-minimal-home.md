# CR-20260908-ui-light-theme-minimal-home

- 级别: L2
- 提出人: user
- 状态: APPROVED
- 影响需求: REQ-F-014（措辞与验收标准变更：科幻深色 → 克制浅色 + 深色开关）；新增 REQ-F-015（极简首页）、REQ-F-016（回复 Markdown 渲染）；REQ-F-007 增加首页弹窗入口（深链页面保留）
- 影响模块: MOD-CHAT-UI、MOD-SETTINGS-UI
- 影响任务: TASK-015 至 TASK-018
- 影响测试: TEST-012、TEST-018 改为双主题；新增 TEST-019（主题）、TEST-020（Markdown）、TEST-021（首页弹窗）
- 当前证据: `project/05_evidence/EV-2026-09-08-ui-light-theme.md`、`project/05_evidence/test-results.json`
- 方案选项: A. 只换调色板为浅色；B. 浅色默认 + 深色开关（theme-aware token）；C. 引入设计系统/组件库重做 UI
- 选择理由: 选 B。用户明确要求"UI 可以转为浅色"并在澄清中选择"浅色为默认 + 深色开关"；C 会引入外部依赖（CONTROLS L3）且远超当前 v1 范围。弹窗用原生 `<dialog>`、Markdown 用自写渲染器，全程零新增依赖。
- 回滚方式: 回退 `src/app/globals.css`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/app/settings/models/page.tsx`、`src/components/{FloatingChat,ModelSettings}.tsx`、`scripts/ui-contract.mjs` 到上一基线；删除新增文件 `src/components/{Dialog,ThemeToggle,SettingsDialog,AccountDialog}.tsx`、`src/lib/markdown.tsx` 及 `tests/{account-dialog,home-dialogs,theme-toggle,markdown}.test.tsx`；恢复 `src/components/AuthActions.tsx` 与 `tests/auth-actions.test.tsx`；恢复本轮改动的四份受控说明书与 `test-results.json`；重跑 `python tools/governance.py verify` 并重新 snapshot。无数据库 schema 变更，无数据迁移。
- 验收条件:
  - 首页仅渲染标题 +「配置」「账号登录」两个弹窗按钮 + 底部悬浮对话。
  - 默认浅色；深色开关写入 `data-theme` 与 localStorage，刷新后保持，且无主题闪烁。
  - 助手回复按 Markdown 渲染；原始 HTML 被转义；仅 http/https/mailto 成链。
  - `node scripts/ui-contract.mjs` 静态 0 FAIL 0 WARN，浅色与深色两套调色板对比度均达 AA。
  - `node scripts/ui-contract.mjs --live` 0 FAIL（含 `LV-CONTRAST-DARK`、`LV-REFLOW-dark`）。
  - `npm test`、`npm run test:smoke`、`npm run test:e2e`、`npm run build` 全部通过。
  - `python tools/governance.py verify | ui | gate g1..g4 | check-changes` 全部通过。
- 评审记录:
  - 产品 owner：确认首页"知识库概览"为暂缓展示而非删除；REQ-F-015/016 由用户本轮明确要求，非 AI 自行发散。APPROVED。
  - 架构角色：确认 DEC-006（theme-aware token + 无闪脚本）、DEC-007（原生 `<dialog>` + 组件复用）、DEC-008（自写 Markdown 渲染器）三项决策零依赖，未触发 CONTROLS L3「外部依赖」。APPROVED。
  - 模块开发角色：确认 `ModelSettings` 根元素由 `<main>` 降为 `<div>`、标题由 `<h1>` 降为 `<h2>`，使其在弹窗与深链页面两种宿主下都不产生嵌套地标或双 h1。APPROVED。
  - 测试角色：确认主题持久化、弹窗开合、Markdown 渲染均有真实浏览器断言（符合 AI_STANDARD 原则 12），未以组件测试单独结案。APPROVED。

## 变更清单

| ID | 变更 | 覆盖需求 | 真实入口证据 |
|---|---|---|---|
| UI-01 | `globals.css` 重构为 theme-aware token：`:root` 浅色基线，`prefers-color-scheme: dark` 与 `[data-theme="dark"]` 覆盖；移除科幻渐变与辉光；间距归到 0.25rem 刻度 | REQ-F-014 | ui-contract 静态 + `--live` 双主题 |
| UI-02 | `ThemeToggle` + root layout 首帧前内联 bootstrap 脚本（localStorage，try/catch） | REQ-F-014 | e2e「appearance toggle switches and persists」 |
| UI-03 | 首页收敛为标题 + 配置/账号两个弹窗按钮 + 悬浮对话；`AuthActions` 由 `AccountDialog` 取代 | REQ-F-015, REQ-F-001 | e2e「clean home」+ smoke 断言两个按钮 |
| UI-04 | 原生 `<dialog>` 封装 `Dialog`；`SettingsDialog` 内含「外观」分区与复用的 `ModelSettings`；`/settings/models` 深链保留 | REQ-F-007, REQ-F-015 | e2e 经弹窗保存 Provider；smoke 仍走深链 |
| UI-05 | 自写 Markdown 渲染器 `src/lib/markdown.tsx` 接入助手气泡（输出 React 元素，不用 innerHTML） | REQ-F-016 | e2e 断言 `<code>`/`<strong>`/`<li>` 且不含 `**ship**` |
| UI-06 | `ui-contract` 双主题化：两套调色板对比度、`LV-SURFACE`、`LV-CONTRAST-DARK`、`LV-REFLOW-dark`；新增 RF-09 展开面板限高（≤65vh）；修正 RF-05/RF-07/LB-01/LB-03/FF-01/DS-01 的误报 | REQ-F-014, REQ-F-003 | `npm run test:visual`、`npm run test:ui-contract:live` |

## 与既有变更的关系

- 承接 `CR-20260908-floating-chat-functional-fixes` 的对话功能修复，不改动其行为，仅重构表现层与首页结构。
- 落实 `CR-20260908-ui-standard-process` 建立的 UI-GOV-001 基线；`scripts/ui-contract.mjs` 作为其可执行强制实现，本轮扩展为双主题。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019PmfK8ePNkNZmrtMS2CQGP
