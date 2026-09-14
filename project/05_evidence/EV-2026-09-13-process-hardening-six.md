# EV-2026-09-13-process-hardening-six

- 来源: 用户 2026-09-13 指示「6 条流程建议，执行」；六条建议出自助手 2026-09-12 的复盘（用户「看看流程上有什么建议，或者优化的地方」），第七条「真实入口记账」已由 `CR-20260913-real-entry-ledger` 单独落地
- 时间: 2026-09-13
- 采集者: 助手（claude-opus-5），本机执行
- 支撑对象: `CR-20260913-process-hardening-six`（DEC-210、TASK-300、TEST-300、TEST-058 ④）
- 可定位路径: 本文件；`next.config.mjs`、`src/app/layout.tsx`、`scripts/check-dev-server.mjs`、`tools/governance.py`、`docs/WORKFLOW.md`、`docs/CONTROLS.md`、`tests/check-dev-server.test.ts`、`tests/test_governance.py`、`project/05_evidence/test-results.json`

## 1. 六条治的是同一个根因

**我验的东西，和用户看的东西，不是同一个东西。**

| # | 表现 | 落点 |
|---|---|---|
| ① | 用户两次说「看不到大模型接口的选择」，真因是服务跑着九小时前的构建 | 页面盖构建戳，`check-dev-server` 与 HEAD 比对 |
| ② | REQ-F-170 ③ 与 REQ-F-180 ⑥ 都做到工具层就停了，通过条件里没有一句关于用户看得到什么 | `check-human-side` |
| ③ | 所有「真实入口已验」都跑在一次性服务器上，记录里看不出这个区别 | 证据带 `entry: user\|isolated` |
| ④ | worktree 里出的快照把 `.git` 记成受控文件，错跟着三次快照传下去 | `snapshot` 护栏 + 并行会话写法写进 `docs/WORKFLOW.md` |
| ⑤ | 同一件事用户说第二次，我又去修了一次实现 | 失败回流加短路径：先复核判据 |
| ⑥ | 同样形状的小修，有时写三节文档、有时一节不写 | `docs/CONTROLS.md` L1 轻量档 |

## 2. 先量后修（②）

把「通过条件里点了工具名（`snake_case`）、却一句人机界面都没提」当判据，扫全表：

```
OK HUMAN_SIDE_PASS 92 requirement(s) checked
OK ADVISORY HUMAN_SIDE_UNSTATED 4 requirement(s) ...: REQ-F-030, REQ-F-058, REQ-F-171, REQ-NF-008
```

92 行命中 4 行。**这 4 行里多数的「人的一侧」其实写在另一条需求里**（REQ-F-030 的步骤流在 REQ-F-035），所以这条判据做成拦路的门会天天误伤，一旦把人训练成无视它就永久失效——定为只报不拦，逃生口是 `人的一侧：无（原因）`。

先量这一步不是形式：如果不量，我会照直觉把它做成门，而 4/92 的误伤率要等到它已经拦了别人才显形。

## 3. 接上 ③ 之后当场看到的（2026-09-13）

只标能证明的两类：e2e 与 smoke 自起服务器（`playwright.config.ts` 里 `reuseExistingServer: false`、端口 3330、`NEXT_DIST_DIR=.next-e2e`、`JARVIS_TEST_USER_ID=e2e-user`），以及本轮亲手在一次性服务器上验的五条（TEST-190、210、230、240、260）。`test:ui-contract:live` 那种「against a real dev server」**不标**——那台服务器是谁的无从判断，未标注是一个诚实的状态。

共标 34 条。对账输出：

```
OK REAL_ENTRY_ACCOUNTED 17 record(s) have a registered real-entry PASS
OK ADVISORY REAL_ENTRY_ISOLATED_ONLY 9 record(s) were verified only on a throwaway server,
  never on the user's own running app: CR-20260911-web-reading, CR-20260912-context-degrade,
  CR-20260912-ingest-extract-chain, CR-20260912-knowledge-attribution, CR-20260912-local-documents,
  CR-20260912-local-production, CR-20260912-proposal-id-collision, CR-20260912-runtime-visibility,
  CR-20260912-skill-report-bridge
OK ADVISORY REAL_ENTRY_UNLABELLED 46 ...
OK ADVISORY REAL_ENTRY_DECLARED_UNRUN 7 ...
```

**9 个 CR 的真实入口从未在用户那台进程上跑过。** 每一条证据的每一句都是真的；它们证明代码可用，证明不了用户屏幕上的东西变了。此前这两者在记录里长得一模一样。

## 4. 附带修掉的一处（CP-4）

`check_stage` 此前只收集 FAIL，OK 行一律丢弃。于是 `check p3` 跑完，「登记了真实入口却没跑」那 7 条一个字都不会出现——**一条没人看得见的告知等于不存在**，这跟它要治的毛病是同一个形状。现约定 `OK ADVISORY ` 前缀，阶段检查照原样带出来：

```
$ python tools/governance.py check p1
...
OK ADVISORY HUMAN_SIDE_UNSTATED 4 requirement(s) ...  [check-human-side]
```

## 5. CP-1 的真实入口（2026-09-13）

在**用户自己那台**服务器上跑（端口 3000，`npm run build:local` + `npm run serve:local`）：

```
PASS served CSS carries compiled Tailwind output (115271 bytes)
  source: http://127.0.0.1:3000 (1 stylesheet(s))
  PASS served build matches HEAD (591cd471)
```

证据记 `entry: "user"`——本轮唯一一条。

**这一跑逮到了本条建议自己的实现缺陷。** 第一版把 `<meta>` 手写在 layout 的 `<head>` 里：五条单测全绿，而服务器返回的 32 KB HTML 里 `grep jarvis-build` 一无所获——App Router 把手写的 `<head>` 整个丢掉了。改用 `metadata.other` 后才真的出现在页面上。**一条只在构造输入上验过的护栏，正是它自己要治的那种东西。**

语义也在这一跑里被钉准：`env` 的值被编译进产物（`.next-prod/server/**` 里能 grep 到该 SHA），`next start` 不会重新取。因此它回答的是「用户看到的这些字节是从哪份代码构建出来的」；`next dev` 下配置在启动时读一次、页面按需编译，于是等同于「这台进程从哪份代码起来的」。两种模式下要比对的都是同一件事。

**局限**：它比的是**提交**。未提交的改动对它完全不可见——工作区改了而 HEAD 没动时，它照样报 PASS。`stale` 与 `absent` 两支由 TEST-058 ④ 以构造输入覆盖；`absent` 的真实形态就是上面那次（页面没有该 meta），只是当时尚未接上检查，未留下 FAIL 输出。

## 6. 证据的局限

- **②③ 都只报不拦**：`ADVISORY` 行若长期无人处理，会退化成一串没人读的绿字——正是它要治的毛病的翻版。这一条如实写进 DEC-210 的风险列，不假装被 TEST-300 覆盖。
- **①比的是提交，不是工作区**：未提交的改动对它完全不可见。它也证明不了那份代码构建成功或页面渲染正确。它补的是样式检查守不住的那一块：一台供着四十个提交之前的构建的服务器，样式照样是编译好的。
- **CP-2 判据本身的准确率无法被机器判断**：命中的 4 行里哪几行是真漏、哪几行的人的一侧写在别处，只有人能分。
