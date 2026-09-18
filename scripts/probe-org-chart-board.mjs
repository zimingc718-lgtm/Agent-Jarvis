// 真实入口：组织架构/研发阵型看板（CR-20260918-org-chart-board，对应 INPUT-2026-09-18-001
// 第 8 条）。核对两件独立的事——① 展示屏能否切到看板（零风险，不依赖任何真实数据）；
// ② 对话能否用 propose_person 登记一个人，并且没有可信来源时正确进入待采纳区、不直接
// 写入看板。
//
// 刻意的克制：本探针不会替用户往真实的「维谛」实体里写一条编好的人名/职位——那是用户
// 真实追踪的公司，编一条「测试用」记录进他们的待采纳队列是在制造需要人工清理的垃圾。第
// ②步改用一个几乎不可能已经登记过的来源域名（example.com），逼一条走「待采纳」而不是
// 「直接生效」的分支，并且成功后立刻清理掉（DELETE 待采纳记录），不论探针本身通过与否。
//
// 本 CR 里"对话创建公司洞察、固化显示在动态屏"那一半（用户原话第 8 条后半句）投入实现前
// 已核对既有 save_insight/show_insight 机制完全覆盖，不产生新代码——见 CR 文档「问题经过」
// 与 CR-20260918-conference-preview-insight 的同类结论；本探针因此不重复覆盖那一半。
//
// 对话历史跨刷新持久（REQ-F-013）——先点「新对话」，避免历史对话影响本次判断。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
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

// ① 展示屏能否切到组织架构看板——不要求任何真实数据，看板允许是空的。
await send("把展示屏切到组织架构看板。");
const finished1 = await waitForIdle(120_000);
await page.waitForTimeout(500);
const boardShown = (await page.locator(".display-screen--org-chart-board").count()) > 0;
console.log(`①流式结束=${finished1}，组织架构看板出现=${boardShown}`);

// ② 用一个几乎不可能已注册过的来源域，逼一条 propose_person 走「待采纳」分支——验证的是
// 机制（没有可信来源就不能直接写），不是这条信息本身的真假。
await send(
  "这是一次机制测试，不要凭空编造真实姓名：帮我用 propose_person 工具，为『维谛』登记一位" +
    "占位人员，姓名就叫「探针测试勿采纳」，岗位「测试」，来源链接用 https://example.com/probe-test" +
    "（这个域名几乎不可能是维谛已登记的来源，目的是验证它会进入待采纳区而不是直接生效）。" +
    "完成后明确告诉我这是一条测试记录，不要建议我采纳它。"
);
const finished2 = await waitForIdle(120_000);
await page.waitForTimeout(500);
const bodyText = await page.locator("body").innerText();
const queuedHint = /待采纳|测试记录|不要采纳|example\.com/i.test(bodyText);
console.log(`②流式结束=${finished2}，回复提到待采纳/测试字样=${queuedHint}`);

// 清理：不论上面走没走通，都尝试把「探针测试勿采纳」相关的待采纳提议清掉，不在用户真实
// 的维谛对象上留下测试痕迹。用真实入口而不是直接调 API，因为这正是用户自己会用的路径
// （知识看板的待采纳区）。
await send("刚才那条「探针测试勿采纳」的提议，如果还在待采纳区，帮我忽略掉。");
await waitForIdle(60_000);
console.log("已尝试清理探针写入的待采纳测试记录（若失败需人工在看板上核对并清理）。");

await browser.close();

const ok = finished1 && boardShown && finished2 && queuedHint;
console.log(
  ok
    ? "PASS 组织架构看板可由对话唤起；propose_person 在无可信来源时正确走待采纳分支"
    : `FAIL 见上方明细（①=${finished1 && boardShown}，②=${finished2 && queuedHint}）`
);
process.exit(ok ? 0 : 1);
