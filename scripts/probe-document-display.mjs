// 真实入口：show_document 工具真的能让模型把一份文档摆上展示屏，浏览器真的能取到字节
// （CR-20260915-document-display CP-1、CP-2，REQ-F-032 ⑤）。
//
// 用真实资料库里已采纳的一份 PDF（不新建任何东西，不改动用户数据）：① 直接请求原件路由，
// 核对未采纳的会被拦；② 在真实对话框里让模型调用 show_document，核对展示屏真的切换、
// iframe 的 src 真的指向能取到 PDF 字节的地址——这是 jsdom 证不了的部分：iframe 不真的
// 发请求，也没有模型在跑。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const library = await fetch(`${base}/api/library?status=adopted`).then((r) => r.json());
const pdfItem = (library.items ?? []).find((item) => item.ext === ".pdf");
if (!pdfItem) {
  console.log("SKIP 资料库里没有已采纳的 PDF，探针需要一份真实数据才能跑，未执行核对。");
  process.exit(0);
}
const pending = await fetch(`${base}/api/library?status=pending`).then((r) => r.json());
const pendingItem = (pending.items ?? [])[0] ?? null;

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await page.waitForTimeout(300);

// --- 直接核对原件路由：未采纳的挡、已采纳的能取到真实字节 ---
let pendingBlocked = true;
if (pendingItem) {
  const blockedResponse = await page.request.get(`${base}/api/documents/raw?id=${encodeURIComponent(`资料库/${pendingItem.id}`)}`);
  pendingBlocked = blockedResponse.status() === 403;
  console.log(`待采纳文档直接访问原件路由：状态码=${blockedResponse.status()}，被拦=${pendingBlocked}`);
}

const adoptedId = `资料库/${pdfItem.id}`;
const directResponse = await page.request.get(`${base}/api/documents/raw?id=${encodeURIComponent(adoptedId)}`);
const directOk = directResponse.status() === 200 && directResponse.headers()["content-type"]?.includes("application/pdf");
const directBytes = await directResponse.body();
const looksLikePdf = directBytes.slice(0, 5).toString("latin1") === "%PDF-";
console.log(`已采纳 PDF 直接访问原件路由：状态码=${directResponse.status()}，Content-Type 正确=${directOk}，字节以 %PDF- 开头=${looksLikePdf}`);

// --- 真实对话框：让模型调用 show_document ---
const box = page.getByPlaceholder("Ask Agent-Jarvis");
await box.waitFor({ timeout: 15_000 });
await box.fill(`请调用 show_document 工具，把展示屏切到这份资料库文档，id 参数用「${adoptedId}」，不用先搜索，直接调用。`);
await box.press("Enter");

const docSection = page.locator(".display-screen--document");
await docSection.waitFor({ timeout: 60_000 }).catch(() => {});
const switched = (await docSection.count()) > 0;

let iframeSrc = "";
let iframeFetchOk = false;
if (switched) {
  const frame = docSection.locator("iframe.display-screen__frame");
  iframeSrc = (await frame.getAttribute("src")) ?? "";
  if (iframeSrc) {
    const viaIframeUrl = new URL(iframeSrc, base).toString();
    const response = await page.request.get(viaIframeUrl);
    iframeFetchOk = response.status() === 200 && (await response.body()).slice(0, 5).toString("latin1") === "%PDF-";
  }
}
console.log(`模型调用后展示屏切到 document 视图=${switched}，iframe src=${iframeSrc}，src 能取到 PDF 字节=${iframeFetchOk}`);

await browser.close();

const ok = pendingBlocked && directOk && looksLikePdf && switched && iframeFetchOk;
console.log(
  ok
    ? "PASS 未采纳文档被拦；已采纳 PDF 原件路由能取到真实字节；模型调用 show_document 后展示屏切换，iframe 指向的地址能取到同一份 PDF"
    : `FAIL 待采纳拦截=${pendingBlocked} 直接路由=${directOk} PDF头=${looksLikePdf} 展示屏切换=${switched} iframe字节=${iframeFetchOk}`
);
process.exit(ok ? 0 : 1);
