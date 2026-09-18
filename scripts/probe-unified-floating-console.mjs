// 真实入口：非首页视图（资料库/模型等设置面板、看板）与首页一样全悬浮，不再固定预留底部
// 空白；控制台的状态灯/上传/模型/技能/工具/资料库入口同一行（CR-20260918-unified-floating-
// console，需求清单第 5、6a 条）。
//
// 「全悬浮」在真实浏览器里的可观察信号：面板容器的 getBoundingClientRect().bottom 等于
// 视口高度（贴到最底，不留一条让位空白），无论控制台此刻收拢还是展开。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await page.waitForTimeout(300);

// 一行核对：状态灯（role=status 的 sr-only 文本）、上传、模型/技能/工具/资料库四个面板
// 入口，是否都能在同一个 .floating-chat__status 容器里找到。
const rowHasEverything = await page.evaluate(() => {
  const row = document.querySelector(".floating-chat__status");
  if (!row) return false;
  const hasStatus = row.querySelector('[role="status"]') !== null;
  const hasUpload = Array.from(row.querySelectorAll("button")).some((b) => b.textContent?.trim() === "上传");
  const labels = ["模型", "技能", "工具", "资料库"];
  const hasAllPanels = labels.every((l) => Array.from(row.querySelectorAll("button")).some((b) => b.textContent?.trim() === l));
  return hasStatus && hasUpload && hasAllPanels;
});
console.log(`状态灯/上传/模型/技能/工具/资料库同一行=${rowHasEverything}`);

// 打开「资料库」面板，核对它贴到视口底部——不留出给控制台的空白。
await page.getByRole("button", { name: "资料库", exact: true }).first().click({ timeout: 15_000 });
const panel = page.getByRole("region", { name: "资料库设置" });
await panel.waitFor({ timeout: 15_000 });

const viewportHeight = page.viewportSize()?.height ?? 900;
const panelBottomCollapsed = await page.evaluate(() => {
  const el = document.querySelector(".display-screen--settings");
  return el ? el.getBoundingClientRect().bottom : null;
});
const floatsFullyCollapsed = panelBottomCollapsed !== null && Math.abs(panelBottomCollapsed - viewportHeight) < 2;
console.log(`收拢态下资料库面板贴到视口底部（不让位）=${floatsFullyCollapsed}（bottom=${panelBottomCollapsed}, viewport=${viewportHeight}）`);

// 展开一次对话（发一条消息），确认展开态下同样全悬浮——这正是 DEC-240/DEC-340 曾经专门
// 处理过的场景（记录区展开时是否盖住内容），本 CR 把"盖住是可接受的代价"这条既有原则从
// 首页扩到了全部视图，这里核对扩得是否真的生效，而不是只在收拢态才生效。
const box = page.getByPlaceholder("Ask Agent-Jarvis");
await box.fill("你好");
await page.getByRole("button", { name: "发送" }).click();
await page.waitForTimeout(1_500);
const panelBottomExpanded = await page.evaluate(() => {
  const el = document.querySelector(".display-screen--settings");
  return el ? el.getBoundingClientRect().bottom : null;
});
const floatsFullyExpanded = panelBottomExpanded !== null && Math.abs(panelBottomExpanded - viewportHeight) < 2;
console.log(`展开态下资料库面板仍贴到视口底部（不让位）=${floatsFullyExpanded}（bottom=${panelBottomExpanded}）`);

await browser.close();

const ok = rowHasEverything && floatsFullyCollapsed && floatsFullyExpanded;
console.log(ok ? "PASS 非首页视图全悬浮，控制台入口收拢为一行" : "FAIL 见上方明细");
process.exit(ok ? 0 : 1);
