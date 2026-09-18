# EV-2026-09-15-unified-upload-entry

- 来源: 用户 INPUT-2026-09-15-029 第 6 条（"上传文件夹，上传zip，还没合并在一起"），范围经 INPUT-2026-09-17-003 确认为 UI 层面
- 时间: 2026-09-15（需求提出）–2026-09-17（实现、说明书落点、机器证据与真实入口核对）
- 采集者: 助手（claude-sonnet-5），在本仓库真实工作树上执行；真实入口部分在用户自己那台服务器（端口 3000）
- 支撑对象: `CR-20260915-unified-upload-entry` CP-1
- 可定位路径: 本文件；`src/components/FloatingChat.tsx`、`tests/setup.ts`（`PointerEvent` polyfill）、`tests/floating-chat.test.tsx`、`tests/e2e/skills-display.spec.ts`、`scripts/probe-unified-upload-entry.mjs`

## 1. 现场核对：后端早就合并了，没合并的是前端呈现

投入实现前核对 `src/components/FloatingChat.tsx`：`handleFolderPicked`/`handleArchivePicked` 两个处理器（分别绑定"上传文件夹"/"上传 zip"两个按钮）都只做了一件事——组一个 `FormData` 后调用同一个 `submitSkillUpload`，再统一 `POST /api/skills`。拖放路径（`handleDrop` → `classifyDrop`）对 folder/archive 两种投递也走同一个函数。**唯一没合并的是控制台上的呈现**：两个并列常驻按钮，逼用户点击前先选好类型。

这个发现直接推翻了"内容分类未合并"的字面联想（尤其紧接在 `CR-20260915-knowledge-library-merge` 的知识库/资料库分类整理之后），因此在投入实现前专门用 `AskUserQuestion` 向用户确认了范围，用户裁定为 UI 层面的入口合并（INPUT-2026-09-17-003）。

## 2. 机器证据

| 用例 | 条数 | 守住的事 |
|---|---|---|
| `floating-chat.test.tsx` ③b（新增） | 1 | 折叠态只有一个「上传」按钮，两个旧按钮不再出现；键盘 Enter 打开菜单，`aria-expanded` 从 `false` 翻转到 `true` |

`npx vitest run tests/floating-chat.test.tsx`：**45 个用例全绿**。`npx tsc --noEmit`：0 错误。全量 `npx vitest run`：**90 个测试文件、832 个用例全绿**（较 CR-F 收口时的 831 增 1，与本 CR 新增的 1 个用例一致）。过程中出现过两次与本 CR 无关的偶发失败（`floating-chat.test.tsx` 里既有的用例④在整套并行跑时超时一次；另一次是 vitest worker 自身的 RPC 超时），单独重跑该文件与再跑一次全量均未复现，判定为并发压力下的资源竞争，不计入本 CR 的验收依据。`node scripts/check-module-graph.mjs`：0 环、0 违规。`node scripts/ui-contract.mjs`：53 项全过。`check-ui-route`：本 CR 的 `机器（UI）` 路线 PASS（8 条中的新一条）。`check-tables`/`check-doors`/`check-ids`/`check-specs`/`check-changes`/`check-index`：均 PASS。`review r1`/`r2` PASS（快车道，矩阵豁免）。

**测试环境的一处修复（非本 CR 专属，如实记在此处）**：`tests/setup.ts` 此前只垫了 Radix 需要的 `hasPointerCapture` 等方法，没垫 `PointerEvent` 构造函数本身——jsdom 完全没有这个全局，`@testing-library/dom` 的 `fireEvent.pointerDown` 因此退化成丢失 `button`/`ctrlKey` 字段的普通 `Event`，Radix 菜单的开合判定永远拿不到匹配。已加一个继承 `MouseEvent` 的最小 polyfill；本 CR 的单测最终改用键盘（`fireEvent.keyDown`）驱动，不再依赖这个 polyfill，但保留它是因为它对任何未来测试 Radix 弹出层组件的用例都通用。

**Radix Portal 菜单内容在 jsdom 里的可查询性不稳定**：多次尝试让单测一路点到菜单项（`fireEvent.click` 在 pointerdown 或 keydown 打开菜单后再点选项）都遇到不稳定的超时或元素查不到的问题，即使菜单本身确认已经打开（`aria-expanded="true"`、`data-state="open"`）。真实 Chromium 里同样的交互稳定可查、多次复现无异常（见下节），判定为 jsdom 环境本身的局限，不是产品缺陷——单测因此如实收窄到「键盘能打开、状态正确翻转」，选项点击的完整链路交给真实入口核验。

## 3. 真实入口（用户自己那台，端口 3000）

`npm run build:local` 重建 `.next-prod`（期间一次因构建缓存损坏而报 `TypeError: Cannot read properties of undefined (reading 'length')`，`rm -rf .next-prod` 后重建即正常——与本 CR 代码无关，是已知的构建缓存问题），停掉旧进程，等 `serve:local` 的看护自动拉起新进程，`curl http://localhost:3000/api/knowledge` 确认 200，并核对 `.next-prod/BUILD_ID` 时间戳晚于最近一次源码修改后开始（[[rebuild-and-restart-after-changes]] 记录的教训，这次照做）。

`node scripts/probe-unified-upload-entry.mjs`：

```
旧按钮已消失：文件夹=true，zip=true；新入口「上传」出现=true
点击「上传」后菜单两个选项都出现=true
点击「文件夹」触发了系统文件选择器=true，选完真的注册出技能=true（name=probe-folder-upload）
点击「zip 压缩包」触发了系统文件选择器=true
清理探针技能「probe-folder-upload」：已删除
PASS 上传入口已收敛为一个按钮，菜单两个选项各自可用且选完确实生效
```

采集时间 2026-09-17（本地服务器，端口 3000）。探针对文件夹一侧走完整链路（自建一次性小目录 → 选择 → 真实调用模型生成 SKILL.md → 注册 → 核对 `/api/skills` 响应体拿到服务端实际分配的 `name` → 用该 `name` 调用既有 `DELETE /api/skills/<name>` 清理），验证完毕后核对 `/api/skills` 列表确认无残留；zip 一侧只核对触发了正确的系统选择器，不重复走一遍模型调用（那条注册链路本身已由既有的 `CR-20260910-skill-intake` 真实入口覆盖，未受本次 UI 改动影响）。

**过程记录（如实登记）**：清理步骤第一版按"探针传入的文件夹名"猜测服务端记录的技能名（如 `probe-upload-entry-skill`），删除报 404——服务端记录的 `name` 来自模型生成的 `SKILL.md` frontmatter，不是文件夹名本身（这一次模型给的是 `probe-folder-upload`，与传入的文件夹名不同）。改为监听真实的 `POST /api/skills` 响应、直接读响应体里的 `name` 字段后，清理稳定成功。

`tests/e2e/skills-display.spec.ts` 里既有的一条 zip 上传用例（`page.getByRole("button", {name: "上传 zip"}).click()`）已同步改为两步点击（"上传" → 菜单项"zip 压缩包"）。尝试真实运行时在到达这段代码之前就因一个无关的既有缺陷失败（见「局限」一节），因此这处改动本身未经端到端验证，只做了静态核对——新写法与 `scripts/probe-unified-upload-entry.mjs` 已经用真实浏览器核对过的交互链路完全一致（同样先点"上传"、再点菜单项）。未单独重跑整个 Playwright e2e 套件（该套件需要真实 Provider 与更长的运行时间，超出本次收口的必经路径）。

## 4. 局限（如实登记）

- 单测未覆盖到"点击菜单项确实触发了对应隐藏 input 的 click()"这一步的直接断言（原计划用 `vi.spyOn` 验证，因 jsdom 环境下 Radix 菜单内容查询不稳定而放弃）——由真实入口探针补足，且探针走的是比 spy 更彻底的验证（选完真的注册出技能，不只是"触发了 click"）。
- `tests/e2e/skills-display.spec.ts` 尝试真实运行过（`npx playwright test tests/e2e/skills-display.spec.ts`），在到达本 CR 改动的那段代码**之前**就失败了：共用的 `configureProvider(page)` 辅助函数里 `page.getByRole("button", { name: "模型" }).click()`（第 148 行）撞上 strict-mode 冲突，页面上同时存在两个可访问名都是"模型"的按钮。用 `git stash` 去掉本 CR 的全部改动后同一条命令原样复现同一个错误，且本 CR 的 diff 里不含任何"模型"字样——确认是与本 CR 无关的既有缺陷，很可能是另一条较晚的 CR 在页面别处新增了第二个"模型"按钮、没有同步更新这个共享 e2e 辅助函数。如实记在此处，留给日后单独的 CR 处理，本 CR 不顺手改（改了会让这条证据记录的改动范围失真）。
