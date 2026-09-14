# EV-2026-09-13-console-decisions

- 来源: 用户 2026-09-13 逐条答复 `CR-20260911-display-console-ux` 的五项待人工终裁（原文见 INPUT-2026-09-13-027）
- 时间: 2026-09-13
- 采集者: 助手（claude-opus-5），本机执行
- 支撑对象: `CR-20260913-console-decisions`（REQ-F-050、REQ-F-052、REQ-F-053、REQ-F-054 ⑨⑩；TASK-092、TEST-031 ⑤）
- 可定位路径: 本文件；`src/components/FloatingChat.tsx`、`tests/floating-chat.test.tsx`、`project/01_specification/产品需求说明书.md`

## 1. 五项裁定

| # | 待裁项 | 裁定 | 落点 |
|---|---|---|---|
| 1 | 追加语义：`save_insight + insightId` 还是新开 `append_insight` | 同意现状 | REQ-F-050 定稿，不扩大模型可见的工具面 |
| 2 | 洞察产物 HTML 还是 Markdown | **两个都要**，并存进本地文档库 | 新需求，另立 `CR-20260913-insight-dual-output` |
| 3 | 搜索设置改对话框入口 | **设置类界面放到动态屏**，由对话框唤起 | 新需求，另立 `CR-20260913-settings-on-display` |
| 4 | 悬停时值交架构按实测调 | 取消，维持现值 | REQ-F-054 ②⑧ 定稿 |
| 5 | 收缩后留不留消息预览 | 不留 | REQ-F-054 ⑨ 确认 |
| 5b | —（用户新提）回到对话框要停在最新一条 | 采纳 | REQ-F-054 ⑩，本 CR 修掉 |

## 2. 5b 是一个真缺陷，不是偏好

收起对话面板会把记录区**从 DOM 移除**（REQ-F-019 ②：长任务下不占内存、不进无障碍树）。再展开是一次重新挂载，滚动位置从 0 起算。而此前的滚动效果只依赖 `messages`：

```ts
useEffect(() => { ...scrollTo({ top: el.scrollHeight }) }, [messages]);
```

收起再展开时消息**没有变化**，这个效果根本不会再跑。于是用户每次回到对话框，看到的是最早的一条，要自己往下滚到头。

修法是一行依赖：`[messages, showTranscript, transcriptVisible]`。节点重新挂上之后再滚一次。

**悬停自动收缩（`autoHidden`）不受影响**——它不移除 DOM，只是 `max-height: 0`，滚动位置本就保留。这也是为什么这条缺陷只在手动收起/展开的路径上出现。

## 3. 先红后绿（TEST-031 ⑤）

jsdom 不实现滚动，所以断言记录的是调用本身：把 `HTMLElement.prototype.scrollHeight` 钉成 4321、`scrollTo` 换成收集器，然后点「展开对话」。

- **改前**：`AssertionError: expected [] to include 4321` —— 一次都没滚。
- **改后**：37 例全绿。

一条只证明「展开后还能看见消息」的断言对这次修复没有任何鉴别力：改前改后都看得见，区别只在停在哪一条。

## 4. 局限

- **没有做「用户往上翻时不强行拉回底部」**。当前行为是每条新消息都滚到底，与改动前一致；用户这次要的是「回到对话框停在最新」，不是滚动跟随策略。真要做，需要先判定「用户是否主动离开了底部」，属另一个改动。
- 本条改动**不影响** REQ-F-019 ② 的移除语义：记录区照旧在收起时离开 DOM。
