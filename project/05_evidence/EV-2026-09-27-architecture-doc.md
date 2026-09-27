# EV-2026-09-27-architecture-doc

- 来源: 用户 2026-09-27「给出这个项目的架构图。」→ 协调会话绘制并发布可分享页面 → 用户「帮我保存到项目里，当新功能或者新重构变化后，更新这个架构图。」（INPUT-2026-09-27-001）
- 时间: 2026-09-27
- 采集者: 协调会话（claude），分支 `cr/20260927-architecture-doc`；不改运行时代码、不碰数据
- 支撑对象: `CR-20260927-architecture-doc` CP-1..CP-4
- 可定位路径: 本文件；`docs/ARCHITECTURE.md`、`tests/architecture-doc.test.ts`、`CLAUDE.md`「六、交付纪律」

## 1. 绘图依据（决定了图上有什么）

架构图按**当前代码与部署**绘制，不照抄说明书：`src/lib`（39 个模块）、`src/lib/tools`（10 个）、`src/components`（24 个顶层组件 + `ui/` primitives）、`src/app/api/**/route.ts`（36 条路由）、`package.json` 运行依赖（17 个）与 `requirements.txt`（2 个 Python 包）、`railpack.json`、`scripts/serve-local.mjs`，以及架构设计说明书「模块边界」表与 DEC-001..430、2026-09-19（Railway）与 09-26（写入确认 + 操作记录）两次真实入口记录。

对照说明书时发现「技术栈与部署形态」「总体架构」两节与现状漂移（仍写交互开发为唯一形态、无公网部署、身份走 `JARVIS_TEST_USER_ID`、运行依赖只有三个；模块表缺资料库 / 文档排版 / 操作记录 / 技能提议），如实写进文档第 5 节，校正另立纯文档 CR。

## 2. 形式取舍

- **Markdown + mermaid 而不是 HTML**：GitHub 直接渲染 mermaid，diff 可评审；可分享页面（Artifact）由它派生，链接写在文首。
- **守卫放在 vitest 而不是 `governance.py`**：治理脚本零 `src/` 依赖是既定边界；vitest 守卫已在全量测试与 `verify:all` 内，效果相同。清单全部从文件系统与源码枚举（`readdirSync`、递归路由、`CREATE TABLE IF NOT EXISTS` 正则、`package.json` / `requirements.txt` 解析），不手写。
- **守卫只证明名字出现**：层与箭头是否画对由评审承担，维护规则写明"先改图再改附录清单"，防止把守卫当成终点。
- **CLAUDE.md 一条纪律**：触发条件（模块 / 路由 / 表 / 依赖 / 部署形态）、顺序、收尾动作（更新文首日期与提交号、重新发布页面）。

## 3. 机器证据（本地实际执行）

| 用例 | 文件 | 条数 | 守住的事 |
|---|---|---|---|
| TEST-560 | `tests/architecture-doc.test.ts` | 6 | ①39 + 10 个模块名出现；②24 个顶层组件名出现；③36 条 `/api/...` 路由出现；④10 张表出现；⑤17 个 npm 依赖 + 2 个 Python 包出现；⑥文首 `截至 2026-09-27`、main `16a3e5b`、「## 6. 维护规则」与测试文件名存在 |

`npx vitest run tests/architecture-doc.test.ts`：**6/6**（15 ms）。`npx tsc --noEmit`：**0 错误**。

`npx vitest run`（全量，2026-09-27 本机）：103 文件 / **952 例全部通过**（较上一 CR 增 1 文件、6 例）。

## 4. 真实入口

无——本 CR 不改任何用户可见行为，CP 表无真实入口路线；守卫测试本身即发现方式。

## 5. 局限（如实登记）

- 守卫是清单式的：能挡住"新增模块没写进图"，挡不住"写进了附录但没画在正确的层"。
- 可分享页面不会自动随文档更新，改后要在协调会话里重新发布同一链接。
- 说明书「技术栈与部署形态」一节的漂移仍在，待另立 CR。
