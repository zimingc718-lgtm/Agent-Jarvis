# EV-2026-09-09-corner-menu-requirements

- 证据 ID: EV-2026-09-09-corner-menu-requirements
- 来源类型: 用户需求讨论 + 多角色评审
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`；代码事实 `src/app/page.tsx`（`home__bar`/`home__actions`）、`src/components/SettingsDialog.tsx`（外观分区 + `ThemeToggle`）、`src/components/AccountDialog.tsx`、`src/components/ThemeToggle.tsx`、`src/app/globals.css`（`.floating-chat` z-index: 20）
- 采集时间: 2026-09-09
- 采集者: Claude Code session（Sonnet 5）
- 支撑对象: CR-20260909-corner-menu；REQ-F-015、REQ-F-014、DEC-005、DEC-014、TASK-031、TEST-032

## 1. 触发与澄清

用户："配置，账号登录两个入口放在左下角的悬浮选项"，参考"左下角有 Route / Try Turbopack / Preferences 的浮层"。

**澄清**：该浮层是 **Next.js 15 dev 模式自带的开发者指示器**（`npm run dev` 才有，生产构建没有，非挂载点）。用户要的是**应用自己的**一个左下角悬浮菜单（视觉/交互参考那个浮层），生产环境也在。

## 2. 决策链（用户逐轮确认）

| 项 | 决定 |
|---|---|
| 形态 | 左下角一个 **☰** 触发器，点开浮层菜单 |
| 主题开关（深色/浅色） | 从「配置」弹窗外观分区**移出**，**内联**进 ☰ 浮层，当场切 |
| 「配置」/「账号登录」 | 仍作浮层里的启动项，点开各自弹窗 |
| header | 删两按钮，只剩标题 |
| dev 指示器冲突 | 把 Next 指示器**挪到 `bottom-right`**（`next.config.mjs devIndicators`），不在应用组件里做 `NODE_ENV` 偏移 |
| 「配置」命名 | **改为「模型」** |
| 浮层机制（原生 `popover` vs 自写 disclosure） | **留给 P3** |
| 移动端 | 与桌面**同一套** |
| ☰ 层叠 | 始终浮在最上层（对话框折叠/展开都能点） |

## 3. 代码事实

| 事实 | 位置 | 影响 |
|---|---|---|
| `home__bar` = 标题（左）+ `home__actions`（右，含 `SettingsDialog` + `AccountDialog`）；≤640px 竖排 | `page.tsx:41-47`、`globals.css:124-141` | header 重构，删 `home__actions` |
| `SettingsDialog` = 「外观」分区（`<h3>外观</h3><ThemeToggle/>`）+ `ModelSettings`（或 `ConfigWarning`）；触发按钮文案「配置」，弹窗标题「设置」 | `SettingsDialog.tsx:24-38` | 删外观分区、按钮文案改「模型」 |
| `ThemeToggle` 是独立组件（`role="group" aria-label="外观主题"`，浅色/深色两按钮，写 `localStorage['jarvis-theme']` + `data-theme`） | `ThemeToggle.tsx` | 组件不动，换宿主到 `CornerMenu` |
| `AccountDialog` 触发按钮「账号登录」；props `authenticated` / `googleOAuth` 来自 `page.tsx` SSR | `AccountDialog.tsx:17-21` | 不动，改为经 ☰ 触发 |
| `.floating-chat { z-index: 20 }` | `globals.css:304` | ☰ 需 ≥21 |
| `next.config.mjs` 当前只有 `distDir` | `next.config.mjs` | 加 `devIndicators` |

## 4. 多角色评审要点（详见 CR 评审记录）

| 角色 | 硬提醒 / 反对 | 处置 |
|---|---|---|
| 产品 owner | REQ-F-015 是 MUST 验收改写；主题移出外观分区须记录 | 用户确认变更；「配置」→「模型」；可发现性取舍成文 |
| 架构角色 | **反对组件 `NODE_ENV` 偏移**——改 `next.config.mjs devIndicators` | DEC-005 修订 + 新 DEC-014；用户采纳 `bottom-right` |
| 模块开发角色 | 不是「加个菜单」——含 SettingsDialog 瘦身 + 测试返工 | TASK-031 含全部；2 子项提交 |
| 测试角色 | TEST-021/019 断言反转须作回归门；主题持久化走真实浏览器 | TEST-032 + 回归重写 |

## 5. 本证据边界

记录需求讨论 + 代码事实 + 评审结论，不含实现验证。实现证据（TEST-032、e2e 回归）待 P3/P4，届时另立 EV。
