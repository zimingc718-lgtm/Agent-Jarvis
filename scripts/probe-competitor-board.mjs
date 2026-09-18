// 真实入口：友商看板（CR-20260918-competitor-board，REQ-F-243）。
//
// 对比维度纯读取自已跟踪对象的 `params`（技术脊梁），本探针不新增、不删除、不修改任何真实
// 对象——只对话触发 show_competitor_board，然后核对动态屏上出现的表格内容是否真的对得上
// `/api/entities` 当下的真实数据。不伪造「零友商」「友商无参数」两种边界场景：伪造需要真的
// 删掉用户账下的真实对象，与本探针「不留痕迹」的原则冲突；这两种状态已由
// tests/competitor-board.test.tsx ②③ 用注入的 load() 覆盖。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

const before = await (await fetch(`${base}/api/entities`)).json();
const competitors = (before.entities ?? []).filter((entity) => entity.kind === "competitor");
console.log(`改前：已跟踪友商 ${competitors.length} 个（${competitors.map((c) => c.title).join("、") || "无"}）`);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
// 开场页：点一下即开始工作（REQ-F-102 ④）。
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

await send("请调用 show_competitor_board 工具，不用先搜索，直接调用。");

const board = page.getByRole("region", { name: "友商看板" });
await board.waitFor({ timeout: 30_000 }).catch(() => {});
const boardShown = (await board.count()) > 0;
console.log(`展示屏切到友商看板=${boardShown}`);

let columnsMatch = true;
let sharedDimensionChecked = false;
let sharedDimensionOk = true;
let noRegistrationLabelOk = true;

if (boardShown) {
  // ① 列头必须是真实数据里的友商标题，不是随便渲染点什么就算数。
  for (const competitor of competitors) {
    const header = board.getByRole("columnheader", { name: competitor.title });
    const present = (await header.count()) > 0;
    columnsMatch = columnsMatch && present;
    if (!present) console.log(`FAIL 列头缺失：${competitor.title}`);
  }

  // ② 若真实数据里至少两家友商共享同一个参数名，核对该维度行两边的值都对得上源数据；
  //   没有真实的共享维度就如实跳过，不伪造。
  const paramNames = new Map();
  for (const competitor of competitors) {
    for (const param of competitor.params ?? []) {
      if (!paramNames.has(param.name)) paramNames.set(param.name, []);
      paramNames.get(param.name).push({ title: competitor.title, value: param.value });
    }
  }
  const sharedEntry = [...paramNames.entries()].find(([, holders]) => holders.length >= 2);
  if (sharedEntry) {
    sharedDimensionChecked = true;
    const [dimensionName, holders] = sharedEntry;
    const rows = board.getByRole("row").filter({ hasText: dimensionName });
    const rowText = (await rows.count()) > 0 ? await rows.first().innerText() : "";
    for (const holder of holders) {
      const present = rowText.includes(holder.value);
      sharedDimensionOk = sharedDimensionOk && present;
      if (!present) console.log(`FAIL 共享维度「${dimensionName}」下 ${holder.title} 的值「${holder.value}」未出现在该行`);
    }
    console.log(`共享维度核对：「${dimensionName}」，各家的值都出现=${sharedDimensionOk}`);
  } else {
    console.log("真实数据里没有任何两家友商共享同一个参数名，跳过共享维度核对（不伪造）");
  }

  // ③ 没有登记任何参数的友商，应显示占位符而不是留空或报错。
  const noParamCompetitor = competitors.find((c) => (c.params ?? []).length === 0);
  if (noParamCompetitor) {
    const bodyText = await board.innerText();
    noRegistrationLabelOk = bodyText.includes("—") || bodyText.includes("还没有登记任何技术参数");
    console.log(`「${noParamCompetitor.title}」未登记参数时页面如实说明=${noRegistrationLabelOk}`);
  }
}

await browser.close();

const ok = boardShown && columnsMatch && sharedDimensionOk && noRegistrationLabelOk;
console.log(
  ok
    ? "PASS 友商看板在真实入口上可达，且列头、共享维度（若有）、未登记占位符都对得上真实数据"
    : `FAIL 看板出现=${boardShown} 列头匹配=${columnsMatch} 共享维度核对过=${sharedDimensionChecked}且一致=${sharedDimensionOk} 未登记占位符=${noRegistrationLabelOk}`
);
process.exit(ok ? 0 : 1);
