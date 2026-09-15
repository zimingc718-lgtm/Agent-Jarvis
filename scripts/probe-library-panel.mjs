// 真实入口：在真浏览器里走一遍资料库的审批（CR-20260915-library-adoption CP-3）。
//
// 面板与审批属人工发现项：测试桩能证明组件会把 id 传出去，不能证明用户在自己那台上点得到、
// 点完之后状态真的留下来了。目标是用户自己那台（默认 http://localhost:3000）。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const before = await (await fetch(`${base}/api/library`)).json();
console.log(`改前：共 ${before.counts.total} 份，待采纳 ${before.counts.pending}，已采纳 ${before.counts.adopted}，已拒绝 ${before.counts.rejected}`);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
// 开场页：点一下即开始工作（REQ-F-102 ④）。
await page.mouse.click(720, 450);

// 控制台上的面板入口（REQ-F-200 ①：设置类界面由对话框唤起、渲染在动态屏）。
const entry = page.getByRole("button", { name: "资料库", exact: true });
await entry.first().click({ timeout: 15_000 });

const panel = page.getByRole("region", { name: "资料库设置" });
await panel.waitFor({ timeout: 15_000 });
console.log("面板已在动态屏上出现");

const firstItem = page.locator("li").filter({ has: page.locator("button", { hasText: "通过" }) }).first();
const firstLabel = (await firstItem.innerText()).split("\n")[0];
await firstItem.getByRole("button", { name: "通过" }).click();
await page.waitForTimeout(1_500);

const nextItem = page.locator("li").filter({ has: page.locator("button", { hasText: "拒绝" }) }).first();
const nextLabel = (await nextItem.innerText()).split("\n")[0];
await nextItem.getByRole("button", { name: "拒绝" }).click();
await page.waitForTimeout(1_500);

console.log(`通过了：${firstLabel}`);
console.log(`拒绝了：${nextLabel}`);

// 刷新之后再看一次——审批要留得住，而不是只活在这一次渲染里。
await page.reload({ waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await page.getByRole("button", { name: "资料库", exact: true }).first().click({ timeout: 15_000 });
await panel.waitFor({ timeout: 15_000 });
await page.getByRole("button", { name: "已采纳" }).click();
await page.waitForTimeout(1_500);
const adoptedText = await panel.innerText();

const after = await (await fetch(`${base}/api/library`)).json();
console.log(`改后：待采纳 ${after.counts.pending}，已采纳 ${after.counts.adopted}，已拒绝 ${after.counts.rejected}`);
await browser.close();

const ok =
  after.counts.adopted === before.counts.adopted + 1 &&
  after.counts.rejected === before.counts.rejected + 1 &&
  adoptedText.includes("撤回判断");
console.log(ok ? "PASS 审批在真实入口上生效，且刷新后仍在" : "FAIL 审批没有留住");
process.exit(ok ? 0 : 1);
