// 真实入口：展开对话框记录区后，屏幕两侧与对话框无关的内容仍可见、可点击
// （CR-20260915-console-menu-consolidation CP-1，REQ-F-200 ④）。
//
// jsdom 不做真布局，这件事只能在真实、可见的浏览器里验。目标是用户自己那台
// （默认 http://localhost:3000），不是一次性服务器。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
// 开场页：点一下即开始工作（REQ-F-102 ④），随后进入看板，好让屏幕两侧真的有内容。
await page.mouse.click(720, 450);
await page.waitForSelector(".knowledge-dashboard, [aria-label='知识看板']", { timeout: 15_000 }).catch(() => {});

// 屏幕左侧、对话框 768px 居中列之外的一点——1440 宽视口下，居中列大致落在 x∈[336,1104]。
const sideX = 80;
const sideY = 200;

async function sideContentVisible() {
  return page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el && el.closest(".knowledge-dashboard, .display-screen"));
    },
    [sideX, sideY]
  );
}

const beforeVisible = await sideContentVisible();
const beforeConsoleH = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--jarvis-console-h")
);
console.log(`折叠态：屏幕左侧内容可命中 = ${beforeVisible}，--jarvis-console-h = ${beforeConsoleH.trim()}`);

// 发一条消息，让记录区有内容可展开（若已有历史对话，输入框本就默认展开，这一步仅作保险）。
const box = page.getByPlaceholder("Ask Agent-Jarvis");
await box.waitFor({ timeout: 15_000 });
const toggle = page.getByRole("button", { name: /展开对话|收起对话/ });
if ((await toggle.count()) > 0 && (await toggle.getAttribute("aria-expanded")) === "false") {
  await toggle.click();
}
await page.waitForTimeout(500);

const afterVisible = await sideContentVisible();
const afterConsoleH = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--jarvis-console-h")
);
console.log(`展开态：屏幕左侧内容可命中 = ${afterVisible}，--jarvis-console-h = ${afterConsoleH.trim()}`);

await browser.close();

const stable = beforeConsoleH.trim() === afterConsoleH.trim();
const ok = beforeVisible && afterVisible && stable;
console.log(
  ok
    ? "PASS 展开前后屏幕两侧内容均可命中，且 --jarvis-console-h 保持不变（未随记录区伸缩）"
    : `FAIL 折叠态可见=${beforeVisible} 展开态可见=${afterVisible} 数值稳定=${stable}`
);
process.exit(ok ? 0 : 1);
