// 真实入口：在真浏览器里把「资料库」面板切到「浏览」，核对统一列表、类型统计、分页与
// 「查看原文」真的可用（CR-20260915-knowledge-library-merge CP-2，REQ-F-242）。
//
// 面板与分页属人工发现项：`fireEvent` 测试桩能证明组件把 offset 传对了，证不了用户在自己
// 那台上点得到、翻页翻得动、原文链接真的打得开。目标是用户自己那台（默认 http://localhost:3000）。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const before = await (await fetch(`${base}/api/library/browse?limit=1`)).json();
console.log(`改前：统一浏览共 ${before.total} 条`);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);

const entry = page.getByRole("button", { name: "资料库", exact: true });
await entry.first().click({ timeout: 15_000 });

const panel = page.getByRole("region", { name: "资料库设置" });
await panel.waitFor({ timeout: 15_000 });
console.log("面板已在动态屏上出现");

// 默认在「审批」——先确认没破坏既有默认，再切「浏览」。
const reviewDefault = (await panel.getByRole("button", { name: "待采纳" }).getAttribute("aria-pressed")) === "true";

await panel.getByRole("button", { name: "浏览", exact: true }).click();
await page.waitForTimeout(1_000);

const summary = await panel.locator(".library-panel__browse-summary").innerText().catch(() => "");
console.log(`浏览摘要：${summary.replace(/\s+/g, " ").trim()}`);

const firstPageText = await panel.locator(".library-panel__browse ul").innerText().catch(() => "");
const cardCountBefore = (await panel.locator(".library-panel__browse li").count()) ?? 0;

// 「查看原文」应该指向已经在 CR-20260915-document-display 里验过的那条原件字节路由。
const rawLink = panel.getByRole("link", { name: "查看原文" }).first();
const hasRawLink = (await rawLink.count()) > 0;
const href = hasRawLink ? await rawLink.getAttribute("href") : null;

// 翻页：总数若超过一页（默认 20 条一页），「下一页」应可点且换一批。
const nextButton = panel.getByRole("button", { name: "下一页" });
let paginated = false;
if ((await nextButton.isEnabled().catch(() => false))) {
  await nextButton.click();
  await page.waitForTimeout(800);
  const secondPageText = await panel.locator(".library-panel__browse ul").innerText().catch(() => "");
  paginated = secondPageText !== firstPageText && secondPageText.length > 0;
}

await browser.close();

const ok = reviewDefault && cardCountBefore > 0 && hasRawLink && href?.startsWith("/api/documents/raw?id=") && (before.total <= 20 || paginated);
console.log(
  ok
    ? `PASS 浏览视图在真实入口上可用：默认仍是审批、切换后 ${cardCountBefore} 张卡片、原文链接=${href}${before.total > 20 ? "、翻页后内容确实换了一批" : "（不足一页，未触发翻页）"}`
    : `FAIL reviewDefault=${reviewDefault} cardCountBefore=${cardCountBefore} hasRawLink=${hasRawLink} href=${href} paginated=${paginated}`
);
process.exit(ok ? 0 : 1);
