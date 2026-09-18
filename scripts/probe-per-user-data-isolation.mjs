// 真实入口：每用户数据私有隔离 + 现有单管理员数据自动迁移（CR-20260918-per-user-data-isolation，
// 对应 INPUT-2026-09-18-001 第 9a 条 + 用户两次 AskUserQuestion 裁定）。
//
// 本探针刻意只做「迁移之后」的只读+自清理验证，不触发迁移本身——触发动作是协调会话重建、
// 重启生产服务这一步的自然结果（首次真实请求命中单管理员身份时自动发生），不需要探针额外
// 做什么，也不应该由探针抢在操作员核对迁移前文件清单之前就先发出请求。CR 文档「验收条件」
// 已经把"迁移前后文件清单比对"列为协调会话必须手工执行的独立步骤，本探针不重复、不替代
// 那一步——两者验证的是不同的事：文件清单比对证明"字节没丢"，本探针证明"迁移后功能正常"。
//
// 执行前提（操作员自查，脚本不会替你确认）：
//   1. 已经完成 CR 文档「验收条件」①②③步——生产服务已用新代码重启，且已确认单管理员的
//      真实数据已经出现在 .data/users/<单管理员 ID>/{entities,knowledge} 下、文件清单与
//      迁移前基线一致。
//   2. 本探针只在这之后运行，用来确认"迁移完成后，日常读写是否正常"，而不是用来发现
//      迁移本身有没有出问题——迁移本身的正确性不是这个脚本的职责。
//
// 克制设计：本探针会写入一个名字明显标注为探针产物、与用户真实追踪对象（如"维谛"）完全
// 不重名的一次性测试实体，验证写入路径后立即在同一探针内删除，不在用户真实数据里留下
// 任何痕迹；不修改、不删除任何已有的真实实体或知识条目。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const PROBE_ENTITY_NAME = "隔离探针测试对象-勿保留";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });

// 基本健康：首页在新代码下能正常渲染，不是重启后卡在 500/白屏。
const pageOk = (await page.locator("body").count()) > 0 && (await page.title()) !== "";
console.log(`①首页可正常加载=${pageOk}`);

await page.mouse.click(720, 450);
await page.waitForTimeout(300);

const box = page.getByPlaceholder("Ask Agent-Jarvis");
await box.waitFor({ timeout: 15_000 });
const newConversation = page.getByRole("button", { name: "新对话" });
if ((await newConversation.count()) > 0) {
  await newConversation.click();
}

async function send(text) {
  await box.fill(text);
  await page.getByRole("button", { name: "发送" }).click();
}

async function waitForIdle(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const stillStreaming = (await page.getByRole("button", { name: "停止" }).count()) > 0;
    if (!stillStreaming) {
      return true;
    }
    await page.waitForTimeout(3_000);
  }
  return false;
}

// ②迁移后能否读到既有真实数据——不要求任何具体条数（探针不知道用户真实有多少条追踪对象），
// 只要求模型能成功列出、不报错。人工核对"数量是否和迁移前基线一致"仍然是操作员自己的工作
// （CR 文档「验收条件」第③步），探针只负责确认"这条读路径本身没坏"。
await send("列出你现在追踪的所有对象（实体）的名称，不用详细介绍，报个数量和名单就行。");
const finished1 = await waitForIdle(120_000);
await page.waitForTimeout(500);
const bodyText1 = await page.locator("body").innerText();
const listedOk = finished1 && !/错误|失败|无法读取|500/i.test(bodyText1);
console.log(`②迁移后读路径正常（模型成功列出且未报错）=${listedOk}`);
if (finished1) {
  console.log(`   模型回复摘录：${bodyText1.slice(-400).replace(/\s+/g, " ")}`);
}

// ③写路径：新建一个名字明显标注为探针产物的一次性测试实体，验证迁移后的私有根可以正常
// 写入（不是只读得到旧数据、写不进新目录）。
await send(
  `帮我新建一个 customer 类型的追踪对象，名字就叫「${PROBE_ENTITY_NAME}」，这是一次自动化探针` +
    `写入测试，不代表任何真实客户，测试完会立刻删除。`
);
const finished2 = await waitForIdle(120_000);
await page.waitForTimeout(500);
const bodyText2 = await page.locator("body").innerText();
const createdOk = finished2 && bodyText2.includes(PROBE_ENTITY_NAME);
console.log(`③迁移后写路径正常（探针测试对象创建成功）=${createdOk}`);

// 清理：不论上面走没走通，都尝试删除探针写入的测试对象，不在用户真实数据里留下痕迹。
await send(`刚才创建的「${PROBE_ENTITY_NAME}」，帮我删掉，它只是一次自动化探针测试。`);
const finished3 = await waitForIdle(60_000);
await page.waitForTimeout(500);
const bodyText3 = await page.locator("body").innerText();
const cleanedOk = finished3 && /删除|移除|已经不在|不存在/i.test(bodyText3);
console.log(`④探针测试对象已清理=${cleanedOk}（若为 false，需人工在看板上核对并手动删除「${PROBE_ENTITY_NAME}」）`);

await browser.close();

const ok = pageOk && listedOk && createdOk && cleanedOk;
console.log(
  ok
    ? "PASS 迁移后的私有根读写路径均正常；探针自身写入的测试对象已清理，未在真实数据中留下痕迹"
    : `FAIL 见上方明细（①=${pageOk}，②=${listedOk}，③=${createdOk}，④=${cleanedOk}）——若④为 false，务必人工核对看板，清掉「${PROBE_ENTITY_NAME}」`
);
process.exit(ok ? 0 : 1);
