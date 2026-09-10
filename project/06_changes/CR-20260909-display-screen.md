# CR-20260909-display-screen

- 级别: L3（重写首页形态 REQ-F-015 + 新增全屏渲染层 + 落地 DEC-015 未沙箱化 `<iframe srcdoc>` 的实际渲染 + 修订路由契约）
- 提出人: user（"skill 会输出一个 html，将其结果在首页上显示…底下是根据对话框显示出固定的知识呈现或者动态内容显示…可以理解为 Jarvis 的动态显示屏…全屏。对话框在它的上面…刷新还在，除非对话出现其他指令…让它显示首页，那么就回到标题首页" → msg 50-6 / 51-12 / 51-13 / 51-15；F1/F2 拆分见 CR-20260909-skills CP-12）
- 状态: R1 待人工终裁（四角色 ReAct 评审已出，见 `EV-2026-09-09-display-screen-requirements.md`）
- 评审模型: R1–R4 + G3/G3.5/G4（第二个按新共识门禁模型执行的 CR；R1 四角色）
- 影响需求: 新增 REQ-F-026、REQ-F-027；**重写 REQ-F-015**（极简首页 → 全屏动态展示屏）；落地 REQ-F-025 ②（未沙箱化 HTML 的首渲提示条）
- 影响模块: **新增 MOD-DISPLAY**（`src/components/DisplayScreen.tsx` + `src/lib/display.ts`）、MOD-DB（新增 `display_state` 单行表）、MOD-CHAT（`routeSkill` → `routeTurn` 返回 `{skill, display}`；路由层写 `display_state`）、MOD-CHAT-UI（`FloatingChat` 派发 `jarvis:display-changed`）、MOD-SETTINGS-UI（`page.tsx` 首页布局重写，层叠关系）
- 影响任务: 新增 TASK-036（`display_state` 表 + `getDisplayState`/`setDisplayState` get-or-create）、TASK-037（`DisplayScreen` 组件 + `GET /api/display` + `jarvis:display-changed` 事件流 + 首渲提示条）、TASK-038（`page.tsx` 首页重写为全屏 DisplayScreen + 层叠 + header `<h1>` 迁入 home 视图）、TASK-039（`routeSkill`→`routeTurn` 扩 `display` 字段 + 路由层写 `display_state`）
- 影响测试: 新增 TEST-039（`display_state` get-or-create + 单行语义）、TEST-040（`DisplayScreen`：默认 home 视图 / insight 渲染 / 提示条 / kind 扩展点）、TEST-041（e2e：技能洞察 → 展示屏切换 → 「显示首页」回标题 → 刷新保持）、TEST-042（`routeTurn` `{skill, display}` 双字段 + display fail-open）；TEST-021/032 + appearance/account e2e 回归（首页结构变）
- 当前证据: `project/05_evidence/EV-2026-09-09-display-screen-requirements.md`
- 方案选项:
  - A. 展示屏做成对话面板内的一个「洞察」标签页（不全屏）——被用户否决（msg 51-12「全屏。对话框在它的上面」）
  - B. **全屏 `DisplayScreen` 作首页基底层，对话与 ☰ 菜单浮其上；内容由 `display_state` 单行表驱动（`kind` 扩展点，F2 = `home`/`insight`），跨刷新持久；对话指令经 `routeTurn` 的 `display` 字段切换（「显示首页」→ `home`）；技能轮产出 `insights` 行 → 路由层写 `display_state` 指向该洞察**
  - C. 展示屏内容纯前端状态（不持久化）——被用户否决（msg 51-13「刷新还在」）
- 选择理由: 选 B。用户要"Jarvis 的动态显示屏"——全屏、内容随对话动态变、刷新保持、可由对话指令切回首页。`display_state` 做**全局单行**（不是 per-conversation）符合"一块屏幕"的心智，`kind` 留扩展点（msg 51-15「留有其他的扩展」）。展示屏内容变更用轻量 `jarvis:display-changed` 事件 + `GET /api/display` 重取，不引入轮询/SSE（对话已有 SSE，展示屏不需要独立长连接）。路由复用 F1 的独立调用（DEC-016），只把返回从 `skill` 扩成 `{skill, display}`，`display` 同样 fail-open。未沙箱化 `<iframe srcdoc>`（DEC-015，用户 msg 54-1 已接受）在此 CR 落地实际渲染 + **不可关闭安全提示条**作为唯一缓解。
- 回滚方式:
  - 文档回滚：还原 `产品需求说明书.md`（删 REQ-F-026/027、恢复 REQ-F-015 corner-menu 版、删非目标新增行与 R1 评审）、`架构设计说明书.md`（删 DEC-017、MOD-DISPLAY、`CR-20260909-display-screen` 节，DEC-015/016 恢复 CR-20260909-skills 版）、`模块任务开发说明书.md`（删 TASK-036..039 + CR 节）、`测试说明书.md`（删 TEST-039..042 + CR 节）、删 EV、`test-results.json` 去本 CR 条目。
  - 运行回滚（P3 后）：删 `src/components/DisplayScreen.tsx`、`src/lib/display.ts`、`src/app/api/display/route.ts`；`page.tsx` 恢复 corner-menu 版首页（header `<h1>` + 无 DisplayScreen）；`store` `migrate()` `DROP TABLE display_state`；`routeTurn` 回退为 `routeSkill`（去 `display` 字段）；`FloatingChat` 去 `jarvis:display-changed` 派发；`globals.css` 删 `.display-screen*`；`ui-contract.mjs` 去新规则。无第三方依赖新增。
  - 回滚后重跑 `verify | check-changes | ui | review r1..r4 | gate g3/g3.5/g4` 并重新 `snapshot`。
- 验收条件:
  - R1：本文件有 `## 变化点登记` 表（CP-1..CP-15，每行有来源角色）+ R1 人工终裁痕迹；`python tools/governance.py review r1` PASS。
  - R2/R3/R4（P2 产出）：三层说明书各含 `CR-20260909-display-screen` 节逐一响应 CP-1..CP-15；本文件补 `## R2/R3/R4 评审矩阵`；`review r2|r3|r4` PASS。
  - P3/P4：TASK-036..039 DONE；TEST-039..042 PASS（含 e2e）；TEST-021/032 + appearance/account e2e 回归通过；`gate g3|g3.5` PASS；`ui-contract` 0 FAIL。
  - DEC-015 出口义务清单（CR-20260909-skills R4 矩阵末②）在本 CR 更新为"F2 已落地不可关闭提示条；沙箱化仍为后续 CR 义务"。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）以本职说明书 + 行业惯例独立 ReAct 评审，详见 `EV-2026-09-09-display-screen-requirements.md §3`。**R1 人工终裁**：待用户拍板（CP-1..CP-15、REQ-F-015 重写、未沙箱化渲染 + 提示条方案、`display_state` 全局单行）。
  - **产品 owner**：F2 把"首页"从"极简空页"变成"动态屏"，是 REQ-F-015 的 MUST 验收重写，须记为用户确认变更。展示屏是"一块屏幕"（全局单行 `display_state`），不是 per-conversation——与用户"Jarvis 的动态显示屏"表述一致。非目标须锁：不做多屏/分屏、不做展示历史回看、不做展示屏手动编辑。结论：APPROVED（须记 REQ-F-015 重写为用户确认变更）。
  - **架构角色**：①`display_state` 全局单行 = get-or-create 模式，`node:sqlite` 无框架下用固定主键 + `INSERT OR REPLACE`。②未沙箱化 `<iframe srcdoc>` 在此 CR 从 DEC-015"立项"变"实际渲染"——**信任面真实打开**，唯一缓解是不可关闭提示条 + known warning；架构坚持提示条**不可关闭**且**每次渲染 insight 都在**（不是"首次后消失"）。③`routeTurn` 扩 `display` 字段复用同一次调用，不加第二次 LLM 调用。④展示屏内容流用 `jarvis:display-changed` 事件 + 重取，不加轮询/SSE。结论：CONDITIONAL（提示条不可关闭且常驻 insight 视图；DEC-017 成文）。
  - **模块开发角色**：①`page.tsx` 首页重写是**大改**（布局从 header+空 变 全屏 DisplayScreen + 浮层），涉及 `header <h1>` 迁入 DisplayScreen home 视图、z-index 层叠（DisplayScreen 基底 / FloatingChat 20 / CornerMenu 30）。②`DisplayScreen` 是 client 组件但首帧要 SSR `display_state` 避免闪烁——同 DEC-011 模式。③`routeSkill`→`routeTurn` 是签名变更，F1 的 TASK-035 调用点要同步改（F1 若已 P3 落地则本 CR 改；若未落地则合并到 F1 实现）。结论：CONDITIONAL（`page.tsx` 重写按 2 子项：Ⅰ DisplayScreen + 数据流；Ⅱ 首页布局重写 + 回归）。
  - **测试角色**：①`DisplayScreen` 的"刷新保持"必须真实浏览器 e2e（原则 12）。②提示条存在性须断言——渲染 insight 时提示条在 DOM 且无法关闭（无 close 按钮 / Esc 无效）。③`routeTurn` 的 `display` 字段 fail-open 须单测（判不出 → `display:null` → 展示屏不变）。④REQ-F-015 重写会碰 TEST-021/032（首页结构断言）——回归门。结论：APPROVED（e2e 覆盖刷新保持 + 提示条；TEST-021/032 回归）。
- 评审结论汇总: 产品 / 测试 APPROVED；架构 / 模块 CONDITIONAL，条件为可实现前置（DEC-017 成文、提示条不可关闭常驻、`page.tsx` 2 子项、`routeTurn` 签名同步）。无 REJECTED。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 |
|---|---|---|---|---|
| CP-1 | 产品 | 首页 = 全屏动态展示屏（DisplayScreen），对话与 ☰ 菜单浮其上；REQ-F-015 重写 | REQ-F-015 | 大改 |
| CP-2 | 产品 | 展示屏默认标题视图（产品名 + 一句话简介），header `<h1>` 迁入该视图 | REQ-F-015 | 大改 |
| CP-3 | 产品 | 技能轮产出 `insights` 行后，展示屏自动切到渲染该会话最新洞察 HTML | REQ-F-026 | 新增 |
| CP-4 | 产品 | 展示屏内容跨刷新持久（`display_state` 恢复），除非对话出现其他指令 | REQ-F-026 | 新增 |
| CP-5 | 产品 | 对话指令「显示首页」类 → 展示屏回标题视图 | REQ-F-027 | 新增 |
| CP-6 | 产品 | `display_state.kind` 扩展点：F2 = `home` / `insight`；其他 kind 预留 | REQ-F-026 | 新增 |
| CP-7 | 产品 | 未沙箱化 `<iframe srcdoc>` 渲染 insight HTML 时，展示屏顶部**不可关闭**安全提示条 | REQ-F-025, REQ-F-026 | 新增 |
| CP-8 | 架构 | `display_state` 为**全局单行**表（固定主键 + `INSERT OR REPLACE`），非 per-conversation；DEC-017 立项 | DEC-017 | 新增 |
| CP-9 | 架构 | 展示屏内容流：`jarvis:display-changed` 事件 + `GET /api/display` 重取，无轮询/SSE | DEC-017 | 新增 |
| CP-10 | 架构 | `routeSkill` → `routeTurn` 返回 `{skill, display}`，同一次独立调用（DEC-016 修订）；`display` 同样 fail-open | DEC-016 | 小改 |
| CP-11 | 架构 | 未沙箱化 iframe 实际渲染在本 CR 落地（DEC-015 从"立项"到"渲染 + 提示条"）；宿主页不对该 iframe 加额外 CSP | DEC-015 | 修订 |
| CP-12 | 模块 | `page.tsx` 首页重写按 2 子项：Ⅰ `DisplayScreen` + `src/lib/display.ts` + `GET /api/display` + 事件流；Ⅱ 首页布局重写 + z-index 层叠 + TEST-021/032 回归 | TASK-037, TASK-038 | 大改 |
| CP-13 | 模块 | `DisplayScreen` 是 client 组件，`page.tsx` SSR 首帧渲染 `display_state`（避免闪烁，同 DEC-011）；`FloatingChat` 在收到 `insight` 尾事件 / display 指令时派发 `jarvis:display-changed` | TASK-037 | 新增 |
| CP-14 | 测试 | `DisplayScreen` 每个可观察行为有真实入口测试：默认 home / insight 渲染 / 提示条不可关闭 / 「显示首页」回标题 / 刷新保持（真实浏览器）/ `routeTurn` display fail-open | TEST-039..TEST-042 | 新增 |
| CP-15 | 测试 | REQ-F-015 重写 → TEST-021/032 + appearance/account e2e 回归门（首页结构断言反转，须真覆盖新结构） | TEST-021, TEST-032 | 回归 |

（产品 CP-1..CP-7 + 架构派生 CP-8..CP-11 + 模块派生 CP-12/CP-13 + 测试派生 CP-14/CP-15。R2/R3/R4 各层须逐一响应 CP-1..CP-15。）

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `CR-20260909-display-screen` 节逐一响应 CP-1..CP-15 后，在此补三张 `## R{n} 评审矩阵`（行 = CP-1..CP-15，列 = 产品/架构/模块/测试），再跑 `review r2|r3|r4`。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ
