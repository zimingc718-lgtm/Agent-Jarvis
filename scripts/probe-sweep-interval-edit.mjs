// 真实入口：巡检间隔输入框——range 提示常驻可见、Enter 立即提交并真实持久化
// （CR-20260915-sweep-interval-edit CP-1，REQ-F-070 ⑦）。
//
// 防抖计时与「编辑中不被后台刷新顶掉」两件事已由 tests/knowledge-dashboard.test.tsx
// 用假计时器覆盖（㉒㉓）；真实浏览器这边只证明它们各自不需要重新证的那一半——保存
// 请求确实打到了真实 API 并且刷新页面后还在，这是打桩测试证不了的。核对完把值改回去，
// 不留下测试痕迹。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await page.waitForSelector(".knowledge-dashboard, [aria-label='知识看板']", { timeout: 15_000 }).catch(() => {});

const bar = page.getByRole("region", { name: "定时巡检" });
await bar.waitFor({ timeout: 15_000 });
const input = bar.getByLabelText("巡检间隔（分钟）");
await input.waitFor({ timeout: 15_000 });

const hintVisible = await bar.getByText(/30–1440/).isVisible();
console.log(`range 提示常驻可见 = ${hintVisible}`);

const originalValue = await input.inputValue();
const testValue = String(Number(originalValue) === 181 ? 182 : 181);
console.log(`原值 = ${originalValue}，测试值 = ${testValue}`);

async function commitAndConfirm(value) {
  await input.fill(String(value));
  await input.press("Enter");
  await page.getByText(`巡检间隔已保存为 ${value} 分钟。`).waitFor({ timeout: 10_000 });
}

let restored = false;
let persistedAfterReload = "";
try {
  await commitAndConfirm(testValue);

  await page.reload({ waitUntil: "networkidle" });
  await page.mouse.click(720, 450);
  await page.waitForSelector(".knowledge-dashboard, [aria-label='知识看板']", { timeout: 15_000 }).catch(() => {});
  const barAfter = page.getByRole("region", { name: "定时巡检" });
  await barAfter.waitFor({ timeout: 15_000 });
  const inputAfter = barAfter.getByLabelText("巡检间隔（分钟）");
  persistedAfterReload = await inputAfter.inputValue();
  console.log(`刷新页面后读到的值 = ${persistedAfterReload}`);

  await commitAndConfirm(originalValue);
  restored = true;
} finally {
  await browser.close();
}

const ok = hintVisible && persistedAfterReload === testValue && restored;
console.log(
  ok
    ? "PASS range 提示常驻、Enter 提交立即写回真实 API 且刷新后仍在，已把值改回原样"
    : `FAIL 提示可见=${hintVisible} 刷新后值=${persistedAfterReload}（期望 ${testValue}） 已复原=${restored}`
);
process.exit(ok ? 0 : 1);
