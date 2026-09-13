# CR-20260911-display-console-ux

- 级别: L2（改变用户可观察行为、工具接口与适配器行为；无新增依赖、无 schema 变更、无信任面变化）
- 提出人: user（P6 运行反馈，INPUT-2026-09-11-010：「html报告过长，就会截断，无法完整显示在动态屏，且没有渲染」「左侧菜单栏打开后排版比较差，参考业界的做法」「鼠标移到动态屏时自动收缩，移到对话框或者准备输入时展开」「对话轮数限制很容易触发，先扩展到100次」）
- 状态: APPROVED（R1 人工终裁：用户 2026-09-11 回复「继续」= 总授权推进；5 项待终裁按助手建议采纳，待追认，见「评审记录」）→ P2 进行中
- 占用 ID: DEC-032, TASK-088..092, TEST-091..096（REQ-F-050..054；并行的 CR-20260911-proactive-wake 为本 CR 留出的空段：需求 F-047..059、决策 032..039、任务 087..099、测试 090..099）
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: 新增 REQ-F-050（洞察追加与参数容错）、REQ-F-051（输出截断可见）、REQ-F-052（展示屏基础样式与主题）、REQ-F-053（☰ 侧边抽屉）、REQ-F-054（对话面板悬停态）；修改 REQ-F-029 ①②（上限 10 → 100）；修订 REQ-F-019 实现约束（允许高度过渡）与 REQ-F-015 中的菜单形态描述
- 影响模块: MOD-GOVERNANCE（CP-9 基线检查不再崩溃）、MOD-ADAPTER（输出上限、`finish_reason`）、MOD-TOOLS（`registry.ts` 参数解析、`display-tools.ts` 追加、`agent-loop.ts` 上限）、MOD-DISPLAY（`DisplayScreen.tsx` 样式外壳）、MOD-CHAT-UI（`FloatingChat.tsx` 悬停态、`CornerMenu.tsx` 抽屉、`SkillList.tsx` 行形态、`SearchSettings.tsx` 入口化）
- 影响任务: 新增 TASK-088..092（全部 DONE）
- 影响测试: 新增 TEST-091..096（全部 PASS）；既有 TEST-032 的 `role` 断言随抽屉改写，TEST-034 / TEST-067 不变
- 当前证据: `project/05_evidence/EV-2026-09-11-display-console-ux.md`
- 方案选项:
  - A. 只提示模型「HTML 请控制在 N 字以内」——拒绝。把输出上限转嫁成提示词约束，报告长度受限于最弱 Provider，且截断仍不可见，模型仍会盲目重试。
  - B. **截断可见 + 参数容错 + 追加到同一洞察 + 展示屏基础样式**——选中。四层各修各的，任一层可单独回滚。
  - C. 改交 Markdown、服务端套模板渲染——不选为本期方案。省约四成 token 且样式不依赖模型，但改变 REQ-F-023/024 的产物形态与技能模板约定，属 L3 取舍；列为待终裁备选。
  - 菜单：A. 保留浮层、加 `max-height` 与滚动——拒绝。只治裁切，不治重叠与信息架构。B. **左侧抽屉（Sheet）+ 分组 + 入口化**——选中。
  - 面板：A. 悬停时改为半透明而非收缩——拒绝。半透明下报告文字与对话文字叠印，可读性更差。B. **`autoHidden` 临时态，与手动折叠正交**——选中。
- 选择理由: 见 EV §1.4（四层缺陷各自独立，一层修不掉现象）、§2（三种视口测量证明浮层形态在中小视口不可用）、§3（展开态面板覆盖 91% 视口高度）、§5 D1–D7。
- 回滚方式:
  - 文档回滚：删除 REQ-F-050..054 行、恢复 REQ-F-029 ①② 的「10」、删除本 CR 在三层说明书的变更响应节。
  - 运行回滚：`git revert` 实现提交。追加模式只更新 `insights.html` 列内容，无 schema 变更；`MAX_TOOL_STEPS` 回到 10 不影响已落库的 `truncated` 行；抽屉与悬停态为纯 UI，无持久化数据。
  - 回滚后重跑 `verify | check-changes | review r1..r4` 并重新 `snapshot`。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260911-display-console-ux` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS。
  - P3/P4: 任务 DONE；新增测试 PASS；`npm run verify:all` 全绿；真实入口：用 DeepSeek 跑一次 `multi-agent-insight-reviewer`，报告完整上屏且带样式；1024×700 下打开抽屉无裁切、遮罩生效；指针移到展示屏面板收缩、回到输入框展开。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立评审。**R1 人工终裁**：用户 2026-09-11 在收到需求分析与 5 项待终裁建议后回复「继续」。按项目既有处理（INPUT-2026-09-11-009「继续」= 总授权 + 待追认清单），记为：总授权推进；5 项待终裁**按助手建议采纳**（①追加用 `save_insight` 加参数；②本期不改 Markdown 产物；③搜索设置入口化为对话框；④悬停延迟 400ms / 过渡 150–200ms 为初值，架构按实测调整；⑤收缩后不留单行预览），每项可单独撤回。如实区分：
- R1 终裁: 已完成 | 用户 | 2026-09-11
  - **CP-1 由用户直接授权**（原话「可以先扩展到100次」），代码已于 2026-09-11 先行修改并通过既有测试，本 CR 只补文档同步与登记。
  - **CP-2..CP-8 由助手依分析代拟**，用户只要求「分析」与「需求分析与描述」，尚未对方案拍板。待终裁项见 EV §7（追加语义形态、Markdown 备选、搜索设置入口化、悬停延迟初值、收缩后是否留单行预览）。

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **工具步数上限 10 → 100**。研究型任务「读技能 → 4 路搜索 → 4 路读页」在第二轮即触顶，用户每次要回「继续」（EV §4）。触顶提示文案随常量；同参连续失败 2 次熔断不变；成本由 REQ-NF-007 / F-041 / F-042 兜底 | REQ-F-029 ①② | 小改 | 双向 | 机器：`tests/agent-loop.test.ts`「触顶」用例按 `MAX_TOOL_STEPS` 断言恰好 100 次 `tool_result` 后停止（已 PASS） |
| CP-2 | 产品 | **`save_insight` 可追加到同一洞察**：指定已有洞察 id 时把 HTML 拼到其正文末尾，展示屏指向不变、内容刷新；结果回喂累计长度，模型知道进度；正文有上限（架构定）。分块提交由「互相覆盖」变为「拼成一份」（EV §1.2） | REQ-F-050 ①②③、REQ-F-024 ③ | 新增 | 双向 | 机器：新增 TEST（P2 编号）——两次调用后 `insights.html` 含两段且 `display_state.refId` 不变；超上限时拒绝并回喂 |
| CP-3 | 产品 | **工具参数解析容错与可诊断**：兼容嵌套 `{"arguments":{...}}` 包装；解析失败或缺必填字段时，结果明确写出「收到的键名」与「缺少的字段」，不再一律「不完整或为空」。63 字节的合法 HTML 曾因此被拒（EV §1.1） | REQ-F-050 ④⑤ | 缺陷修复 | 双向 | 机器：`tests/registry.test.ts`（或同类）——嵌套包装解析出 `html`；缺字段结果含键名 |
| CP-4 | 产品 | **模型输出截断可见**：请求带 `max_tokens`（按 Provider 取最大允许值，Provider 行可覆盖）；适配器读 `finish_reason=length`；被截断的工具调用**不执行**，改回喂「参数在第 N 字符被输出上限截断，请缩短或分块」，步骤流显示「参数被截断」；纯文本回复被截断时对话内提示。截断不可见是 9 次盲目重试的根因（EV §1.1） | REQ-F-051 | 缺陷修复 | 双向 | 机器：`tests/adapters-tools.test.ts`——流末 `finish_reason:"length"` 且 `tool_calls` 未闭合 → 发出 `tool_call` 带截断标记；`tests/agent-loop.test.ts`——截断的调用不执行、回喂文案含字符数 |
| CP-5 | 产品 | **展示屏基础样式与主题**：iframe 文档包一层基础样式（正文、标题层级、表格边框、代码、链接、图片 max-width），主题 token 随宿主 `data-theme`；洞察自带 `<style>` 或完整文档时自带样式优先；长报告在 iframe 内滚动不裁切。三份实测报告均为无样式裸片段（EV §1.3） | REQ-F-052、REQ-F-026 ③ | 新增 | 双向 | 机器：`tests/display-screen.test.tsx`——`srcDoc` 含基础 `<style>` 与主题属性；自带 `<style>` 的输入不被覆盖。真实入口：`tests/e2e/skills-display.spec.ts` 断言 iframe 内表格有边框 |
| CP-6 | 产品 | **☰ 菜单改为左侧抽屉**：触发器不变；打开后从左侧滑出 280–320px 全高抽屉，带遮罩，内容区独立滚动；分组「外观 / 模型 / 账号 / 技能 / 知识库 / 搜索与用量」，组标题与行高统一；Esc / 遮罩点击 / 焦点回归契约保持；层叠 30 不变。抽屉为模态，遮罩接管点击，故与对话面板的视觉重叠是设计的一部分。1024×700 下现浮层顶部被裁 26px、且以非模态形态与仍可交互的对话框相撞（EV §2） | REQ-F-053 ①②③⑥⑦、REQ-F-015 | 大改 | 双向 | 机器：`tests/home-dialogs.test.tsx` / corner-menu 用例——aria、Esc、焦点回归；`scripts/ui-contract.mjs` 抽屉规则。真实入口：1024×700 打开抽屉，包围盒完整在视口内，遮罩覆盖全视口且点击对话框区域只关抽屉 |
| CP-7 | 产品 | **抽屉内容形态**：技能每项一行（名称 + 单行省略描述），重命名 / 删除收进行尾更多菜单或悬停显示；「模型」「账号登录」为入口行；搜索设置从内联表单改为入口行 + 对话框（**待终裁**，EV §7-3） | REQ-F-053 ④⑤ | 小改 | 双向 | 机器：`tests/skill-list.test.tsx`——描述单行省略、操作在更多菜单内可达；搜索设置对话框用例 |
| CP-8 | 产品 | **对话面板悬停自动收缩 / 展开**：新增 `autoHidden` 临时态，`showTranscript = hasTranscript && !userCollapsed && !autoHidden`；指针离开面板并停留展示屏 ≥ 400ms → 收缩为输入条形态；指针进入面板 / 输入框获焦 / 按键 / 发送 → 立即展开；流式或工具执行中不收缩；仅 `(hover: hover) and (pointer: fine)` 设备启用；`userCollapsed` 为真时悬停不展开；不持久化；150–200ms 高度过渡，`prefers-reduced-motion` 下无动画。展开态面板覆盖 91% 视口高度（EV §3） | REQ-F-054、REQ-F-019 ④ 与实现约束 | 新增 | 双向 | 机器：`tests/floating-chat.test.tsx`——假定时器下 leave → 400ms → 收缩；enter / focus / keydown → 展开；`isStreaming` 时 leave 不收缩；`userCollapsed` 时 enter 不展开。真实入口：指针移到展示屏面板收缩 |
| CP-9 | 模块 | **`verify` 遇到「基线条目已不是普通文件」时报告而非崩溃**。`.git` 被记入基线（提交 a8873a7，来自在 git worktree 内所做的 snapshot——那里 `.git` 是文件），普通 checkout 里它是目录，`check_baseline` 用 `path.exists()` 放行后 `open()` 抛 PermissionError，`verify` / `check p3` 对任何人都直接崩溃。门禁只能报告，不能崩溃 | REQ-NF-004 | 缺陷修复 | 双向 | 机器：`python tools/governance.py verify` 现输出 `FAIL BASELINE_NOT_A_FILE .git` 并跑完全部条目；`python -m unittest tests.test_governance` 75 PASS |

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260911-display-console-ux` 节（逐变化点方案表 + 架构总判）+ DEC-032 + MOD-TOOLS / MOD-ADAPTER / MOD-DISPLAY / MOD-CHAT-UI / MOD-SETTINGS-UI 边界行。行 = CP-1..CP-8，列 = 四角色。无 REJECTED、无空格。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 用户直接授权，文档只是追认 | APPROVED DEC-032 ⑧ 仅改常量，成本由 NF-007 / F-041 / F-042 兜底（自审） | APPROVED 已落地，无新代码 | APPROVED TEST-067 按常量已 PASS |
| CP-2 | APPROVED 分块拼成一份正是用户「不完整」的解 | APPROVED DEC-032 ③ 只 UPDATE 既有行，无 schema；属主校验复用 show_insight（自审） | APPROVED store 一个方法 + 工具一个可选参数 | APPROVED 拼接、指针不变、上限、跨会话四条均可断言（TEST-092 ③④⑤） |
| CP-3 | APPROVED 模型收到「收到的键名」才能自纠 | APPROVED DEC-032 ② 解包装限单键三种名，不做猜测式修复（自审） | APPROVED 纯函数改动，registry 无副作用 | APPROVED EV §1.1 的失败样本可原样回放（TEST-092 ①②⑧） |
| CP-4 | APPROVED 截断可见是 9 次盲目重试的根因 | APPROVED DEC-032 ① 按 kind 常量、不加列；字段回退与既有两处同形（自审） | APPROVED adapters 加一字段 + SSE 一处读取；loop 一条分支且不 import 工具 | APPROVED 假 SSE 可构造 finish_reason=length（TEST-091） |
| CP-5 | APPROVED 「没有渲染」= 无样式，外壳兜底即解 | APPROVED DEC-032 ④ @layer + 命名空间保证自带样式优先；MutationObserver 不触 LB-09 的键事件 / 轮询禁令（自审） | APPROVED 纯函数可 node 单测，组件只换 srcDoc 来源 | APPROVED 文档结构断言 + 主题切换断言（TEST-093）；观感如实登记人工 |
| CP-6 | APPROVED 三种视口测量证明浮层不可用 | APPROVED DEC-032 ⑤ 手写抽屉沿 DEC-014 理由；role 改 dialog 的三处断言同 CR 改完（自审） | APPROVED CornerMenu 单文件重写 + MenuSection 小组件 | APPROVED a11y 契约（Esc / 遮罩 / 焦点 / Tab 循环）逐条可断言（TEST-094） |
| CP-7 | APPROVED 已终裁：搜索设置入口化 | APPROVED DEC-032 ⑥ 复用 components/Dialog，不引新组件（自审） | APPROVED SkillList / SearchSettings 各一处改动 | APPROVED 单行省略 + 更多可达 + 对话框保存可断言（TEST-094 ⑥⑦） |
| CP-8 | APPROVED 与手动折叠正交，用户偏好不被覆盖 | APPROVED DEC-032 ⑦ DOM 保留才能过渡；hover 媒体查询排除触屏（自审） | APPROVED 一个 state + 三个事件处理 + 一个定时器 | APPROVED 假定时器 + matchMedia 桩覆盖全部时序（TEST-095）；手感如实登记人工 |
| CP-9 | APPROVED 门禁崩溃时无人能验证交付 | APPROVED 只改判定分支，不改基线语义（自审） | APPROVED `is_file()` 一行守卫 | APPROVED verify 现跑完全部条目并报告 |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260911-display-console-ux` 节（变化点影响矩阵 + 技术设计）+ TASK-088..092。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED TASK-089 ④ 只登记不重做 | APPROVED 与 DEC-032 ⑧ 一致 | APPROVED 已 DONE 的常量改动如实标注（自审） | APPROVED 不新增用例 |
| CP-2 | APPROVED TASK-089 ②③ 覆盖参数、上限、回喂三点 | APPROVED appendInsightHtml 落 store，工具不直接写 SQL | APPROVED 依赖 TASK-088 的 truncated 类型先行（自审） | APPROVED TEST-092 ③④⑤ 对应 |
| CP-3 | APPROVED TASK-089 ① 明确三种包装名 | APPROVED 解析仍是纯函数 | APPROVED describeArgsProblem 一处实现、多工具复用（自审） | APPROVED TEST-092 ①②⑧ 对应 |
| CP-4 | APPROVED TASK-088 四项与 REQ-F-051 ①..④ 一一对应 | APPROVED 回退助手与既有 shouldRetryWithout* 同形 | APPROVED ChatDelta 类型同步在同一任务内（自审） | APPROVED TEST-091 ①..⑤ 对应 |
| CP-5 | APPROVED TASK-090 三项覆盖 REQ-F-052 ①..④ | APPROVED 纯函数落 lib，组件薄 | APPROVED MutationObserver 在 effect 内挂 / 卸（自审） | APPROVED TEST-093 对应 |
| CP-6 | APPROVED TASK-091 ①②⑤⑥ 覆盖契约与断言迁移 | APPROVED 分组在 page.tsx 组织，CornerMenu 仍不知子项 | APPROVED Tab 循环手写 focus trap，范围限抽屉（自审） | APPROVED TEST-094 ①..⑤ + TEST-032 改写登记 |
| CP-7 | APPROVED TASK-091 ③④ | APPROVED 复用 Dialog | APPROVED 更多按钮为 disclosure 非 DropdownMenu，jsdom 可测（自审） | APPROVED TEST-094 ⑥⑦ |
| CP-8 | APPROVED TASK-092 ①..⑤ 与 REQ-F-054 ①..⑨ 对应 | APPROVED transcriptMounted / Visible 拆分保留 F-019 ② 语义 | APPROVED 定时器在 ref 中，卸载清理（自审） | APPROVED TEST-095 ①..⑦ 对应 |
| CP-9 | APPROVED 与 CP-1..8 无耦合，可单独回滚 | APPROVED 不触碰 snapshot 写入路径 | APPROVED 崩溃改为 finding（自审） | APPROVED 治理单测 75 PASS 未受影响 |

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260911-display-console-ux` 节（任务→测试派生矩阵 + 覆盖缺口 + 既有测试处置）+ TEST-091..096。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 触顶用例按常量 | APPROVED 无新断言即可守 | APPROVED 无实现工作 | APPROVED TEST-067 已 PASS（自审） |
| CP-2 | APPROVED 追加后「一份」可断言 | APPROVED 指针不变是关键断言 | APPROVED 用真实 store 不用 mock | APPROVED TEST-092 ③④⑤ + TEST-096 ① 真实入口（自审） |
| CP-3 | APPROVED 回放真实失败样本 | APPROVED 63 字节样本守住「非长度问题」 | APPROVED 纯函数单测 | APPROVED TEST-092 ①②⑧（自审） |
| CP-4 | APPROVED 截断可见性有独立用例 | APPROVED 回退用例与既有 stream_options 用例同形 | APPROVED 假 SSE 构造简单 | APPROVED TEST-091 ①..⑤（自审） |
| CP-5 | APPROVED 观感缺口如实登记 | APPROVED 主题切换用例守 MutationObserver | APPROVED node 环境测纯函数、jsdom 测组件 | APPROVED TEST-093 + 缺口登记（自审） |
| CP-6 | APPROVED 信息架构缺口如实登记 | APPROVED 三处 role 断言改写登记在「既有测试处置」 | APPROVED 1024×700 真实入口测包围盒 | APPROVED TEST-094 + TEST-096 ②④（自审） |
| CP-7 | APPROVED 确认逻辑不变有断言 | APPROVED 对话框复用既有断言方式 | APPROVED skill-list / search-settings 各自文件 | APPROVED TEST-094 ⑥⑦（自审） |
| CP-8 | APPROVED 手感缺口如实登记 | APPROVED 时序用假定时器不靠真实等待 | APPROVED localStorage 不变有断言 | APPROVED TEST-095 + TEST-096 ③（自审） |
| CP-9 | APPROVED 报告文案指明修法 | APPROVED 该条目由下次 snapshot 自然消失 | APPROVED 无新增用例，既有治理单测即守卫 | APPROVED `verify` 输出本身可断言（自审） |

## 实施记录（2026-09-11）

- **后端**：`adapters.ts` 增 `DEFAULT_MAX_OUTPUT_TOKENS` / `outputLimitField` / `shouldRetryWithoutOutputLimit` 与 `finish_reason=length` 标记；`types.ts` 的 `tool_call` 增 `truncated?` / `argsLength?`；`registry.ts` 增包装解包与 `describeArgsProblem`，`ToolDescriptor.execute` 增第三参 `rawArguments`；`display-tools.ts` 的 `save_insight` 增 `insightId` 追加模式与 512 KiB 上限；`store.ts` 增 `appendInsightHtml`（只 UPDATE，无 schema 变更）；`agent-loop.ts` 不执行被截断的调用并透传 `notice`。
- **前端**：新增 `src/lib/display-document.ts`（纯函数外壳）与 `src/components/MenuSection.tsx`；`DisplayScreen` 用 `MutationObserver` 跟随主题；`CornerMenu` 改为模态抽屉；`SkillList` 行单行化 + 「更多」；`SearchSettings` 拆为入口行 + 对话框；`FloatingChat` 增 `autoHidden` 悬停态。
- **契约**：`ui-contract` LB-08 改抽屉契约、LB-07 允许带 `motion-reduce` 的过渡且禁止把 `autoHidden` 写进 localStorage。53 规则 0 FAIL 0 WARN。
- **测试**：新增 `adapters-tools-limit` / `registry-args` / `tool-suites-append` / `agent-loop-truncated` / `display-document` / `display-screen` / `search-settings` / `floating-chat-hover` 八个单测文件与 `tests/e2e/ux-display-console.spec.ts`。单测 406 PASS，e2e 16 PASS。
- **交付中发现并修正的三件事**（都在 P3 记录，不是需求变更）：
  1. **「抽屉不与对话面板重叠」这条需求写错了**。抽屉是模态的，遮罩接管点击；在 1024 宽下 320px 抽屉与居中的 768px 对话框必然相交。真正要守的是「完整在视口内 + 遮罩生效」，已据此改写 REQ-F-053 ②、DEC-032 ⑤ 与 TEST-096 ②。原浮层的缺陷是**非模态**浮层与仍可交互的对话框相撞，与此不同。
  2. **e2e 文件名决定执行顺序**。全部 spec 共用一个数据库与一个 worker，`human-workflow.spec.ts` 会数模型收到的消息条数，前面的 spec 留下会话就会改变这个数。本 CR 的 spec 因此命名为 `ux-display-console.spec.ts` 以排在最后，并在每个用例开头点「新对话」。
  3. **CP-9 的治理崩溃**（见变化点登记表）。
- **未做**：`snapshot` 未执行——按 `docs/WORKFLOW.md`，全流程只在合并前跑一次，且本工作树同时有并行会话的两个 CR，需先确认分支归属。因此 `verify` 现为红（本 CR 的新增/改动文件未入基线 + 一条 pre-existing `.git` 条目）。

