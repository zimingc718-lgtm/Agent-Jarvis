# EV-2026-09-09-corner-menu-impl

- 证据 ID: EV-2026-09-09-corner-menu-impl
- 来源类型: 三角色逐变化点方案（架构 / 模块 / 测试）+ P3 实现 + P4 真实入口验证
- 来源路径或引用: `src/components/CornerMenu.tsx`（新）、`src/components/SettingsDialog.tsx`、`src/app/page.tsx`、`src/app/globals.css`、`src/lib/chat.ts`、`next.config.mjs`、`scripts/ui-contract.mjs`、`scripts/smoke.mjs`、`tests/corner-menu.test.tsx`（新）、`tests/home-dialogs.test.tsx`、`tests/e2e/human-workflow.spec.ts`；方案表见 `架构设计说明书 · CR-20260909-corner-menu 方案` / `模块任务开发说明书 · 技术设计` / `测试说明书 · 测试设计`
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-corner-menu；REQ-F-015、REQ-F-014、DEC-005、DEC-014、TASK-031、TEST-032、TEST-019/021（回归）

## 1. 变化点

CP-1 REQ-F-015 验收重写 · CP-2 「配置」→「模型」 · CP-3 主题内联（`ThemeToggle` 迁宿主）· CP-4 `CornerMenu` 组件 · CP-5 `next.config.mjs devIndicators` · CP-6 TEST-019/021 + appearance/account e2e 回归。

## 2. 三角色逐 CP 响应（严格对应，均成文进说明书）

### 架构角色（部署/前端/后端/数据库 + 可行性）

**零部署形态 / 零后端 / 零数据库变更**（`devIndicators` 仅是 dev UI 位置）。纯 MOD-SETTINGS-UI + `page.tsx` chrome 改动，无新依赖。z-index 刻度成文：对话 20 / ☰+浮层 30 / 模态 `<dialog>` 由浏览器 top-layer 管理。dev 指示器用 `next.config.mjs devIndicators.position` 而非组件 `NODE_ENV` 分支（架构角色反对后者）。全 CP 可行性高。

### 模块开发角色（实现 + 可行性）

| CP | 落地 | 可行性 |
|---|---|---|
| CP-4 | `CornerMenu.tsx`：`useState(open)` + `triggerRef` + `open` 时挂 `document` `mousedown`（命中 `.corner-menu` 外则关）+ `keydown` `Escape`（关 + `triggerRef.focus()`）。渲染 `<div className="corner-menu">{open ? <div role="menu">{children}</div> : null}<button className="corner-menu__trigger" aria-haspopup="menu" aria-expanded={open}>☰</button></div>`。**自写 disclosure**（P3 选型：jsdom 可测 + 全控制，未用原生 `popover`）。 | 高 |
| CP-1 | `page.tsx`：`<header>` 只 `<h1>`；`<CornerMenu><ThemeToggle/><SettingsDialog .../><AccountDialog .../></CornerMenu>` 无条件渲染。 | 高 |
| CP-3 | `SettingsDialog.tsx`：删 `import { ThemeToggle }` + `<section aria-label="外观">…</section>`。`ThemeToggle` 零改动，由 `page.tsx` 渲染进 `CornerMenu`。 | 高 |
| CP-2 | `SettingsDialog` 触发 `<button>配置</button>` → `模型`；弹窗标题 `设置` → `模型 Provider`。`chat.ts` 409 提示同步「配置」→「模型」。 | 高 |
| CP-5 | `next.config.mjs`：`devIndicators: { position: "bottom-right" }`。`build:verify` 无配置错误。 | 高 |
| CP-6 | `globals.css`：`.corner-menu` / `__trigger`（`2.25rem` 方块，全局 `:focus-visible` 环，`--surface` 底、细线、极轻阴影）/ `__panel`（浮层，`grid`、`min-width: 12rem`）；删死代码 `.home__actions` 与其移动端规则。`ui-contract.mjs`：文件表加 `CornerMenu.tsx`，新增 LB-08。 | 高 |

**未越界性**：`CornerMenu` 归 MOD-SETTINGS-UI；`page.tsx` 用 `children` 传三个组件，`CornerMenu` 零 import 业务、不感知 props。零 API/store/schema/依赖变更。**2 子项提交**：Ⅰ `CornerMenu` + `page.tsx` + `next.config.mjs` + CSS + `ThemeToggle` 迁移（此时 `SettingsDialog` 仍有外观分区，测试全绿）；Ⅱ `SettingsDialog` 瘦身 + `chat.ts` 提示 + TEST-019/021/home-dialogs + appearance/account e2e + smoke + ui-contract LB-08。

### 测试角色（可验证 + 可交付，逐 CP）

| CP | 证据 |
|---|---|
| CP-1 | e2e：home header 无「配置」按钮、`打开菜单` 触发器可见、点开后 `模型`/`账号登录` 出现、Esc 关。TEST-021 改写覆盖。 | ✅ |
| CP-2 | home-dialogs 组件（触发文案「模型」）+ e2e `saveProviderThroughSettingsDialog`（经 ☰ → 模型）。 | ✅ |
| CP-3 | `tests/corner-menu.test.tsx`：点「深色」→ `data-theme=dark` + `localStorage['jarvis-theme']` 且 `dialog[open]` 为 null。home-dialogs：`SettingsDialog` 无 `role="group" name="外观主题"`。e2e appearance：经 ☰ 切主题 + `page.reload()` 保持。 | ✅ |
| CP-4 | corner-menu.test.tsx 5 用例：aria 属性、items 关闭时不挂载、Esc 关 + 焦点回归、outside-click 关、启动两个弹窗。e2e：对话展开时 ☰ 仍可点开菜单。 | ✅ |
| CP-5 | `build:verify` 接受 `devIndicators`；Next 指示器位置是 dev-only shadow DOM，Playwright 不断言——接受为 dev 便利。 | ✅（低优先级） |
| CP-6 | `npm run test:auth-ui` + `npm run test:e2e`：appearance/account/首页三用例经 ☰ 全 PASS，断言按新结构校准。 | ✅（回归门） |

## 3. 验证结果（全部本机执行）

| 命令 | 结果 | 摘要 |
|---|---|---|
| `npx tsc --noEmit`（含 `noUnusedLocals`/`noUnusedParameters`） | PASS | 无类型错误 |
| `npm test` | PASS | 22 文件 / **124** 测试（新增 `corner-menu.test.tsx` 5，`home-dialogs` 改写 6→5，删「switches theme from inside the dialog」） |
| `node scripts/ui-contract.mjs` | PASS | **47** 规则 0 FAIL 0 WARN（新增 LB-08） |
| `npm run build:verify` | PASS | 11 路由，`devIndicators` 生效 |
| `npm run test:smoke` | PASS | 首页断言改判 `corner-menu__trigger` + `打开菜单` |
| `npm run test:e2e` | PASS | **8** Chromium（新增「the ☰ menu stays reachable while the chat panel is expanded」；appearance/account/首页三用例经 ☰ 重跑） |
| `python -m unittest tests.test_governance` | PASS | 17 |
| `python tools/governance.py verify\|gate g1..g4\|ui\|check-changes` | 全 PASS | g1-g4 全绿 |

## 4. 已知取舍

- `CornerMenu` 用自写受控 disclosure 而非原生 `popover` 属性：原生 `popover` 自带 light-dismiss/Esc，但 jsdom 支持差、组件测试难写。自写版本行为等价且完全可测。若后续浏览器/测试环境成熟可平替。
- CP-5 Next 指示器位置无 Playwright 断言（Next 自己的 shadow DOM）——是 dev 体验项，接受。
- 焦点管理：Esc 关闭时焦点回触发器；浮层内无 roving tabindex（就三个控件，原生 Tab 顺序足够），未实现完整 WAI-ARIA menu 键盘模型——对本规模可接受。
