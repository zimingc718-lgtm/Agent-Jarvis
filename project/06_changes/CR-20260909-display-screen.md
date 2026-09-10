# CR-20260909-display-screen

- 级别: L3（重写首页形态 REQ-F-015 + 新增全屏渲染层 + 落地 DEC-015 未沙箱化 `<iframe srcdoc>` 的实际渲染 + 修订路由契约）
- 提出人: user（"skill 会输出一个 html，将其结果在首页上显示…底下是根据对话框显示出固定的知识呈现或者动态内容显示…可以理解为 Jarvis 的动态显示屏…全屏。对话框在它的上面…刷新还在，除非对话出现其他指令…让它显示首页，那么就回到标题首页" → msg 50-6 / 51-12 / 51-13 / 51-15；F1/F2 拆分见 CR-20260909-skills CP-12）
- 状态: CLOSED（R1 四角色 APPROVED（1 轮反馈闭环）+ 用户 2026-09-10 人工终裁「确认，开始执行」+ R2/R3/R4 机器门 PASS + P3/P4 完成：TASK-036..039 DONE、TEST-039..042 PASS、g1-g4 全绿。与 CR-20260909-skills 合并实现）
- 占用 ID: DEC-017, TASK-036..039, TEST-039..042 （由 CR-20260910-risk-scaled-gates 回填，只登记本 CR **创建**的 ID，不含其引用或修订的既有 ID；DEC-001..014 的创建归属无法从现有记录复原，故未登记。）
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
  - R2/R3/R4（P2 产出，**已完成**）：三层说明书各含 `CR-20260909-display-screen` 节逐一响应 CP-1..CP-15；本文件 `## R2/R3/R4 评审矩阵`（CP-1..CP-15 × 4 角色，全 APPROVED，无 REJECTED / 无空 / 无遗留 CONDITIONAL）；`review r1|r2|r3|r4` 全 PASS。
  - P3/P4：TASK-036..039 DONE；TEST-039..042 PASS（含 e2e）；TEST-021/032 + appearance/account e2e 回归通过；`gate g3|g3.5` PASS；`ui-contract` 0 FAIL。
  - DEC-015 出口义务清单（CR-20260909-skills R4 矩阵末②）在本 CR 更新为"F2 已落地不可关闭提示条；沙箱化仍为后续 CR 义务"。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）以本职说明书 + 行业惯例独立 ReAct 评审，详见 `EV-2026-09-09-display-screen-requirements.md §3`；反馈闭环记录见 `CR-20260909-display-screen.feedback.jsonl`（1 轮收敛）。**R1 人工终裁**：待用户拍板（CP-1..CP-15、REQ-F-015 重写、未沙箱化渲染 + 不可关闭提示条、`display_state` 全局单行、`routeTurn` 扩 `display`、F1/F2 P3 合并实现）。
  - **产品 owner（R1）**：F2 把"首页"从"极简空页"变成"动态屏"，是 REQ-F-015 的 MUST 验收重写，须记为用户确认变更。展示屏是"一块屏幕"（全局单行 `display_state`），不是 per-conversation——与用户"Jarvis 的动态显示屏"表述一致。非目标须锁：不做多屏/分屏、不做展示历史回看、不做展示屏手动编辑、不做内容导出。结论：**APPROVED**（REQ-F-015 重写记为用户确认变更；非目标 4 行已入说明书）。
  - **架构角色（R1 → R2 轮闭环）**：
    - R1 CONDITIONAL：① 提示条须**不可关闭**且**渲染 insight 时常驻**（非"首次渲染前"一次性）；② 展示屏内容流机制（`display_state` 存储形态 + 事件流）须在 R1 锁定，不留 P2 开放问题。
    - 处理：① REQ-F-025 ② 已改为"渲染任一技能 HTML 时顶部显示不可关闭提示条（无关闭按钮、Esc 无效、切走 insight 视图才消失）"。② CR 选择理由 + CP-8/CP-9 + 下方"机制 R1 锁定"行明确：`display_state` = 全局单行（固定主键 `id='singleton'` + `INSERT OR REPLACE`）；内容流 = `jarvis:display-changed` 事件 + `GET /api/display` 重取，**无轮询/SSE**——DEC-017 是该已锁机制在 P2 架构说明书的誊写位，非待决问题。③ `routeTurn` 一次调用扩 `display`（DEC-016 修订，不加第二次 LLM 调用）；F1/F2 P3 合并实现，router 从第一行即 `routeTurn`，无签名 churn。
    - 结论：**APPROVED**（信任面由 DEC-015 承载、带"后续 CR 必须沙箱化"出口义务，可接受）。
  - **模块开发角色（R1 → R2 轮闭环）**：
    - R1 CONDITIONAL：① `page.tsx` 首页重写须按 2 子项提交（Ⅰ `DisplayScreen` + 数据流；Ⅱ 布局重写 + TEST-021/032 回归）；② `routeSkill`→`routeTurn` 签名 churn 窗口须消除。
    - 处理：① CP-12 + TASK-038 描述 + 验收条件 P3 行均写明 2 子项。② 确定 **F1（skills）与 F2（display-screen）P3 合并实现**：`src/lib/skills.ts` 的路由函数从第一行代码起即 `routeTurn(): {skill, display}`（F1 阶段 `display` 恒 `null`）；F1 的 `CR-20260909-skills` + `架构 DEC-016` + `模块 TASK-035` + 接口契约已同步为 `routeTurn`，不再有 `routeSkill` 命名——无 principle-13 悬空、无后续 rename。`DisplayScreen` 首帧 SSR `display_state` 走 DEC-011 已验证模式。
    - 结论：**APPROVED**。
  - **测试角色（R1）**：① `DisplayScreen`"刷新保持"必须真实浏览器 e2e（原则 12）；② 渲染 insight 时提示条在 DOM 且无法关闭（无 close 按钮 / Esc 无效）须断言；③ `routeTurn` `display` fail-open 单测（判不出 → 展示屏不变）；④ REQ-F-015 重写碰 TEST-021/032（首页结构）——回归门。结论：**APPROVED**（TEST-039..042 + TEST-021/032 回归覆盖以上四点）。
- 评审结论汇总: **R1 反馈闭环后四角色全部 APPROVED**（产品/测试 R1 即 APPROVED；架构/模块 R1 CONDITIONAL → 反馈处理 → R2 轮 APPROVED，1 轮收敛，见 `.feedback.jsonl`）。无 REJECTED。无遗留 CONDITIONAL 进入 P2。

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
| CP-10 | 架构 | 路由函数为 `routeTurn(): {skill, display}`（F1/F2 P3 合并实现，`src/lib/skills.ts` 从第一行即此签名；F1 阶段 `display` 恒 null、无 `routeSkill` 命名，无 rename/悬空）；`display` 同样 fail-open（DEC-016 修订） | DEC-016 | 小改 |
| CP-11 | 架构 | 未沙箱化 iframe 实际渲染在本 CR 落地（DEC-015 从"立项"到"渲染 + 提示条"）；宿主页不对该 iframe 加额外 CSP | DEC-015 | 修订 |
| CP-12 | 模块 | `page.tsx` 首页重写按 2 子项：Ⅰ `DisplayScreen` + `src/lib/display.ts` + `GET /api/display` + 事件流；Ⅱ 首页布局重写 + z-index 层叠 + TEST-021/032 回归 | TASK-037, TASK-038 | 大改 |
| CP-13 | 模块 | `DisplayScreen` 是 client 组件，`page.tsx` SSR 首帧渲染 `display_state`（避免闪烁，同 DEC-011）；`FloatingChat` 在收到 `insight` 尾事件 / display 指令时派发 `jarvis:display-changed` | TASK-037 | 新增 |
| CP-14 | 测试 | `DisplayScreen` 每个可观察行为有真实入口测试：默认 home / insight 渲染 / 提示条不可关闭 / 「显示首页」回标题 / 刷新保持（真实浏览器）/ `routeTurn` display fail-open | TEST-039..TEST-042 | 新增 |
| CP-15 | 测试 | REQ-F-015 重写 → TEST-021/032 + appearance/account e2e 回归门（首页结构断言反转，须真覆盖新结构） | TEST-021, TEST-032 | 回归 |

（产品 CP-1..CP-7 + 架构派生 CP-8..CP-11 + 模块派生 CP-12/CP-13 + 测试派生 CP-14/CP-15。R2/R3/R4 各层须逐一响应 CP-1..CP-15。）

### 机制 R1 锁定（架构 R1 CONDITIONAL 闭环）

以下机制在 R1 已定，P2 只做架构说明书誊写（DEC-017），不是待决问题：

- **`display_state` 存储**：单表 `display_state(id TEXT PRIMARY KEY, kind TEXT, ref_id TEXT, updated_at TEXT)`，**全局单行**（固定 `id='singleton'`），读写用 get-or-create（`INSERT OR REPLACE` / 读时无行则返回默认 `{kind:'home'}`）。非 per-conversation、非 per-user（当前单管理员）。
- **内容流**：`FloatingChat` 在收到 SSE 尾部 `insight` 事件、或 `routeTurn` 返回 `display:'home'` 后，`window.dispatchEvent(new Event('jarvis:display-changed'))`；`DisplayScreen` 监听该事件 → `GET /api/display` 重取并重渲染。**无轮询、无独立 SSE/WebSocket**。
- **首帧**：`page.tsx`（RSC）读 `getDisplayState()` 作 `DisplayScreen` 初始 props → SSR 首帧即正确内容；client `useEffect` 再订阅事件。SSR/hydration 一致性同 DEC-011 模式。
- **路由**：`routeTurn(userMessage, skills): Promise<{skill: string|null, display: 'home'|null}>` —— F1 的 DEC-016 独立最小 LLM 调用，一次调用出两个字段；两者各自 fail-open（失败 → `{skill:null, display:null}`）。
- **未沙箱化渲染**：`kind:'insight'` 时 `<iframe srcDoc={html}>` **不加 `sandbox`**（DEC-015，用户接受）；iframe 上方 `<div class="display-screen__notice">` 不可关闭提示条，`kind` 非 `insight` 时不渲染提示条。

## R2 评审矩阵

评审对象：`架构设计说明书.md`（`CR-20260909-display-screen 方案` 表 + DEC-017 + DEC-016 修订 + MOD-DISPLAY + 接口契约新增行）。行 = CP-1..CP-15，列 = 产品 / 架构 / 模块 / 测试。无 REJECTED、无空、无遗留 CONDITIONAL。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 首页形态与"动态屏"一致（方案表 CP-1） | APPROVED 层叠刻度承 DEC-014（自审） | APPROVED `page.tsx` 重写按 2 子项 | APPROVED e2e 可验（TEST-041） |
| CP-2 | APPROVED 标题移入 home 视图符合"标题首页" | APPROVED `<h1>` 迁移无地标冲突 | APPROVED 删 `<header>` + home 视图承载 | APPROVED TEST-040 ① + TEST-021 回归 |
| CP-3 | APPROVED 洞察上屏是需求核心 | APPROVED 路由层 `setDisplayState`（DEC-017 ⑤） | APPROVED TASK-039 ② 一个分支 | APPROVED TEST-041 ② |
| CP-4 | APPROVED "刷新还在"锁定 | APPROVED SSR 首帧读 `display_state`（DEC-011 模式） | APPROVED `page.tsx` RSC 读取 | APPROVED TEST-041 ④ 真实浏览器 |
| CP-5 | APPROVED "回到首页"指令锁定 | APPROVED `display:"home"` 复用同一路由调用 | APPROVED TASK-039 ② | APPROVED TEST-042 ③ + TEST-041 ③ |
| CP-6 | APPROVED 扩展点无过度设计 | APPROVED `switch + default`（方案表 CP-6） | APPROVED `DisplayScreen` switch | APPROVED TEST-040 ④ 未知 kind 回退 |
| CP-7 | APPROVED 安全告知是唯一缓解 | APPROVED 不可关闭常驻（R1 CONDITIONAL 已闭环） | APPROVED 无按钮无 Esc 处理（TASK-037 ①） | APPROVED TEST-040 ③ 断言无 close 途径 |
| CP-8 | APPROVED "一块屏"= 全局单行 | APPROVED 固定主键 + `ON CONFLICT`（DEC-017 ①） | APPROVED `src/lib/display.ts` get-or-create | APPROVED TEST-039 单行语义 |
| CP-9 | APPROVED 不引入新长连接 | APPROVED 事件 + 重取，无轮询/SSE（DEC-017 ③） | APPROVED `add/removeEventListener` | APPROVED TEST-040 ⑤ + 代码审查 |
| CP-10 | APPROVED 一条消息可只切展示 | APPROVED 一次调用出两字段（DEC-016 修订） | APPROVED `routeTurn` 从第一行即此签名 | APPROVED TEST-042（与 F1 TEST-034 不重叠） |
| CP-11 | APPROVED 用户接受未沙箱化 | APPROVED DEC-015 落地渲染 + 提示条 + 出口义务 | APPROVED `<iframe srcDoc>` 无 sandbox 1 行 | APPROVED TEST-040 ② 断言无 sandbox 属性 |
| CP-12 | APPROVED 2 子项不改变行为 | APPROVED Ⅰ 不碰现有首页、Ⅱ 布局 + 回归 | APPROVED TASK-038 Ⅰ/Ⅱ（自审） | APPROVED Ⅰ 组件先测、Ⅱ 触发回归 |
| CP-13 | APPROVED 解耦无用户可见影响 | APPROVED `FloatingChat` 不 import `DisplayScreen` | APPROVED 自定义事件解耦（自审） | APPROVED grep 守卫 + TEST-041 ④ |
| CP-14 | APPROVED 验收有可观察落点 | APPROVED 每 CP 有真实入口或审查项 | APPROVED 影响矩阵逐 CP 有任务 | APPROVED TEST-039..042 全覆盖 |
| CP-15 | APPROVED 回归门锁定首页结构 | APPROVED TEST-021/032 反转是预期 | APPROVED TASK-038 Ⅱ 承接回归 | APPROVED TEST-021/032 作回归门重写 |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md`（`CR-20260909-display-screen 变化点影响矩阵` + `技术设计` 表 + TASK-036..039 + 关键接口新增行）。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 无 CR 外行为 | APPROVED 布局是 CSS 层叠 + 条件渲染 | APPROVED TASK-037/038 Ⅱ（自审） | APPROVED TEST-040/041 |
| CP-2 | APPROVED 标题在 home 视图 | APPROVED 删 `<header>` 无地标问题 | APPROVED 技术设计 CP-1/CP-2（自审） | APPROVED TEST-021 回归 |
| CP-3 | APPROVED | APPROVED 路由层写 `display_state` | APPROVED TASK-039 ②（自审） | APPROVED TEST-041 ② |
| CP-4 | APPROVED 刷新保持 | APPROVED `page.tsx` RSC 每请求读取 | APPROVED 技术设计 CP-4（自审） | APPROVED TEST-041 ④ |
| CP-5 | APPROVED | APPROVED `display:"home"` 分支 | APPROVED TASK-039 ②（自审） | APPROVED TEST-042 ③ |
| CP-6 | APPROVED | APPROVED `switch + default` | APPROVED 技术设计 CP-6（自审） | APPROVED TEST-040 ④ |
| CP-7 | APPROVED 告知唯一缓解 | APPROVED 无 close 途径 | APPROVED TASK-037 ①④（自审） | APPROVED TEST-040 ③ |
| CP-8 | APPROVED | APPROVED `ON CONFLICT DO UPDATE` 单行 | APPROVED TASK-036（自审） | APPROVED TEST-039 |
| CP-9 | APPROVED | APPROVED 自定义事件标准做法 | APPROVED 技术设计 CP-3/CP-9（自审） | APPROVED TEST-040 ⑤ |
| CP-10 | APPROVED | APPROVED 路由层读 `display` 字段 | APPROVED `routeTurn` 签名无 rename（自审） | APPROVED TEST-042 |
| CP-11 | APPROVED 用户接受 | APPROVED `<iframe>` 无 sandbox + DEC-015 | APPROVED 技术设计 CP-10/CP-11（自审） | APPROVED TEST-040 ② |
| CP-12 | APPROVED | APPROVED Ⅰ 不碰现有首页 | APPROVED TASK-038 Ⅰ/Ⅱ（自审） | APPROVED Ⅰ 先测、Ⅱ 回归 |
| CP-13 | APPROVED | APPROVED 零直接引用 | APPROVED `FloatingChat` 只 dispatchEvent（自审） | APPROVED grep 守卫 |
| CP-14 | APPROVED | APPROVED 每 CP 有任务或说明 | APPROVED 影响矩阵无遗漏（自审） | APPROVED 派生矩阵覆盖全部任务 |
| CP-15 | APPROVED | APPROVED TASK-038 Ⅱ 承接 | APPROVED 回归门写入 TASK-038（自审） | APPROVED TEST-021/032 重写 |

## R4 评审矩阵

评审对象：`测试说明书.md`（`CR-20260909-display-screen 任务→测试派生矩阵` + `测试设计` 表 + TEST-039..042 + TEST-021/032 回归改写 + 复盘迭代）。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 全屏可断言 | APPROVED e2e 覆盖 | APPROVED TASK-037/038 绑 TEST-040/041 | APPROVED TEST-040 ① + TEST-041 ①（自审） |
| CP-2 | APPROVED 标题视图可断言 | APPROVED 无 header 可断言 | APPROVED 绑 TEST-021 回归 | APPROVED TEST-040 ① + TEST-021（自审） |
| CP-3 | APPROVED 上屏可断言 | APPROVED e2e | APPROVED TASK-039 绑 TEST-041 | APPROVED TEST-041 ②（自审） |
| CP-4 | APPROVED 刷新保持逐条 | APPROVED 真实浏览器（原则 12） | APPROVED 绑 TEST-041 | APPROVED TEST-041 ④ `page.reload()`（自审） |
| CP-5 | APPROVED 回标题可断言 | APPROVED 路由层写入有断言 | APPROVED TASK-039 绑 TEST-042 | APPROVED TEST-042 ③ + TEST-041 ③（自审） |
| CP-6 | APPROVED 扩展点回退可断言 | APPROVED 未知 kind 不崩 | APPROVED 绑 TEST-040 | APPROVED TEST-040 ④（自审） |
| CP-7 | APPROVED 提示条可断言 | APPROVED 不可关闭须断言无途径 | APPROVED TASK-037 绑 TEST-040 | APPROVED TEST-040 ③ 无 close 途径（自审） |
| CP-8 | APPROVED 单行可断言 | APPROVED `count(*)≤1` 断言 | APPROVED TASK-036 绑 TEST-039 | APPROVED TEST-039（自审） |
| CP-9 | APPROVED 无轮询可验 | APPROVED 一事件一重取 + 代码审查 | APPROVED 绑 TEST-040 ⑤ | APPROVED TEST-040 ⑤ + 审查（自审） |
| CP-10 | APPROVED display 字段可断言 | APPROVED 与 F1 TEST-034 分测 | APPROVED TASK-039 绑 TEST-042 | APPROVED TEST-042 ①②④（自审） |
| CP-11 | APPROVED 用户接受 | APPROVED 断言无 sandbox 属性 + DEC 可追溯 | APPROVED 绑 TEST-040 ② | APPROVED TEST-040 ② + 代码审查（自审） |
| CP-12 | APPROVED 2 子项各有测试 | APPROVED Ⅰ 组件先测 | APPROVED 派生矩阵 TASK-038 Ⅰ/Ⅱ | APPROVED 派生矩阵（自审） |
| CP-13 | APPROVED 审查可验 | APPROVED grep 守卫 | APPROVED `FloatingChat` 不 import DisplayScreen | APPROVED 测试设计 CP-13（自审） |
| CP-14 | APPROVED 逐条落点 | APPROVED 每 CP 有真实入口或审查项 | APPROVED 派生矩阵覆盖全部任务 | APPROVED CP-1..CP-15 全映射 TEST-039..042（自审） |
| CP-15 | APPROVED 回归门 | APPROVED 断言反转是预期 | APPROVED TASK-038 Ⅱ 承接 | APPROVED TEST-021/032 作回归门重写（自审） |

**R2/R3/R4 结果**：CP-1..CP-15 × 4 角色 **全 APPROVED，无 REJECTED、无遗留 CONDITIONAL**。DEC-015 的"后续 CR 必须沙箱化"出口义务由本 CR 继续承载（F1 已登记 known warning `skill-html-unsandboxed`；F2 落地不可关闭常驻提示条作为当前唯一缓解）——这是**跨 CR 的长期义务**，非本 CR 的未决条件。

## R1 人工终裁

用户 2026-09-10：「确认，开始执行。」——确认 CP-1..CP-15、REQ-F-015 重写为全屏动态展示屏、`display_state` 全局单行 + `kind` 扩展点、`routeTurn` 扩 `display`、提示条不可关闭常驻、未沙箱化渲染在本 CR 落地，并授权进入 P3（与 CR-20260909-skills 合并实现）。

## P3/P4 实施记录（2026-09-10）

### 落地清单

| 任务 | 落点 |
|---|---|
| TASK-036 | `src/lib/store.ts`：`display_state` 建表 + `getDisplayState`/`setDisplayState`（`INSERT OR REPLACE`，固定主键 `'singleton'`）+ `dumpDisplayStateRowsForTest` |
| TASK-037 | `src/components/DisplayScreen.tsx`（`kind` switch + `default` 回退、不可关闭 `.display-screen__notice`、无 `sandbox` 的 `<iframe srcDoc>`、`jarvis:display-changed` 订阅）+ `src/lib/display.ts` `resolveDisplayView`/`showInsight`/`showHome` + `src/app/api/display/route.ts` + `globals.css` `.display-screen*` |
| TASK-038 | Ⅰ 组件与数据层（同上，未动首页）；Ⅱ `src/app/page.tsx` 删 `<header>`、`<DisplayScreen initial={resolveDisplayView()} />` 作基底、`.home` 改为纯容器 + `.home__message`；`ui-contract` 新增 **LB-09**、RF-05 候选容器扩到 `.display-screen--home`；TEST-021/032 回归门在 e2e 重跑 |
| TASK-039 | `src/lib/skills.ts` `routeTurn` 返回 `{skill, display}`；`chat/stream/route.ts` 读 `display` → `showHome()` + `{type:"display",kind:"home"}` 尾事件；`FloatingChat` 收到 `insight`/`display` 尾事件后 `dispatchEvent(DISPLAY_CHANGED_EVENT)` |

### P3 设计细化（相对 P2 的差异，已回写各层说明书）

1. **单行原语归属澄清**：`getDisplayState`/`setDisplayState` 实现在 `src/lib/store.ts`（与其它表的 CRUD 原语一致）；`src/lib/display.ts` 是 MOD-DISPLAY 的服务端外观，提供 `resolveDisplayView()`（把指针 join 到 `insights.html`）与 `showInsight`/`showHome` 两个写入意图函数。DEC-017 ① 已按此更新。
2. **`INSERT OR REPLACE` 取代 `ON CONFLICT DO UPDATE`**——单行表语义等价、SQLite 核心语法、无 upsert 版本依赖。
3. **新增零依赖模块 `src/lib/display-events.ts`**，导出 `DISPLAY_CHANGED_EVENT` 与 `DisplayView` 类型。理由：CP-13 要求 `FloatingChat` 不 import `DisplayScreen`；同时客户端组件不能经 `@/lib/display` 拉入 `store-singleton`（`node:sqlite`/`node:fs`）。事件名与视图类型因此各只有**一处**定义。
4. **`playwright.config.ts` 加 `workers: 1`**。理由：新增第二个 spec 文件后暴露出既有并行缺陷——各 spec 共用同一 dev server 与 SQLite，而 `resolveActiveProvider` 走**全局**优先级序，并行会互抢解析到的 Provider。属测试基建修复，不改产品行为。
5. **`skills-display.spec.ts` 自清理**：进入时与收尾时各删一次全部 Provider，避免污染共用 e2e 库的其它 spec。

### 验证

`npm test` **159** · `ui-contract` 静态 **49/0/0** · `--live` **67 PASS / 1 SKIP** · `smoke` OK · `test:e2e` **10 PASS**（新增 `tests/e2e/skills-display.spec.ts` 2 例：洞察上屏 + 提示条不可关闭 + 刷新保持 + 显示首页回标题 + 未产出提示；☰ 在展示屏之上可用）· `build:verify` OK · `tsc --noEmit` OK。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ

## R1 评审意见

**CR-20260909-display-screen 评审（R1，第二个按新共识门禁模型执行）**（迁移自 `产品需求说明书.md`）

R1 四角色（产品 / 架构 / 模块开发 / 测试）独立 ReAct 评审。完整记录见 `project/05_evidence/EV-2026-09-09-display-screen-requirements.md §3`。CP 逐条响应见 `project/06_changes/CR-20260909-display-screen.md` 的「变化点登记」表（CP-1..CP-15）。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 产品 owner | ①REQ-F-015 从"极简空首页"变"全屏动态展示屏"是 MUST 验收重写，须记为用户确认变更。②展示屏是"一块屏幕"（全局单行 `display_state`），非 per-conversation——与用户"Jarvis 的动态显示屏"一致。③非目标须锁：不做多屏/分屏、展示历史回看、手动编辑、内容导出。 | REQ-F-015 重写 + 用户确认行；REQ-F-026 写明全局单行；非目标新增 4 行 | APPROVED |
| 架构角色 | ①`display_state` 全局单行 = get-or-create（固定主键 + `INSERT OR REPLACE`）。②未沙箱化 `<iframe srcdoc>` 在此 CR 从 DEC-015"立项"变"实际渲染"——信任面真实打开，唯一缓解是提示条 + known warning；提示条须**不可关闭**且**渲染 insight 时常驻**（不是"首次后消失"）。③`routeTurn` 扩 `display` 字段复用 F1 同一次独立调用，不加第二次 LLM 调用。④展示屏内容流用 `jarvis:display-changed` 事件 + 重取，不加轮询/SSE。 | REQ-F-025 ② 改"渲染时常驻不可关闭"；DEC-017 立项（P2）；REQ-F-027 复用同一路由调用 | CONDITIONAL（提示条不可关闭常驻；DEC-017 成文） |
| 模块开发角色 | ①`page.tsx` 首页重写是大改（header+空 → 全屏 DisplayScreen + 浮层 + z-index 层叠 + `<h1>` 迁入 home 视图）——按 2 子项：Ⅰ DisplayScreen + 数据流；Ⅱ 首页布局重写 + 回归。②`DisplayScreen` client 组件但首帧 SSR `display_state` 避免闪烁（同 DEC-011）。③`routeSkill`→`routeTurn` 是签名变更，与 F1 的 TASK-035 调用点须同步（F1 未 P3 落地则并入 F1 实现）。 | CP-12 写明 2 子项；CP-13 写明 SSR 首帧；CP-10 写明签名同步 | CONDITIONAL（`page.tsx` 2 子项；`routeTurn` 签名同步 F1） |
| 测试角色 | ①"刷新保持"必须真实浏览器 e2e（原则 12）。②提示条存在性须断言——渲染 insight 时在 DOM、无 close 按钮、Esc 无效。③`routeTurn` `display` fail-open 须单测（判不出 → 展示屏不变）。④REQ-F-015 重写碰 TEST-021/032（首页结构）——回归门。 | TEST-039..042 + TEST-021/032 回归 | APPROVED |

**R1 人工终裁**：待用户拍板——确认 CP-1..CP-15、REQ-F-015 重写、未沙箱化渲染 + 不可关闭提示条、`display_state` 全局单行、`routeTurn` 扩 `display` 字段。两个 CONDITIONAL 均为可实现前置（DEC-017、提示条常驻、`page.tsx` 2 子项、签名同步），无 REJECTED。

**动态展示屏实现细节（CR-20260909-display-screen，随 P2 细化）**：`display_state` 全局单行表（`kind` + `ref_id` + `updated_at`）。`src/components/DisplayScreen.tsx`（client）+ `src/lib/display.ts` + `GET /api/display`。`kind:"home"` → 标题视图（含产品名，取代 header `<h1>`）；`kind:"insight"` → `<iframe srcdoc>`（无 sandbox）+ 不可关闭提示条。内容变更经 `jarvis:display-changed` 事件（`FloatingChat` 收到 `insight` 尾事件 / display 指令时派发）→ 重新 `GET /api/display`。`routeTurn`（F1 `routeSkill` 扩展）一次调用返回 `{skill, display}`，`display` fail-open。层叠：DisplayScreen 基底 / FloatingChat 20 / CornerMenu 30。

## R2 评审意见

**CR-20260909-display-screen 评审（R2，架构说明书）**（迁移自 `架构设计说明书.md`）

各角色对本节「CR-20260909-display-screen 方案」表 + DEC-017 + DEC-016 修订 + MOD-DISPLAY 独立评审。逐 CP 裁决见 CR 的 `## R2 评审矩阵`。R1 阶段架构 CONDITIONAL 的两条（提示条不可关闭常驻 / DEC-017 成文）在此闭环——REQ-F-025 ② 已收紧、DEC-017 已成文。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 架构角色（自审） | ①`display_state` 全局单行 + get-or-create（固定主键）——`node:sqlite` 无框架下最简。②DEC-017 内容流（事件 + 重取，无轮询/SSE）成文，首帧 SSR 走 DEC-011 模式。③`<iframe srcDoc>` 无 sandbox 是 DEC-015 的落地——信任面真实打开，提示条不可关闭常驻是唯一缓解、出口义务保留。④`routeTurn` `display` 字段复用 F1 同一次调用。 | DEC-017 立项；REQ-F-025 ② 已收紧 | APPROVED |
| 产品 owner | 方案无 CR 外行为；标题移入 home 视图符合"回到标题首页"表述；`kind` 扩展点未做过度设计（switch + default）。 | 确认 | APPROVED |
| 模块开发角色 | ①`page.tsx` 重写按 2 子项（CP-12）——认可。②`DisplayScreen` 与 `FloatingChat` 解耦（后者只派发事件）——边界干净。③`GET /api/display` 在 `kind:"insight"` 时附 html，省一次 `GET /api/insights` 往返——合理。 | 记入 TASK-037/038 | APPROVED |
| 测试角色 | ①`GET /api/display` 是真实入口，"刷新保持"可 e2e。②提示条不可关闭须断言（无 close 按钮 + Esc 无效）。③`display` fail-open 单测。④DEC-016 修订后 F1 的 TEST-034 仍只测 `skill`，`display` 归 TEST-042——无重叠。 | TEST-039..042 | APPROVED |

## R3 评审意见

**CR-20260909-display-screen 评审（R3，模块任务开发说明书）**（迁移自 `模块任务开发说明书.md`）

各角色对本 CR 的「变化点影响矩阵」+「技术设计」两表 + TASK-036..039 独立评审。逐 CP 裁决见 CR 的 `## R3 评审矩阵`。R1 阶段模块 CONDITIONAL 两条（`page.tsx` 2 子项 / `routeTurn` 签名 churn）在此闭环。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 模块开发角色（自审） | ①影响矩阵与架构 CP-1..CP-15 逐行对应，无遗漏。②`page.tsx` 重写按 2 子项写死 TASK-038（Ⅰ 组件/数据层不碰现有首页 → 可先单测；Ⅱ 布局 + 回归）。③`routeTurn` 从 TASK-035 第一行即 `{skill, display}` 签名——F1/F2 合并 P3，无 `routeSkill` 命名、无 rename churn。④`FloatingChat` 只 `dispatchEvent`、不 import `DisplayScreen`——解耦。 | TASK-036..039 + 2 子项 + 合并 P3 顺序 | APPROVED |
| 架构角色 | ①`display_state` get-or-create（`ON CONFLICT DO UPDATE`）+ 单行——符合 DEC-017。②`GET /api/display` 在 `kind:"insight"` 时附 html，省一次往返——合理。③`<iframe srcDoc>` 无 sandbox 是 DEC-015 落地，提示条不可关闭在 TASK-037 ①（无按钮/无 Esc）——满足。 | 记入 TASK-037 | APPROVED |
| 产品 owner | ①标题移入 `DisplayScreen` home 视图——符合"回到标题首页"。②`kind` `switch + default` 不过度设计。③无展示屏编辑/历史——非目标一致。 | 确认 | APPROVED |
| 测试角色 | ①TASK-036 `display_state` get-or-create 单测（无行→默认 / 有行→更新）。②TASK-037 提示条断言（无 close 按钮 + Esc 无效）。③TASK-038 Ⅱ 触发 TEST-021/032 回归——须真覆盖新结构。④TASK-039 `display:"home"` fail-open 单测。 | TEST-039..042 + 回归 | APPROVED |

## R4 评审意见

**复盘迭代（CR-20260909-display-screen）**（迁移自 `测试说明书.md`）

评审立场：测试角色以 AI_STANDARD 原则 12/13/15 为立场独立评审 R4（本测试说明书）。R1 阶段测试即 APPROVED；本轮确认 P2 测试设计闭合。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 测试角色（自审） | ①"刷新保持"jsdom 测不出 → TEST-041 走真实浏览器 `page.reload()`。②提示条"不可关闭"须断言无 close 途径（无按钮 + Esc 无效），不能只断言"存在"。③`routeTurn` `display` 字段与 F1 的 `skill` 分测（TEST-042 vs TEST-034），无重叠。④REQ-F-015 重写是行为回归 → TEST-021/032 作回归门重写、点名。 | TEST-039..042 + TEST-021/032 回归 | APPROVED |
| 架构角色 | DEC-017 的"无轮询/SSE"须可验 → TEST-040 ⑤ 断言"一次事件 → 一次重取" + 代码审查 `DisplayScreen` 无 `setInterval`/`EventSource` | 记入 TEST-040 + 测试设计 CP-9 | APPROVED |
| 模块开发角色 | 每个任务/子项绑定断言：TASK-036→TEST-039、TASK-037→TEST-040/041、TASK-038 Ⅱ→TEST-021/032 回归、TASK-039→TEST-042。派生矩阵无遗漏 | 确认 | APPROVED |
| 产品 owner | REQ-F-015/026/027 的可观察动作（全屏展示屏 / 洞察上屏 / 刷新保持 / 显示首页回标题 / 提示条）在 TEST-040/041/042 逐条落点 | 确认 | APPROVED |
