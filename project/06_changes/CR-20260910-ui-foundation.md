# CR-20260910-ui-foundation

- 级别：L3（用户指定 shadcn/ui、Tailwind 与 HSL Token 技术路线；新增外部 UI 依赖与构建样式链路，并替换全部前端界面的视觉基础）
- 提出人：user
- 状态：APPROVED（R1 人工终裁、P2/R2、R3、R4 完成）；**P3/P4 完成**——TASK-044..048 DONE、TEST-047..050 PASS、全量门禁 g1-g4 全绿
- 影响需求：新增 REQ-NF-006；保持 REQ-F-002、REQ-F-003、REQ-F-006、REQ-F-014、REQ-F-015、REQ-F-019 的业务行为和已批准验收。P3 的 REQ-F-020、REQ-F-028、REQ-NF-005 不纳入本 CR 验收。
- 影响模块：P2 待定。预期涉及全局样式、展示屏、悬浮对话、角落菜单、模型设置、通用弹窗与主题控制；不得在 R1 前定义模块任务。
- 影响任务：P2 后确定；不得在本 CR 将 P3 技能上传任务记为完成或重记。
- 影响测试：P2 后确定；现有 Provider 优先级、聊天、菜单、主题、展示屏的通过测试将作为回归基线。P3 测试独立保留，不计入本 CR 验收。
- 当前证据：`project/00_input/需求输入.md` 的 INPUT-2026-09-10-005；现有 `src/app/globals.css` 为全局 CSS 视觉基础，`package.json` 尚无 Tailwind、shadcn/ui 或其 primitive 依赖；当前工作区含未验收的 P3 技能上传改动。
- 方案选项：
  - A. 仅局部调整现有 CSS：不满足用户指定的组件与 Token 基础，拒绝。
  - B. 以 shadcn/ui、Tailwind 与语义化 HSL 三元组 Token 渐进迁移视觉基础：不采用；用户改选一次性重写。
  - C. 迁移时改变 Provider、上传或展示屏业务语义：超出用户确认范围，拒绝。
  - D. 以 shadcn/ui、Tailwind 与语义化 HSL 三元组 Token **一次性重写全部已批准前端界面**：已选。
- 选择理由：用户在 INPUT-2026-09-10-006 明确选择 D。最终态必须完全移除旧视觉实现；UI 基础迁移同时保持既有业务能力和真实入口，不以视觉重构掩盖 P3 未完成事项。
- 回滚方式：P2 必须定义可回退的依赖、配置、Token、组件与页面迁移顺序；P3 代码和验证记录不属于本 CR，不能通过回滚本 CR 影响其状态。
- 验收条件：
  - R1：本 CR 的全部变化点具有来源角色、四角色意见和人工终裁；用户已确认保留既有深色切换，浅色紫色为默认主题；`python tools/governance.py review r1` 通过。
  - R2-R4：架构、模块、测试说明书逐项承接本 CR 的全部 CP，四角色矩阵无空项、无 REJECTED、无未说明条件；各层机器门通过。
  - P3/P4：仅在 R4 通过后实施；从真实浏览器入口验证全部基线界面，Provider 优先级语义、菜单「模型」入口、主题、展示屏、对话和设置均不回归；P3 技能上传以其自身 CR 的独立证据判断。
- 评审记录：R1 四角色审查及反馈闭环详见本 CR「R1 四角色审查」及 `CR-20260910-ui-foundation.feedback.jsonl`。四角色无 REJECTED、无遗留 CONDITIONAL；用户已完成 R1 人工终裁。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 |
|---|---|---|---|---|
| CP-1 | 产品 | 全部已批准前端界面统一迁移到一致的浅色紫色视觉基础，默认呈现浅色紫色。 | REQ-NF-006 | L3 视觉基础变更 |
| CP-2 | 产品 | 左下角菜单内子菜单名称保持「模型」；Provider 启用与优先级选择保持既有语义，对话浮窗不新增选择器。 | REQ-F-006, REQ-NF-006 | 业务保持 |
| CP-3 | 产品 | 展示屏、悬浮对话、菜单、模型设置、账号占位入口和既有弹窗均在范围内；未批准的 P3 技能上传功能不计入本 CR 验收。 | REQ-F-002, REQ-F-003, REQ-F-007, REQ-F-015, REQ-NF-006 | 范围锁定 |
| CP-4 | 产品 | 本次不改变 Provider、会话、展示屏数据、上传、安全或认证语义；视觉迁移不得借机扩展业务需求。 | REQ-F-004, REQ-F-006, REQ-F-020, REQ-F-026 | 非目标 |
| CP-5 | 产品 | 既有 REQ-F-014 要求深色切换；「采用浅色」是否表示退役深色主题必须由人工终裁明确，未确认前按保留处理。 | REQ-F-014, REQ-NF-006 | 待决产品边界 |
| CP-6 | 架构 | P2 明确 shadcn/ui、Tailwind、HSL Token 的版本、依赖清单、构建接入和组件注册策略，且不改变服务端 API、数据库或 Provider 授权边界。 | REQ-NF-006, UI-GOV-001 | L3 技术路线 |
| CP-7 | 架构 | P2 设计语义 Token 及亮暗主题选择器与现有 `data-theme`、SSR/hydration 的兼容策略，避免首帧主题闪烁。 | REQ-F-014, REQ-NF-006 | 状态与渲染边界 |
| CP-8 | 架构 | 组件基础层与业务组件分层；Dialog、Menu、Button、Input 等 primitive 的引入不得泄漏 Provider、技能或展示屏协议。 | REQ-F-006, REQ-F-015, REQ-NF-006 | 模块边界 |
| CP-9 | 模块开发 | 受 P3 未验收代码影响的 `globals.css`、`FloatingChat`、首页和技能列表必须隔离；先形成 P3 可验证基线或使用受控隔离，禁止跨 CR 交叉记账。 | CR-20260910-skill-intake, REQ-NF-006 | 实现前置 |
| CP-10 | 模块开发 | 后续任务按基础设施、基础组件、页面布局、菜单/弹窗、聊天/设置适配拆分为可独立测试和回滚的任务；同义旧样式不得长期并存。 | REQ-NF-006, AI_STANDARD 原则 16 | 可维护性 |
| CP-11 | 测试 | 每个保留的可观察行为独立验证：Provider 优先级、菜单「模型」、展示屏、聊天、设置/弹窗、主题与响应式。 | REQ-F-002, REQ-F-003, REQ-F-006, REQ-F-015, REQ-NF-006 | 回归测试 |
| CP-12 | 测试 | 以组件测试、静态 UI 契约和 Playwright 真实入口验证语义 Token、WCAG 2.2 AA、焦点、键盘和 320/390/1280px reflow；P3 测试保持独立。 | UI-GOV-001, REQ-NF-006 | 验收策略 |

（产品 CP-1..CP-5，架构派生 CP-6..CP-8，模块派生 CP-9..CP-10，测试派生 CP-11..CP-12。R2/R3/R4 必须逐项承接 CP-1..CP-12。）

## R1 四角色审查

### 产品 owner

- 观察：用户确认了全界面覆盖、默认浅色紫色、技术方向、Provider 选择边界和 P3 排除范围。
- 判断：`APPROVED`。用户已在 R1 人工终裁明确保留深色主题；浅色紫色是默认而非唯一主题，不删除 REQ-F-014 的既有能力。
- 处理：REQ-NF-006 ⑥明确两套主题均受 `UI-GOV-001` 约束；深色主题不需要产品重定义。

### 架构角色

- 观察：当前项目使用全局 CSS 和 `data-theme`；引入 shadcn/ui、Tailwind 和组件 primitives 会改变前端依赖与样式构建链路，符合 L3。
- 判断：`APPROVED`。技术可行；版本、HSL Token 编译方案、亮暗主题选择器、SSR/hydration 首帧策略、依赖许可与回滚路径是 P2 必须交付的架构约束。
- 处理：不改变 API、数据库、Provider 认证和数据协议；基础组件置于受控 UI 边界，不能使业务组件直接依赖未封装的视觉细节。

### 模块开发角色

- 观察：P3 的待验收实现已经修改 `globals.css`、`FloatingChat`、首页和候选技能列表，正与拟迁移区域重叠。
- 判断：`APPROVED`。全界面迁移可拆分；P3 不纳入本 CR 验收已经锁定。
- 处理：P2 前确定隔离方式；P3 以其自身 CR 闭环，或将未验收文件明确隔离并在 L3 任务中逐项标注不承接。每个后续任务都要有独立回滚点，旧视觉实现按同一受控变更清理。

### 测试角色

- 观察：视觉迁移的风险不只在截图，还包括现有真实入口、键盘焦点、主题持久化、移动 reflow 和 Provider 自动优先级。
- 判断：`APPROVED`。深色主题保留，测试矩阵应固定覆盖浅色紫色默认与深色两套主题。
- 处理：测试说明书需将每个受保留行为单独映射到组件测试或 Playwright 真实入口；P3 的 TEST-043..046 不得用于证明本 CR 完成。

## R1 反馈闭环状态

- 已闭合：全界面范围、默认浅色紫色、Provider 行为保持、P3 不纳入验收、不得改动业务协议、保留深色主题。
- P2 约束：技术路线细化、P3/L3 工作区隔离、任务可回滚拆分、两套主题的真实入口测试。

## R1 人工终裁

用户 2026-09-10：「保留。」——确认保留既有深色主题；浅色紫色为默认主题。用户同时确认 REQ-NF-006 与 CP-1..CP-12 的范围、非目标和 P3 排除边界。R1 四角色已全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL；允许进入 P2 架构评审，但未授权代码实施。

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `CR-20260910-ui-foundation 方案` 与 DEC-019。一次性重写的实施前置（P3 隔离、构建基线回滚）已作为方案本身成文，不是未处理的条件。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 全部已批准界面统一迁移 | APPROVED DEC-019 最终态 | APPROVED 全量视觉层可替换 | APPROVED 两主题可验 |
| CP-2 | APPROVED 「模型」与自动优先级保持 | APPROVED 无 Provider 协议变动 | APPROVED 业务 props 不改 | APPROVED TEST-025/026 回归 |
| CP-3 | APPROVED P3 不计入验收 | APPROVED 已批准视图清单明确 | APPROVED SkillList 排除 | APPROVED 隔离审查 |
| CP-4 | APPROVED 无业务扩展 | APPROVED API/DB/auth 不变 | APPROVED 仅前端视觉层 | APPROVED 业务回归守卫 |
| CP-5 | APPROVED 浅色默认、深色保留 | APPROVED data-theme 双 token | APPROVED ThemeToggle 契约保留 | APPROVED 双主题重载 |
| CP-6 | APPROVED 用户技术约束落地 | APPROVED Tailwind/shadcn 最小依赖 | APPROVED 本地 primitive 可维护 | APPROVED 构建/lockfile 审查 |
| CP-7 | APPROVED HSL token 可追溯 | APPROVED @theme inline + custom variant | APPROVED 单一 token 来源 | APPROVED 计算样式检查 |
| CP-8 | APPROVED 无隐藏业务变化 | APPROVED ui 与业务模块分层 | APPROVED import 边界明确 | APPROVED 静态守卫 |
| CP-9 | APPROVED P3 边界保持 | APPROVED 基线隔离已成文 | APPROVED 实施前置可执行 | APPROVED 独立证据 |
| CP-10 | APPROVED 不留双视觉体系 | APPROVED 基线回滚而非双 CSS | APPROVED 残留规则删除 | APPROVED 残留扫描 |
| CP-11 | APPROVED 行为逐项保留 | APPROVED 契约不变 | APPROVED 组件仅换呈现 | APPROVED 独立回归 |
| CP-12 | APPROVED UI-GOV-001 不放宽 | APPROVED 测试责任明确 | APPROVED 可测试边界 | APPROVED real-entry 覆盖 |

**R2 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。** `python tools/governance.py review r2` 是进入 R3 的机器门；此结论不授权实现。

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `CR-20260910-ui-foundation 变化点影响矩阵与任务派生`、`技术设计` 与 TASK-044..048。TASK-044 的 P3 隔离是实施门槛，作为任务前置而非本 CR 的 P3 验收。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 全界面范围未缩减 | APPROVED 统一 foundation | APPROVED TASK-044..048 | APPROVED TEST-047..050 |
| CP-2 | APPROVED 模型语义保持 | APPROVED 接口不变 | APPROVED TASK-045..047 | APPROVED Provider 回归 |
| CP-3 | APPROVED P3 排除明确 | APPROVED 无 SkillList 依赖 | APPROVED TASK-044 隔离 | APPROVED P3 证据分离 |
| CP-4 | APPROVED 无业务扩展 | APPROVED 服务端不改 | APPROVED 仅渲染层 | APPROVED API 回归 |
| CP-5 | APPROVED 双主题保留 | APPROVED data-theme 实现 | APPROVED TASK-044/045 | APPROVED 两主题验证 |
| CP-6 | APPROVED 用户技术约束 | APPROVED 最小依赖 | APPROVED TASK-044 | APPROVED build 审查 |
| CP-7 | APPROVED token 可追溯 | APPROVED HSL/SSR 方案 | APPROVED 唯一 token 来源 | APPROVED 静态与 live |
| CP-8 | APPROVED 无功能发散 | APPROVED ui/业务分层 | APPROVED import 审查 | APPROVED 边界守卫 |
| CP-9 | APPROVED P3 不重记 | APPROVED 基线隔离 | APPROVED TASK-044 前置 | APPROVED 独立记录 |
| CP-10 | APPROVED 无双 UI 系统 | APPROVED 基线回滚 | APPROVED TASK-048 删除 | APPROVED 残留扫描 |
| CP-11 | APPROVED 行为保留 | APPROVED 契约不变 | APPROVED TASK-045..048 | APPROVED 真实入口 |
| CP-12 | APPROVED UI-GOV-001 不放宽 | APPROVED 验证链明确 | APPROVED 测试绑定 | APPROVED R4 派生 |

**R3 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。** `python tools/governance.py review r3` 是进入 R4 的机器门；所有 TASK-044..048 仍为 TODO。

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `CR-20260910-ui-foundation 任务→测试派生矩阵`、`测试设计` 与 TEST-047..050。所有结果当前均为计划，P3 相关 TEST-043..046 不计入本 CR。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 全界面验收完整 | APPROVED foundation 可测 | APPROVED TASK-044..048 绑定 | APPROVED TEST-047..050 |
| CP-2 | APPROVED 模型语义守卫 | APPROVED 协议回归 | APPROVED 组件边界 | APPROVED TEST-048+025/026 |
| CP-3 | APPROVED P3 排除 | APPROVED 无 P3 依赖 | APPROVED 隔离前置 | APPROVED 证据分离 |
| CP-4 | APPROVED 无业务扩展 | APPROVED API 不变 | APPROVED 仅视觉任务 | APPROVED API+E2E |
| CP-5 | APPROVED 双主题保留 | APPROVED token 覆盖 | APPROVED ThemeToggle | APPROVED 两主题重载 |
| CP-6 | APPROVED 技术约束受控 | APPROVED build 链可查 | APPROVED TASK-044 | APPROVED TEST-047 |
| CP-7 | APPROVED token 可追溯 | APPROVED CSS 映射 | APPROVED 单来源 | APPROVED static+live |
| CP-8 | APPROVED 无发散 | APPROVED import 边界 | APPROVED primitive 层 | APPROVED 静态审查 |
| CP-9 | APPROVED P3 独立 | APPROVED 基线隔离 | APPROVED 任务前置 | APPROVED 治理审查 |
| CP-10 | APPROVED 不留旧 UI | APPROVED 基线回滚 | APPROVED TASK-048 | APPROVED 残留扫描 |
| CP-11 | APPROVED 全部行为回归 | APPROVED 契约不变 | APPROVED 任务映射 | APPROVED component+E2E |
| CP-12 | APPROVED UI-GOV-001 | APPROVED 验证链 | APPROVED 任务可测 | APPROVED TEST-047..050 |

**R4 结论：四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。** `python tools/governance.py review r4` 通过后，才允许 TASK-044 开始；任何 TASK 标记 DONE 前均须有当前通过证据。

## P3/P4 执行记录

**结论**：TASK-044..048 全部 DONE，TEST-047..050 全部 PASS。全量门禁 `verify` / `check-specs` / `check-changes` / `g1` / `g2` / `g3` / `g3.5` / `g4` **全绿**——本 CR 落地后，仓库首次在**不加 `--cr`** 的情况下通过 `check release` 之前的全部门禁。

### P3 前置条件（CP-9）已由在途工作满足

CP-9 与 DEC-019「P3 隔离」要求：动 `globals.css` / `page.tsx` / `FloatingChat` / `SkillList` 之前，必须先把 P3 变更**关闭到它自己的 CR**，或从 L3 工作树隔离。本 CR 起草时 P3 未验收，故写成硬前置。到实施时该前置已由**第一条分支**满足：`CR-20260909-skills`、`CR-20260909-display-screen`、`CR-20260910-skill-intake` 的 P3/P4 均已完成、有证据、已入基线。因此本 CR 直接在受控基线上原地实施，未再建隔离工作树。

按 CP-3/CP-4：P3 的上传/技能 UI **原样保留、语义一字未改**，但**不计入本 CR 的通过证据**——TEST-043..046 仍归其自身 CR。

### 与 DEC-019 的偏差（三处，均在实施期实测后决定）

1. **`CornerMenu` 保留自写 disclosure，未改用 Radix DropdownMenu。**
   实测两条理由：① Radix 的 trigger 只响应 `pointerdown`，而 jsdom 没有 `PointerEvent`，`fireEvent.click` 打不开菜单；改用 `@testing-library/user-event` 后每个用例挂死 90 秒以上（portal + pointer 路径），**已批准的 TEST-032 五条断言直接变成不可测**。② 菜单内容是主题开关与弹窗启动器这类任意 chrome，不是 menu item，DropdownMenu 的 roving-focus / typeahead 语义在这里没有收益，反而 `role="menu"` 配非 menuitem 子项是 a11y 反模式。
   `CR-20260909-corner-menu` 的 P3 当初正是因为同一个原因选了自写 disclosure。CR 冻结的契约（aria、Esc、light-dismiss、焦点回归、z-index 20/30、`children` 边界）**逐条保留且仍被断言**，只换视觉。`user-event` 已卸载，未留在依赖里。

2. **`Dialog` 保留原生 `<dialog>`，未改用 Radix Dialog。**
   原生元素本身就提供 TEST-049 ③ 要的焦点陷阱、Esc 与焦点回归；且已批准的 TEST-032 / account-dialog 断言直接读 `document.querySelector("dialog")` 与其 `open` 属性。换实现会在零收益的前提下打断已批准断言。改为用 Button primitive、Separator、Lucide 关闭图标与 token 重做视觉，机制不动。

3. **shadcn CLI 的默认产物做了两处收敛。**
   CLI 当前默认生成 `import { cn } from "cn"` 与 `import { Dialog } from "radix-ui"`（umbrella 包），而 DEC-019 明写「仅安装这些 primitive 的**实际 peer dependency**、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 与 `tw-animate-css`」。已把 11 个 primitive 的 import 改写为 `@/lib/utils` 与 8 个 `@radix-ui/react-*` 独立包，并卸载 `cn` 与 `radix-ui`。依赖清单现与 DEC-019 逐条对齐；构建工具（`tailwindcss` / `@tailwindcss/postcss` / `postcss` / `tw-animate-css`）归入 devDependencies。

### 实施期发现并修复的真实缺陷

1. **`--input` token 对比度不达标（DEC-019 基线数值缺陷）。**
   DEC-019 自己写了「数值是本 CR 的架构基线，P3 前必须由 `ui-contract` 与真实浏览器对两套主题计算对比度」——这条检查当场抓到：`--border`/`--input` 同值时，控件边框对背景**浅色 1.36:1、深色 1.80:1**，远低于 WCAG 1.4.11 要求的 3:1。
   修法不是把 `--border` 一起调深（那会让所有分隔线变重）：`--border` 是装饰性发丝线，而 `--input` 才是 Input / Textarea / outline Button **实际画边框用的 token**（三个 primitive 都是 `border-input`），1.4.11 管的是后者。只调 `--input`：浅色 `264 18% 87%` → `264 18% 52%`，深色 `264 16% 28%` → `264 16% 46%`。两套主题现均 ≥3:1。

2. **UI 契约脚本大面积失灵（10 FAIL + 6 SKIP）。**
   49 条静态规则里有 16 条是读 `globals.css` 的声明来取证的，而 DEC-019 把布局搬进了组件的 Tailwind utility——规则要么误报 FAIL，要么**静默降级成 SKIP**（等于不再断言任何东西，比 FAIL 更危险）。逐条改为读 utility，断言与引用标准不变：DS-03 / RF-02 / RF-04 / RF-05 / RF-06 / LB-01 / LB-02 / LB-03 / LB-06 / LB-07 / LB-08 / LB-09 / RF-07 / RF-09 / FF-02 / TY-03 / RF-08 / DS-04。
   同时修了读取器本身的两个洞：① `parseRules` 不认识 `@layer`，Tailwind v4 的 base 样式全在 `@layer base` 里，导致 body/focus/min-width 规则**根本没被看见**（TY-02、FK-02、RF-03 三条因此误报 WARN，其中 FK-02「完全没有焦点样式」是彻底的假警报）；② `parseColor` 只认 hex/rgb，不认 HSL，而 DEC-019 的 token 全是裸 HSL 三元组——**CC-01/02/03 三条对比度规则因此全部 SKIP**，形同虚设。补上 `@layer` 下钻与 HSL 解析后，三条对比度规则才真正跑起来，也正是它们抓出了上面的 `--input` 缺陷。
   结果：静态 49/49，**0 FAIL、0 WARN、0 SKIP**。

3. **真实浏览器对比度探针的两个假阳性 + 一个测量时序错误。**
   ① Tailwind v4 的计算值是 `oklab()`，而探针用正则从颜色字符串里抓数字，`oklab(0.99 0.00004 0.00002 / 0.95)` 被读成 `rgb(1,0,0)`（近黑），于是每个浅色表面都报 ~1.2:1。改为用 canvas 画一像素再读回，交给浏览器做色彩空间转换，任何 `oklab`/`oklch`/`color()` 都能正确归一。
   ② `sr-only` 文本（如状态灯的无障碍文本）本来就不绘制，却被算进可见文本对比度。已按 clip-path + 尺寸排除。
   ③ **深色主题在 transition 途中被测量**：primitive 带 `transition-all`，切 `data-theme` 后立刻取计算值拿到的还是旧主题颜色（实测 `rgb(38,27,54)` 深紫字压深色卡片 → 报 1.06:1），等 300ms 才收敛到正确的近白。已在两次对比度探测期间冻结 transition/animation，测完恢复（LV-REDUCED-MOTION 仍观察真实动画规则）。
   三处都是**检查器缺陷，不是 UI 缺陷**——实测颜色本身一直是 ~14:1。修完后真实浏览器 68/68 全过。

4. **新增 `axe-core` 打开被跳过的完整无障碍审计。** 脚本本就支持 `LV-AXE` 但因未安装而 SKIP。UI-GOV-001 要求 WCAG 2.2 AA，装上后审计结果：**no serious/critical violations**。

### 交付验证

| 层 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `vitest` | 27 文件 / **194 测试** 全通过 |
| `test:visual` | 3/3 |
| `test:ui-contract`（静态） | **49/49**，0 FAIL / 0 WARN / 0 SKIP |
| `test:ui-contract:live`（真实浏览器） | **68/68**，含 axe-core、双主题对比度、320/390/1280px 回流、焦点、触控尺寸、reduced-motion |
| `test:smoke` | 通过 |
| `test:e2e` | 10/10 |
| `build:verify` | Tailwind v4 管线编译通过，13/13 路由 |
| 门禁 | `verify` `check-specs` `check-changes` `g1` `g2` `g3` `g3.5` `g4` **全绿（全量，未用 `--cr`）** |

`globals.css` 由 **715 行降到 137 行**，其中不含任何组件视觉选择器；`.floating-chat*` / `.display-screen*` / `.corner-menu*` / `.dialog*` / `.settings-*` / `.provider-*` 的样式规则全部删除，仅保留这些类名作为**已批准测试的结构钩子**（TEST-031/032/040/041 直接按类名取元素），钩子本身不带任何样式。手绘 ☰ 与 ↑/↓ 字形已全部换成 Lucide 图标。`src/components/ui/*` 不 import 任何业务模块（store / providers / chat / skills / display / types / auth），边界干净。
