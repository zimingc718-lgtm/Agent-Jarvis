// 真实入口：CR-20260918-change-history-and-sources 的三个变化点在真实浏览器里核对。
//
// CP-1（消息清单）真正靠不住的部分不是「fetchSource 检测到变化会记一条历史」——那已经
// 由 tests/sources.test.ts、tests/entity-history.test.ts 用受控 fetcher 断言过了。真正
// 只有真实浏览器能回答的是：卡片打开后，这条历史是否真的渲染成了一条可点击、指向来源
// 链接的消息。本探针因此不依赖对一个真实外部网页两次抓取都产生同一份可预测的「变化」
// （这在真实网络下几乎不可控）——改为像本项目既有的维护脚本
// （scripts/migrate-legacy-knowledge-notes.mjs）一样，直接对运行中服务器同一份
// .data/entities 目录写一条历史 JSONL，把「有真实数据可渲染」这件事变成确定性的前提，
// 要核对的渲染本身仍然是真实的。
//
// CP-2（add_source 工具）与 CP-3（弹窗配置）在浏览器里核对：一个新建的、没有任何来源的
// 对象，展开卡片时，「采集源设置」入口是一个按钮而不是内联表单（小按钮改弹窗）；点开弹窗
// 后能看到既有的手动添加表单，以及「自动配置来源」按钮——点击后应把预填问题交给对话框
// （复用既有 onAsk 机制），不在弹窗里自己发起请求。
//
// 全程用一个带时间戳的一次性对象，结束时无论成败都用 DELETE 清理（不留垃圾在真实看板上）。
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const entitiesRoot = process.env.JARVIS_ENTITIES_PATH ?? join(process.cwd(), ".data", "entities");
const testTitle = `探针测试友商-${Date.now()}`;

async function api(path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

let entityName = null;
let ok = true;
const fail = (label) => {
  ok = false;
  console.log(`FAIL ${label}`);
};

try {
  // 建对象——直接 POST，不经待采纳区，与看板「+」卡片的直建路径相同（不是本 CR 要测的
  // 东西，只是搭一个干净的起点）。
  const created = await api("/api/entities", { method: "POST", body: JSON.stringify({ kind: "competitor", title: testTitle }) });
  if (created.status !== 201) {
    throw new Error(`建对象失败：HTTP ${created.status}`);
  }
  entityName = created.body.entity.name;
  console.log(`已建立探针对象：${entityName}`);

  // 写一条历史——直接落盘 JSONL，理由见文件头注释。写完立即用 API 读回核对格式没写错，
  // 而不是等浏览器渲染失败了才发现是探针自己的准备工作有问题。
  const historyDir = join(entitiesRoot, "history");
  await mkdir(historyDir, { recursive: true });
  const entry = { at: new Date().toISOString(), url: "https://probe.example/change-history-and-sources", change: "新增 1 行：探针写入的测试消息" };
  await appendFile(join(historyDir, `${entityName}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8");
  const historyCheck = await api(`/api/entities/${encodeURIComponent(entityName)}/history`);
  const historyOk = historyCheck.status === 200 && historyCheck.body.entries?.[0]?.change === entry.change;
  console.log(`API 能读回刚写入的历史=${historyOk}`);
  if (!historyOk) fail("history API 读回不一致");

  // 真实浏览器
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.mouse.click(720, 450);
  await page.waitForTimeout(300);

  // 打开知识看板——本探针只核对卡片本身，走既有的展示屏切换（与其它看板探针同样的入口）。
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jarvis:display-stage", { detail: { stage: "board" } })));
  await page.waitForTimeout(500);

  const card = page.getByText(testTitle, { exact: true }).first();
  await card.waitFor({ timeout: 10_000 });
  await card.click();
  await page.waitForTimeout(300);

  // CP-1：消息清单渲染成可点击链接，href 指向探针写入的那条来源。
  const messageLink = page.getByRole("link", { name: entry.change });
  const messageShown = (await messageLink.count()) > 0;
  const href = messageShown ? await messageLink.first().getAttribute("href") : null;
  console.log(`消息清单渲染出可点击链接=${messageShown}，href 正确=${href === entry.url}`);
  if (!messageShown || href !== entry.url) fail("消息清单未按预期渲染");

  // CP-3：源配置是一个按钮，不是内联表单——展开态里不应该直接看到「添加采集源」输入框。
  const inlineInputBeforeOpen = await page.getByLabel(`为 ${testTitle} 添加采集源`).count();
  console.log(`弹窗打开前，内联输入框不存在=${inlineInputBeforeOpen === 0}`);
  if (inlineInputBeforeOpen !== 0) fail("采集源表单仍是内联的，未收进弹窗");

  const sourcesTrigger = page.getByRole("button", { name: /采集源设置/ });
  await sourcesTrigger.waitFor({ timeout: 5_000 });
  await sourcesTrigger.click();
  await page.waitForTimeout(300);
  const dialogTitle = page.getByRole("heading", { name: `${testTitle} 的采集源` });
  const dialogShown = (await dialogTitle.count()) > 0;
  console.log(`点击「采集源设置」后弹窗打开=${dialogShown}`);
  if (!dialogShown) fail("弹窗未打开");

  // CP-2 的用户可见一半：弹窗里的「自动配置来源」按钮把预填问题交给对话框（onAsk），
  // 不在弹窗里自己发请求——断言的是对话框输入框被填入了预期文本，而不是弹窗本身起了变化。
  const autoButton = page.getByRole("button", { name: "自动配置来源（交给对话）" });
  const autoButtonShown = (await autoButton.count()) > 0;
  console.log(`「自动配置来源」按钮存在=${autoButtonShown}`);
  if (autoButtonShown) {
    await autoButton.click();
    await page.waitForTimeout(300);
    const box = page.getByPlaceholder("Ask Agent-Jarvis");
    const prefilled = await box.inputValue();
    const expected = `请帮「${testTitle}」自动查找官网、权威媒体等正式信息来源，找到后登记为采集源。`;
    const prefillOk = prefilled === expected;
    console.log(`点击后对话框被预填正确文本，且未自动发送=${prefillOk}`);
    if (!prefillOk) fail("自动配置来源未正确预填对话框");
  } else {
    fail("自动配置来源按钮缺失");
  }

  await browser.close();
} catch (error) {
  ok = false;
  console.log(`FAIL 探针异常：${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (entityName) {
    const deleted = await api(`/api/entities/${encodeURIComponent(entityName)}`, { method: "DELETE" }).catch(() => ({ status: 0 }));
    console.log(`清理探针对象=${deleted.status === 200}`);
  }
}

console.log(ok ? "PASS 消息清单渲染正确、来源配置已收进弹窗、自动配置来源正确交给对话框" : "FAIL 见上方明细");
process.exit(ok ? 0 : 1);
