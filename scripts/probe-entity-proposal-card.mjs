// 真实入口：对话内提议卡——模型真的能提议，用户真的能在对话里点按钮采纳/忽略，
// 走的真的是看板那条同一条审批闸（CR-20260915-entity-proposal-card，REQ-F-072 ⑤）。
//
// 两条路线都用真实数据，但选择不留痕迹的那一半：新对象走「采纳后立刻用已有的删除
// 入口（CR-20260915-board-card-lifecycle）归档掉」；字段修改走「忽略」，真实对象的
// 字段绝不会被这次探针改动。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const probeTitle = `探针临时友商-${Date.now()}`;

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await page.waitForTimeout(300);

const box = page.getByPlaceholder("Ask Agent-Jarvis");
await box.waitFor({ timeout: 15_000 });

// --- 路线一：新对象提议 → 对话里点「采纳」→ 真的出现在看板 → 用已有删除入口清理 ---
await box.fill(
  `请调用 propose_entity 工具，kind 用 "competitor"，title 用 "${probeTitle}"，不用先搜索，直接调用。`
);
await box.press("Enter");

const entityCard = page.getByRole("region", { name: `提议新对象「${probeTitle}」` });
await entityCard.waitFor({ timeout: 60_000 }).catch(() => {});
const entityCardShown = (await entityCard.count()) > 0;
let entityAdopted = false;
let entityOnBoard = false;
let createdName = null;
if (entityCardShown) {
  await entityCard.getByRole("button", { name: "采纳" }).click();
  await entityCard.getByText("已采纳。").waitFor({ timeout: 10_000 }).catch(() => {});
  entityAdopted = (await entityCard.getByText("已采纳。").count()) > 0;
  const board = await page.request.get(`${base}/api/entities`).then((r) => r.json());
  const created = (board.entities ?? []).find((entity) => entity.title === probeTitle);
  entityOnBoard = Boolean(created);
  createdName = created?.name ?? null;
}
console.log(`新对象卡片出现=${entityCardShown}，点采纳后显示已采纳=${entityAdopted}，真的出现在看板=${entityOnBoard}`);

// 清理：不管上面成不成功都尝试删一次，探针不该在用户的真实看板上留下痕迹。用看板
// 实际返回的 name（不是自己猜的 slug），避免猜错而删不掉或删错。
if (createdName) {
  await page.request.delete(`${base}/api/entities/${encodeURIComponent(createdName)}`).catch(() => {});
}

// --- 路线二：字段修改提议 → 对话里点「忽略」→ 真实对象的字段确认没被改动 ---
const target = "台达-delta";
const before = await page.request.get(`${base}/api/entities`).then((r) => r.json());
const beforeChange = (before.entities ?? []).find((entity) => entity.name === target)?.change ?? null;

await box.fill(
  `请调用 propose_entity_update 工具，name 用 "${target}"，field 用 "change"，value 用 "探针测试值-不代表真实变更"，source_url 用 "https://probe.example/not-a-real-source"，不用先搜索，直接调用。`
);
await box.press("Enter");

const updateCard = page.getByRole("region", { name: `提议修改「${target}」的 change` });
await updateCard.waitFor({ timeout: 60_000 }).catch(() => {});
const updateCardShown = (await updateCard.count()) > 0;
let updateDiscarded = false;
let realFieldUntouched = false;
if (updateCardShown) {
  await updateCard.getByRole("button", { name: "忽略" }).click();
  await updateCard.getByText("已忽略。").waitFor({ timeout: 10_000 }).catch(() => {});
  updateDiscarded = (await updateCard.getByText("已忽略。").count()) > 0;
  const after = await page.request.get(`${base}/api/entities`).then((r) => r.json());
  const afterChange = (after.entities ?? []).find((entity) => entity.name === target)?.change ?? null;
  realFieldUntouched = afterChange === beforeChange;
}
console.log(`修改提议卡片出现=${updateCardShown}，点忽略后显示已忽略=${updateDiscarded}，真实字段未被改动=${realFieldUntouched}`);

await browser.close();

const ok = entityCardShown && entityAdopted && entityOnBoard && updateCardShown && updateDiscarded && realFieldUntouched;
console.log(
  ok
    ? "PASS 两条路线都在真实对话框里出现了可操作的卡片：新对象采纳后真的上了看板（已清理）；字段修改忽略后真实对象未被改动"
    : `FAIL 新对象卡片=${entityCardShown} 采纳=${entityAdopted} 上看板=${entityOnBoard} 修改卡片=${updateCardShown} 忽略=${updateDiscarded} 字段未动=${realFieldUntouched}`
);
process.exit(ok ? 0 : 1);
