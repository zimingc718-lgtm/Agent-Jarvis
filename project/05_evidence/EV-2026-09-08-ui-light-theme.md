# EV-2026-09-08-ui-light-theme

- 证据 ID: EV-2026-09-08-ui-light-theme
- 来源类型: 测试执行 + 真实浏览器验证
- 来源路径: 本仓库 `src/`、`tests/`、`scripts/ui-contract.mjs`
- 采集时间: 2026-09-08
- 采集者: agent-jarvis-00 (Claude Code session)
- 支撑对象: CR-20260908-ui-light-theme-minimal-home，REQ-F-014、REQ-F-015、REQ-F-016，TASK-015..018，TEST-012/018/019/020/021

## 1. 用户输入（变更来源）

用户在本轮明确指示：

> 主界面是知识库概览，当前版本可以不用显示。仅显示题目和配置，账号登录两个弹出框按钮，保持页面干净。当前版本主要做好对话UI，及对话对接大模型的功能。另外UI可以转为浅色，不用科幻风。

澄清问答确认：设置采用「弹窗 + 保留 `/settings/models` 路由」；账号弹窗展示状态 + 登录/登出 + 授权边界提示；主题为「浅色默认 + 深色开关」；对话 UI 本轮增加 Markdown 渲染。

## 2. 执行结果

| 命令 | 结果 | 摘要 |
|---|---|---|
| `npx tsc --noEmit` | PASS | 无类型错误 |
| `npm test` | PASS | 18 文件 / 80 测试 |
| `npm run test:theme` | PASS | 默认浅色、切换写入 `data-theme` + localStorage、无效值忽略、bootstrap 脚本生效 |
| `npm run test:markdown` | PASS | 代码块（含未闭合围栏）、行内代码、粗体/斜体、有序/无序列表、h3–h5、链接白名单、HTML 转义 |
| `npm run test:auth-ui` | PASS | 账号弹窗四态 + 设置弹窗开合、外观分区、无第二 h1/嵌套 main |
| `node scripts/ui-contract.mjs` | PASS | **45 规则，0 FAIL，0 WARN** |
| `node scripts/ui-contract.mjs --live` | PASS | **63 通过，0 FAIL**（axe-core 未安装则 SKIP） |
| `npm run test:smoke` | PASS | 真实 Next.js：首页含「配置」「账号登录」；深链设置链路不回归；双轮 ctx=2→4；刷新恢复；禁用/删除 |
| `npm run test:e2e` | PASS | 4 个 Chromium 用例（见下） |
| `npm run build` | PASS | 10 路由 |
| `python -m unittest tests.test_governance` | PASS | 13 |
| `python tools/governance.py ui` | PASS | UI_CONTROL_PASS |

## 3. 真实浏览器（Playwright）覆盖

1. **clean home, settings dialog, multi-turn chat with markdown, refresh restore** —— 首页只有 `h1` 标题 + 配置/账号两按钮，初始无打开弹窗；经「配置」弹窗保存本地 Provider（201）、连接测试返回 `Connection OK.`、关闭弹窗；发送两轮对话验证上下文 `ctx=2 → ctx=4`；断言 `<code>npm test</code>`、`<strong>ship</strong>`、2 个 `<li>` 且转录中不含字面 `**ship**`；刷新后转录与「Restored」状态恢复。
2. **appearance toggle switches and persists the dark theme** —— 初始 `html` 无 `data-theme=dark`；弹窗内点「深色」后立即生效；刷新后仍为 dark；切回「浅色」生效。
3. **the account dialog separates Agent-Jarvis login from model authorization** —— 账号弹窗包含「Agent-Jarvis 账号 ≠ 模型授权」，可关闭。
4. **Stop halts the stream server-side** —— 真实 Stop 按钮触发 abort，落库助手消息 `status=stopped`（不回归）。

## 4. 双主题对比度（ui-contract 计算值）

静态层对 `:root`（浅色）与 `[data-theme="dark"]`（深色）两套 token 各校验一次：

- CC-01 `--text` / `--bg`：两套均 ≥ 4.5:1。
- CC-02 `--muted` / `--surface`：两套均 ≥ 4.5:1。
- CC-03 `--line` / `--bg`（控件边界，WCAG 1.4.11）：两套均 ≥ 3:1 —— 浅色 `#858e9a`、深色 `#5b6672` 即为满足该门槛所选。

真实浏览器层另在默认与 `data-theme="dark"` 下各扫描一次所有可见文本节点的计算对比度（`LV-CONTRAST` / `LV-CONTRAST-DARK`），均无低对比文本。

## 5. 本轮修正的 ui-contract 误报

| 规则 | 误报原因 | 修正 |
|---|---|---|
| RF-05 | 硬编码 `.shell`，首页容器已改名 `.home` | 改为在 `.home`/`.shell`/`main` 中探测页面滚动容器 |
| RF-07 | 转录高度改由被限高的 flex 父级约束，规则只看自身 `max-height` | 接受"父级 `--expanded` 已限高 + 自身 `flex:1`"的等价约束 |
| LB-01 | `calc(1.25rem + env(...))` 解析为 NaN | 取偏移中第一个字面长度参与判断 |
| LB-03 | `useState(initialMessages.length > 0)` 被判为"可能不折叠" | 识别由恢复态派生的初始展开 |
| FF-01 | 只认 `saving/pending/status` 变量名 | 补充 `busy` 等常见命名 |
| DS-01 | 深色 token 位于 `:root[data-theme="dark"]`，被当作散落字面量 | 排除所有以 `:root` 开头的选择器 |
| LV-FOCUS | 关闭的 `<dialog>` 内控件无法获得焦点，被判为缺焦点环 | 仅校验 `focus()` 后确实成为 `activeElement` 的可见控件 |

以上均为**规则本身的判定缺陷**，不是放宽标准：修正后静态层从 38 PASS / 1 FAIL / 6 WARN 变为 45 PASS / 0 FAIL / 0 WARN，且新增 RF-09（展开面板限高）收紧了约束。
