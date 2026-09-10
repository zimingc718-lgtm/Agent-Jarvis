# CR-20260910-skill-intake

- 级别: L2（扩展已批准需求 REQ-F-020 的输入形态 + 新增一个处理不可信二进制输入的自写解析器；无新增运行依赖、无部署/信任模型变更）
- 提出人: user（P6 运行反馈：「拖skill压缩包到对话框，没有上传反应」→「skill上传成功了，但对话模型读取不了」→ 定位后决策「1. 一起做；2. c。3. 自写。4. 顺便放宽。」）
- 状态: R1 人工终裁完成（用户 2026-09-10「确认」）；P2 完成、R2/R3/R4 四角色全 APPROVED；P3 待实现
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
