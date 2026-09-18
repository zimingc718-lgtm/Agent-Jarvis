# CR-20260915-unified-upload-entry

- 级别: L2（单一 CP，双向门，机器（UI）检查发现——快车道；`机器（UI）` 标记要求真的驱动过控件才算过）
- 提出人: 用户，INPUT-2026-09-15-029 第 6 条（"上传文件夹，上传zip，还没合并在一起"），投入实现前就 UI/内容分类两种读法另行确认，见 INPUT-2026-09-17-003
- 状态: CLOSED（闭环完成：真实入口探针在生产构建上 PASS（含两条真实系统文件选择器交互、文件夹一侧真实注册+清理一次技能），45 个相关单测 + 全量 832 个前端单测 + 治理单测全通过，check-ui-route/check-module-graph/check-index 等全部 PASS；2026-09-17 合入 main 后收口）
- 占用 ID: DEC-346, TASK-451, TEST-451
- 评审模型: 快车道（DEC-021 ①：单一 CP 双向门且有机器检查）
- 影响需求: **修订** REQ-F-020（新增 ⑧）
- 影响模块: MOD-CHAT-UI（`src/components/FloatingChat.tsx`）
- 影响任务: **新增** TASK-451
- 影响测试: **新增** TEST-451
- 当前证据: `project/05_evidence/EV-2026-09-15-unified-upload-entry.md`
- 方案选项:
  - A. **只做视觉合并**（用 CSS 把两个按钮挤在一起，或隐藏其中一个的文字）——否决。不能提供菜单该有的键盘导航（方向键/Enter/Esc）与 `role="menu"`/`role="menuitem"` 语义，等于用视觉上的"合并"换掉了无障碍能力，与用户当初新增这两个按钮的理由（REQ-F-020 ①注释：拖放对键盘用户不可用）矛盾。
  - B. **手搓一个与 `CornerMenu.tsx` 同款的受控 disclosure**——否决。`CornerMenu` 是纯展开/收起，没有"打开后选一项、选完关闭"的菜单语义；本仓库已经装了 `@radix-ui/react-dropdown-menu`（shadcn 脚手架自带，此前零处使用），硬套 `CornerMenu` 的模式等于重新发明已经装好的轮子。
  - C. **单个 `DropdownMenuTrigger` + `DropdownMenuContent`，两个 `DropdownMenuItem` 各自触发既有的隐藏 `<input>`**（选中）：控制台常驻按钮从两个收敛为一个（"上传"），点击展开菜单给出"文件夹"/"zip 压缩包"两个选项；两个隐藏的 `<input type=file>` 与其 `onChange` 处理器原样不动，菜单只是换了一种方式触发同一次 `.click()`——不新开任何写入口，不改变已注册技能的存储或校验逻辑。
- 选择理由: 选 C。①`@radix-ui/react-dropdown-menu` 已是项目依赖，不算新增（L1 级别的变更，不是 L3 引依赖）；②Radix 自带完整的键盘导航与 ARIA 语义，保留了用户当初要求这两个按钮存在的无障碍理由；③改动范围严格限定在触发方式——两个隐藏 input 和它们各自的 `onChange` 处理器、以及背后整条 `submitSkillUpload` → `/api/skills` → `registerSkill` 的注册链路完全不碰，风险面不扩大。
- 回滚方式: `git revert` 本 CR 的提交，`FloatingChat.tsx` 回到两个并列按钮；`tests/setup.ts` 的 `PointerEvent` polyfill可以保留（对其它场景无害，是通用的测试环境修复，不是本 CR 专属）也可以一并回滚，不影响功能代码。
- 验收条件:
  - R1: 本文件有 `## 变化点登记` 表 + 结构化签置行；`check-doors` PASS；`review r1` PASS。
  - 快车道不产出 R2/R3/R4 矩阵；三层说明书各含 `变更响应 · CR-20260915-unified-upload-entry` 节落点。
  - P3/P4: TASK-451 DONE；TEST-451 PASS；`check-ui-route` 对本 CR 的 `机器（UI）` 路线 PASS。
  - **真实入口**：用户自己那台（`npm run build:local && npm run serve:local`，端口 3000）——旧的"上传文件夹"/"上传 zip"两个按钮不再出现，新的"上传"入口点击后菜单两个选项都出现；点"文件夹"真的弹出系统的文件夹选择器，选一个真实一次性目录后真的注册出技能（探针随后用既有删除入口清理，不留痕迹）；点"zip 压缩包"真的弹出系统的文件选择器。
- 评审记录: 快车道。唯一 CP 能被单测（`fireEvent.keyDown` 驱动的键盘打开）+ 真实入口（含两条真实系统选择器交互）直接核验。
- R1 终裁: 已完成 | 用户 | 2026-09-15

## 问题经过

用户在 INPUT-2026-09-15-029 第 6 条指出："上传文件夹，上传zip，还没合并在一起。"

投入实现前的代码核对发现：`handleFolderPicked`/`handleArchivePicked` 两个处理器早就统一调用同一个 `submitSkillUpload` 函数，再统一 POST 到同一条 `/api/skills`——**后端从一开始就是合并的**。真正"没合并在一起"的是前端呈现：控制台上是两个并列常驻的按钮，逼用户在点击前就先选好"我要传的是文件夹还是 zip"，而不是先点一个"上传"、再在弹出的菜单里选类型。

由于这个发现直接推翻了"文件夹/zip 上传还没合并"字面上最容易联想到的"内容分类未合并"读法（尤其是 CR-20260915-knowledge-library-merge 刚做完知识库/资料库的分类整理，两件事容易被联想到一起），这一处在投入实现前专门向用户确认了一次（INPUT-2026-09-17-003），用户裁定为 UI 层面的入口合并。

## 变化点登记

| CP | 来源角色 | 一句话 | 关联 ID | 类型 | 门 | 发现方式 |
|---|---|---|---|---|---|---|
| CP-1 | 产品 | **上传入口收敛为一个按钮**：控制台的"上传文件夹"/"上传 zip"两个并列按钮，改为一个"上传"按钮展开的下拉菜单（`DropdownMenuItem` 分别为"文件夹"/"zip 压缩包"），点击后仍各自触发原有的隐藏 `<input type=file>`，注册链路完全不变 | REQ-F-020 ⑧, DEC-346, TASK-451, TEST-451 | 修订 | 双向 | 机器（UI）：TEST-451（`fireEvent.keyDown` 驱动键盘打开菜单、`aria-expanded` 翻转）+ 真实入口：`scripts/probe-unified-upload-entry.mjs`（真实浏览器点击，含两条真实系统文件选择器交互） |

## 非目标（如实登记）

- 不改变文件夹/zip 上传各自的内容分类或校验逻辑——两个隐藏 `<input>` 触发的仍是同一套既有的技能注册链路（`submitSkillUpload` → `POST /api/skills` → `registerSkill`），本 CR 不碰。
- 不新增"上传知识库文档"或"上传资料库集合"之类的新目标——投入实现前已就此与用户确认过范围仅限 UI 层面的入口合并（INPUT-2026-09-17-003），不做超出这个范围的内容路由改动。
- 拖放上传（`handleDrop`/`classifyDrop`）不受影响——那条路径本来就不经过这两个按钮，本 CR 没有改动它。

## 流程偏差记录（如实登记）

无。本 CR 从一开始就先建分支（`git switch -c cr/20260915-unified-upload-entry main`）再落地实现，没有发生过直接提交到 `main` 的情况。

单测环节确实遇到并解决了一处非本 CR 独有的测试环境缺口：`tests/setup.ts` 此前只垫了 `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture` 等方法，没有垫 `PointerEvent` 构造函数本身——这是仓库里第一次有测试用到 Radix 的弹出层组件（`@radix-ui/react-dropdown-menu`），此前没人踩到过。已在 `tests/setup.ts` 补一个继承 `MouseEvent` 的最小 `PointerEvent` polyfill，供任何未来测试 Radix 弹出层的用例复用，不是本 CR 的一次性权宜写法，因此没有单独另开一条 CP，直接记在 DEC-346 里。
