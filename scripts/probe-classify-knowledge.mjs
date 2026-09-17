// 真实入口：模型真的能调用 classify_knowledge 改一条已入库条目的类型，直接生效、不进
// 待采纳区（CR-20260915-knowledge-library-merge CP-1，REQ-F-046 ⑥）。
//
// 只对探针自己造的一次性条目动手：先用 `POST /api/knowledge` 存一条真实存在但内容无意义
// 的条目，让模型在真实对话里调用 classify_knowledge 改它的类型，核对生效后立即用既有的
// 归档删除入口清理掉——不留痕迹，也不碰用户自己的任何真实条目。
//
// 对话历史跨刷新持久（REQ-F-013）——先点「新对话」，避免上一轮探针留下的同名条目干扰匹配。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const probeTitle = `探针临时分类条目-${Date.now()}`;

const created = await (
  await fetch(`${base}/api/knowledge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: probeTitle, content: "用于验证 classify_knowledge 真实入口，验证完即归档清理。", source: "manual" }),
  })
).json();
const name = created.entry?.name;
if (!name) {
  console.log(`FAIL 没能先造出探针条目：${JSON.stringify(created)}`);
  process.exit(1);
}
console.log(`已造出探针条目 name=${name}`);

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

await send(
  `请调用 classify_knowledge 工具，name 用 "${name}"，doc_type 用 "探针验证类型"，不用先搜索，直接调用，然后告诉我结果。`
);

// 没有专门的卡片——分类是直接生效的整理动作（REQ-F-046 ⑥ 的选择理由），转录区只会有
// 一句文字回复，靠等它出现或等发送按钮复位来判断「做完了没」两条路都试过、都不稳：文字
// 命中会在工具参数回显阶段假阳性（探针第一版踩到）；等按钮复位则可能因为模型在工具调用
// 之后还有话要说而迟迟不触发，白等一个和「有没有真的分类成功」无关的超时（探针第二版踩
// 到——那一次后端其实已经改对了，只是浏览器还在流式吐字）。两条都是在猜 UI 什么时候「看起
// 来」完事；真正要核对的是后端状态，于是直接轮询后端，而不是猜前端渲染的时间点。
let entry = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const snapshot = await (await fetch(`${base}/api/knowledge`)).json();
  entry = (snapshot.entries ?? []).find((item) => item.name === name);
  if (entry?.docType === "探针验证类型") {
    break;
  }
  await page.waitForTimeout(2_000);
}

if (process.env.PROBE_DEBUG) {
  console.log("=== DEBUG：转录区末尾文字 ===");
  console.log((await page.locator("body").innerText()).slice(-3000));
  console.log("=== DEBUG：条目当前状态 ===", JSON.stringify(entry));
}

const classified = entry?.docType === "探针验证类型";
console.log(`模型回复里出现新类型=${(await page.locator("body").innerText()).includes("探针验证类型")}，后端 docType 真的改了=${classified}`);

await browser.close();

// 清理：不管上面成不成功都尝试归档掉，探针不该在真实知识库里留下痕迹。
const cleanup = await fetch(`${base}/api/knowledge/${encodeURIComponent(name)}`, { method: "DELETE" });
console.log(`清理探针条目：${cleanup.ok ? "已归档" : `失败（${cleanup.status}）`}`);

console.log(classified ? "PASS 真实模型调用 classify_knowledge 后，条目类型在真实知识库里生效" : "FAIL 类型没有真的改变");
process.exit(classified ? 0 : 1);
