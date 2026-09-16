// 真实入口：菜单待采纳区默认收拢，点徽标后同一套采纳/忽略控件出现
// （CR-20260915-console-menu-consolidation CP-2，REQ-F-241）。
//
// 用真实待采纳数据核对「默认只显计数、点开后控件才出现」这一件事；不点「采纳」/「忽略」
// 本身去改真实数据——那部分的行为等价性已由 tests/knowledge-list.test.tsx 用打桩数据覆盖。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
// 开场页：点一下即开始工作（REQ-F-102 ④），跟 probe-console-overlay.mjs 同一手法。
await page.mouse.click(720, 450);
await page.waitForTimeout(300);

const menuToggle = page.getByRole("button", { name: /打开菜单|关闭菜单/ });
await menuToggle.waitFor({ timeout: 15_000 });
if ((await menuToggle.getAttribute("aria-label")) === "打开菜单") {
  await menuToggle.click();
}

const pendingToggle = page.getByRole("button", { name: /待采纳（\d+）/ });
await pendingToggle.waitFor({ timeout: 15_000 });

const itemsBefore = await page.locator(".knowledge-list__pending-item").count();
const expandedBefore = await pendingToggle.getAttribute("aria-expanded");

await pendingToggle.click();
await page.waitForTimeout(300);

const itemsAfter = await page.locator(".knowledge-list__pending-item").count();
const adoptButtons = await page.locator(".knowledge-list__adopt").count();
const discardButtons = await page.locator(".knowledge-list__discard").count();
const expandedAfter = await pendingToggle.getAttribute("aria-expanded");

console.log(`收拢态：条目数=${itemsBefore}，aria-expanded=${expandedBefore}`);
console.log(
  `展开态：条目数=${itemsAfter}，aria-expanded=${expandedAfter}，可见「采纳」按钮=${adoptButtons}，可见「忽略」按钮=${discardButtons}`
);

await browser.close();

const ok =
  itemsBefore === 0 &&
  expandedBefore === "false" &&
  itemsAfter > 0 &&
  expandedAfter === "true" &&
  adoptButtons === itemsAfter &&
  discardButtons === itemsAfter;
console.log(
  ok
    ? "PASS 默认收拢（条目不在文档里），点徽标后展开且同一套采纳/忽略按钮按条目数一一出现"
    : `FAIL 收拢条目=${itemsBefore} 展开条目=${itemsAfter} 采纳按钮=${adoptButtons} 忽略按钮=${discardButtons}`
);
process.exit(ok ? 0 : 1);
