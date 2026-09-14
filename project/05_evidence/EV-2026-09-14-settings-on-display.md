# EV-2026-09-14-settings-on-display

- 来源: 用户 2026-09-13 答复 `CR-20260911-display-console-ux` 第 3 项待终裁：「支持会话框调出菜单内嵌表单，如模型，技能，工具等在动态屏」（INPUT-2026-09-13-027）
- 时间: 2026-09-14
- 采集者: 助手（claude-opus-5），本机执行
- 支撑对象: `CR-20260914-settings-on-display`（REQ-F-200；DEC-240、TASK-330、TEST-330）；同时根治 `CR-20260913-ratify-pending` 第 8、10 两项「过渡追认」
- 可定位路径: 本文件；`src/lib/ui-events.ts`、`src/components/FloatingChat.tsx`、`src/components/DisplayScreen.tsx`、`src/components/ToolPanel.tsx`、`src/app/api/tools/route.ts`、`src/lib/tools/registry.ts`、`tests/settings-on-display.test.tsx`

## 1. 控制台让位，不是分栏

报告被控制台盖住约 78%，这件事 2026-09-12 只做了纵向缓解（面板高度上限 75vh → 58vh），当时如实登记为「仅追认为过渡」，用户 2026-09-13 又提了一次。

分栏（报告与控制台各占一边）要改掉 REQ-F-090 ①「列宽 0.68、水平居中」，还要处理面板开合时报告是否跟着位移——**动的面比这个问题本身大得多**。

实际做法：控制台用 `ResizeObserver` 把**实测高度**发布成 `--jarvis-console-h`，展示屏的报告、看板、设置面板都以它作为下边界。控制台的形状、位置、浮动感一个都没变，只是它占的那块高度从展示屏可用区里减掉了，于是**没有任何一块内容再被压住**。

用实测值而不是常量，是因为那个高度有四五种状态：记录区展开、悬停收缩、步骤流几条、有没有错误行。写死一个数，总有一种状态对不上——看板此前正是靠写死的 `pb-36` 躲它。

## 2. 工具面板：把只有模型知道的事说给人听

工具是按可用性动态注册的（REQ-NF-008 ④）。此前这件事只有模型知道：用户既看不到系统一共有哪些能力，也看不到某一个这轮为什么不在。**看不见的能力等于不存在**——这正是本轮几个缺陷的共同形状。

判定必须与对话走同一条路：`/api/tools` 调的是 `runChatTurn` 用的**同一个** `buildRegistry` 与同一份 `ToolContext`。另写一份近似判定，迟早分岔，分岔那天用户看到的就是一份假名单。

## 3. 真实入口（2026-09-14，用户自己那台服务器，端口 3000）

生产构建 + `serve:local`，`node scripts/check-dev-server.mjs` → `PASS served build matches HEAD (591cd471)`。

```
$ curl -s http://localhost:3000/api/tools
登记工具共 24 个
本轮可调用 23 : list_skills, read_skill, search_skills, show_home, show_board, show_insight,
               save_insight, web_search, read_url, search_knowledge, read_knowledge,
               save_knowledge, ingest_url, list_knowledge, list_entities, read_entity,
               propose_entity, propose_entity_update, fetch_source, extract_fields,
               search_documents, read_document, list_documents
未注册 1 : archive_insight
判定条件: {"skillCount": 7, "webEnabled": true, "searchConfigured": true,
          "knowledgeCount": 8, "contextWindow": 128000, "providerName": "DeepSeek"}
```

这一条同时验到了两件事：

1. **注册判定是真的**：`archive_insight` 未注册，因为归档目录当前没配（`CR-20260914-insight-dual-output` 的真实入口验完已把设置恢复原状）。这不是构造出来的用例，是此刻这台机器的真实状态。
2. **新界面真的被服务出去了**：首页 HTML 里能 grep 到 `在屏上打开` 与 4 处 `floating-chat__panel`——三个入口按钮加容器。

## 4. 单测（8 例，全绿）

`npx vitest run tests/settings-on-display.test.tsx` → 8 passed。

有鉴别力的两条：

- **⑥ 未注册的工具要落在「未注册」那一组里**，不只是「出现在页面上」。只断言后者的话，一个把两组混在一起显示的实现照样全绿，而那恰恰抹掉了这个面板的全部意义。
- **④ 服务未就绪时明说打不开**，而不是画一个存不了的空表单。

## 5. 没有验到的（如实登记）

- **CP-4 的观感**：单测只能断言那个 CSS 变量被用上了，断言不了「展开对话之后报告看着舒不舒服」。这要连着用几天才判得了，**登记为人工发现项**。
- **`ResizeObserver` 在 jsdom 里不存在**，所以「发布高度」那一侧在组件测里根本不执行；断言落在消费侧。这条差别写在明处，不用「测过了」含糊过去。
- **浏览器里点那三个入口这一下没做**。验的是事件到面板的接线（组件测）与服务器真的把按钮发出来了（HTML 实测），中间那一下由 `SETTINGS_PANEL_EVENT` 连接，两端都有断言。
