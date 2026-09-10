# EV-2026-09-10-skill-intake

- 证据 ID: EV-2026-09-10-skill-intake
- 来源类型: P6 运行反馈 + 运行时实测定位 + R1 四角色 ReAct 评审 + 反馈闭环
- 来源路径或引用: 交互会话 `session_01Ckbi5GYRRH4HyTHLEWnrtZ`；运行中的 dev server `127.0.0.1:3000`；`.data/agent-jarvis.sqlite`；`src/components/FloatingChat.tsx`
- 采集时间: 2026-09-10
- 采集者: Claude Code session（Opus 5）
- 支撑对象: CR-20260910-skill-intake；REQ-F-020（①⑤⑦ 重写）、REQ-F-028、REQ-NF-005；后续 DEC-018 / TASK-040..043 / TEST-043..046

## 1. 触发（P6）

用户：「拖skill压缩包到对话框，没有上传反应。怎么处理？要不要做个上传文件的按钮？」
随后：「skill上传成功了，但对话模型读取不了。」（并转述 Agent-Jarvis 的回复：「我这边仍然没有拿到这个 skill 文件夹」）

## 2. 实测定位（自下而上，先证据后归因 —— 原则 9）

对运行中的 dev server（:3000，新代码已热加载）与其数据库直接取证：

| 观察 | 结果 |
|---|---|
| `GET /api/skills` | `{"skills":[]}` —— 零个已注册技能 |
| `GET /api/display` | `{"kind":"home","refId":null,"html":null}` —— 服务正常，新路由已生效 |
| 首页 HTML | 含 `display-screen` / `display-screen--home` —— F2 代码已生效，排除「跑的是旧构建」 |
| `.data/skills/` | **目录不存在** |
| DB `skills` 表 | **0 行**；`insights` 0 行 |

**结论：上传从未发生。** 模型回复「没有拿到 skill 文件夹」是**如实的**——它确实没收到任何技能内容。

### 根因链

```
拖入 zip
  → readDroppedFolderEntries 只接受「恰好一个 FileSystemDirectoryEntry」，zip 是文件 → 返回 null
  → handleDrop 在 event.preventDefault() 之前就 return
  → onDragOver 已 preventDefault（允许 drop），但 drop 未阻止默认行为 → 浏览器接管该次 drop
  → 零请求打到 POST /api/skills
  → skills.length === 0 → routeTurn 根本不被调用（REQ-F-021 ⑤）
  → 主对话无任何技能附加 system 段
  → 模型如实回答「没拿到」
```

### 三层缺陷（按严重度）

| # | 缺陷 | 性质 |
|---|---|---|
| 1 | 非文件夹 drop 未 `preventDefault`，浏览器可接管页面 | 真 bug，会导致页面被替换 |
| 2 | 投递失败**完全无声**：不提示、不报错、无日志可见 | 可观测性缺陷 |
| 3 | 界面上**没有已注册技能列表**，用户无从发现第 1 步失败了 | 可观测性缺陷 |
| 4 | `<input webkitdirectory>` 兜底入口 —— **TASK-033 Ⅰ 描述里写了，P3 未实现** | 规格与代码偏差（欠账） |
| 5 | 白名单外的文件被静默排除，注册回执不提 | 可观测性缺陷 |

其中 4 是本会话 P3 的直接欠账，须如实记为缺陷而非新功能。

## 3. 用户决策（2026-09-10）

| 项 | 决定 |
|---|---|
| 缺陷与 zip 扩展的先后 | **一起做**（「1. 一起做」） |
| 上传入口接受的形态 | **文件夹与 zip 两者**（「2. c」） |
| zip 实现方式 | **零依赖自写解析**（「3. 自写」），不引第三方库（L3 敏感） |
| 扩展名白名单 | **顺便放宽**（「4. 顺便放宽」），新增 `.mdx .toml .sh .jsonl .xml` |

## 4. R1 四角色 ReAct 评审

评审形态：单 Agent 顺序换视角（L2）。每角色 ReAct + 4 护栏。

### 4.1 产品 owner

- Thought：这是 P6 缺陷驱动的变更，混着一条真需求扩展（zip）。记账必须分清，否则"补欠账"会被当成"交付新功能"。
- Action：核对 TASK-033 Ⅰ 原文 —— 「`<input webkitdirectory>` 兜底」确实已写入已批准任务，P3 未实现。
- Observation：最坏失败模式不是"用不了"，而是"**以为能用**"。修入口而不修可观测性，只是把黑箱换个位置。
- 裁决：**APPROVED**。处理：REQ-F-020 ①⑤ 重写 + 新增 ⑦（失败可见）；新增 REQ-F-028（技能可见性）；非目标补 3 行（只支持 zip、技能列表只读、无上传进度/队列）。
- 证据引用：`模块任务开发说明书` TASK-033 Ⅰ；本文件 §2。

### 4.2 架构角色

- Thought：本 CR 唯一实质风险面是**手写二进制格式解析器处理不可信输入**。功能面反而是小事。
- Action：枚举 zip 的已知攻击面 —— zip slip（条目名 `../`、绝对路径、盘符、反斜杠）、zip bomb（高压缩比 / 巨量条目 / 巨大解压总量）、加密条目、截断文件、非常见压缩方法。
- Observation：`registerSkill` 已有 `path.resolve` 越界校验，但那是**落盘时**的最后一道；解析层必须先拒。`node:zlib.inflateRawSync` 正好覆盖 deflate 条目，容器解析零依赖可行。
- 裁决：**CONDITIONAL** → 条件：① zip slip 双重校验；② 四个资源上限（条目数 / 单条解压字节 / 总解压字节 / 压缩比），任一超限**整体拒绝**且给可读原因；③ 仅 method `0`/`8`，加密位置位即拒绝；④ 解析器为纯函数、不碰 fs、独立模块。
- 处理 → **APPROVED**：立 **DEC-018**（有界零依赖 zip 解析器）+ 新增 **REQ-NF-005**（不可信归档处理边界，四项边界有 ID 可追溯）；条件全部写入 CP-7 / CP-8 / CP-10。另确认 SSE 新增 `skill` 尾事件与既有 `insight` / `display` 同机制，无新传输面。
- 证据引用：`src/lib/skills.ts` `registerSkill` 现有越界校验；DEC-008 自写渲染器先例；`node:zlib` API。

### 4.3 模块开发角色

- Thought：这次要加三条输入路径（拖文件夹 / 拖 zip / 点选）。三条各写一套 = 三套 bug。
- Action：勾画收敛点 —— 三个入口都只负责把输入规整成 `{folderName, files}`，然后走同一个 `submitSkillUpload`。
- Observation：解压放客户端会把 ~120 行解析器塞进浏览器包，而且越界校验本来就在服务端 —— 两处解压等于两套安全边界，必然漂移。
- 裁决：**CONDITIONAL** → 条件：① 单一 `submitSkillUpload(folderName, files)`；② 解压在服务端，客户端把 zip 原样 POST。
- 处理 → **APPROVED**：CP-11 写明单一提交路径，CP-7 / CP-10 写明服务端解压。另定：上传入口用两个隐藏 `<input type="file">`（`webkitdirectory` / `accept=".zip"`）+ 真实可见 `<button>`，不自造控件；技能列表用 `CornerMenu` 既有 `children` 模式挂新组件，不改 `CornerMenu` 本身（CP-9）。
- 证据引用：`FloatingChat.tsx` `handleDrop` / `collectFolderFiles`；`api/skills/route.ts` 既有 multipart 处理；DEC-014 `children` 模式。

### 4.4 测试角色

- Thought：zip 解析器是本项目第一个需要**对抗性**测试的部件；其余是可观测性断言。
- Action：为 CP 映射测试 —— zip 对抗样本 7 类；`preventDefault` 断言；注册回执 + 技能列表双断言；被排除文件三类断言。
- Observation：本次 P6 的根因正是"没有任何可观察信号"。测试必须把"静默失败"变成"必然被断言捕获"。
- 裁决：**APPROVED**（条件即测试设计）。TEST-043..046；TEST-034..042 作回归门。
- 证据引用：AI_STANDARD 原则 12 / 15；本文件 §2 根因链。

### 4.5 汇总

产品 / 测试 R1 即 APPROVED；架构 / 模块 R1 CONDITIONAL → **1 轮反馈闭环** → APPROVED。**四角色全部 APPROVED，无 REJECTED、无遗留 CONDITIONAL。** 逐条见 `CR-20260910-skill-intake.feedback.jsonl`。

## 5. R1 人工终裁

**待用户拍板**。需确认：CP-1..CP-15、REQ-F-020 ①⑤⑦ 重写、REQ-F-028（技能可见性）、REQ-NF-005（四项归档边界）、白名单放宽清单、DEC-018（自写零依赖有界解析器）。

## 6. 本证据边界

R1 只锁定需求与 CP 登记。DEC-018 的具体上限数值、TASK-040..043、TEST-043..046 在 P2 各层说明书产出。`review r2|r3|r4` 在 P2 成文前预期报 `COVERAGE_GAP` / `MATRIX_INVALID` —— 这是 R1 阶段的正确状态。

**已知的临时绕过**（P3 落地前）：解压后拖**文件夹**，或直接 `POST /api/skills` multipart —— 后者有 `tests/skills-route.test.ts` 与 e2e 覆盖，是当前可靠路径。
