// 真实入口：采纳前后，同一个问题在对话里的答案不一样（CR-20260915-library-adoption CP-4）。
//
// 这是用户那句「审批通过后……支持对话查阅」唯一算数的验法：单测能证明闸的逻辑，证明不了
// 模型在真实一轮里确实被挡住、又确实读得到。走用户自己那台（默认 http://localhost:3000）与
// 真实 Provider，因此会花掉少量额度——问题刻意问得小。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const target = process.env.PROBE_DOC_ID ?? "AIDC-供电架构与电网/04_文本层/P1_ocp-diablo-400_文本层.txt";
const question =
  process.env.PROBE_QUESTION ??
  `用 read_document 读 资料库/${target}，只回它的头两行原文；读不到就直说读不到、并说明原因。`;

async function statusOf(id) {
  const data = await (await fetch(`${base}/api/library`)).json();
  return data.items.find((item) => item.id === id)?.status ?? "（不在清单里）";
}

async function decide(id, status) {
  const response = await fetch(`${base}/api/library/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [id], status }),
  });
  if (!response.ok) {
    throw new Error(`裁定失败：${response.status} ${await response.text()}`);
  }
}

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);

const box = page.getByPlaceholder("Ask Agent-Jarvis");
await box.waitFor({ timeout: 15_000 });

async function ask(label) {
  await box.fill(question);
  await box.press("Enter");
  // 等这一轮结束：输入框重新可用且出现新的助手气泡。
  const started = Date.now();
  let text = "";
  while (Date.now() - started < 180_000) {
    await page.waitForTimeout(2_000);
    const bubbles = await page.locator(".floating-chat__message--assistant").allInnerTexts();
    text = bubbles.length > 0 ? bubbles[bubbles.length - 1] : "";
    const busy = await box.isDisabled().catch(() => false);
    if (!busy && text.length > 20) {
      break;
    }
  }
  console.log(`\n—— ${label} ——\n${text.slice(0, 600)}`);
  return text;
}

console.log(`目标：${target}`);
console.log(`采纳前状态：${await statusOf(target)}`);
const before = await ask("采纳前");

await decide(target, "adopted");
console.log(`\n已采纳，状态：${await statusOf(target)}`);
await page.reload({ waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await box.waitFor({ timeout: 15_000 });
const after = await ask("采纳后");

await browser.close();

const blocked = /待采纳|未采纳|没有通过|审批/.test(before);
const readable = after.length > 40 && !/待采纳|未采纳/.test(after);
console.log(`\n采纳前被挡：${blocked ? "是" : "否"}；采纳后读得到：${readable ? "是" : "否"}`);
console.log(blocked && readable ? "PASS 采纳前后对话里的答案确实不同" : "FAIL 对照没有成立");
process.exit(blocked && readable ? 0 : 1);
