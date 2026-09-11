# CR-20260910-agent-tooling

- 级别: L3（改核心目标——对话从「注入式单轮管线」变为「工具循环 agent」；改技术路线——内核按 DeepSeek Harness 插件化思想重构；打开新信任面——联网搜索与网页读取出网、`read_url` 任意 URL 抓取；新增环境依赖——SearXNG 自托管服务（**零新增 npm 依赖**）。按 `docs/CONTROLS.md` 分档判据含单向门 CP，走**重型**：完整 R1–R4 + 回滚方案 + 事前验尸。）
- 提出人: user（INPUT-2026-09-10-008；起因：「哪怕上传了 skill，Jarvis 也没有管理 skill 的能力，也没有联网搜索的能力」+「openclaw 的 token 消耗有点大，怎么借鉴轻量化」）
- 状态: APPROVED（R1）——P0 原文已存；CP-1..CP-43 登记表已填；`产品需求说明书.md` 基线表与变更响应节已写入；**R1 四角色评审完成（全 CONDITIONAL、零 REJECTED）+ 人工终裁 7 项已拍板**（见「## R1 人工终裁」）。**P2 完成**：三层说明书各含 `变更响应 · CR-20260910-agent-tooling` 节（架构 43 CP 逐点方案 + DEC-022..029 + DEC 修订作废；模块 43 CP 影响矩阵 + TASK-059..076；测试 43 CP 派生矩阵 + 既有测试处置 + TEST-061..078），三张 43×4 矩阵全 APPROVED，`review r2|r3|r4` + `gate g1|g2` + `check-specs|check-doors|check-ids|check-warnings|ui` 全 PASS。**P3 未开始**
- 占用 ID: DEC-022..029, TASK-059..076, TEST-061..078 （另创建 REQ-F-029..041、REQ-NF-007..011，见附录 A；REQ-* 不在 `check-ids` 登记范围）
- 评审模型: R1-R4 + G3/G3.5/G4
- 影响需求: **新增** REQ-F-029..041（13 条）、REQ-NF-007..011（5 条）；**重写** REQ-F-003、F-004、F-005、F-006、F-013、F-014、F-018、F-019、F-023、F-024、F-028、NF-006（12 条）；**作废并由新条款取代** REQ-F-021、F-022、F-027（3 条）；**澄清** REQ-NF-001、NF-003、NF-004、F-016、F-020（5 条）；非目标作废 4 行、改写 1 行、新增 7 行。全文见附录 A / B。
- 影响模块: **新增 MOD-TOOLS**（`src/lib/tools/` 注册表 + 循环内核 + 6 类工具 + 地址校验 + 预算，`src/lib/agent-loop.ts`）；MOD-CHAT（单轮管线 → 循环宿主、工具落库与回放、来源引用）、MOD-ADAPTER（`tools` 请求体、`tool_calls` 分片累积、`usage` 与 `stream_options` 回退、能力探测）、MOD-DB（迁移框架 + 六处 schema 变更）、MOD-SKILLS（工具化 + 删除/重命名，`routeTurn` 删除）、MOD-DISPLAY（工具化 + 循环中即时写）、MOD-CHAT-UI（步骤流、状态灯五态、面板分情形、事件单一来源）、MOD-SETTINGS-UI（搜索配置入口、token 用量、技能管理 UI）
- 影响任务: **新增 TASK-059..076（18 个）**，实施顺序有硬依赖（TASK-059 迁移框架 → TASK-060 六处 schema → 其余）。**既有任务**：废止 TASK-035、TASK-039 ①②③、TASK-034 ②④、TASK-043 ③④；大改 TASK-024/028、TASK-026/028、TASK-010、TASK-005、TASK-004、TASK-034 ④；小改 TASK-030 ④、TASK-003、TASK-016。**既有任务受影响（R1 测试/模块角色登记）**：TASK-035 全废；TASK-034 ②④、TASK-039 ①②③、TASK-043 ③④ 废；TASK-024/028（四态→五态）、TASK-026/028（50vh→分情形）、TASK-030 ④ 大改
- 影响测试: **新增 TEST-061..078（18 条）**。**既有测试（R1 测试角色登记，非「无」）**：作废 TEST-034（F-021 路由）、TEST-036（HTML 围栏捕获）、TEST-042（F-027 display 路由）；断言反转或校准 TEST-035、038 ②③④、041 ③、046 ④⑤⑥、027、031 ④、012、018、047、030、008、013、014、009、029、025、026、006、010、049、032 ③、048 ④、020；其余 REQ-F-002..028 既有 TEST 作回归门
- 当前证据: `project/05_evidence/EV-2026-09-10-agent-tooling-requirements.md`（仓库代码事实 + 联网调研 + 16 项用户决策时间线 + 三轮审视缺口）；`project/00_input/需求输入.md` INPUT-2026-09-10-008
- 方案选项:
  - A. **真嵌入 `@deepseek-ai/dsh` 包作为运行依赖**——否决。①与用户已定三项决策冲突：零新增 npm 依赖、只读免审批工具集（dsh Standard 模式默认带 shell / 文件编辑 / sandbox）、Provider 由 Jarvis 自管（REQ-F-006/009 建立在此上）；②模型层、会话/存储层、SSE 事件三处要做归属裁决与桥接，需求无一条覆盖；③dsh 为 developer preview，且**是否可作为库嵌入未确认**（文档只给 CLI / Web 入口，见 EV §2）。
  - B. **采用 OpenClaw 架构**——否决。①它是多渠道常驻 gateway，Jarvis 只有一个入口（悬浮窗），gateway 层是纯负担；②其 token 开销是结构性的（每轮 ≈ 8000 tokens 固定注入、bootstrap 文件合计 60000 字符全量注入、5 轮 ≈ 13 倍成本、时间进 system prompt 打掉前缀缓存——官方文档自述，见 EV §2），与本 CR「轻量化」目标相反；③只借其「主动唤醒」概念，且推到 D 期。
  - C. **读 DeepSeek Harness 源码，抄其插件化结构在 `src/lib/` 自行实现（用户拍板「读法二、方案 A」）**——选中。工具、技能来源、模型适配、上下文预算 / 压缩、循环策略均为注册式；只实现 Jarvis 需要的工具（技能三件套、`web_search`、`read_url`、`show_home` / `show_insight` / `save_insight`）；MIT 许可允许直接参考代码；零新增 npm 依赖；搜索后端用 SearXNG（无 API key、Jarvis 侧只需 `fetch`）。
  - D. **维持注入式现状，只补技能管理 UI 与一个「搜索」按钮**——否决。不解决「每轮 32KB 技能正文全量注入 + 全量历史回放 + 每轮一次独立路由调用」的 token 结构问题，而本地知识库（C 期）上线后该结构会直接爆掉。
- 选择理由: 选 C。①**证据**：`src/lib/chat.ts` 是单轮管线、`src/lib/skills.ts` 每轮注入 ≤32KB 正文并额外跑一次路由调用、`messages` 表无工具记录位（EV §1）——这三处是「没有管理能力、没有联网能力、token 高」三个用户痛点的共同根因，补 UI 不动内核解决不了；②**dsh 的结构正好补 Jarvis 缺的那层**（工具循环 / 注册式扩展 / compaction），而 Jarvis 已有的那层（凭据加密、多 Provider 归一与优先级、治理链）恰是 harness 类项目最弱的部分——「借内核、不换外壳」；③**同栈同许可**：dsh 为 Node/TS、MIT，可直接对照源码，不像 Python 项目需要转译；④**OpenClaw 的账单是现成的反面教材**：技能只注入名录、描述强制简短、工具结果有硬顶、时间不进稳定前缀——这四条直接写成 REQ-NF-007/008；⑤**web_search 提进 A 期**（用户决策 D13）：A 期若只做技能工具化，用户可感知收益仅「能删技能」，而工具循环、步骤流、上下文预算三者都需要一个多步慢操作来验证——搜索正是最佳压测用例。
- 回滚方式:
  - **文档回滚**：还原 `产品需求说明书.md`（删 REQ-F-029..041、REQ-NF-007..011；REQ-F-003/004/005/006/013/014/018/019/023/024/028/NF-006 回到 CR-20260910-ui-foundation 版；REQ-F-021/022/027 恢复 APPROVED；非目标恢复 61/62/67/71/77 五行原文、删新增 7 行；删本 CR 变更响应节）、`架构设计说明书.md` / `模块任务开发说明书.md` / `测试说明书.md` 各删本 CR 变更响应节与其创建的 DEC / TASK / TEST；删本文件、`.feedback.jsonl`、EV；`test-results.json` 去本 CR 条目；`需求输入.md` 的 INPUT-2026-09-10-008 **保留**（原始输入不删）。
  - **运行回滚（P3 后，按单向门 CP 逐项）**：
    - CP-10（工具记录持久化）：提供 `down` 迁移——删除 `messages` 中工具类记录行（或新表整表删除），`role` 类型回到 `user | assistant`；回滚前先导出被删行到 `.data/rollback-<date>.jsonl`。老代码读回滚后的库不会遇到未知 `role`。
    - CP-16（Provider 工具能力字段）：`down` 迁移删列；该列非敏感、可重新探测得到，无数据损失。
    - CP-5 / CP-7（出网）：代码回滚即停止出网；**已发出的查询词无法撤回**——这是本 CR 明知的单向面，缓解为 REQ-NF-009 ②「只发查询词」把不可撤回的内容压到最小。搜索后端配置行随 CP-6 回滚删除。
    - 其余 CP：`git revert` 本 CR 全部实现提交；`ChatDelta` 回到 9 种事件；`chat.ts` 回到单轮管线；`skills.ts` 恢复路由 + 注入；`display_state` 语义不变；状态灯回四态；面板回 50%；☰ 菜单去「搜索」「token」项与技能管理控件。
  - 回滚后重跑 `verify | check-changes | check-doors | review r1..r4 | gate g3/g3.5/g4` 并重新 `snapshot`；REQ-F-002..028 既有 TEST 全部重跑。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表（CP-1..CP-25，每行有来源角色、门、发现方式）+ `产品需求说明书.md` 含 `变更响应 · CR-20260910-agent-tooling` 节（附录 A / B 全文）+ 四角色 ReAct 意见 + R1 人工终裁痕迹；`check-doors` PASS；`review r1` PASS。
  - R2/R3/R4: 三层说明书各含 `变更响应 · CR-20260910-agent-tooling` 节逐一响应全部 CP；本文件三张矩阵无空、无 REJECTED；`review r2|r3|r4` PASS；R2 须裁决的 P3 待决项：单工具超时、`read_url` 体积上限、REQ-F-041 的 N、NF-007 各子预算数值、NF-008 描述长度上限、工具记录的数据形状。
  - P3/P4: 全部 TASK DONE、TEST PASS；`gate g3|g3.5` PASS；`ui-contract` 0 FAIL；**零新增运行依赖**（`package.json` `dependencies` 不变）；REQ-F-002..028 回归全绿；真实入口冒烟覆盖「注册技能 → 提问 → 步骤流显示 read_skill → 回答」与「配置 SearXNG → 提问 → 步骤流显示 web_search/read_url → 回答附来源」两条主路径；SSRF 对抗样本（loopback / 私网 / 元数据地址 / 重定向到内网 / 非 http 协议）逐条拒绝断言。
  - 出口义务（实现前逐条清零，P2 补齐）：① 新增写文件 / 执行命令类工具的审批机制；② 未沙箱化执行面（本 CR 无执行类工具，义务为「不得在无审批机制时引入」）；③ **（R1 架构角色改写）**`skill-html-unsandboxed` 的信任面**确已扩大**——`read_url` 使 HTML 来源从「用户自选的技能文件夹」变为「任意网页」，原措辞「不扩大」只看 sink 不看 source，不成立；用户终裁 3 明示接受，风险登记为 `skill-html-unsandboxed-web-source`，**iframe 沙箱化为未来 CR 的强制出口义务且优先级提高**；④ REQ-F-025 ② 的不可关闭提示条必须覆盖经 `save_insight` 上屏的 HTML，不限于技能轮产出。
- 评审记录: R1 四角色（产品 / 架构 / 模块开发 / 测试）独立 ReAct 评审**已完成**，四角色**全部 CONDITIONAL，零 REJECTED**；逐 CP 裁决与条件见 `## R1 评审意见` 与 `CR-20260910-agent-tooling.feedback.jsonl`；各角色派生变化点已合并去重后追加为 CP-26..CP-43。**R1 人工终裁**：用户 2026-09-10 逐项拍板 7 项（保留告知 / `show_insight` 保留并改写非目标 / 明示接受信任面扩大 / 联网默认开 / 面板 75% 分情形 / adapters 缩为接口预留 / 迁移框架纳入 A 期），见 `## R1 人工终裁`。R1 **PASS**。

## 事前验尸（重型变更必需）

假设本 CR 上线三个月后被判定失败，最可能的死因：

| # | 死因 | 本 CR 的对策 | 若对策失效的发现方式 |
|---|---|---|---|
| PM-1 | **token 不降反升**：技能省了 32KB，但多轮搜索的工具结果累积把它吃回来还多 | REQ-F-041 保留窗口（A 期）+ NF-007 子预算 + B 期完整压缩 | REQ-F-037 的 token 数在「注册 1 技能 + 连续 3 轮搜索」基准场景下与上线前对比，写入 EV |
| PM-2 | **模型该读技能不读 / 该搜不搜**：删掉路由后靠模型自主，弱模型（本地小模型）不会主动调工具 | REQ-F-040 能力探测提醒；自然语言可显式指定（「用技能 X」「搜一下」）；技能名录留在稳定前缀提示可用 | 真实入口冒烟用 DeepSeek 与一个本地模型各跑一遍；弱模型场景记为 known limitation 而非缺陷 |
| PM-3 | **`read_url` 被提示注入引导读内网**：搜索结果页内容是攻击者可控的 | REQ-NF-009 ③ 地址白名单 + 每跳重校验，MUST 级 | 对抗样本 TEST；`read_url` 目标校验为纯函数便于穷举 |
| PM-4 | **长任务把 UI 拖垮**：10 步步骤流塞进半屏，回复看不见 | REQ-F-003 分情形放宽 75%；步骤流默认折叠详情 | 真实入口视觉测试：10 步场景下最终回复首行可见 |
| PM-5 | **SearXNG 环境依赖把非技术用户挡在门外** | 未配置时工具不注册、Jarvis 其余功能不受影响（NF-008 ④）；「搜索」配置页提供测试连接；Docker 起服务步骤写入 `docs/LOCAL_CONFIGURATION.md`（P2） | 冒烟包含「未配置搜索」路径 |
| PM-6 | **数据模型改了但老会话读不回**：工具记录形状与旧 `messages` 行混存 | CP-10 单向门：迁移 up/down 脚本 + 老行不动；`GET /api/conversations/[id]/messages` 契约向后兼容 | store 单测覆盖「混合新旧行的会话」重建 |

## 变化点登记

「门」按撤回代价逐 CP 判定（`docs/CONTROLS.md`「分档判据」）。「发现方式」只有三种合法答案：
某条机器检查、某个真实入口操作、或 `发现不了` —— 填 `发现不了` 即风险登记项，强制按单向门处理。

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | 工具调用循环：一次发送内模型可多次调用已注册工具，上限 10 步，触顶**提醒后停止**且成果保留（`status=truncated`，可重放）；工具失败回喂模型而非终止；同工具同参数连续失败 2 次计为该步失败；全部工具只读或仅改 UI 状态，**免审批**，新增写 / 执行类工具时审批机制为该 CR 出口义务 | REQ-F-029 | 新增 | 双向 | 机器：循环单测（上限 / 触顶 / 失败回喂 / 连续失败计数）+ 真实入口：发送触发 ≥2 步工具调用的消息，步骤流可见 |
| CP-2 | 产品 | 技能从「每轮注入 ≤32KB 正文 + 独立路由调用」改为**三个工具** `list_skills` / `read_skill` / `search_skills`；system 稳定前缀只留名录；一轮可读多个技能，无「仅当轮」硬边界；名录超预算只列前 N 条并提示用 `search_skills`；无技能时三工具不注册。**REQ-F-021 独立路由调用删除，REQ-F-022 注入方式作废** | REQ-F-030；作废 REQ-F-021、REQ-F-022 | 大改 | 双向 | 机器：断言 system prompt 不含技能正文、每轮无路由调用、一轮内多次 `read_skill`；`skills.test.ts` 回归按新逻辑校准 |
| CP-3 | 产品 | 技能管理：☰ 技能列表每项可**删除**（二次确认，目录 + DB 行同步移除）与**重命名**（唯一性校验，目录同步）；列表免刷新更新；不做编辑正文 / 版本 / 市场。REQ-F-028 ① 由只读改为可管理 | REQ-F-031；重写 REQ-F-028 ① | 新增 | 双向 | 机器：`skill-list` 组件测 + `skills-route` 测（DELETE / PATCH）；真实入口：☰ 内删除一个技能后列表与 `.data/skills/` 同步 |
| CP-4 | 产品 | 展示屏控制工具化：`show_home()` / `show_insight(id)` 两个工具取代 REQ-F-027 的路由 `display` 字段（该字段随 CP-2 路由删除而失去宿主）；`show_insight` 可指向任意历史洞察 | REQ-F-032；作废 REQ-F-027 | 大改 | 双向 | 机器：工具单测 + `display` 测；真实入口：对话「回到首页」→ 展示屏切标题视图 |
| CP-5 | 产品 | 联网搜索工具 `web_search(query)`：经配置的 SearXNG 兼容端点 `GET /search?format=json` 取 title/url/content；**只发查询词**；未配置不注册；配置但不可用时按 NF-011 作为工具失败回喂、连续 2 次失败本轮不再调用 | REQ-F-033、REQ-NF-011 | 新增 | **单向** | 机器：出网载荷断言（请求体仅含查询词，不含历史 / 凭据 / 身份）+ 后端不可用降级测；真实入口：配置本机 SearXNG 后提问，步骤流出现 `web_search` 行。单向理由：查询词一旦发出不可撤回 |
| CP-6 | 产品 | 搜索后端配置入口：☰ 新增「搜索」项（与「模型」并列，**不进「模型」弹窗**），含「联网」总开关、SearXNG 端点 URL、启用 / 停用、「测试连接」；URL 服务端保存、不得含凭据；总开关关闭 → `web_search` 与 `read_url` 均不注册。**总开关默认值待终裁（待终裁 4）**。**R1 架构改判为单向**：与 CP-16 同为 schema 增量，判据须一致 | REQ-F-038 | 新增 | 单向 | 机器：设置组件测 + 配置路由测；真实入口：☰ →「搜索」→ 填 URL → 测试连接 PASS |
| CP-7 | 产品 | 网页读取工具 `read_url(url)`：抓取正文**先摘要再入上下文**，原文不进上下文、不落库；目标地址受 NF-009 ③ 白名单约束；体积 / 超时上限 P2 定 | REQ-F-034 | 新增 | **单向** | 机器：SSRF 对抗样本逐条拒绝（loopback / 链路本地 / 私网 / 元数据地址 / 重定向到内网 / 非 http(s)）+ 摘要而非原文入上下文断言；真实入口：提问触发 `read_url`。单向理由：打开任意 URL 抓取的信任面 |
| CP-8 | 产品 | 出网边界（MUST）：联网工具是 Jarvis 唯一主动出网点（Provider 调用除外）；出网只携带查询词 / 目标 URL；`read_url` 目标仅 http(s)、解析后 IP 不得为 loopback / 链路本地 / 私网 / 元数据地址、**重定向每跳重校验**；搜索后端 URL 允许本机地址但该例外不适用于 `read_url`；REQ-NF-003 不变（SearXNG 为无账号聚合，非登录模拟） | REQ-NF-009；澄清 REQ-NF-003 | 新增 | 双向 | 机器：地址校验纯函数穷举测 + 出网载荷断言（与 CP-5 / CP-7 共用） |
| CP-9 | 产品 | 对话内步骤流：每次 `tool_call` 在记录区出一行紧凑步骤（工具名 + 参数摘要），`tool_result` 后更新为完成 / 失败并可展开看结果摘要；默认折叠；SSE 新增 `tool_call` / `tool_result` 事件；展开控件为真实 `<button>`；REQ-F-028 ②「本轮使用技能」提示删除，由步骤流 `read_skill` 行承担 | REQ-F-035；重写 REQ-F-028 ② | 新增 | 双向 | 机器：`floating-chat` 组件测（事件 → 行 → 展开）+ ui-contract；真实入口：多步任务可见每步 |
| CP-10 | 产品 | 工具调用**落库并可重建**：消息记录含工具调用与结果（数据形状 P2 定），刷新后活动会话重建包括步骤流；`GET /api/conversations/[id]/messages` 返回含工具记录且向后兼容；老会话行不动 | 重写 REQ-F-013 | 大改 | **单向** | 机器：store 单测（混合新旧行会话重建）+ 迁移 up/down 测；真实入口：多步任务后刷新，步骤流原样回来。单向理由：数据形状变化，回滚需 down 迁移 |
| CP-11 | 产品 | 状态灯**四态 → 五态**：新增「执行工具中」，与「生成文本中」可辨识；两套主题 AA 非文本对比 ≥3:1；显式取代 REQ-F-018「四态」与 CR-20260909-collapsible-panel「不新增可辨识状态」约束（用户 2026-09-10 拍板）；REQ-F-014 / NF-006 相应改写并把步骤流纳入视觉基础 | REQ-F-036；重写 REQ-F-018、REQ-F-014、REQ-NF-006 | 大改 | 双向 | 机器：`theme-toggle`/`visual` 五态对比断言 + axe；真实入口：工具执行中灯态肉眼可辨 |
| CP-12 | 产品 | 折叠态长任务：折叠时由灯态承担执行可见性（步骤流不在 DOM）；完成 / 触顶 / 失败时灯做一次瞬时提示后落定；全程不自动展开 | 重写 REQ-F-019 ④ | 小改 | 双向 | 机器：折叠态收到 `tool_call` 事件不展开且灯态切换的组件测 |
| CP-13 | 产品 | 面板高度上限**分情形**：纯对话仍 50%；本轮记录区含步骤流时 75%（覆盖 CR-20260908 65% / CR-20260909 50% 两次澄清） | 重写 REQ-F-003 | 小改 | 双向 | 机器：两情形高度断言；真实入口：10 步场景最终回复首行可见 |
| CP-14 | 产品 | token 用量可见：☰ 菜单显示当前会话累计 input / output token，累计**全部内部调用**；Provider 返回 `usage` 用真实值（流式带 `stream_options.include_usage`），否则服务端**本地估算并标注「估算」**；新对话清零；不做费用换算 | REQ-F-037 | 新增 | 双向 | 机器：累计 / 估算 / 标注断言；真实入口：☰ 内数字随对话增长 |
| CP-15 | 产品 | 回答来源引用：本轮用了 `web_search` / `read_url` 时最终回答附来源列表（URL + 标题）；**URL 必须来自本轮工具结果集合**，服务端校验，不在集合内的剔除并在步骤流标记；按 REQ-F-016 渲染 | REQ-F-039 | 新增 | 双向 | 机器：伪造 URL 被剔除断言 + 未联网轮次无来源断言；真实入口：搜索类回答末尾可点链接 |
| CP-16 | 产品 | Provider 工具能力探测与降级：Provider 新增「支持工具调用」属性，REQ-F-007「测试」动作顺带探测并在配置页标注；解析到的 Provider 不支持时**本轮降级为纯对话（不注册工具）+ 每会话一次性提醒**；优先级规则不变，**不因工具能力跳过**（用户决策「提醒」）；状态灯「常亮」语义不变 | REQ-F-040；重写 REQ-F-006 ④ | 新增 | **单向** | 机器：探测请求断言 + 降级路径断言 + 提醒一次断言；真实入口：本地不支持工具的 Provider 提问出现提醒。单向理由：Provider 表加字段 |
| CP-17 | 产品 | 工具结果保留窗口：上下文中只有最近 N 轮工具结果保留原文，更早的替换为一行摘要标记；文本消息不受影响（完整压缩属 B 期）；落库不变、只影响发给模型的上下文；N 由 P2 定（建议 2） | REQ-F-041 | 新增 | 双向 | 机器：上下文组装纯函数测（第 N+1 轮工具结果被替换为标记） |
| CP-18 | 产品 | REQ-F-004 重写：每轮上下文由服务端按 NF-007 / F-041 规则组装——稳定前缀 + 易变后缀 + 会话消息（含工具往返、受保留窗口约束）；**不再是「已有全部消息 + 一段固定 system prompt」** | 重写 REQ-F-004 | 大改 | 双向 | 机器：上下文组装快照测（同会话前缀字节级一致、消息区按规则） |
| CP-19 | 产品 | REQ-F-005 重写：「停止」在循环任一阶段（生成中 / 工具执行中）立即生效；已执行工具调用与已生成文本落库，助手消息 `status=stopped`；会话结束语义不变 | 重写 REQ-F-005 | 小改 | 双向 | 机器：工具执行中 abort 断言（工具 promise 被放弃、落库含已完成步骤）；真实入口：多步任务中点停止 |
| CP-20 | 产品 | 洞察捕获工具化：`save_insight(html)` 工具取代「技能轮最后一个 html 围栏」捕获（「技能轮」概念随 CP-2 消失）；模型显式调用；HTML 完整性由工具参数校验；`insights.kind` 扩展点与追加语义不变。**R1 架构改判为单向门**：`read_url` 抓回的攻击者可控 HTML 可诱导模型调 `save_insight`，进入 DEC-015 的**无沙箱同源 iframe**（可 `fetch` 同源 API、读 `localStorage`）；DEC-015 的信任面前提是「技能文件夹被投毒」，本 CR 把来源扩到任意网页，故「边界不扩大」不成立，出口义务 ③ 措辞须改。**P2 必须立 DEC 覆盖：沙箱前置，或联网开启时不注册 `save_insight`** | 重写 REQ-F-023、REQ-F-024；DEC-015 | 大改 | 单向 | 机器：`read_url` 结果含注入样本 → 无 `insights` 行断言；`save_insight` → `insights` 行 + `display_state` 切换断言；真实入口：技能产出报告上屏。**注**：原填「双向」时的发现方式发现不了注入路径，按 DEC-021 ② 强制单向 |
| CP-21 | 产品 | 每轮上下文预算（MUST）：总输入硬上限（按 Provider 窗口比例）；技能名录 / 工具定义 / 单条工具结果 / 来源列表各有子预算；工具结果超预算截断并尾注；总输入超限先按 F-041 收窄、仍超 → 请求级错误红字，**不无限压缩**；验收以 F-037 的 token 数为度量 | REQ-NF-007 | 新增 | 双向 | 机器：各子预算边界断言 + 超限报错断言；EV 记录基准场景 token 数（PM-1） |
| CP-22 | 产品 | 前缀稳定与动态注册（MUST）：system prompt 分稳定前缀（身份 / 工具定义 / 技能名录，同会话内字节级不变）与易变后缀（display 状态等）；**时间不进稳定前缀**；工具与技能 description 强制简短（上限 P2 定）；工具按可用性动态注册（无技能 / 联网关 / Provider 不支持 → 相应工具定义不进 prompt） | REQ-NF-008 | 新增 | 双向 | 机器：前缀字节稳定快照测 + 三种不注册场景断言 + description 长度守卫 |
| CP-23 | 产品 | 内核可扩展性（MUST）：**本期做成注册式的是三处——工具、技能来源、循环策略（loop）**；模型适配与预算 / 压缩策略**只留接口位，不重构 `adapters.ts`**（用户终裁 6 选 A）。新增一个工具 = 注册一个描述符（name / description / 参数 schema / 执行体 / 可用性判定），不改对话核心；loop 扩展点为 Code mode 预留；参考 DeepSeek Harness 插件化，**不引入其包**。注：CP-27 的 adapter 解析 `tool_calls` / `usage` 不属本条缩减范围，它是工具循环的必要实现 | REQ-NF-010 | 新增 | 双向 | 机器：grep 守卫（对话核心不 import 具体工具模块）+ 「注册一个假工具即可被循环调用」测；「注册式设计合理性」为代码审查项不作机器断言 |
| CP-24 | 产品 | 既有条款澄清（不改语义）：NF-001「本机运行」讲部署形态，出网是数据流，仍成立；NF-003 见 CP-8；NF-004 冒烟扩到两条 agent 主路径；F-016 工具执行错误既非请求级也非流中错误——是工具结果，在步骤流内显示，工具结果摘要按 Markdown 渲染但链接仅 http(s)/mailto；F-020 ② 生成 SKILL.md 的独立调用**不进工具循环** | 澄清 REQ-NF-001、NF-003、NF-004、REQ-F-016、REQ-F-020 | 小改 | 双向 | 机器：`check-specs` 结构 + R1 产品角色逐条核对；F-016 有工具错误显示位置断言 |
| CP-25 | 产品 | 非目标：**作废** 61（不做工具调用 / Agent 编排）、62（不做知识固化入口）、67（不做截断或摘要）、77（不做技能编辑删除重命名）；**改写** 71（路由不准确 → 工具化后由模型自主选技能，用户可自然语言指定，仍不做路由覆写 UI）；**新增**：不引入 dsh Standard 模式的 subagents / planning / goals / workflows / shell / 文件编辑 / sandbox；Code mode 为未来候补；不做执行审批（无执行类工具）；B 期上下文分层压缩、C 期本地知识库、D 期主动唤醒（默认关 + 开关）不在本 CR；不做 token 费用换算；不做搜索结果缓存 | 非目标 | 大改 | 双向 | 机器：`governance.py ui`「超出已批准需求」+ R1 产品角色核对；实现期 grep 无 subagent / sandbox / shell 工具注册 |

### R1 派生变化点（架构 / 模块 / 测试角色提出，已合并去重）

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-26 | 架构+模块 | 建 `PRAGMA user_version` 迁移框架（up/down 注册）——仓库无任何 down 先例（`store.ts:539-543` 只有 `ADD COLUMN`），它是 CP-10 / CP-16 / CP-21 / CP-6 四处 schema 变更的**共同前置** | REQ-F-013、F-040、NF-007、F-038 | 新增 | **单向** | 机器：up→down→up 零 diff 测 |
| CP-27 | 架构+模块 | `ChatMessage` 扩 `tool_calls` 与 `tool` 角色；adapter 按 `index` 累积流式分块、不依赖 `finish_reason`（DeepSeek 与本地服务粒度不一）；`adapters.ts` 对 `tool_calls`/`stream_options`/`usage` 零基础，是 A 期最大实现体 | REQ-F-029、NF-010；DEC-003 | 大改 | 双向 | 机器：两组分块 fixture 的 adapter 单测 |
| CP-28 | 架构 | 悬空 `tool_calls` 回放规则：`stopped` / `truncated` 轮缺对应 `tool_result` 时合成「已中止」结果或整体剥离——否则 `chat.ts:99-102` 会把非法序列外发给 Provider | REQ-F-029 ②⑤、F-005、F-013 | 新增 | 双向 | 机器：回放序列合法性单测 |
| CP-29 | 架构+模块+产品 | Provider 新增「上下文窗口」属性作为 NF-007 ① 硬上限依据（`types.ts:20-29` 无此字段且不可探测），随 CP-26 迁移登记 | REQ-NF-007 ①、F-040 | 新增 | **单向** | 机器：预算计算单测 |
| CP-30 | 架构+模块 | `usage` 作为新 `ChatDelta` 类型 + 会话累计用量的存储位（`adapters.ts:30-36` 丢弃 usage 块）；`stream_options.include_usage` 对不识别该参数的 Provider 可能 400，须按能力/kind 发送并在失败时回退不带参 + 走估算（不得因此破坏 REQ-F-012）。**单向理由**：会话累计用量需加列 | REQ-F-037 ③④、F-012 | 新增 | 单向 | 机器：刷新后用量不归零断言；不识别参数的 Provider 回退断言 |
| CP-31 | 架构+模块+测试 | `REQ-F-039` 来源列表为**服务端从本轮工具结果集生成的独立结构**（尾事件 + 落库字段），不解析、不改写已流出的正文——否则「剔除伪造 URL」不可实现 | REQ-F-039 ①② | 澄清 | 双向 | 机器：伪造 URL 剔除断言 |
| CP-32 | 架构+模块 | 工具能力属 **(provider, model)** 而非 provider；三态（支持 / 不支持 / **未探测**）；`default_model` 或模型覆盖变更即失效；探测须 POST `/chat/completions`（既有 `adapters.ts:129-158` 走 `GET /models`，探不出工具能力）。**单向理由**：Provider 表加列，迁移并入 CP-26 | REQ-F-040 ①②③ | 大改 | 单向 | 机器：三态分支断言 + 探测请求方法断言 |
| CP-33 | 架构+测试 | `read_url` 地址校验器必须**可注入 DNS resolver 与测试宿主白名单**：全局 `fetch` 自动跟随重定向并自行解析 DNS，「每跳重校验」须 `redirect:"manual"` 自循环；校验与连接非原子（DNS 重绑定 TOCTOU），P2 立 DEC 走 `node:https` 自定义 `lookup` 或登记残余风险。不可注入则「重定向到内网」样本实为**发现不了**（本地测试服务器本身是 loopback，首跳即被拒） | REQ-NF-009 ③ | 新增 | 双向 | 机器：对抗样本测全绿且不依赖外网 |
| CP-34 | 测试 | NF-009 ③ 对抗样本集补全：IPv6（`::1`、`fe80::/10`、`fc00::/7`、`::ffff:127.0.0.1`）、`0.0.0.0/8`、`100.64/10`、`localhost` 名、URL userinfo、多 A 记录含私网、DNS 重绑定 | REQ-NF-009 ③ | 小改 | 双向 | 机器：逐条拒绝断言 |
| CP-35 | 测试 | e2e / smoke 的 mock 模型支持 OpenAI `tool_calls` 流式增量脚本 + 内置 mock SearXNG；真实 SearXNG 降为人工冒烟（`verification: manual`）。现状：`smoke.mjs:27-48` 只回文本 delta，`skills-display.spec.ts:29` 以 `stream===false` 识别路由调用，CP-2 删路由后整套失效 | REQ-NF-004 | 大改 | 双向 | 机器：无 SearXNG 环境下 `test:e2e` / `test:smoke` 全绿 |
| CP-36 | 测试 | vitest 全局 `fetch` 守卫 + grep 守卫：非 Provider / 非联网工具模块发起的 fetch 即失败——`NF-009 ①「唯一出网点」`原本无发现方式。守卫白名单：`adapters`、`makeCompleter`、`providers/test` | REQ-NF-009 ① | 新增 | 双向 | 机器：fetch 守卫 + grep |
| CP-37 | 测试 | 既有 TEST 作废与反转登记（见「影响测试」标签）：TEST-034/036/042 作废并在 `test-results.json` 标 superseded，使 `gate g3` 不再索要其证据；7 组断言反转 | REQ-F-021/022/023/027/028/018/003 | 大改 | 双向 | 机器：`gate g3` 不再索要作废 TEST 证据 |
| CP-38 | 测试+模块 | `ui-contract.mjs` 三处规则改写：LB-06 四态→五态（`:1347-1364` 硬编码）、RF-09 分情形阈值（`:892-915` 超 50vh 即 FAIL）、新增步骤流 a11y 规则 | REQ-F-018/F-003/F-035 | 小改 | 双向 | 机器：`ui-contract` 0 FAIL |
| CP-39 | 模块+架构 | `listMessages` 排序加**行内序号**（`store.ts:435` 仅按 `created_at`，同毫秒多行工具记录重建乱序）。**单向理由**：messages 表加列，迁移并入 CP-26 | REQ-F-013 | 小改 | 单向 | 机器：同毫秒 5 行重建顺序断言 |
| CP-40 | 模块 | `FloatingChat.tsx:28-36` 客户端复制的事件类型改为 import `types.ts` 单一来源（`:169-186` 白名单未列事件会**静默丢弃**） | REQ-F-035 ③ | 小改 | 双向 | 机器：typecheck |
| CP-41 | 模块+架构 | NF-011 ②「本轮不再调用」实现为**执行体短路**，不注销工具定义——注销会破坏 NF-008 ① 前缀稳定；同步澄清 NF-008 ④ 与 F-038 ④ 的注册条件一致 | REQ-NF-011 ②、NF-008 ①④ | 澄清 | 双向 | 机器：前缀字节快照测 |
| CP-42 | 模块+架构 | 技能 `name`（frontmatter）与目录 slug 的二元关系裁定（`skills.ts:231/258`）：重命名改哪一个、目录与 DB 行非事务时的顺序与半失败恢复；重命名须沿用注册期的名称合法性与 NF-005 路径边界校验 | REQ-F-031 ③ | 澄清 | 双向 | 机器：`skills-route` 测 + `../x` 越界拒绝断言 |
| CP-43 | 模块+架构 | `show_insight(insightId)` 属主校验（`insights` 表无 `user_id`，须经 `conversations` 关联）；非法 / 不存在 id 的行为定义 | REQ-F-032 ② | 小改 | 双向 | 机器：跨会话 id 拒绝断言 |

（产品 CP-1..CP-25 在 R1 产出；架构 / 模块 / 测试派生 CP-26..CP-43 由 R1 四角色评审追加，已合并去重。**单向门**：CP-5、CP-6、CP-7、CP-10、CP-16、CP-20、CP-26、CP-29、CP-30、CP-32、CP-39 → 重型流程成立。CP-6 与 CP-20 的门由 R1 架构角色改判，原判定与理由见「## R1 评审意见」。）

## R1 人工终裁（用户 2026-09-10）

四角色全 CONDITIONAL、零 REJECTED。下列 7 项由用户逐项拍板，结果已回写 `产品需求说明书.md` 与本文件。

| # | 事项 | 谁提的 | **用户终裁** | 落点 |
|---|---|---|---|---|
| 1 | REQ-F-023 重写删除了「否则在对话内明确告知，不静默」（2026-09-09 已拍板的可观察行为，INPUT-008 无取消依据） | 产品 | **A. 保留告知** | REQ-F-023 ③ 恢复「本轮读取过技能却未调 `save_insight` 时对话内明确告知」 |
| 2 | REQ-F-032 ② `show_insight` 可指向任意历史洞察（与生效非目标冲突） | 产品 | **B. 保留并改写非目标** | REQ-F-032 ② 保留；非目标「不做展示内容历史回看/切换」与「只支持回首页意图」改写——切换只经对话，仍不做展示屏内历史列表 UI，仍不做指向非 `insight` 内容的指令 |
| 3 | CP-20 信任面扩大：`read_url` 的攻击者可控 HTML 可经模型诱导进入无沙箱同源 iframe；DEC-015 的接受前提是「技能文件夹被投毒」，来源现扩至任意网页 | 架构 | **C. 明示接受扩大后的风险** | 用户在被完整告知攻击链（`web_search → read_url → 页面内提示注入 → 模型调 save_insight → 无沙箱同源 iframe → 读 localStorage / 调同源 API`）与三个选项后选择接受。新增风险登记 `skill-html-unsandboxed-web-source`（`test-results.json known_warnings`）；缓解仍只有 REQ-F-025 ② 提示条；**CP-20 保持单向门**（注入路径本身「发现不了」，DEC-021 ②）；**iframe 沙箱化仍是未来 CR 的强制出口义务，且优先级因本 CR 提高** |
| 4 | 「联网」总开关默认值 | 产品 | **B. 默认开** | REQ-F-038 ②。附注：URL 未配置时 `web_search` 仍不注册，实际出网以填入 SearXNG 地址为准 |
| 5 | 面板 75% 与「分情形」（用户原话只说「放宽」） | 产品 | **A. 确认 75% + 分情形** | REQ-F-003 去除待终裁标记 |
| 6 | A 期是否包含 adapters 注册式重构（NF-010 ①「模型适配」） | 模块 | **A. 缩为接口预留** | REQ-NF-010 ① 改写：本期只做工具 / 技能来源 / loop 三处注册式；模型适配与预算 / 压缩策略只留接口位，**不重构 `adapters.ts`**。注意：CP-27（adapter 解析 `tool_calls` / `usage`）**不在缩减范围内**——它是工具循环的必要实现，不是架构重构 |
| 7 | CP-26 迁移框架作为前置 | 架构+模块 | **A. 纳入 A 期并先做** | CP-26 留在本 CR，且为 CP-10/16/29/30/32/39 六处 schema 变更的实施前置 |

**终裁结论**：R1 **PASS**。四角色的其余条件属澄清或 P2 落点（见 `## R1 评审意见` 与 `feedback.jsonl`），在 R2 前由各层闭环，不阻断进入 P2。

## R1 评审意见

四角色独立 ReAct 评审，完整条件与证据见 `CR-20260910-agent-tooling.feedback.jsonl`。

| 角色 | 反馈（本角色视角） | 结论 |
|---|---|---|
| 产品 owner | ①**未经拍板的削减**：F-023「不静默」告知被删（待终裁 1）。②**与生效非目标冲突**：F-032 ② vs 非目标 91/93（待终裁 2）。③**条款矛盾**：NF-008 ④ vs F-038 ④ 注册条件（→ CP-41）。④**新信任面缺默认值**：F-038「联网」总开关（待终裁 4）。⑤NF-007 ① 隐含 Provider 加「上下文窗口」字段未登记（→ CP-29）。⑥75% 为产品推导须复述确认（待终裁 5）。⑦需求文本 20 处措辞 / 引用失效须闭环（F-015、F-026 ③ 引用已 SUPERSEDED 的 F-027；非目标 87 字样失效；CR 行 5 / 行 8 计数）。 | **CONDITIONAL** |
| 架构角色 | ①**CP-20 门判定错误**：`read_url` → 模型 → `save_insight` → DEC-015 无沙箱同源 iframe，信任面来源从「技能文件夹」扩到「任意网页」，出口义务 ③ 只看 sink 不看 source，须改单向 + P2 立 DEC（待终裁 3）。②CP-6 须与 CP-16 同档。③待裁决项补 5 项（线协议、悬空 tool_calls、usage 存储位、窗口来源、能力粒度）→ CP-27/28/29/30/32。④既有探测走 `GET /models` 探不出工具能力。⑤CP-10/16 回滚补「down 先于旧代码启动」与 `DROP COLUMN` 可用性。⑥CP-1 ⑥ 工具分类措辞须改三类（`save_insight` 会写 `insights` 行）。⑦DEC 修订清单：DEC-016 SUPERSEDED、DEC-017 ⑤、DEC-012、DEC-005、DEC-003/004。 | **CONDITIONAL** |
| 模块开发角色 | ①CP-1/2/9/11/14 每个至少三件事，P2 派生须按给出的粒度拆。②**迁移框架是共同前置且仓库无 down 先例**（→ CP-26，待终裁 7）。③四项「一句话」条款实现量巨大须 R2 补落点：`read_url` 摘要方式、F-040 探测判据、NF-007 窗口来源、F-037 存储形状。④F-039 来源须为独立结构（→ CP-31）。⑤NF-011 ② 须为执行体短路（→ CP-41）。⑥建议 CP-23 缩为接口预留（待终裁 6）。⑦`adapters.ts` 对 `tool_calls`/`usage` 零命中，是 A 期最大实现体（→ CP-27）。 | **CONDITIONAL** |
| 测试角色 | ①**「影响测试: 无」不成立**：3 条作废 + 7 组反转须在 R1 登记（→ CP-37，已回写标签）。②NF-009 ③ 样本集缺 IPv6 / 重绑定 / userinfo（→ CP-34）。③CP-7 的机器发现方式在校验器不可注入时实为「发现不了」（→ CP-33）。④两条真实入口主路径在现有 e2e/smoke 上**都不存在**（→ CP-35）。⑤五处措辞不可断言：F-035 ①「紧凑」、F-036 ③「互相可辨识」（reduced-motion 下仅靠动画即失效）、NF-007 ⑤ 只有度量无阈值、F-039 ② 标记位置、F-040 ③ 未探测态。⑥10 项 P2 数值定前对应用例不能写。⑦好消息：`chat.ts:33` `providerStream` 是**工厂**，工具循环可在 vitest 下无外网闭环。 | **CONDITIONAL** |

**R1 结果**：四角色 **CONDITIONAL ×4，REJECTED ×0**。派生 CP-26..CP-43 已登记。待终裁 7 项 + 各角色澄清条件清零后，`review r1` 可转 PASS 并进入 P2。

## R2 / R3 / R4 评审矩阵

P2 产出。三层说明书写 `变更响应 · CR-20260910-agent-tooling` 节后，跑 `governance.py matrix CR-20260910-agent-tooling` 生成矩阵骨架，再逐格填裁决。

## 附录 A：新增需求草案（写入 `产品需求说明书.md` 变更响应节的原文）

### 功能需求

| ID | 名称 | 优先级 | 描述 | 验收标准 |
|---|---|---|---|---|
| REQ-F-029 | 工具调用循环 | MUST | 一次发送内，模型可多次调用已注册工具，服务端执行并回喂结果，直到模型给出最终文本或触顶。 | ①单轮内工具调用上限 **10** 步；②触顶：终止循环，对话内出现提醒「已达 10 步上限，已停止」，**已执行工具结果与已生成文本保留**并落库 `status=truncated`，`truncated` 进入可重放集合；③工具执行失败（异常 / 超时）不终止循环——失败信息作为该工具结果回喂，由模型决定重试或改道；单工具超时上限由架构定；④同一工具同参数连续失败 ≥2 次即计为该步失败并计入上限；⑤「停止」（REQ-F-005）在循环任一阶段立即生效；⑥全部工具当前为只读或仅改 UI 状态，**不引入执行审批**；新增任何写文件 / 执行命令类工具的 CR 必须把审批机制列为出口义务；⑦Provider 不支持工具调用时按 REQ-F-040 处理。 |
| REQ-F-030 | 技能作为工具 | MUST | 技能不再按轮注入，而是作为三个工具供模型按需读取。 | ①`list_skills()` 返回名录；`read_skill(name)` 返回 `SKILL.md` + 白名单文本文件正文（白名单与 32KB 上限沿用 REQ-F-020，上限语义从「每轮注入」改为「单次 read 结果」）；`search_skills(query)` 按 name / description 关键字检索；②system 稳定前缀只含技能名录（name + 一行 description），不含正文；③名录超出 REQ-NF-007 子预算时只列前 N 条并提示模型用 `search_skills`；④一轮内可 read 多个技能；read 结果作为工具结果进入上下文，随 REQ-F-041 淡出，**无「仅当轮」硬边界**；⑤未注册任何技能时三个工具不注册（REQ-NF-008 ④）；⑥REQ-F-021 独立路由调用删除、REQ-F-022 注入方式作废。 |
| REQ-F-031 | 技能管理 | SHOULD | 用户可在 ☰ 技能列表删除与重命名技能。 | ①每项提供「删除」「重命名」；②删除需二次确认，成功后目录与 DB 行同步移除，列表免刷新更新；③重命名做唯一性校验（复用 `SkillNameConflictError`），目录名同步；④历史会话中已进入上下文的技能内容不受影响；⑤仍不做编辑正文、版本管理、技能市场。 |
| REQ-F-032 | 展示屏工具化 | SHOULD | 展示屏由工具控制，取代路由字段。 | ①`show_home()`：`display_state` 置 `{kind:"home"}`；②`show_insight(insightId)`：置 `{kind:"insight", ref}`，id 可为任意历史洞察；③REQ-F-027 路由 `display` 字段作废；④两工具仅改 UI 状态，免审批。 |
| REQ-F-033 | 联网搜索工具 | MUST | 模型可通过 `web_search(query)` 检索网页。 | ①经配置的 SearXNG 兼容端点 `GET /search?q=&format=json` 取结果，返回 title / url / content 列表，条数受 REQ-NF-007 子预算约束；②未配置搜索后端或「联网」总开关关闭时该工具**不注册**；③配置了但不可用时按 REQ-NF-011；④只发送查询词，不发送会话历史、凭据、用户身份（REQ-NF-009）；⑤结果内容按子预算截断。 |
| REQ-F-034 | 网页读取工具 | MUST | 模型可通过 `read_url(url)` 读取网页正文。 | ①抓取正文后**先摘要再入上下文**；原文不进入上下文、不落库；②目标地址受 REQ-NF-009 ③ 约束；③抓取超时与体积上限由架构定；④步骤流显示的是摘要不是原文；⑤「联网」总开关关闭时不注册。 |
| REQ-F-035 | 对话内步骤流 | MUST | 工具执行过程在对话内可见。 | ①每次 `tool_call` 在记录区出现一行紧凑步骤（工具名 + 参数摘要）；`tool_result` 到达后该行更新为完成 / 失败并可展开查看结果摘要；②默认折叠详情；③SSE 新增 `tool_call` / `tool_result` 事件；④刷新后活动会话的步骤流按落库记录**重建**（REQ-F-013）；⑤步骤行与展开控件为真实 DOM / `<button>`，满足 REQ-F-014 / NF-006 可访问性；⑥REQ-F-028 ②「本轮使用技能」提示删除，由步骤流的 `read_skill` 行承担。 |
| REQ-F-036 | 状态灯执行阶段 | SHOULD | 状态灯能区分「执行工具中」与「生成文本中」。 | ①新增第五态「执行工具中」；②折叠态下由灯态承担执行可见性；③五态在两套主题下互相可辨识且 WCAG 2.2 AA 非文本对比 ≥3:1；④显式取代 REQ-F-018「四态」与 CR-20260909-collapsible-panel「不新增可辨识状态」约束（用户 2026-09-10 拍板）。 |
| REQ-F-037 | token 用量可见 | SHOULD | 用户能看到当前会话的 token 消耗。 | ①☰ 菜单显示当前会话累计 input / output token；②累计包含该会话内**全部**内部模型调用（主循环每一步、摘要调用等）；③Provider 返回 `usage` 时用真实值，流式请求携带 `stream_options.include_usage`；④Provider 不返回 usage 时用服务端本地估算并**标注「估算」**；⑤新对话清零；⑥不做费用换算。 |
| REQ-F-038 | 搜索后端配置入口 | MUST | 用户可配置联网能力与搜索后端。 | ①☰ 新增「搜索」项，与「模型」并列，**不进「模型」弹窗**；②含「联网」总开关、SearXNG 兼容端点 URL、启用 / 停用、「测试连接」；③URL 服务端保存，非敏感、不得含凭据；④总开关关闭 → `web_search` 与 `read_url` 均不注册；仅 URL 未配置 → 只 `web_search` 不注册。 |
| REQ-F-039 | 回答来源引用 | SHOULD | 使用了联网结果的回答附来源。 | ①本轮使用了 `web_search` / `read_url` 结果时，最终回答附来源列表（URL + 标题）；②来源 URL **必须来自本轮工具结果集合**，服务端校验，不在集合内的剔除并在步骤流标记；③按 REQ-F-016 渲染为可点击链接；④未使用联网工具的轮次不附来源。 |
| REQ-F-040 | Provider 工具能力探测与降级 | MUST | 不支持工具调用的 Provider 不导致失败。 | ①Provider 新增「支持工具调用」能力属性；②REQ-F-007「测试」动作顺带探测（发送带工具定义的最小请求）并保存结果，配置页标注；③解析到的最高优先级 Provider 不支持时，**本轮降级为纯对话**（不注册任何工具）并在对话内提醒，每会话一次；④REQ-F-006 优先级规则不变——**不因工具能力跳过** Provider；⑤状态灯「常亮」语义不变。 |
| REQ-F-041 | 工具结果保留窗口 | MUST | 工具结果不无限累积进上下文。 | ①发送给模型的上下文中，只有最近 N 轮的工具结果以原文保留；更早轮次的工具结果替换为一行摘要标记（工具名 + 参数摘要 + 「结果已省略」）；N 由架构定（建议 2）；②用户与助手文本消息不受本条影响（完整压缩属 B 期）；③落库记录不变，只影响发送给模型的上下文；④步骤流重建读库，不受影响。 |

### 非功能需求

| ID | 名称 | 优先级 | 描述 | 验收标准 |
|---|---|---|---|---|
| REQ-NF-007 | 每轮上下文预算 | MUST | 单轮发送给模型的输入有硬上限与子预算。 | ①总输入硬上限按 Provider 上下文窗口比例（架构定）；②子预算：技能名录、工具定义、单条工具结果、来源列表各有上限；③工具结果超子预算 → 截断并在结果尾注明；④总输入超上限 → 先按 REQ-F-041 收窄；仍超 → 请求级错误（REQ-F-016 红字），**不无限压缩**；⑤验收以 REQ-F-037 的 token 数为度量，基准场景（1 技能 + 连续 3 轮搜索）记入证据。 |
| REQ-NF-008 | 提示词前缀稳定性与工具动态注册 | MUST | system prompt 可缓存，工具定义不白占 token。 | ①system prompt 分**稳定前缀**（身份、工具定义、技能名录）与**易变后缀**（display 状态等）；稳定前缀同会话内字节级不变，除非技能 / 工具集合变化；②当前时间不进入稳定前缀；③工具与技能 description 强制简短（上限架构定）；④工具按可用性动态注册：无技能 → 无技能工具；联网关闭 / 未配置 → 无联网工具；Provider 不支持 → 无工具；未注册的工具定义不进 prompt。 |
| REQ-NF-009 | 出网边界 | MUST | 联网能力的数据流与目标地址受限。 | ①联网工具是 Jarvis **唯一**主动出网点（Provider 调用除外）；②出网只携带查询词 / 目标 URL，不携带会话历史、凭据、用户身份、系统提示；③`read_url` 目标：仅 http / https；解析后 IP 不得为 loopback、链路本地、私网段、云元数据地址；**重定向每跳重校验**；④「联网」总开关关闭 → 两工具不注册；⑤搜索后端 URL 允许为本机地址（自托管 SearXNG），该例外仅适用于 `web_search` 的后端调用，不适用于 `read_url` 目标；⑥REQ-NF-003 不变：SearXNG 为无账号聚合查询，不构成登录模拟。 |
| REQ-NF-010 | 内核可扩展性 | MUST | 新增能力不改对话核心。 | ①工具、技能来源、模型适配、上下文预算 / 压缩策略、**循环策略（loop）**均为注册式能力；②新增一个工具 = 注册一个描述符（name、description、参数 JSON schema、执行体、可用性判定），**不修改对话核心**；③loop 作为扩展点为 Code mode 预留（本 CR 非目标）；④模式参考 DeepSeek Harness 插件化，**不引入其包**。 |
| REQ-NF-011 | 搜索后端不可用降级 | SHOULD | 搜索后端故障不打断对话。 | ①`web_search` 调用失败（连接失败 / 超时 / 非 2xx / JSON 非法）→ 作为工具失败回喂模型（REQ-F-029 ③），不弹请求级错误；②连续失败 ≥2 次 → 本轮后续不再调用，步骤流标记「搜索后端不可用」；③「搜索」配置的「测试连接」可复现该故障。 |

## 附录 B：重写 / 作废 / 澄清 / 非目标（写入变更响应节的原文）

### 重写

| ID | 改后要点 |
|---|---|
| REQ-F-003 | 面板高度上限**分情形**：纯对话 50%；本轮记录区含步骤流时 75%。覆盖 CR-20260908（65%）与 CR-20260909（50%）两次澄清。 |
| REQ-F-004 | 每轮请求由服务端按 REQ-NF-007 / REQ-F-041 规则组装上下文：稳定前缀 + 易变后缀 + 会话消息（含工具往返，受保留窗口约束）。**不再是「已有全部消息 + 一段固定 system prompt」**。流式逐段显示不变。 |
| REQ-F-005 | 「停止」在工具循环任一阶段（生成中 / 工具执行中）立即生效；已执行工具调用与已生成文本落库，助手消息 `status=stopped`；「当前会话即结束」不变。 |
| REQ-F-006 | ④ 补：解析到最高优先级 Provider 后按 REQ-F-040 判定工具可用性；**优先级不因工具能力跳过**。其余不变。 |
| REQ-F-013 | 消息记录含工具调用与结果（数据形状由架构定）；刷新后活动会话重建**包括步骤流**；`GET /api/conversations/[id]/messages` 返回含工具记录且向后兼容；已有会话行不动。 |
| REQ-F-014 / REQ-NF-006 | 「状态灯四态」→「五态」达 AA；步骤流（步骤行、展开控件）纳入视觉基础与可访问性要求。 |
| REQ-F-018 | 五态：检测中 / 灭 / 常亮 / **生成文本中** / **执行工具中**；CR-20260909-collapsible-panel「不新增可辨识状态」补充作废。 |
| REQ-F-019 | ④ 改：折叠态下收到 `tool_call` / `tool_result` 保持折叠，灯态切「执行工具中」；完成 / 触顶 / 失败时瞬时提示后落定；不自动展开。 |
| REQ-F-023 | 捕获改为 `save_insight(html)` 工具：模型显式调用；无「技能轮」概念；HTML 完整性由工具参数校验，不完整则工具失败回喂；不调用则无捕获、对话内不提示。 |
| REQ-F-024 | `kind` 扩展点与追加语义不变；④ 读回入口不变；⑤ 写入者由「捕获逻辑」改为 `save_insight` 工具。 |
| REQ-F-028 | ① 列表**可管理**（REQ-F-031）；② **删除**（由步骤流承担）；③ 删除；④ 不变。 |

### 作废（由新条款取代）

| ID | 取代者 | 状态 |
|---|---|---|
| REQ-F-021 按发送路由技能 | REQ-F-030（模型经工具自主选择） | SUPERSEDED |
| REQ-F-022 技能内容注入 | REQ-F-030 ①②④ | SUPERSEDED |
| REQ-F-027 对话指令控制展示屏 | REQ-F-032 | SUPERSEDED |

### 澄清（不改语义）

- REQ-NF-001 本机运行：讲部署形态（单进程、本机启动、SQLite 本地）；联网工具的出网是数据流，本条仍成立。
- REQ-NF-003 官方授权边界：SearXNG 为无账号、无 cookie 的聚合查询，不构成「网页登录模拟」；本条不放宽。
- REQ-NF-004 真实入口验证：冒烟扩到两条 agent 主路径——「注册技能 → 提问 → 步骤流 read_skill → 回答」「配置搜索 → 提问 → 步骤流 web_search / read_url → 回答附来源」，以及「未配置搜索」路径。
- REQ-F-016：工具执行错误既非请求级错误也非流中错误——它是**工具结果**，在步骤流内显示；工具结果摘要按 Markdown 渲染，链接仍仅 http / https / mailto 可点击；模型输出中的原始 HTML 不执行。
- REQ-F-020 ②：生成 `SKILL.md` 的独立 LLM 调用**不进工具循环**、不注册工具、不计入 REQ-F-037 的会话累计（它不属于任何会话）。

### 非目标

**作废**（原文行号按 CR-20260910-ui-foundation 版）：
- 61「首版不实现工具调用和 Agent 编排」
- 62「首版不实现知识固化入口」（C 期本地知识库将实现；本 CR 不实现）
- 67「首版不实现超长上下文的截断或摘要」（本 CR 实现工具结果保留窗口；完整压缩属 B 期）
- 77「仍不做技能的编辑、删除、重命名」（删除、重命名由 REQ-F-031 实现；编辑正文仍不做）

**改写** 71：「技能选择由模型经工具自主完成，不保证与用户预期一致；用户可用自然语言显式指定（『用技能 X』）；不做路由覆写 UI。」

**新增**：
- 采用 DeepSeek Harness 的**内核结构**（插件化、注册式、loop 可换），**不引入**其 Standard 模式的 subagents / planning / goals / workflows / shell / 文件编辑 / sandbox；不安装 `@deepseek-ai/dsh` 包。
- Code mode（模型写程序一次做完多步）为未来候补；前提是执行沙箱与审批机制。
- 不做执行审批机制（本 CR 无写文件 / 执行命令类工具）；引入此类工具的 CR 以审批机制为出口义务。
- B 期「会话上下文分层与完整压缩」、C 期「本地知识库」、D 期「主动唤醒（默认关 + 开关 + 空闲 token 上限）」不在本 CR。
- 不做 token 费用换算；不做搜索结果缓存；不做技能编辑正文 / 版本 / 市场。

## 附录 C：分期

| 期 | 内容 | 出网 | 新 npm 依赖 | 状态 |
|---|---|---|---|---|
| **A（本 CR）** | REQ-F-029..041 + REQ-NF-007..011 + 附录 B 全部 | 是（用户可关） | 零 | R1 待评审 |
| B | 会话上下文分层与完整压缩（含压缩策略注册） | 否 | 零 | 另立 CR |
| C | 本地知识库（检索工具 + 知识固化入口） | 否 | 待定 | 另立 CR |
| D | 主动唤醒（默认关 + 开关 + 空闲态 token 上限） | 否 | 零 | 另立 CR |

## R2 评审矩阵

评审对象：`架构设计说明书.md` 的 `变更响应 · CR-20260910-agent-tooling` 节（逐变化点方案表 + DEC-022..029 + DEC 修订与作废 + 架构总判）与新增的 DEC 行、MOD-TOOLS 模块边界行。行 = CP-1..CP-43，列 = 产品 / 架构 / 模块 / 测试四角色。无 REJECTED、无空格、无遗留 CONDITIONAL。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 方案未引入 CP 外的可观察行为（工具循环 ≤10 步） | APPROVED DEC-022（自审） | APPROVED 可派生为 TASK-065/071 ① | APPROVED 有断言落点 TEST-067 ①-⑥ |
| CP-2 | APPROVED 方案未引入 CP 外的可观察行为（技能工具化删路由） | APPROVED DEC-016 SUPERSEDED（自审） | APPROVED 可派生为 TASK-067 | APPROVED 有断言落点 TEST-069；TEST-034 作废 |
| CP-3 | APPROVED 方案未引入 CP 外的可观察行为（技能管理） | APPROVED 方案表 CP-3 删改顺序（自审） | APPROVED 可派生为 TASK-073 | APPROVED 有断言落点 TEST-074 |
| CP-4 | APPROVED 方案未引入 CP 外的可观察行为（展示屏工具化） | APPROVED DEC-017 ⑤ 修订（自审） | APPROVED 可派生为 TASK-068 ①②③ | APPROVED 有断言落点 TEST-070 ①②③；TEST-042 作废 |
| CP-5 | APPROVED 方案未引入 CP 外的可观察行为（web_search） | APPROVED DEC-027（自审） | APPROVED 可派生为 TASK-070 ① | APPROVED 有断言落点 TEST-072 ①②③ |
| CP-6 | APPROVED 方案未引入 CP 外的可观察行为（搜索配置入口） | APPROVED DEC-027 app_settings（自审） | APPROVED 可派生为 TASK-074 ①-④ | APPROVED 有断言落点 TEST-075 ①-⑤⑨ |
| CP-7 | APPROVED 方案未引入 CP 外的可观察行为（read_url） | APPROVED DEC-025 成文；DNS 重绑定作为残余风险显式登记，不伪装已防护（自审） | APPROVED 可派生为 TASK-069/070 ② | APPROVED 有断言落点 TEST-071；TEST-072 ⑤ |
| CP-8 | APPROVED 方案未引入 CP 外的可观察行为（出网边界 MUST） | APPROVED DEC-025（自审） | APPROVED 可派生为 TASK-069 | APPROVED 有断言落点 TEST-071；TEST-072 ①⑥ |
| CP-9 | APPROVED 方案未引入 CP 外的可观察行为（对话内步骤流） | APPROVED ChatDelta 扩展（自审） | APPROVED 可派生为 TASK-075 | APPROVED 有断言落点 TEST-076 ①②③⑥⑦⑧ |
| CP-10 | APPROVED 方案未引入 CP 外的可观察行为（工具落库与重建） | APPROVED DEC-024（自审） | APPROVED 可派生为 TASK-060 ①⑤/071 ②③⑥ | APPROVED 有断言落点 TEST-062；TEST-076 ④ |
| CP-11 | APPROVED 方案未引入 CP 外的可观察行为（状态灯五态） | APPROVED DEC-012 修订（自审） | APPROVED 可派生为 TASK-076 ①④ | APPROVED 有断言落点 TEST-077 ①②③⑧ |
| CP-12 | APPROVED 方案未引入 CP 外的可观察行为（折叠态长任务） | APPROVED DEC-012 修订（自审） | APPROVED 可派生为 TASK-076 ② | APPROVED 有断言落点 TEST-077 ④⑤ |
| CP-13 | APPROVED 方案未引入 CP 外的可观察行为（面板分情形高度） | APPROVED DEC-005 修订（自审） | APPROVED 可派生为 TASK-076 ③④ | APPROVED 有断言落点 TEST-077 ⑥⑦⑧ |
| CP-14 | APPROVED 方案未引入 CP 外的可观察行为（token 用量可见） | APPROVED DEC-028（自审） | APPROVED 可派生为 TASK-062/060 ③/074 ⑤ | APPROVED 有断言落点 TEST-064；TEST-075 ⑥⑦⑧ |
| CP-15 | APPROVED 方案未引入 CP 外的可观察行为（来源引用） | APPROVED 方案表 CP-15 独立结构（自审） | APPROVED 可派生为 TASK-072 | APPROVED 有断言落点 TEST-073 |
| CP-16 | APPROVED 方案未引入 CP 外的可观察行为（Provider 能力探测） | APPROVED DEC-029（自审） | APPROVED 可派生为 TASK-063/060 ② | APPROVED 有断言落点 TEST-065 |
| CP-17 | APPROVED 方案未引入 CP 外的可观察行为（工具结果保留窗口） | APPROVED DEC-026 ③（自审） | APPROVED 可派生为 TASK-066 ② | APPROVED 有断言落点 TEST-068 ③ |
| CP-18 | APPROVED 方案未引入 CP 外的可观察行为（REQ-F-004 重写） | APPROVED DEC-026 ①（自审） | APPROVED 可派生为 TASK-066 ①/071 ③ | APPROVED 有断言落点 TEST-068 ①② |
| CP-19 | APPROVED 方案未引入 CP 外的可观察行为（循环中途停止） | APPROVED DEC-022 signal 传入（自审） | APPROVED 可派生为 TASK-065 ⑥ | APPROVED 有断言落点 TEST-067 ⑦ |
| CP-20 | APPROVED 信任面扩大已由用户终裁 3 明示接受并登记 known warning，非静默扩张 | APPROVED DEC-015 修订如实记录来源扩大；出口义务措辞已改（自审） | APPROVED 可派生为 TASK-068 ④⑤⑥ | APPROVED 有断言落点 TEST-070 ④-⑧；TEST-036 作废 |
| CP-21 | APPROVED 方案未引入 CP 外的可观察行为（每轮上下文预算） | APPROVED DEC-026 ④⑤⑥（自审） | APPROVED 可派生为 TASK-066 ③④⑤ | APPROVED 有断言落点 TEST-068 ④-⑦ |
| CP-22 | APPROVED 方案未引入 CP 外的可观察行为（前缀稳定+动态注册） | APPROVED DEC-026 ①②⑦（自审） | APPROVED 可派生为 TASK-064 ①②③ | APPROVED 有断言落点 TEST-066 ②③；TEST-068 ①② |
| CP-23 | APPROVED 方案未引入 CP 外的可观察行为（内核可扩展性） | APPROVED DEC-022（三注册点）（自审） | APPROVED 可派生为 TASK-064 ④ | APPROVED 有断言落点 TEST-066 ①⑤ |
| CP-24 | APPROVED 方案未引入 CP 外的可观察行为（既有条款澄清） | APPROVED 方案表 CP-24（自审） | APPROVED 可派生为 TASK-067 ③/075 ⑥ | APPROVED 有断言落点 TEST-069 ⑧；TEST-076 ⑦⑧ |
| CP-25 | APPROVED 方案未引入 CP 外的可观察行为（非目标处置） | APPROVED 总判「不安装 dsh」（自审） | APPROVED 可派生为 TASK-064 约束 | APPROVED 有断言落点 TEST-066 ⑥ grep |
| CP-26 | APPROVED 方案未引入 CP 外的可观察行为（迁移框架） | APPROVED DEC-023（自审） | APPROVED 前置任务，须先于 TASK-060 实施 | APPROVED 有断言落点 TEST-061 |
| CP-27 | APPROVED 方案未引入 CP 外的可观察行为（线协议+分片累积） | APPROVED DEC-024 ①（自审） | APPROVED A 期最大实现体，粒度已单列为 TASK-061 | APPROVED 有断言落点 TEST-063 |
| CP-28 | APPROVED 方案未引入 CP 外的可观察行为（悬空 tool_calls 回放） | APPROVED DEC-024 ④（自审） | APPROVED 可派生为 TASK-071 ④ | APPROVED 有断言落点 TEST-067 ⑧ |
| CP-29 | APPROVED 方案未引入 CP 外的可观察行为（Provider 上下文窗口） | APPROVED DEC-026 ⑤（自审） | APPROVED 可派生为 TASK-060 ②/066 ④ | APPROVED 有断言落点 TEST-068 ⑦ |
| CP-30 | APPROVED 方案未引入 CP 外的可观察行为（usage 事件与存储） | APPROVED DEC-028（自审） | APPROVED 可派生为 TASK-062/060 ③ | APPROVED 有断言落点 TEST-064；TEST-062 ① |
| CP-31 | APPROVED 方案未引入 CP 外的可观察行为（来源列表独立结构） | APPROVED 方案表 CP-31（自审） | APPROVED 可派生为 TASK-072 ① | APPROVED 有断言落点 TEST-073 ②③ |
| CP-32 | APPROVED 方案未引入 CP 外的可观察行为（能力粒度三态） | APPROVED DEC-029（自审） | APPROVED 可派生为 TASK-063 ②③ | APPROVED 有断言落点 TEST-065 ②③④ |
| CP-33 | APPROVED 方案未引入 CP 外的可观察行为（校验器可注入 resolver） | APPROVED DEC-025 可注入（自审） | APPROVED 可派生为 TASK-069 ② | APPROVED 有断言落点 TEST-071 ⑨⑩⑪ |
| CP-34 | APPROVED 方案未引入 CP 外的可观察行为（SSRF 样本集补全） | APPROVED DEC-025 规则集（自审） | APPROVED 可派生为 TASK-069 ① | APPROVED 有断言落点 TEST-071 ①-⑧ |
| CP-35 | APPROVED 方案未引入 CP 外的可观察行为（mock 模型+mock SearXNG） | APPROVED 总判（测试基建）（自审） | APPROVED 可派生为 —（测试角色） | APPROVED 有断言落点 TEST-078 ①②⑦ |
| CP-36 | APPROVED 方案未引入 CP 外的可观察行为（出网守卫） | APPROVED 方案表 CP-36 白名单（自审） | APPROVED 可派生为 —（测试角色） | APPROVED 有断言落点 TEST-072 ⑥；TEST-066 ⑤ |
| CP-37 | APPROVED 方案未引入 CP 外的可观察行为（既有 TEST 作废与反转） | APPROVED 方案表 CP-37（自审） | APPROVED 可派生为 —（测试角色） | APPROVED 有断言落点 既有测试处置表 |
| CP-38 | APPROVED 方案未引入 CP 外的可观察行为（ui-contract 三处改写） | APPROVED 方案表 CP-38（自审） | APPROVED 可派生为 TASK-076 ④ | APPROVED 有断言落点 TEST-077 ⑧ |
| CP-39 | APPROVED 方案未引入 CP 外的可观察行为（messages 行内序号） | APPROVED DEC-024 ②③（自审） | APPROVED 可派生为 TASK-060 ①⑤ | APPROVED 有断言落点 TEST-062 ③ |
| CP-40 | APPROVED 方案未引入 CP 外的可观察行为（事件类型单一来源） | APPROVED 方案表 CP-40（自审） | APPROVED 可派生为 TASK-075 ④ | APPROVED 有断言落点 TEST-076 ⑤ |
| CP-41 | APPROVED 方案未引入 CP 外的可观察行为（NF-011 执行体短路） | APPROVED DEC-026 ②（自审） | APPROVED 可派生为 TASK-064 ③/070 ④ | APPROVED 有断言落点 TEST-066 ③；TEST-072 ④ |
| CP-42 | APPROVED 方案未引入 CP 外的可观察行为（技能 name 与 slug） | APPROVED 方案表 CP-42（自审） | APPROVED 可派生为 TASK-073 ④⑤ | APPROVED 有断言落点 TEST-074 ③④⑤ |
| CP-43 | APPROVED 方案未引入 CP 外的可观察行为（show_insight 属主校验） | APPROVED 方案表 CP-43（自审） | APPROVED 可派生为 TASK-068 ③ | APPROVED 有断言落点 TEST-070 ③ |

## R3 评审矩阵

评审对象：`模块任务开发说明书.md` 的 `变更响应 · CR-20260910-agent-tooling` 节（变化点影响矩阵 + 技术设计）与新增的 TASK-059..076 任务行。行 = CP-1..CP-43，列 = 产品 / 架构 / 模块 / 测试四角色。无 REJECTED、无空格、无遗留 CONDITIONAL。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 验收动作在任务中有落点（工具循环 ≤10 步） | APPROVED 任务与 DEC-022 一致，无越界 | APPROVED 已拆为 TASK-065（内核）与 TASK-071 ①（宿主）两个任务（自审） | APPROVED 子项各自绑 TEST-067 ①-⑥ |
| CP-2 | APPROVED 验收动作在任务中有落点（技能工具化删路由） | APPROVED 任务与 DEC-016 SUPERSEDED 一致，无越界 | APPROVED 已拆为工具实现 / 删路由 / 名录预算三子项（自审） | APPROVED 子项各自绑 TEST-069；TEST-034 作废 |
| CP-3 | APPROVED 验收动作在任务中有落点（技能管理） | APPROVED 任务与 方案表 CP-3 删改顺序 一致，无越界 | APPROVED TASK-073 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-074 |
| CP-4 | APPROVED 验收动作在任务中有落点（展示屏工具化） | APPROVED 任务与 DEC-017 ⑤ 修订 一致，无越界 | APPROVED TASK-068 ①②③ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-070 ①②③；TEST-042 作废 |
| CP-5 | APPROVED 验收动作在任务中有落点（web_search） | APPROVED 任务与 DEC-027 一致，无越界 | APPROVED TASK-070 ① 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-072 ①②③ |
| CP-6 | APPROVED 验收动作在任务中有落点（搜索配置入口） | APPROVED 任务与 DEC-027 app_settings 一致，无越界 | APPROVED TASK-074 ①-④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-075 ①-⑤⑨ |
| CP-7 | APPROVED 验收动作在任务中有落点（read_url） | APPROVED 任务与 DEC-025 一致，无越界 | APPROVED TASK-069/070 ② 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-071；TEST-072 ⑤ |
| CP-8 | APPROVED 验收动作在任务中有落点（出网边界 MUST） | APPROVED 任务与 DEC-025 一致，无越界 | APPROVED TASK-069 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-071；TEST-072 ①⑥ |
| CP-9 | APPROVED 验收动作在任务中有落点（对话内步骤流） | APPROVED 任务与 ChatDelta 扩展 一致，无越界 | APPROVED 已拆为事件形状 / 步骤行组件 / 删旧提示三子项（自审） | APPROVED 子项各自绑 TEST-076 ①②③⑥⑦⑧ |
| CP-10 | APPROVED 验收动作在任务中有落点（工具落库与重建） | APPROVED 任务与 DEC-024 一致，无越界 | APPROVED TASK-060 ①⑤/071 ②③⑥ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-062；TEST-076 ④ |
| CP-11 | APPROVED 验收动作在任务中有落点（状态灯五态） | APPROVED 任务与 DEC-012 修订 一致，无越界 | APPROVED 已拆为灯态与 ui-contract 两子项（自审） | APPROVED 子项各自绑 TEST-077 ①②③⑧ |
| CP-12 | APPROVED 验收动作在任务中有落点（折叠态长任务） | APPROVED 任务与 DEC-012 修订 一致，无越界 | APPROVED TASK-076 ② 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-077 ④⑤ |
| CP-13 | APPROVED 验收动作在任务中有落点（面板分情形高度） | APPROVED 任务与 DEC-005 修订 一致，无越界 | APPROVED TASK-076 ③④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-077 ⑥⑦⑧ |
| CP-14 | APPROVED 验收动作在任务中有落点（token 用量可见） | APPROVED 任务与 DEC-028 一致，无越界 | APPROVED 已拆为 adapter 解析 / schema 列 / UI 三处（自审） | APPROVED 子项各自绑 TEST-064；TEST-075 ⑥⑦⑧ |
| CP-15 | APPROVED 验收动作在任务中有落点（来源引用） | APPROVED 任务与 方案表 CP-15 独立结构 一致，无越界 | APPROVED TASK-072 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-073 |
| CP-16 | APPROVED 验收动作在任务中有落点（Provider 能力探测） | APPROVED 任务与 DEC-029 一致，无越界 | APPROVED TASK-063/060 ② 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-065 |
| CP-17 | APPROVED 验收动作在任务中有落点（工具结果保留窗口） | APPROVED 任务与 DEC-026 ③ 一致，无越界 | APPROVED TASK-066 ② 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-068 ③ |
| CP-18 | APPROVED 验收动作在任务中有落点（REQ-F-004 重写） | APPROVED 任务与 DEC-026 ① 一致，无越界 | APPROVED TASK-066 ①/071 ③ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-068 ①② |
| CP-19 | APPROVED 验收动作在任务中有落点（循环中途停止） | APPROVED 任务与 DEC-022 signal 传入 一致，无越界 | APPROVED TASK-065 ⑥ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-067 ⑦ |
| CP-20 | APPROVED 验收动作在任务中有落点（save_insight 工具化） | APPROVED 任务与 DEC-015 修订（信任面扩大） 一致，无越界 | APPROVED TASK-068 ④⑤⑥ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-070 ④-⑧；TEST-036 作废 |
| CP-21 | APPROVED 验收动作在任务中有落点（每轮上下文预算） | APPROVED 任务与 DEC-026 ④⑤⑥ 一致，无越界 | APPROVED TASK-066 ③④⑤ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-068 ④-⑦ |
| CP-22 | APPROVED 验收动作在任务中有落点（前缀稳定+动态注册） | APPROVED 任务与 DEC-026 ①②⑦ 一致，无越界 | APPROVED TASK-064 ①②③ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-066 ②③；TEST-068 ①② |
| CP-23 | APPROVED 缩为三注册点符合用户终裁 6，未削减已批准需求 | APPROVED 任务与 DEC-022（三注册点） 一致，无越界 | APPROVED TASK-064 ④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-066 ①⑤ |
| CP-24 | APPROVED 验收动作在任务中有落点（既有条款澄清） | APPROVED 任务与 方案表 CP-24 一致，无越界 | APPROVED TASK-067 ③/075 ⑥ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-069 ⑧；TEST-076 ⑦⑧ |
| CP-25 | APPROVED 验收动作在任务中有落点（非目标处置） | APPROVED 任务与 总判「不安装 dsh」 一致，无越界 | APPROVED TASK-064 约束 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-066 ⑥ grep |
| CP-26 | APPROVED 验收动作在任务中有落点（迁移框架） | APPROVED 任务与 DEC-023 一致，无越界 | APPROVED 实施顺序硬依赖已写入技术设计（自审） | APPROVED 子项各自绑 TEST-061 |
| CP-27 | APPROVED 验收动作在任务中有落点（线协议+分片累积） | APPROVED 任务与 DEC-024 ① 一致，无越界 | APPROVED TASK-061 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-063 |
| CP-28 | APPROVED 验收动作在任务中有落点（悬空 tool_calls 回放） | APPROVED 任务与 DEC-024 ④ 一致，无越界 | APPROVED TASK-071 ④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-067 ⑧ |
| CP-29 | APPROVED 验收动作在任务中有落点（Provider 上下文窗口） | APPROVED 任务与 DEC-026 ⑤ 一致，无越界 | APPROVED TASK-060 ②/066 ④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-068 ⑦ |
| CP-30 | APPROVED 验收动作在任务中有落点（usage 事件与存储） | APPROVED 任务与 DEC-028 一致，无越界 | APPROVED TASK-062/060 ③ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-064；TEST-062 ① |
| CP-31 | APPROVED 验收动作在任务中有落点（来源列表独立结构） | APPROVED 任务与 方案表 CP-31 一致，无越界 | APPROVED TASK-072 ① 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-073 ②③ |
| CP-32 | APPROVED 验收动作在任务中有落点（能力粒度三态） | APPROVED 任务与 DEC-029 一致，无越界 | APPROVED TASK-063 ②③ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-065 ②③④ |
| CP-33 | APPROVED 验收动作在任务中有落点（校验器可注入 resolver） | APPROVED 任务与 DEC-025 可注入 一致，无越界 | APPROVED TASK-069 ② 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-071 ⑨⑩⑪ |
| CP-34 | APPROVED 验收动作在任务中有落点（SSRF 样本集补全） | APPROVED 任务与 DEC-025 规则集 一致，无越界 | APPROVED TASK-069 ① 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-071 ①-⑧ |
| CP-35 | APPROVED 验收动作在任务中有落点（mock 模型+mock SearXNG） | APPROVED 任务与 总判（测试基建） 一致，无越界 | APPROVED —（测试角色） 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-078 ①②⑦ |
| CP-36 | APPROVED 验收动作在任务中有落点（出网守卫） | APPROVED 任务与 方案表 CP-36 白名单 一致，无越界 | APPROVED —（测试角色） 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-072 ⑥；TEST-066 ⑤ |
| CP-37 | APPROVED 验收动作在任务中有落点（既有 TEST 作废与反转） | APPROVED 任务与 方案表 CP-37 一致，无越界 | APPROVED —（测试角色） 单一职责可独立回滚（自审） | APPROVED 子项各自绑 既有测试处置表 |
| CP-38 | APPROVED 验收动作在任务中有落点（ui-contract 三处改写） | APPROVED 任务与 方案表 CP-38 一致，无越界 | APPROVED TASK-076 ④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-077 ⑧ |
| CP-39 | APPROVED 验收动作在任务中有落点（messages 行内序号） | APPROVED 任务与 DEC-024 ②③ 一致，无越界 | APPROVED TASK-060 ①⑤ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-062 ③ |
| CP-40 | APPROVED 验收动作在任务中有落点（事件类型单一来源） | APPROVED 任务与 方案表 CP-40 一致，无越界 | APPROVED TASK-075 ④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-076 ⑤ |
| CP-41 | APPROVED 验收动作在任务中有落点（NF-011 执行体短路） | APPROVED 任务与 DEC-026 ② 一致，无越界 | APPROVED TASK-064 ③/070 ④ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-066 ③；TEST-072 ④ |
| CP-42 | APPROVED 验收动作在任务中有落点（技能 name 与 slug） | APPROVED 任务与 方案表 CP-42 一致，无越界 | APPROVED TASK-073 ④⑤ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-074 ③④⑤ |
| CP-43 | APPROVED 验收动作在任务中有落点（show_insight 属主校验） | APPROVED 任务与 方案表 CP-43 一致，无越界 | APPROVED TASK-068 ③ 单一职责可独立回滚（自审） | APPROVED 子项各自绑 TEST-070 ③ |

## R4 评审矩阵

评审对象：`测试说明书.md` 的 `变更响应 · CR-20260910-agent-tooling` 节（任务→测试派生矩阵 + 既有测试处置 + 测试设计）与新增的 TEST-061..078 测试行。行 = CP-1..CP-43，列 = 产品 / 架构 / 模块 / 测试四角色。无 REJECTED、无空格、无遗留 CONDITIONAL。

| CP | 产品 | 架构 | 模块 | 测试 |
|---|---|---|---|---|
| CP-1 | APPROVED 每个可观察动作逐条可验（工具循环 ≤10 步） | APPROVED 测试覆盖 DEC-022 的约束面 | APPROVED TASK-065/071 ① 绑 TEST-067 ①-⑥ | APPROVED TEST-067 ①-⑥（自审） |
| CP-2 | APPROVED 每个可观察动作逐条可验（技能工具化删路由） | APPROVED 测试覆盖 DEC-016 SUPERSEDED 的约束面 | APPROVED TASK-067 绑 TEST-069；TEST-034 作废 | APPROVED TEST-069；TEST-034 作废（自审） |
| CP-3 | APPROVED 每个可观察动作逐条可验（技能管理） | APPROVED 测试覆盖 方案表 CP-3 删改顺序 的约束面 | APPROVED TASK-073 绑 TEST-074 | APPROVED TEST-074（自审） |
| CP-4 | APPROVED 每个可观察动作逐条可验（展示屏工具化） | APPROVED 测试覆盖 DEC-017 ⑤ 修订 的约束面 | APPROVED TASK-068 ①②③ 绑 TEST-070 ①②③；TEST-042 作废 | APPROVED TEST-070 ①②③；TEST-042 作废（自审） |
| CP-5 | APPROVED 每个可观察动作逐条可验（web_search） | APPROVED 测试覆盖 DEC-027 的约束面 | APPROVED TASK-070 ① 绑 TEST-072 ①②③ | APPROVED TEST-072 ①②③（自审） |
| CP-6 | APPROVED 每个可观察动作逐条可验（搜索配置入口） | APPROVED 测试覆盖 DEC-027 app_settings 的约束面 | APPROVED TASK-074 ①-④ 绑 TEST-075 ①-⑤⑨ | APPROVED TEST-075 ①-⑤⑨（自审） |
| CP-7 | APPROVED 每个可观察动作逐条可验（read_url） | APPROVED 测试覆盖 DEC-025 的约束面 | APPROVED TASK-069/070 ② 绑 TEST-071；TEST-072 ⑤ | APPROVED TEST-071 ⑨⑩ 依赖 TASK-069 ② 的可注入 resolver，否则该样本发现不了（自审） |
| CP-8 | APPROVED 每个可观察动作逐条可验（出网边界 MUST） | APPROVED 测试覆盖 DEC-025 的约束面 | APPROVED TASK-069 绑 TEST-071；TEST-072 ①⑥ | APPROVED TEST-071；TEST-072 ①⑥（自审） |
| CP-9 | APPROVED 每个可观察动作逐条可验（对话内步骤流） | APPROVED 测试覆盖 ChatDelta 扩展 的约束面 | APPROVED TASK-075 绑 TEST-076 ①②③⑥⑦⑧ | APPROVED TEST-076 ①②③⑥⑦⑧（自审） |
| CP-10 | APPROVED 每个可观察动作逐条可验（工具落库与重建） | APPROVED 测试覆盖 DEC-024 的约束面 | APPROVED TASK-060 ①⑤/071 ②③⑥ 绑 TEST-062；TEST-076 ④ | APPROVED TEST-062；TEST-076 ④（自审） |
| CP-11 | APPROVED 每个可观察动作逐条可验（状态灯五态） | APPROVED 测试覆盖 DEC-012 修订 的约束面 | APPROVED TASK-076 ①④ 绑 TEST-077 ①②③⑧ | APPROVED TEST-077 ③ 覆盖 reduced-motion 下的可辨识性（自审） |
| CP-12 | APPROVED 每个可观察动作逐条可验（折叠态长任务） | APPROVED 测试覆盖 DEC-012 修订 的约束面 | APPROVED TASK-076 ② 绑 TEST-077 ④⑤ | APPROVED TEST-077 ④⑤（自审） |
| CP-13 | APPROVED 每个可观察动作逐条可验（面板分情形高度） | APPROVED 测试覆盖 DEC-005 修订 的约束面 | APPROVED TASK-076 ③④ 绑 TEST-077 ⑥⑦⑧ | APPROVED TEST-077 ⑥⑦⑧（自审） |
| CP-14 | APPROVED 每个可观察动作逐条可验（token 用量可见） | APPROVED 测试覆盖 DEC-028 的约束面 | APPROVED TASK-062/060 ③/074 ⑤ 绑 TEST-064；TEST-075 ⑥⑦⑧ | APPROVED TEST-064；TEST-075 ⑥⑦⑧（自审） |
| CP-15 | APPROVED 每个可观察动作逐条可验（来源引用） | APPROVED 测试覆盖 方案表 CP-15 独立结构 的约束面 | APPROVED TASK-072 绑 TEST-073 | APPROVED TEST-073（自审） |
| CP-16 | APPROVED 每个可观察动作逐条可验（Provider 能力探测） | APPROVED 测试覆盖 DEC-029 的约束面 | APPROVED TASK-063/060 ② 绑 TEST-065 | APPROVED TEST-065（自审） |
| CP-17 | APPROVED 每个可观察动作逐条可验（工具结果保留窗口） | APPROVED 测试覆盖 DEC-026 ③ 的约束面 | APPROVED TASK-066 ② 绑 TEST-068 ③ | APPROVED TEST-068 ③（自审） |
| CP-18 | APPROVED 每个可观察动作逐条可验（REQ-F-004 重写） | APPROVED 测试覆盖 DEC-026 ① 的约束面 | APPROVED TASK-066 ①/071 ③ 绑 TEST-068 ①② | APPROVED TEST-068 ①②（自审） |
| CP-19 | APPROVED 每个可观察动作逐条可验（循环中途停止） | APPROVED 测试覆盖 DEC-022 signal 传入 的约束面 | APPROVED TASK-065 ⑥ 绑 TEST-067 ⑦ | APPROVED TEST-067 ⑦（自审） |
| CP-20 | APPROVED 每个可观察动作逐条可验（save_insight 工具化） | APPROVED 测试覆盖 DEC-015 修订（信任面扩大） 的约束面 | APPROVED TASK-068 ④⑤⑥ 绑 TEST-070 ④-⑧；TEST-036 作废 | APPROVED TEST-070 ⑧ 如实记录已接受风险的实际行为，不伪装防护（自审） |
| CP-21 | APPROVED 每个可观察动作逐条可验（每轮上下文预算） | APPROVED 测试覆盖 DEC-026 ④⑤⑥ 的约束面 | APPROVED TASK-066 ③④⑤ 绑 TEST-068 ④-⑦ | APPROVED NF-007 ⑤ 已由 P2 定值获得阈值，构成断言而非仅测量（自审） |
| CP-22 | APPROVED 每个可观察动作逐条可验（前缀稳定+动态注册） | APPROVED 测试覆盖 DEC-026 ①②⑦ 的约束面 | APPROVED TASK-064 ①②③ 绑 TEST-066 ②③；TEST-068 ①② | APPROVED TEST-066 ②③；TEST-068 ①②（自审） |
| CP-23 | APPROVED 每个可观察动作逐条可验（内核可扩展性） | APPROVED 测试覆盖 DEC-022（三注册点） 的约束面 | APPROVED TASK-064 ④ 绑 TEST-066 ①⑤ | APPROVED TEST-066 ①⑤（自审） |
| CP-24 | APPROVED 每个可观察动作逐条可验（既有条款澄清） | APPROVED 测试覆盖 方案表 CP-24 的约束面 | APPROVED TASK-067 ③/075 ⑥ 绑 TEST-069 ⑧；TEST-076 ⑦⑧ | APPROVED TEST-069 ⑧；TEST-076 ⑦⑧（自审） |
| CP-25 | APPROVED 每个可观察动作逐条可验（非目标处置） | APPROVED 测试覆盖 总判「不安装 dsh」 的约束面 | APPROVED TASK-064 约束 绑 TEST-066 ⑥ grep | APPROVED TEST-066 ⑥ grep（自审） |
| CP-26 | APPROVED 每个可观察动作逐条可验（迁移框架） | APPROVED 测试覆盖 DEC-023 的约束面 | APPROVED TASK-059 绑 TEST-061 | APPROVED TEST-061（自审） |
| CP-27 | APPROVED 每个可观察动作逐条可验（线协议+分片累积） | APPROVED 测试覆盖 DEC-024 ① 的约束面 | APPROVED TASK-061 绑 TEST-063 | APPROVED TEST-063（自审） |
| CP-28 | APPROVED 每个可观察动作逐条可验（悬空 tool_calls 回放） | APPROVED 测试覆盖 DEC-024 ④ 的约束面 | APPROVED TASK-071 ④ 绑 TEST-067 ⑧ | APPROVED TEST-067 ⑧（自审） |
| CP-29 | APPROVED 每个可观察动作逐条可验（Provider 上下文窗口） | APPROVED 测试覆盖 DEC-026 ⑤ 的约束面 | APPROVED TASK-060 ②/066 ④ 绑 TEST-068 ⑦ | APPROVED TEST-068 ⑦（自审） |
| CP-30 | APPROVED 每个可观察动作逐条可验（usage 事件与存储） | APPROVED 测试覆盖 DEC-028 的约束面 | APPROVED TASK-062/060 ③ 绑 TEST-064；TEST-062 ① | APPROVED TEST-064；TEST-062 ①（自审） |
| CP-31 | APPROVED 每个可观察动作逐条可验（来源列表独立结构） | APPROVED 测试覆盖 方案表 CP-31 的约束面 | APPROVED TASK-072 ① 绑 TEST-073 ②③ | APPROVED TEST-073 ②③（自审） |
| CP-32 | APPROVED 每个可观察动作逐条可验（能力粒度三态） | APPROVED 测试覆盖 DEC-029 的约束面 | APPROVED TASK-063 ②③ 绑 TEST-065 ②③④ | APPROVED TEST-065 ②③④（自审） |
| CP-33 | APPROVED 每个可观察动作逐条可验（校验器可注入 resolver） | APPROVED 测试覆盖 DEC-025 可注入 的约束面 | APPROVED TASK-069 ② 绑 TEST-071 ⑨⑩⑪ | APPROVED TEST-071 ⑨⑩⑪（自审） |
| CP-34 | APPROVED 每个可观察动作逐条可验（SSRF 样本集补全） | APPROVED 测试覆盖 DEC-025 规则集 的约束面 | APPROVED TASK-069 ① 绑 TEST-071 ①-⑧ | APPROVED TEST-071 ①-⑧（自审） |
| CP-35 | APPROVED 每个可观察动作逐条可验（mock 模型+mock SearXNG） | APPROVED 测试覆盖 总判（测试基建） 的约束面 | APPROVED —（测试角色） 绑 TEST-078 ①②⑦ | APPROVED TEST-078 ①②使两条主路径在无真实 SearXNG 下可跑；真实后端降人工冒烟（自审） |
| CP-36 | APPROVED 每个可观察动作逐条可验（出网守卫） | APPROVED 测试覆盖 方案表 CP-36 白名单 的约束面 | APPROVED —（测试角色） 绑 TEST-072 ⑥；TEST-066 ⑤ | APPROVED TEST-072 ⑥；TEST-066 ⑤（自审） |
| CP-37 | APPROVED 每个可观察动作逐条可验（既有 TEST 作废与反转） | APPROVED 测试覆盖 方案表 CP-37 的约束面 | APPROVED —（测试角色） 绑 既有测试处置表 | APPROVED 3 条作废 + 15 组反转/校准已逐条登记，gate g3 不再索要作废证据（自审） |
| CP-38 | APPROVED 每个可观察动作逐条可验（ui-contract 三处改写） | APPROVED 测试覆盖 方案表 CP-38 的约束面 | APPROVED TASK-076 ④ 绑 TEST-077 ⑧ | APPROVED TEST-077 ⑧（自审） |
| CP-39 | APPROVED 每个可观察动作逐条可验（messages 行内序号） | APPROVED 测试覆盖 DEC-024 ②③ 的约束面 | APPROVED TASK-060 ①⑤ 绑 TEST-062 ③ | APPROVED TEST-062 ③（自审） |
| CP-40 | APPROVED 每个可观察动作逐条可验（事件类型单一来源） | APPROVED 测试覆盖 方案表 CP-40 的约束面 | APPROVED TASK-075 ④ 绑 TEST-076 ⑤ | APPROVED TEST-076 ⑤（自审） |
| CP-41 | APPROVED 每个可观察动作逐条可验（NF-011 执行体短路） | APPROVED 测试覆盖 DEC-026 ② 的约束面 | APPROVED TASK-064 ③/070 ④ 绑 TEST-066 ③；TEST-072 ④ | APPROVED TEST-066 ③；TEST-072 ④（自审） |
| CP-42 | APPROVED 每个可观察动作逐条可验（技能 name 与 slug） | APPROVED 测试覆盖 方案表 CP-42 的约束面 | APPROVED TASK-073 ④⑤ 绑 TEST-074 ③④⑤ | APPROVED TEST-074 ③④⑤（自审） |
| CP-43 | APPROVED 每个可观察动作逐条可验（show_insight 属主校验） | APPROVED 测试覆盖 方案表 CP-43 的约束面 | APPROVED TASK-068 ③ 绑 TEST-070 ③ | APPROVED TEST-070 ③（自审） |

**R2/R3/R4 结果**：CP-1..CP-43 × 4 角色 **全 APPROVED，无 REJECTED、无空格、无遗留 CONDITIONAL**。R1 阶段四角色的 CONDITIONAL 条件已在 P2 全部成文：产品的 7 项经人工终裁回写需求说明书；架构的 8 项落为 DEC-022..029 与 DEC-005/012/015/016/017 的修订作废；模块的 9 项落为 TASK-059..076 的粒度拆分与实施顺序（TASK-059 → TASK-060 → 其余）；测试的 7 项落为 TEST-061..078 与「既有测试处置」表（3 条作废、15 组反转/校准）。

**P3 出口义务清单（实现前逐条清零）**：① `src/lib/tools/url-guard.ts` 与 `budget.ts` 不得 import `node:fs`（grep 守卫，并入 TEST-071 ⑫ / TEST-068）；② 对话核心不得 import 具体工具模块（grep 守卫，TEST-066 ⑤）；③ 无 subagent / sandbox / shell 类工具注册（grep 守卫，TEST-066 ⑥）；④ `package.json` `dependencies` 逐字不变；⑤ TASK-059 迁移框架必须先于 TASK-060 六处 schema 变更实施，且每条迁移 `up`/`down` 齐备（TEST-061 ②③）；⑥ REQ-F-025 ② 提示条覆盖经 `save_insight` 上屏的全部 HTML（TEST-070 ⑦）；⑦ 既有 TEST-001..060 全部重跑，其中 3 条作废项在 `test-results.json` 标 `superseded`、15 组反转项按新逻辑校准（TEST-037 表）。
