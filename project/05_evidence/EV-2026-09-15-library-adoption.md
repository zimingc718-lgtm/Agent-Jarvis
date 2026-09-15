# EV-2026-09-15-library-adoption

- 来源: 用户 2026-09-15（INPUT-2026-09-15-028）：「把资料库目录加入版本，并与知识库链接起来。里面的内容改为待采纳，审批通过后，可正式纳入，并支持对话查阅。」两项待裁定当日答复：入库范围「全部 253 MB 入库」、审批粒度「逐文件审批，界面在动态屏」
- 时间: 2026-09-15
- 采集者: 助手（claude-opus-5），在用户本机这棵工作树上执行
- 支撑对象: `CR-20260915-library-adoption` CP-1..CP-6；REQ-F-220、REQ-F-230
- 可定位路径: 本文件；`src/lib/library.ts`、`src/lib/html-text.ts`、`src/app/api/library/**`、`src/components/LibraryPanel.tsx`、`src/lib/tools/document-tools.ts`、`tests/library*.test.ts*`

## 1. 资料库的现场口径（入库前实测）

```
资料库/AIDC-供电架构与电网/
  01_报告/      5.9 MB    两份成品报告的 PDF 与 HTML
  02_原文_供电架构/  146 MB   P 编号原文
  03_原文_电网/      100 MB   G 编号原文
  04_文本层/     2.1 MB    图片型 PDF 与需逐字核对件的文本抽取
  清单.md / 清单.csv  各 60 KB（CSV 带 UTF-8 BOM）
  README.md
```

- 共 **258 个文件 / 253 MB**：139 个 HTML、78 个 PDF、37 个 TXT、1 个 DOCX、1 个 CSV、2 个 MD。
- 最大单文件 17 MB；两个原文目录里存在同一篇的重复（`P140_` 与 `G19_` 同为那份 17 MB 的 PDF）。
- README 自述：227 条来源、取得原文 **214** 条、未取得 13 条；`04_文本层/` 是逐字核对过的抽取结果。

入库后：`.git` 由入库前的量增至 **197 MB**（PDF 几乎不压缩），`git add 资料库` 耗时 11 秒。

## 2. 三层职责（本 CR 的设计要点）

| 层 | 放什么 | 谁写 | 回滚 |
|---|---|---|---|
| 资料库目录 | 字节（原件） | 用户 / git | `git revert` 不动它——回滚的是机制，不是用户的资料 |
| `.data/library/adoption.json` | 判断（谁、何时、什么结论） | 审批面板 | 删掉即全部回到待采纳 |
| 知识库索引卡 | 检索入口（标题、来源、`documentId`） | 采纳动作 | 撤回采纳即删卡 |

「与知识库链接起来」这句话的具体落点是第三行：`search_knowledge` 命中卡片 → 卡片给出 `documentId` → `read_document` 取全文，模型在一轮里走得通。

## 3. 机器证据（TEST-390..420，共 21 条断言，全绿）

| 用例 | 条数 | 守住的事 |
|---|---|---|
| TEST-390 `tests/library.test.ts` | 8 | 清单解析（BOM、引号内逗号）、**默认全部待采纳**、采纳写卡 / 撤回删卡、拒绝不写卡、登记坏掉退回待采纳、`.gitattributes` 有 `资料库/** -text` |
| TEST-400 `tests/library-routes.test.ts` | 4 | GET 计数不随筛选变、POST 逐条裁定与 `unchanged`、400/404、未登录 401 |
| TEST-410 `tests/library-panel.test.tsx` | 5 | 默认只看待采纳、逐条通过带一个 id、**本组全部通过带的是每一条的 id**、已采纳视图给撤回入口、失败显示服务端原话 |
| TEST-420 `tests/library-gate.test.ts` | 5 | 待采纳一份不露出**且报数**、采纳后可见可检索、未采纳读不了但说清去处、网页存档读得出正文、撤回后立刻又读不到 |

全量：`npm run verify:all` → 87 个测试文件、**764 条单测**通过（本 CR 之前是 743）。

## 4. 两处被测试当场逮到的问题（都不是猜的）

1. **路径写成模块级常量，测试就会读到真的资料库。** `LIBRARY_ROOT = join(process.cwd(), "资料库")` 在模块加载那一刻定死，于是 `tests/document-tools.test.ts` 里「未配置目录」那条断言开始失败——它读到了仓库里那 258 个文件。改为调用时求值（`libraryRootPath()`），测试才指得开。
2. **夹具目录取名「资料库」会让 vitest 的 worker 直接死掉。** `beforeEach` 里对一个中文名目录反复 `rmSync(recursive)`，worker 报 `ERR_IPC_CHANNEL_CLOSED`，**一条用例结果都收不到、也没有堆栈**——看起来像「测试文件坏了」。夹具改用 ASCII 名即全绿；真实目录名由 `JARVIS_LIBRARY_PATH` 指定，与夹具叫什么无关。这一条写进了 `tests/library-routes.test.ts` 的注释。

## 5. 顺带修掉的一处旧缺陷

`insight-export.ts` 的 `slugify` 里，字符类 `[\\/:*?"<>|\x00-\x1f]` 的两个控制字符被写成了**真的字节**（NUL 与 0x1F）。语义相同，但 git 因此把整个文件判为二进制，`git diff` 与 `grep` 都不可读。搬迁 `htmlToMarkdown` 时一并改回转义写法。

## 6. 局限（如实登记）

- **真实入口尚未执行**：审批面板与「通过前/通过后」的对照必须在用户自己那台（`build:local` + `serve:local`）上走一遍，测试桩不算。本证据只覆盖机器侧。
- **采纳登记不随版本库走**：`.data/` 不进版本库，换机器克隆下来资料在、审批结果不在，需重审。
- **仓库体积不可逆**：253 MB 进了历史，删文件只减工作树。用户在知悉后裁定入库。
- **`origin` 是公开仓库**：本 CR 不 push；是否发布这 214 份第三方原文由用户决定。
- 扫描件 PDF 仍不做 OCR，采纳后也读不出文字——与 REQ-F-110 同口径。
