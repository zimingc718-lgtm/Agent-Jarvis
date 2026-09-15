// 真实入口：在真浏览器里打开看板，看巡检的客户端 tick 会不会自己跑（CR-20260911-scheduled-sweep CP-4）。
//
// 服务端那一半昨天已用 curl 验过；这一半的声明是「开着看板一段时间，轮次是否如预期发生」，
// 它只在看板挂载且标签页可见时跳动，所以只能用一个真的、可见的浏览器页面来验。
// 目标是用户自己那台（默认 http://localhost:3000），不是一次性服务器。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const waitMs = Number(process.env.PROBE_WAIT_MS ?? 75_000);

const before = await (await fetch(`${base}/api/entities/sweep`)).json();
console.log(`改前 lastRun = ${before.lastRun}`);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const sweepCalls = [];
page.on("response", async (response) => {
  if (response.url().endsWith("/api/entities/sweep") && response.request().method() === "POST") {
    const body = await response.json().catch(() => ({}));
    sweepCalls.push({ at: new Date().toISOString(), ran: body.ran, reason: body.reason, results: body.results?.length ?? 0 });
    console.log(`[tick] POST /api/entities/sweep → ran=${body.ran} ${body.reason ?? ""}`);
  }
});

await page.goto(base, { waitUntil: "networkidle" });
// 开场页：点一下即进入看板（REQ-F-102 ④：点击/聚焦算开始工作）。
await page.mouse.click(720, 450);
await page.waitForSelector(".knowledge-dashboard, [aria-label='知识看板']", { timeout: 15_000 });
console.log("看板已挂载，等待客户端 tick…");

const started = Date.now();
while (Date.now() - started < waitMs && sweepCalls.length === 0) {
  await page.waitForTimeout(1_000);
}
// 再等一个周期，看第二次 tick 是否也来（证明是周期性的，不只是挂载那一次）。
if (sweepCalls.length > 0) {
  const target = sweepCalls.length + 1;
  const started2 = Date.now();
  while (Date.now() - started2 < 70_000 && sweepCalls.length < target) {
    await page.waitForTimeout(1_000);
  }
}

const after = await (await fetch(`${base}/api/entities/sweep`)).json();
console.log(`改后 lastRun = ${after.lastRun}`);
console.log(`tick 次数 = ${sweepCalls.length}`);
for (const call of sweepCalls) console.log("  ", JSON.stringify(call));
await browser.close();

if (sweepCalls.length === 0) {
  console.log("FAIL 看板挂载后 75 秒内没有发出任何巡检请求");
  process.exit(1);
}
console.log(after.lastRun !== before.lastRun ? "PASS 客户端 tick 触发了真实巡检，lastRun 已前进" : "PASS tick 发出了请求（本轮无到期源，lastRun 未变）");
