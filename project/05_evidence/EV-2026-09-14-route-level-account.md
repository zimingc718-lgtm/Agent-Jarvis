# EV-2026-09-14-route-level-account

- 来源: 助手 2026-09-14 在一天之内第三次撞到同一个盲区；用户同日「继续」授权
- 时间: 2026-09-14
- 采集者: 助手（claude-opus-5），本机执行
- 支撑对象: `CR-20260914-route-level-account`（DEC-300、TASK-380、TEST-380）
- 可定位路径: 本文件；`tools/governance.py`、`tests/test_governance.py`、`docs/CONTROLS.md`、三条被迁移的变更记录

## 1. 同一个盲区，一天三次

| 撞到的时刻 | 记录 | 发生了什么 |
|---|---|---|
| 下午 | `CR-20260912-technical-spine` | 我给看板测试登记真实入口证据，它当场从「未执行」名单里消失——两者共用 TEST-123，而它自己声明的（三态够不够用）一次都没跑过 |
| 傍晚 | `CR-20260912-turn-budget-continue` | 四条路线跑掉三条，剩下的 CP-4 在账本里消失 |
| 夜里 | `CR-20260911-scheduled-sweep` | 跑通服务端那一半，客户端 tick 与「会不会被当爬虫」两条也消失 |

前一次（DEC-250）修的是「靠**别人**的证据过门」。这一次是同一形状的另一半：**靠自己另一条路线的证据过门**。

根子都在 `if ran:` 这一个分支——它一成立，记录里写的「仅剩 CP-4」在机器输出里一个字都不会出现。

## 2. 它逼人做的那个选择

想让剩下的那条可见，只剩一个办法：**不给已有的证据打勾**。

我今天真的这么干过一次——把 `TEST-129` 的 `real_entry` 从 true 改回 false，好让 scheduled-sweep 留在「未执行」名单里。那一刻账面上有两条事实，我只能显示其中一条：

- 巡检的服务端那一半在真实源上跑通了；
- 它的另外两条路线没跑。

**用瞒报一件事去换另一件事可见——这不该是账本逼人做的选择。**

## 3. 改法与结果

CP 行的「发现方式」里可以写 `（未执行：原因）`，该路线单独记账，与其所在记录是否另有证据无关。每条声明的路线都自陈未执行时，记录级那一行就不必再写。

迁移三条之后：

```
OK REAL_ENTRY_ACCOUNTED 28 record(s) have a registered real-entry PASS
OK ADVISORY REAL_ENTRY_ROUTE_UNRUN 3 route(s) declare themselves not run, regardless of
   whether their record has other evidence:
   CR-20260911-scheduled-sweep CP-4、CR-20260911-scheduled-sweep CP-5、
   CR-20260912-turn-budget-continue CP-4
```

账面剩余项由「1 条记录」变成「**3 条路线**」。数字变大了——**看见的东西才是真的**。

而 `TEST-129` 的 `real_entry` 也终于可以照实记回 true：巡检那一半确实在真实源上跑过。

## 4. 局限（如实登记）

- **判据只认「有没有写那句声明」**：一条随手写「（未执行：忙）」的路线照样能过。写得对不对要人看。
- **三种写法共处一格**：「机器：TEST-xxx」「（证据：TEST-xxx）」「（未执行：原因）」靠互不重叠区分，没有语法保证。真要严格，得把「发现方式」从散文改成结构化字段——那是另一次改动，今天不做。
