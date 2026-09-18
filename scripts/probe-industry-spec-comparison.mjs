// 真实入口：模型调用 show_industry_spec_comparison 后，展示屏切到行业技术指标对比页，
// 能看到跨友商/规则与准入方/客户三类对象的参数对比表（CR-20260918-industry-spec-comparison，
// 对应 INPUT-2026-09-18-001 第 1 条 + INPUT-2026-09-18-002 澄清「不是同一个页面，包含客户」）。
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

await send("拉一下行业技术指标对比表，我要横向看所有友商、准入方和客户的技术参数。");

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
const finished = await waitForIdle(120_000);
console.log(`流式在超时前结束=${finished}`);

const boardShown = (await page.locator(".display-screen--industry-spec-comparison").count()) > 0;
console.log(`展示屏切到行业技术指标对比页=${boardShown}`);

let headerText = "";
let hasKindLabel = false;
if (boardShown) {
  const table = page.locator(".industry-spec-comparison table");
  if ((await table.count()) > 0) {
    headerText = (await page.locator(".industry-spec-comparison thead").innerText()).trim();
    hasKindLabel = /友商|规则与准入方|客户/.test(headerText);
  } else {
    // 真实数据里可能一个对象都还没登记，此时是空态文案而不是表格——如实记录，不当失败。
    headerText = (await page.locator(".industry-spec-comparison").innerText()).trim();
  }
}
console.log(`表头/正文摘要=${headerText.slice(0, 200)}`);
console.log(`表头含 kind 标签（友商/规则与准入方/客户）=${hasKindLabel}`);

await browser.close();

// PASS 的判定只要求「切换成功」，不强求「当前真实数据里三类对象都有」——那取决于用户
// 实际登记了什么，不是这个探针该断言的事；kind 标签命中与否是信息性输出，供人工复核。
const ok = finished && boardShown;
console.log(
  ok
    ? "PASS 行业技术指标对比页可由对话唤起，展示屏正确切换"
    : `FAIL 见上方明细（流式结束=${finished}，展示屏切换=${boardShown}）`
);
process.exit(ok ? 0 : 1);
