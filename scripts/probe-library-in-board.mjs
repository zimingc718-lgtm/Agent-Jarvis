// 真实入口：知识看板里的「资料库」板块——不是 ☰ 菜单那个设置面板，是看板正文里新嵌入的
// 那一块——真的能看见可翻页的卡片，REQ-F-170 ②③ 的「无归属/通用」计数没有因为改版消失
// （CR-20260918-library-in-board CP-1，item 3）。
//
// `probe-library-browse.mjs` 验的是 ☰ 资料库设置面板的浏览模式，跟这里改的不是同一块 DOM——
// 那份探针继续证它自己的入口，证不了看板正文里这块新嵌入内容真的渲染、真的能翻页。两份
// 探针目标不同，不能互相替代。
//
// item 4（chat 检索资料库 + 展示屏直显原件）在这次改动里没有新代码：`search_documents` /
// `show_document` / `/api/documents/raw` 早已支持资料库（CR-20260915-library-adoption、
// CR-20260915-document-display），`probe-library-chat.mjs`、`probe-document-display.mjs`
// 两份现成探针已经是这条能力的真实入口证据，本探针不重复造一份。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const before = await (await fetch(`${base}/api/library/browse?limit=1`)).json();
console.log(`统一浏览共 ${before.total} 条（看板板块与 ☰ 面板共用同一条 API）`);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
// 开场页点一下进入看板（REQ-F-102 ④：点击/聚焦算开始工作），同 probe-board-tick.mjs。
await page.mouse.click(720, 450);
await page.waitForSelector(".knowledge-dashboard, [aria-label='知识看板']", { timeout: 15_000 });
console.log("看板已挂载");

const section = page.getByRole("region", { name: "资料库", exact: true });
await section.waitFor({ timeout: 15_000 });
console.log("看板正文里的「资料库」板块已出现（改名生效，不再是「知识库总览」）");

// REQ-F-170 ②③：无归属/通用两个数原样保留，不因为这次改版消失。
const summaryText = await section.locator("span", { hasText: "无归属" }).first().innerText().catch(() => "");
const summaryKept = /无归属\s*\d+\s*条/.test(summaryText);
console.log(`REQ-F-170 无归属计数仍在：${summaryKept ? "是" : "否"}（"${summaryText}"）`);

// 真的能看到可浏览的卡片——这是本次新加的内容，不是原来就有的统计数字。
const cardCount = await section.locator("li").count();
console.log(`板块内可见卡片数：${cardCount}`);

const rawLink = section.getByRole("link", { name: "查看原文" }).first();
const hasRawLink = (await rawLink.count()) > 0;
const href = hasRawLink ? await rawLink.getAttribute("href") : null;
console.log(`「查看原文」链接：${href ?? "（无卡片，未出现）"}`);

// 翻页：总数超过一页时，「下一页」应可点且换一批（与 probe-library-browse.mjs 同样的判据）。
const firstPageText = await section.locator("ul").innerText().catch(() => "");
const nextButton = section.getByRole("button", { name: "下一页" });
let paginated = false;
if (await nextButton.isEnabled().catch(() => false)) {
  await nextButton.click();
  await page.waitForTimeout(800);
  const secondPageText = await section.locator("ul").innerText().catch(() => "");
  paginated = secondPageText !== firstPageText && secondPageText.length > 0;
}

await browser.close();

const ok = summaryKept && cardCount > 0 && hasRawLink && href?.startsWith("/api/documents/raw?id=") && (before.total <= 20 || paginated);
console.log(
  ok
    ? `PASS 看板里的「资料库」板块可用：REQ-F-170 计数保留、${cardCount} 张卡片、原文链接=${href}${before.total > 20 ? "、翻页后内容确实换了一批" : "（不足一页，未触发翻页）"}`
    : `FAIL summaryKept=${summaryKept} cardCount=${cardCount} hasRawLink=${hasRawLink} href=${href} paginated=${paginated}`
);
process.exit(ok ? 0 : 1);
