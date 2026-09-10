# CR-20260910-skill-intake

- 级别: L2（扩展已批准需求 REQ-F-020 的输入形态 + 新增一个处理不可信二进制输入的自写解析器；无新增运行依赖、无部署/信任模型变更）
- 提出人: user（P6 运行反馈：「拖skill压缩包到对话框，没有上传反应」→「skill上传成功了，但对话模型读取不了」→ 定位后决策「1. 一起做；2. c。3. 自写。4. 顺便放宽。」）
- 状态: CLOSED（R1 人工终裁 + R2/R3/R4 四角色全 APPROVED + P3/P4 完成：TASK-040..043 DONE、TEST-043..046 PASS、5 条出口义务清零、本 CR 相关回归全绿）。注：仓库级 `gate g3` 此刻为红，**原因在 CR-20260910-ui-foundation**（其 TEST-047..050 已过 R4 但未实施），与本 CR 无关 —— 见下「g3 跨 CR 阻塞」。
- 评审模型: R1–R4 + G3/G3.5/G4
- 影响需求: **重写 REQ-F-020 ①⑤**（拖文件夹 → 文件夹 **或 zip** + 显式上传入口；白名单放宽 + 被排除文件须回执）；新增 **REQ-F-028**（技能可见性）、**REQ-NF-005**（不可信归档处理边界）
- 影响模块: **新增 MOD-ZIP**（`src/lib/zip.ts`，纯函数解析器）、MOD-SKILLS（消费解析结果 + 白名单）、MOD-CHAT-UI（上传入口 + 非法拖放提示 + 「本轮使用技能」提示）、MOD-SETTINGS-UI（☰ 菜单内技能列表）、MOD-CHAT（SSE 新增 `skill` 尾事件）
- 影响任务: 新增 TASK-040（`src/lib/zip.ts` 有界 zip 解析器）、TASK-041（`submitSkillUpload` 单一提交路径 + 两个 `<input>` 上传入口 + 非法拖放 `preventDefault` 与提示）、TASK-042（服务端 zip 解包接入 `POST /api/skills` + 白名单放宽 + 被排除文件回执）、TASK-043（技能列表面板 + `skill` 尾事件 + 「本轮使用技能 X」提示）
- 影响测试: 新增 TEST-043（zip 解析器，含对抗样本）、TEST-044（三条上传路径 + 非法拖放 `preventDefault`）、TEST-045（被排除文件回执 + 白名单放宽）、TEST-046（技能列表可见 + 「本轮使用技能」提示）；TEST-038 e2e 扩展（zip 注册流）
- 当前证据: `project/05_evidence/EV-2026-09-10-skill-intake.md`（P6 根因定位 + R1 四角色 ReAct 评审 + 反馈闭环）
- 方案选项:
  - A. 只补上传按钮，不支持 zip——用户否决（「1. 一起做」「2. c」）：只修入口不修可观测性，下次仍是黑箱
  - B. **自写零依赖 zip 解析（`node:zlib.inflateRawSync` + 手写 End of Central Directory / Central Directory 解析）+ 三条上传路径收敛为单一提交 + 技能可见性 + 白名单放宽**
  - C. 引第三方 zip 库（`adm-zip` / `yauzl`）——新增运行依赖属 CONTROLS L3 敏感项，用户选择自写（「3. 自写」）
- 选择理由: 选 B。① 这次的根因是**静默失败**：非文件夹 drop 在 `preventDefault()` 之前 `return`，浏览器接管了 drop，零请求打到 `POST /api/skills`，而界面上又看不到「已注册技能」列表 —— 用户以为成功了，模型却什么都没收到。修入口而不修可观测性，只是把黑箱换个位置。② zip 自写解析与既有做法一脉相承（DEC-008 自写 Markdown 渲染器、`skills.ts` 自写 frontmatter 解析），`node:zlib` 的 `inflateRawSync` 正是 ZIP deflate 条目所需，容器格式解析约 120 行，零依赖。③ 三条输入路径（拖文件夹 / 拖 zip / 点选）必须收敛为一条提交路径，否则三套代码三套 bug。
- 回滚方式:
  - 文档回滚：还原 `产品需求说明书.md`（REQ-F-020 ①⑤ 回到 CR-20260909-skills 版、删 REQ-F-028/REQ-NF-005、删非目标新增行与 R1 评审）、`架构设计说明书.md`（删 DEC-018、MOD-ZIP、本 CR 节）、`模块任务开发说明书.md`（删 TASK-040..043 + 本 CR 节）、`测试说明书.md`（删 TEST-043..046 + 本 CR 节）、删 EV 与 `.feedback.jsonl`、`test-results.json` 去本 CR 条目。
  - 运行回滚（P3 后）：删 `src/lib/zip.ts` 与其单测；`POST /api/skills` 去 zip 分支；`FloatingChat` 去两个 `<input>`、去 `submitSkillUpload` 收敛（`handleDrop` 恢复原路径）、去 `skill` 尾事件处理；删技能列表组件与 `CornerMenu` 内挂载；`SKILL_TEXT_EXTENSIONS` 回到 11 项。无第三方依赖新增，无 schema 变更。
  - 回滚后重跑 `verify | check-changes | ui | review r1..r4 | gate g3/g3.5/g4` 并重新 `snapshot`。
- 验收条件:
  - R1：本文件有 `## 变化点登记` 表（CP-1..CP-15，每行有来源角色）+ R1 人工终裁痕迹；`review r1` PASS。
  - R2/R3/R4（P2 产出，**已完成**）：三层说明书各含 `CR-20260910-skill-intake` 节逐一响应 CP-1..CP-15；本文件三张评审矩阵全 APPROVED；`review r1|r2|r3|r4` PASS。
  - P3/P4：TASK-040..043 DONE；TEST-043..046 PASS（含对抗样本与 e2e zip 注册流）；TEST-038 扩展通过；`gate g3|g3.5` PASS；`ui-contract` 0 FAIL；**零新增运行依赖**（`package.json` `dependencies` 不变）。
  - 回归门：CR-20260909-skills 的 TEST-034..038 与 CR-20260909-display-screen 的 TEST-039..042 全部重跑通过。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立 ReAct 评审；架构与模块的 CONDITIONAL 经 1 轮反馈闭环转 APPROVED，详见 `EV-2026-09-10-skill-intake.md §3` 与 `CR-20260910-skill-intake.feedback.jsonl`。**R1 人工终裁**：用户 2026-09-10「确认」—— 确认 CP-1..CP-15、REQ-F-020 ①⑤⑦ 重写、REQ-F-028、REQ-NF-005 四项边界、白名单放宽清单、DEC-018 有界解析器。
  - **产品 owner**：① A1–A4 是**缺陷**（其中 A2「上传入口」是 TASK-033 Ⅰ 已写却未实现的欠账），B（zip）才是需求扩展——CR 内须分清，不得把补欠账当新功能记账。② 最坏失败模式是「以为成功、其实没有」，可观测性（技能列表 + 本轮命中提示）必须与入口同批交付，否则只是换个位置的黑箱。③ 非目标须保持：仍不做技能编辑/删除/版本管理/技能市场；归档只支持 zip，不做 rar/7z/tar。结论：**APPROVED**。
  - **架构角色（R1 → 闭环后 APPROVED）**：
    - R1 CONDITIONAL：本 CR 唯一实质风险面是**手写二进制格式解析器处理不可信输入**，须成文四条硬约束：① **zip slip** —— 条目名含 `..`、绝对路径、盘符或反斜杠时拒绝，且落盘前仍须过既有 `path.resolve` 越界校验（双重）；② **zip bomb** —— 条目数、单条解压后字节、总解压后字节、压缩比四个上限，任一超限**整体拒绝**并返回可读原因；③ 只支持压缩方法 `0`(store) 与 `8`(deflate)，通用位标记加密位置位即拒绝；④ 解析器必须是**纯函数、不碰 fs、独立模块**，便于对抗性单测。
    - 处理：立 **DEC-018**（有界零依赖 zip 解析器）+ 新增 **REQ-NF-005**（不可信归档处理边界，四个上限有 ID 可追溯）；条件全部写入 CP-8 / CP-10。另确认 SSE 新增 `skill` 尾事件与既有 `insight`/`display` 同机制，无新传输面；客户端不解压（见模块闭环②）。
    - 结论：**APPROVED**。
  - **模块开发角色（R1 → 闭环后 APPROVED）**：
    - R1 CONDITIONAL：① 三条输入路径（拖文件夹 / 拖 zip / 点选）**必须收敛为单一** `submitSkillUpload(folderName, files)`，三个入口只负责把输入规整成同一形状，否则三套代码三套 bug；② 解压必须在**服务端**——客户端解压会把解析器塞进浏览器包，且越界校验本来就在服务端，两处解压等于两套安全边界。
    - 处理：CP-11 写明单一提交路径；CP-7/CP-10 写明服务端解压（客户端把 zip 原样 POST）。另：上传入口用两个隐藏 `<input type="file">`（一个 `webkitdirectory`、一个 `accept=".zip"`）+ 真实可见 `<button>` 触发，不自造控件；技能列表用 `CornerMenu` 既有 `children` 模式挂新组件，不改 `CornerMenu` 本身。
    - 结论：**APPROVED**。
  - **测试角色**：① zip 单测必须含**对抗样本**：`../` 条目、绝对路径条目、超压缩比、超条目数、超总大小、加密位置位、截断/损坏文件 —— 每条独立断言（原则 15）。② 「非文件夹 drop 被浏览器接管」是本次 P6 根因，必须有断言证明 `preventDefault` 被调用且对话内出现说明。③ 「上传成功但没注册」不得再静默发生：注册回执与技能列表**两处**断言。④ 被排除文件清单须断言（非白名单 / 二进制 / 超限三类各一）。⑤ 既有 TEST-034..042 作回归门。结论：**APPROVED**（条件即测试设计）。
- 评审结论汇总: **R1 四角色全部 APPROVED**（产品 / 测试 R1 即 APPROVED；架构 / 模块 R1 CONDITIONAL → 1 轮反馈闭环 → APPROVED）。无 REJECTED，无遗留 CONDITIONAL 进入 P2。

## 背景：P6 根因

运行中的 dev server（:3000，新代码已热加载）实测：

```
GET /api/skills   → {"skills":[]}          零个技能
.data/skills/     → 目录不存在
DB skills 表      → 0 行
```

因果链：拖 zip → `readDroppedFolderEntries` 只认目录、返回 `null` → `handleDrop` 在 `event.preventDefault()` **之前** `return` → 浏览器接管该次 drop → **零请求打到 `POST /api/skills`** → `skills.length === 0` → `routeTurn` 根本不被调用 → 模型无技能内容 → 回复「没有拿到这个 skill 文件夹」（如实）。用户无从察觉，因为界面上没有任何「已注册技能」列表。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 |
|---|---|---|---|---|
| CP-1 | 产品 | 非技能文件夹的拖放必须 `preventDefault` 并在对话内说明原因，不得被浏览器接管 | REQ-F-020 | 缺陷修复 |
| CP-2 | 产品 | 对话框提供**显式上传入口**（真实 `<button>`），可选文件夹、也可选 zip | REQ-F-020 | 缺陷修复（TASK-033 Ⅰ 欠账） |
| CP-3 | 产品 | **zip 压缩包**成为合法技能来源，拖放与点选两条路径都支持；REQ-F-020 ① 重写 | REQ-F-020 | 新增 |
| CP-4 | 产品 | 技能可见性：☰ 菜单可查看已注册技能（名称 + 描述）；命中技能的那一轮对话内提示「本轮使用技能 X」 | REQ-F-028 | 新增 |
| CP-5 | 产品 | 注册回执列出**被排除的文件**（非白名单 / 二进制 / 超限），不静默丢内容 | REQ-F-020 | 缺陷修复 |
| CP-6 | 产品 | 扩展名白名单放宽，新增 `.mdx .toml .sh .jsonl .xml` | REQ-F-020 | 小改 |
| CP-7 | 架构 | zip 解析零依赖自写：`node:zlib.inflateRawSync` + 手写 EOCD/Central Directory 解析；仅支持压缩方法 `0`/`8`，加密位置位即拒绝；**解压在服务端** | DEC-018 | 新增 |
| CP-8 | 架构 | zip 是不可信二进制输入：条目数 / 单条解压字节 / 总解压字节 / 压缩比四个上限，任一超限整体拒绝并给可读原因；条目名含 `..`、绝对路径、盘符或反斜杠即拒绝，落盘前仍过 `path.resolve` 越界校验（双重） | REQ-NF-005, DEC-018 | 新增 |
| CP-9 | 架构 | 上传入口归 MOD-CHAT-UI；技能列表归 MOD-SETTINGS-UI（`CornerMenu` 既有 `children` 模式挂载，不改 `CornerMenu`） | MOD-CHAT-UI, MOD-SETTINGS-UI | 小改 |
| CP-10 | 模块 | zip 解析器落在新 `src/lib/zip.ts`，**纯函数、不碰 fs**（`readZipEntries(buffer, limits)`）；`skills.ts` 只消费，便于对抗性单测 | TASK-040 | 新增 |
| CP-11 | 模块 | 三条输入路径收敛为**单一** `submitSkillUpload(folderName, files)`；三个入口（拖文件夹 / 拖 zip / 点选）只负责规整输入形状 | TASK-041 | 新增 |
| CP-12 | 模块 | 「本轮使用技能 X」需服务端回传命中技能名 —— SSE 新增尾事件 `{type:"skill", name}`，与 `insight`/`display` 同机制 | TASK-043 | 小改 |
| CP-13 | 测试 | zip 解析器对抗性单测：`../` 条目 / 绝对路径 / 超压缩比 / 超条目数 / 超总大小 / 加密位 / 截断文件，逐条独立断言 | TEST-043 | 新增 |
| CP-14 | 测试 | 非文件夹 drop 的 `preventDefault` 与对话内说明须有断言；三条上传路径各有真实入口测试 | TEST-044 | 新增 |
| CP-15 | 测试 | 技能列表可见、「本轮使用技能」提示、被排除文件清单三处须有断言；TEST-034..042 作回归门 | TEST-045, TEST-046 | 新增 + 回归 |

（产品 CP-1..CP-6 + 架构派生 CP-7..CP-9 + 模块派生 CP-10..CP-12 + 测试派生 CP-13..CP-15。R2/R3/R4 各层须逐一响应 CP-1..CP-15。）

## R2 评审矩阵

评审对象：`架构设计说明书.md`（`CR-20260910-skill-intake 方案` 表 + DEC-018 + MOD-ZIP + 接口契约新增行）。行 = CP-1..CP-15，列 = 产品 / 架构 / 模块 / 测试。无 REJECTED、无空、无遗留 CONDITIONAL。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 失败可见入 REQ-F-020 ⑦ | APPROVED preventDefault 前置（方案表 CP-1） | APPROVED 顺序修正，一行位置 | APPROVED 合成事件可断言 |
| CP-2 | APPROVED 补 TASK-033 Ⅰ 欠账 | APPROVED 原生 input + 真实 button | APPROVED 不自造控件 | APPROVED e2e setInputFiles 可走通 |
| CP-3 | APPROVED zip 与文件夹同一注册语义 | APPROVED archive 分支复用 registerSkill（方案表 CP-3） | APPROVED 出口形状与既有一致 | APPROVED slug 一致性可断言 |
| CP-4 | APPROVED 只读列表符合非目标 | APPROVED 复用 GET /api/skills，无新端点 | APPROVED CornerMenu children 模式 | APPROVED 真实浏览器免刷新更新 |
| CP-5 | APPROVED 丢内容必须回执 | APPROVED excluded 两类语义在契约里分清 | APPROVED 既有过滤点改 push | APPROVED 四类 reason 各一断言 |
| CP-6 | APPROVED 放宽是用户决策 | APPROVED 常量扩容，无结构影响 | APPROVED 一处常量 | APPROVED 5 个新扩展名进注入可断言 |
| CP-7 | APPROVED 零依赖符合既有取向 | APPROVED DEC-018 成文，整包拒 vs 逐条排除分开（自审） | APPROVED 只实现读路径、两种方法 | APPROVED 纯函数 + 手工字节可精确构造 |
| CP-8 | APPROVED 边界不改需求语义 | APPROVED REQ-NF-005 四项上限 + 双重路径校验（自审） | APPROVED 判定全在碰 fs 之前 | APPROVED 11 类整体拒绝逐条断言 |
| CP-9 | APPROVED 归属不影响用户可见行为 | APPROVED 上传入口 MOD-CHAT-UI / 列表 MOD-SETTINGS-UI | APPROVED CornerMenu 本身不改 | APPROVED 代码审查可验 |
| CP-10 | APPROVED 不影响需求 | APPROVED 不 import node:fs / store | APPROVED grep 守卫可行 | APPROVED 已并入 TEST-043 末条 |
| CP-11 | APPROVED 收敛不改用户可观察行为 | APPROVED 服务端只有一处分支 | APPROVED 净减代码量 | APPROVED 三路径同形状回执可断言 |
| CP-12 | APPROVED 命中才提示，不制造噪声 | APPROVED 与 insight/display 同批次同机制 | APPROVED 既有机制加一 variant | APPROVED 命中/未命中各一断言 |
| CP-13 | APPROVED 可交付有依据 | APPROVED 对抗样本覆盖已知攻击面 | APPROVED 纯函数便于测 | APPROVED TEST-043 十八条（自审） |
| CP-14 | APPROVED 三入口都有落点 | APPROVED jsdom + e2e 两层 | APPROVED 子项各自绑断言 | APPROVED TEST-044 五条（自审） |
| CP-15 | APPROVED 可见性有守卫 | APPROVED 回归门覆盖 F1+F2 | APPROVED TASK-034..039 不受影响 | APPROVED TEST-045/046 + TEST-034..042 回归（自审） |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md`（`CR-20260910-skill-intake 变化点影响矩阵` + `技术设计` 表 + TASK-040..043 + 关键接口新增行）。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 记为缺陷修复 | APPROVED 顺序修正 | APPROVED TASK-041 ②（自审） | APPROVED TEST-044 ① 根因守卫 |
| CP-2 | APPROVED 记为欠账补齐 | APPROVED 原生控件 | APPROVED TASK-041 ③ 两个并列按钮（自审） | APPROVED TEST-044 ④ |
| CP-3 | APPROVED 无发散 | APPROVED archive 分支前置 | APPROVED TASK-042 ①（自审） | APPROVED TEST-045 ③④ |
| CP-4 | APPROVED 只读 | APPROVED children 挂载 | APPROVED TASK-043 ①②（自审） | APPROVED TEST-046 ①②③⑥ |
| CP-5 | APPROVED 四类 reason 够用 | APPROVED 两类语义分清 | APPROVED TASK-042 ③（自审） | APPROVED TEST-045 ② |
| CP-6 | APPROVED | APPROVED | APPROVED TASK-042 ②（自审） | APPROVED TEST-045 ① |
| CP-7 | APPROVED | APPROVED 每次 readUInt 前校验边界 | APPROVED TASK-040 ①③④⑤⑥（自审） | APPROVED TEST-043 正向 6 条 |
| CP-8 | APPROVED | APPROVED 拒绝全在碰 fs 之前 | APPROVED TASK-040 ②（自审） | APPROVED TEST-043 拒绝 11 条 + TEST-045 ③ 零产物 |
| CP-9 | APPROVED | APPROVED | APPROVED 归属写进任务（自审） | APPROVED 代码审查项 |
| CP-10 | APPROVED | APPROVED 可 grep | APPROVED 约束写进 TASK-040 描述（自审） | APPROVED grep 守卫 |
| CP-11 | APPROVED | APPROVED 服务端单分支 | APPROVED TASK-041 ① 单一 submitSkillUpload（自审） | APPROVED TEST-044 ⑤ |
| CP-12 | APPROVED | APPROVED 同批次发出 | APPROVED TASK-043 ③④（自审） | APPROVED TEST-046 ④⑤ |
| CP-13 | APPROVED | APPROVED | APPROVED 派生矩阵按子项列行 | APPROVED TEST-043（自审） |
| CP-14 | APPROVED | APPROVED | APPROVED 子项分行绑断言（自审） | APPROVED TEST-044（自审） |
| CP-15 | APPROVED | APPROVED | APPROVED 无既有任务废止（自审） | APPROVED 回归门（自审） |

## R4 评审矩阵

评审对象：`测试说明书.md`（`任务→测试派生矩阵`（按子项列行）+ `测试设计` 表 + TEST-043..046 + 复盘迭代表）。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 失败可见可断言 | APPROVED 合成事件断言 preventDefault | APPROVED TASK-041 ② 绑 TEST-044 ① | APPROVED TEST-044 ① 硬断言非顺带（自审） |
| CP-2 | APPROVED 入口可断言 | APPROVED jsdom + e2e | APPROVED TASK-041 ③ 绑 TEST-044 ④ | APPROVED TEST-044 ④（自审） |
| CP-3 | APPROVED zip 路径可断言 | APPROVED slug 一致性 | APPROVED TASK-042 ① 绑 TEST-045 | APPROVED TEST-045 ③④（自审） |
| CP-4 | APPROVED 可见性逐条 | APPROVED 免刷新走真实浏览器 | APPROVED TASK-043 绑 TEST-046 | APPROVED TEST-046 ①②③（自审） |
| CP-5 | APPROVED 四类各一 | APPROVED not-injected 须断言已落盘 | APPROVED TASK-042 ③ 绑 TEST-045 ② | APPROVED TEST-045 ②（自审） |
| CP-6 | APPROVED | APPROVED | APPROVED TASK-042 ② 绑 TEST-045 ① | APPROVED TEST-045 ①（自审） |
| CP-7 | APPROVED | APPROVED 含合法高压缩比反例避免误杀 | APPROVED TASK-040 绑 TEST-043 | APPROVED TEST-043 ⑤ 已补该样本（自审） |
| CP-8 | APPROVED | APPROVED 零产物断言到位 | APPROVED TASK-040 ② 绑 TEST-043/045 | APPROVED 11 类拒绝逐条 + 零产物（自审） |
| CP-9 | APPROVED | APPROVED CornerMenu 未改动可验 | APPROVED 代码审查项 | APPROVED 测试设计 CP-9（自审） |
| CP-10 | APPROVED | APPROVED grep 守卫入 TEST-043 | APPROVED TASK-040 约束 | APPROVED TEST-043 末条（自审） |
| CP-11 | APPROVED | APPROVED 同形状回执证明共用代码 | APPROVED TASK-041 ① 绑 TEST-044 ⑤ | APPROVED TEST-044 ⑤（自审） |
| CP-12 | APPROVED | APPROVED | APPROVED TASK-043 ③④ 绑 TEST-046 ④⑤ | APPROVED TEST-046 ④⑤（自审） |
| CP-13 | APPROVED | APPROVED 十八条覆盖已知攻击面 | APPROVED 纯函数便于测 | APPROVED TEST-043（自审） |
| CP-14 | APPROVED | APPROVED | APPROVED 派生矩阵按子项列行 | APPROVED TEST-044（自审） |
| CP-15 | APPROVED 回归门锁 F1+F2 | APPROVED | APPROVED | APPROVED TEST-034..042 全部重跑（自审） |

**R2/R3/R4 结果**：CP-1..CP-15 × 4 角色 **全 APPROVED，无 REJECTED、无遗留 CONDITIONAL**。R1 阶段架构的四条与模块的两条 CONDITIONAL 已在 P2 全部成文（DEC-018 ①–⑧、REQ-NF-005、CP-10 的 grep 守卫、CP-11 的单一提交路径、CP-7 的服务端解压）。

**P3 出口义务清单（实现前逐条清零）**：① `src/lib/zip.ts` 不得 import `node:fs` / `store`（grep 守卫，并入 TEST-043）；② 被拒归档必须 `.data/skills/` 零产物（TEST-045 ③，不得部分写入）；③ `handleDrop` 首行 `preventDefault`，其后才分类（TEST-044 ① 根因守卫）；④ `src/lib/display-events.ts` 更名 `ui-events.ts` 后**旧文件必须删除**（原则 16），两处 import 同步；⑤ TEST-034..042 全部重跑通过（F1+F2 回归门）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ckbi5GYRRH4HyTHLEWnrtZ

## P3/P4 实施记录（2026-09-10）

### 落地清单

| 任务 | 落点 |
|---|---|
| TASK-040 | **新增 `src/lib/zip.ts`**（MOD-ZIP）：`readZipEntries` / `deriveFolderName` / `ZipError` / `DEFAULT_ZIP_LIMITS`。尾部 65557 字节内反向搜 EOCD → 遍历 Central Directory → 按 `localHeaderOffset` 读 Local File Header 定位数据 → method `0` 切片 / method `8` 走 `inflateRawSync`。每次 `readUInt*` 前经 `ensure()` 边界校验 |
| TASK-041 | `FloatingChat`：`submitSkillUpload(input)` 单一提交路径；`handleDrop` **首行 `preventDefault`** 后再 `classifyDrop` 分类，三态（folder / archive / none）各有出口，none 走系统消息说明原因；两个隐藏 `<input>`（`webkitdirectory` / `accept=".zip"`，各带 `aria-label`）+ 两个真实 `<button>`；新增导出的纯函数 `classifyDrop` / `describeExcluded` 便于单测 |
| TASK-042 | `POST /api/skills` 增 `archive` 分支（`readZipEntries` → `deriveFolderName` → `UploadedFile[]` → 既有 `registerSkill`）；`ZipError` → 400 且零产物；`SKILL_TEXT_EXTENSIONS` 11 → 16；回执新增 `excluded: [{path, reason}]` 四类 |
| TASK-043 | **新增 `src/components/SkillList.tsx`**（只读，读 `GET /api/skills`，监听 `SKILLS_CHANGED_EVENT` 重取）；`page.tsx` 经 `CornerMenu` `children` 挂载并 SSR 注水 `initialSkills`；`chat/stream/route.ts` `onFinal` 加 `{type:"skill", name}` 尾事件；`FloatingChat` 消费后插「本轮使用技能：X」；`display-events.ts` → **`ui-events.ts`**（旧文件已删，原则 16） |

### P3 设计细化（相对 P2 的差异，已回写各层说明书）

1. **`maxRatio` 由 100 上调到 2000**。P2 定的 100 在实现时被 TEST-043 ⑤ 证伪：deflate 对重复文本轻易达到 1000:1，一个 200 KB 的普通重复文本技能文件就会被误杀。真正的内存边界是 `maxTotalBytes`（50 MiB）与 `maxEntryBytes`（5 MiB）—— 二者在**解压前**用 Central Directory 声明的大小判定，所以分配量本就有界；`maxRatio` 只作病态归档的兜底。四项上限的结构不变，REQ-NF-005 ② 仍成立。
2. **「不支持的压缩方法」与「加密」分开处置**（P2 已定，实现确认）：前者逐条进 `skipped`（合法但不支持，非恶意），后者整包拒（读不出任何有意义内容）。
3. **`inflateRawSync` 加 `maxOutputLength: uncompSize + 1`**，并在解压后复核实际长度 —— 防止「声明小、实际大」的头部撒谎。P2 未写到这一层。
4. **`smoke.mjs` 端口改为可回退**：固定 3210 在本机被无关进程占为临时端口导致 `EACCES`，整轮 smoke 挂掉。新增 `pickPort()`：显式配置优先，否则试首选端口、被占则由系统分配。属测试基建健壮性修复，不改产品行为。
5. **两个隐藏 `<input>` 补 `aria-label`** —— `ui-contract` SE-05 要求每个 input 有可访问名，隐藏与否不影响该静态规则。

### 出口义务清零

| # | 条件 | 状态 |
|---|---|---|
| ① | `src/lib/zip.ts` 不得 import `node:fs` / `store` | ✅ `tests/zip.test.ts` 末条源码守卫，grep 为空 |
| ② | 被拒归档 `.data/skills/` 零产物 | ✅ `tests/skills-route.test.ts` ③ 断言 `SKILLS_ROOT` 为空 |
| ③ | `handleDrop` 首行 `preventDefault` | ✅ `tests/floating-chat.test.tsx` ① 用 `fireEvent.drop` 返回值断言（返回 `false` 即已阻止） |
| ④ | `display-events.ts` 更名后旧文件必须删除 | ✅ `git mv` 完成，仓库内无该文件，两处 import 已同步 |
| ⑤ | TEST-034..042 全部重跑通过 | ✅ 194 单测 + 10 e2e 全绿 |

### 验证

`npm test` **194**（新增 `zip` 19、`skill-list` 5、`floating-chat` +7、`skills-route` +4）· `ui-contract` 静态 **49/0/0** · `npm run test:smoke` OK · `npm run test:e2e` **10 PASS**（含真机走「上传 zip」按钮 → 文件选择器 → 注册 → ☰ 技能列表免刷新更新）· `npm run build:verify` OK · `npx tsc --noEmit` OK。**零新增运行依赖**（`package.json` `dependencies` 未变）。

### g3 跨 CR 阻塞（如实记录）

`gate g3` 对**测试说明书里全部 required TEST** 求交集判定，因此任何一个「R4 已过、P3 未做」的在途 CR 都会让 g3 对**所有** CR 变红。本 CR 收口时：

```
gate g3 → FAIL missing PASS evidence for: TEST-047, TEST-048, TEST-049, TEST-050
```

这四条属 `REQ-NF-006` / CR-20260910-ui-foundation（并行会话，状态 APPROVED 未实施）。本 CR 自身的 TEST-043..046 已 PASS，TEST-034..042 回归全绿。

这不是本 CR 的缺陷，但**是流程本身的一个摩擦点**：g3 没有按 CR 切分的粒度，导致「别人的 CR 没做完」会阻塞「我的 CR 收口」。已登记为流程优化候选（见后续流程 CR）。

## R1 评审意见

**CR-20260910-skill-intake 评审（R1）**（迁移自 `产品需求说明书.md`）

来源：P6 运行反馈（拖 zip 无反应 → 实测 `GET /api/skills` 返回空 → 定位为「非文件夹 drop 在 `preventDefault()` 之前 return，浏览器接管，零请求到达服务端」）。四角色独立 ReAct 评审，架构与模块的 CONDITIONAL 经 1 轮反馈闭环转 APPROVED。完整记录见 `project/05_evidence/EV-2026-09-10-skill-intake.md §3` 与 `CR-20260910-skill-intake.feedback.jsonl`；CP 逐条见该 CR 的「变化点登记」表（CP-1..CP-15）。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 产品 owner | ①A1–A4 是**缺陷**（A2「上传入口」是 TASK-033 Ⅰ 已写却未实现的欠账），只有 zip 是需求扩展——记账须分清。②最坏失败模式是「以为成功、其实没有」，可观测性必须与入口**同批**交付。③非目标须保持：不做技能编辑/删除/版本/市场；归档只支持 zip。 | REQ-F-020 ①⑤⑦ 重写；新增 REQ-F-028；非目标新增 3 行 | APPROVED |
| 架构角色（R1 → 闭环） | R1 CONDITIONAL：手写二进制解析器处理不可信输入是唯一实质风险面，须成文四条硬约束——zip slip 双重校验、四个资源上限（条目数/单条/总量/压缩比）整体拒绝、仅 method 0/8 且加密位拒绝、解析器纯函数不碰 fs。处理：立 **DEC-018** + 新增 **REQ-NF-005**，四条全部写入 CP-7/CP-8/CP-10；SSE 新增 `skill` 尾事件与既有 `insight`/`display` 同机制，无新传输面。 | DEC-018 + REQ-NF-005 立项；CP-7/8/10 成文 | **APPROVED**（闭环后） |
| 模块开发角色（R1 → 闭环） | R1 CONDITIONAL：①三条输入路径（拖文件夹/拖 zip/点选）必须收敛为**单一** `submitSkillUpload`；②解压必须在**服务端**（客户端解压会把解析器塞进浏览器包，且越界校验本在服务端，两处解压=两套安全边界）。处理：CP-11 写明单一提交路径，CP-7/CP-10 写明服务端解压；上传入口用原生 `<input>` + 真实 `<button>`，技能列表走 `CornerMenu` 既有 `children` 模式不改 `CornerMenu`（CP-9）。 | CP-9/10/11 成文 | **APPROVED**（闭环后） |
| 测试角色 | ①zip 单测须含 7 类对抗样本逐条独立断言（原则 15）。②「非文件夹 drop 被浏览器接管」是本次根因，须断言 `preventDefault` 被调用且对话内有说明。③「上传成功但没注册」不得再静默发生——注册回执与技能列表**两处**断言。④被排除文件三类各一断言。⑤TEST-034..042 作回归门。 | TEST-043..046 + 回归门 | APPROVED |

**R1 人工终裁**：待用户拍板——确认 CP-1..CP-15、REQ-F-020 ①⑤⑦ 重写、REQ-F-028、REQ-NF-005 四项资源/路径边界、白名单放宽清单、DEC-018 自写零依赖解析器。四角色已全部 APPROVED，无遗留 CONDITIONAL。

## R2 评审意见

**CR-20260910-skill-intake 评审（R2，架构说明书）**（迁移自 `架构设计说明书.md`）

各角色对本节「CR-20260910-skill-intake 方案」表 + DEC-018 + MOD-ZIP + 接口契约新增行独立评审。逐 CP 裁决见 CR 的 `## R2 评审矩阵`。R1 阶段架构 CONDITIONAL 的四条（zip slip 双重校验 / 四项资源上限 / 仅 method 0·8 且拒加密位 / 解析器纯函数）在此全部成文。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 架构角色（自审） | ①DEC-018 把 R1 的四条硬约束逐条落成可实现规格，并补齐两处 R1 未定的细节：**不支持的压缩方法逐条排除而非整包拒**（合法归档不该被苛待），**加密位整包拒**（读不出任何有意义内容）；②`folderName` 推导规则（单顶层目录剥前缀）必须成文，否则 zip 与文件夹两条路径会产出不同的 slug；③零 schema 变更、零新增依赖、零部署变更 —— L2 判定成立；④唯一新信任面是自写解析器，风险由上限 + 双重路径校验 + 对抗样本承载，已在总判里显式点名。 | DEC-018 ①–⑧ 成文；MOD-ZIP 入模块边界表 | APPROVED |
| 产品 owner | ①方案未引入 CR 未声明的用户可观察行为；②`excluded` 的两类语义（未落盘 vs 已落盘但不注入）在契约里分清了，符合 REQ-F-020 ⑤「列出被排除的文件**与原因**」；③技能列表走既有 `GET /api/skills`，未新增只为 UI 服务的端点。 | 确认无发散 | APPROVED |
| 模块开发角色 | ①`readZipEntries` 返回 `{entries, skipped}` 而非抛错混合，使"整体拒绝"与"逐条排除"两种语义在类型上就分开 —— 可实现性好；②`archive` 与 `file[]` 二选一的形状让服务端只有一处分支；③`zip.ts` 不 import `node:fs` 可被 grep 守卫。 | 记入 TASK-040/042 | APPROVED |
| 测试角色 | ①纯函数 + 手工构造字节 = 7 类对抗样本可精确构造，无需真实 zip 工具；②四项上限各有独立数值，可逐条越界断言（原则 15）；③`maxRatio` 需要一个"高压缩比但合法"的反例避免误杀，测试须含该样本。 | TEST-043 补合法高压缩比样本 | APPROVED |

## R3 评审意见

**CR-20260910-skill-intake 评审（R3，模块任务开发说明书）**（迁移自 `模块任务开发说明书.md`）

各角色对本 CR 的「变化点影响矩阵」+「技术设计」两表 + TASK-040..043 独立评审。逐 CP 裁决见 CR 的 `## R3 评审矩阵`。R1 阶段模块 CONDITIONAL 两条（单一 `submitSkillUpload` / 解压在服务端）在此全部成文。

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 模块开发角色（自审） | ①影响矩阵与架构 CP-1..CP-15 逐行对应，无遗漏；②**记账分清**：CP-1/CP-2/CP-5 明确标为「缺陷修复」，其中 CP-2 标注「欠账」——TASK-033 Ⅰ 写了却没实现；③三入口收敛后 `FloatingChat` 代码量净下降（现有内联提交逻辑提出为一处）；④上传按钮 P3 定选为**两个并列按钮**（「上传文件夹」「上传 zip」）而非自造下拉，简单且可访问性更好；⑤`display-events.ts` → `ui-events.ts` 更名，避免为一个常量再开一个文件，旧文件按原则 16 删除。 | TASK-040..043 + 影响矩阵 + 技术设计 | APPROVED |
| 架构角色 | ①`zip.ts` 每次 `readUInt*` 前校验边界 —— 这是手写解析器最容易漏的一环，写进技术设计是对的；②拒绝判定全部发生在**碰 fs 之前**（解析器根本不接触 fs），满足「不得部分写入」；③`archive` 与 `file[]` 在服务端汇合成同一形状后再走 `registerSkill`，`path.resolve` 第二道校验自动覆盖 zip 路径。 | 确认 | APPROVED |
| 产品 owner | ①`excluded` 的四种 `reason` 覆盖了用户会遇到的全部丢内容场景；②技能列表是**只读**的，与非目标一致；③「本轮使用技能：X」只在命中时出现，不制造噪声。 | 确认 | APPROVED |
| 测试角色 | ①`readZipEntries` 返回 `{entries, skipped}` + 抛 `ZipError` 的双语义，让"整体拒绝"与"逐条排除"可分别断言；②`handleDrop` 首行 `preventDefault` 可用合成事件断言；③`submitSkillUpload` 单一路径意味着三个入口共用一组回执断言，不必写三遍。 | TEST-043..046 | APPROVED |

## R4 评审意见

**CR-20260910-skill-intake 评审（R4，测试说明书）**（迁移自 `测试说明书.md`）

| 角色 | 反馈（本角色视角） | 处理结果 | 结论 |
|---|---|---|---|
| 测试角色（自审） | ①zip 解析器是纯函数，18 类样本可手工构造字节精确覆盖，无需真实 zip 工具或 fixture 文件；②**合法高压缩比样本**必须有（TEST-043 ⑤），否则 `maxRatio` 会误杀正常的重复文本归档；③被拒归档必须断言 `.data/skills/` **零产物**（TEST-045 ③），光断言 400 不够——"不得部分写入"是 REQ-NF-005 ② 的原话；④本次根因由 TEST-044 ① 与 TEST-046 ①②③ 两处守卫：失败必被说出、成功必被看见。 | TEST-043..046 | APPROVED |
| 架构角色 | ①`zip.ts` 不 import `node:fs` 需要 grep 守卫而非仅靠代码审查——已并入 TEST-043 末条；②整体拒绝与逐条排除两种语义分别断言（抛 `ZipError` vs `skipped` 数组），与 DEC-018 的类型设计对齐。 | 记入 TEST-043 | APPROVED |
| 模块开发角色 | 派生矩阵按**子项**列行（TASK-041 ①②③ 分三行），每子项各自绑断言——正是本次「TASK-033 Ⅰ 子项漏做无人发现」的固化对策，认可。 | 记入派生矩阵与复盘表 | APPROVED |
| 产品 owner | REQ-F-020 ①⑤⑦、REQ-F-028、REQ-NF-005 的每个可观察动作在 TEST-043..046 逐条落点；REQ-F-028 ⑥ 的「只读」非目标也有守卫（TEST-046 ⑥）。 | 确认 | APPROVED |

**复盘迭代（CR-20260910-skill-intake）**（迁移自 `测试说明书.md`）

自下而上：先证据（运行时实测 `GET /api/skills` 为空、`.data/skills/` 不存在、DB 0 行），再归因（`preventDefault` 在判空之后 → 浏览器接管 drop → 零请求到达），最后指向流程/控制缺口而非单个 bug（原则 9 / 第 7 节）。

| 观察 | 根因（指向控制缺口） | 固化的可执行控制 |
|---|---|---|
| 拖 zip 无反应，用户以为成功 | **投递路径没有"失败必被说出"的约束** —— 需求只写了成功路径 | REQ-F-020 新增 ⑦「投递失败必须可见」；TEST-044 ① 硬断言 `preventDefault` + 说明文案 |
| 界面无法看到已注册技能，失败不可发现 | **能力类功能缺少"当前拥有什么"的只读视图** —— 首个"补充系统能力"功能没带可见性 | 新增 REQ-F-028（技能可见性）；TEST-046 六条断言 |
| `<input webkitdirectory>` 兜底写进了 TASK-033 Ⅰ 却没实现，无人发现 | **任务描述内的子项没有逐项对应的验收断言** —— 整任务只绑一个 TEST-038，子项漏做不阻断 | 本 CR 起，派生矩阵按**子项**列行（见上表 TASK-041 ①②③ 分行），每子项各自绑断言 |
| 白名单外文件被静默排除 | **"过滤"类逻辑默认静默** —— 无"丢弃必须回执"的通则 | REQ-F-020 ⑤ 要求列出被排除文件与原因；TEST-045 ② 四类各一断言 |
