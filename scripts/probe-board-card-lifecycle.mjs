// 真实入口：看板卡片新增（+ 卡片）与删除（归档）两条路线
// （CR-20260915-board-card-lifecycle CP-1、CP-2，REQ-F-070 ⑧⑨）。
//
// 不碰用户已有的真实跟踪对象：新建一张探针自己的卡片，验完新增与删除两件事后，
// 那张卡片本来就该消失——不需要额外清理，也不会在用户的真实数据里留下痕迹。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const probeTitle = `探针临时对象-${Date.now()}`;

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("dialog", (dialog) => dialog.accept());

await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await page.waitForSelector(".knowledge-dashboard, [aria-label='知识看板']", { timeout: 15_000 }).catch(() => {});

const lane = page.getByRole("region", { name: "友商" });
await lane.waitFor({ timeout: 15_000 });

// --- CP-2：新增默认收拢成 +，点开、填名称、提交出现新卡片 ---
const addToggle = lane.getByRole("button", { name: "新增友商", exact: true });
await addToggle.waitFor({ timeout: 15_000 });
const collapsedBeforeAdd = (await lane.getByRole("textbox", { name: "新增友商", exact: true }).count()) === 0;

await addToggle.click();
const input = lane.getByRole("textbox", { name: "新增友商", exact: true });
await input.waitFor({ timeout: 5_000 });
await input.fill(probeTitle);
await lane.getByRole("button", { name: "添加" }).click();

const newCard = page.getByText(probeTitle, { exact: true });
await newCard.waitFor({ timeout: 10_000 });
const addCollapsedAfterSubmit = (await lane.getByRole("textbox", { name: "新增友商", exact: true }).count()) === 0;

console.log(`新增前收拢=${collapsedBeforeAdd}，新卡片出现=true，提交后自动收回=${addCollapsedAfterSubmit}`);

// --- CP-1：展开这张探针卡片，删除，确认后从看板消失 ---
await newCard.click();
const deleteButton = page.getByRole("button", { name: `删除跟踪对象「${probeTitle}」` });
await deleteButton.waitFor({ timeout: 5_000 });
await deleteButton.click();

await newCard.waitFor({ state: "detached", timeout: 10_000 });
const goneFromBoard = (await page.getByText(probeTitle, { exact: true }).count()) === 0;
console.log(`确认删除后卡片已从看板消失=${goneFromBoard}`);

await browser.close();

const ok = collapsedBeforeAdd && addCollapsedAfterSubmit && goneFromBoard;
console.log(
  ok
    ? "PASS 新增默认收拢成 +、提交后出现新卡片且自动收回；删除经确认后卡片从看板移除"
    : `FAIL 新增前收拢=${collapsedBeforeAdd} 提交后收回=${addCollapsedAfterSubmit} 删除后消失=${goneFromBoard}`
);
process.exit(ok ? 0 : 1);
