// 真实入口：CR-20261016-board-card-info-first 的两个变化点在真实浏览器里核对。
//
// 机器断言已经由 tests/knowledge-dashboard.test.tsx 的 ⑤d 与 ⑥ 守住（jsdom）。真实浏览器
// 这一遍要回答的是 jsdom 答不了的那部分：展开一张**真有 7 条消息**的卡片时，用户第一眼看到
// 的确实只有 5 条链接；「查看全部（7）」真的能展开、也真的能收回；卡片正面确实没有
// 「问 Jarvis 关于这个对象」；以及消息确实是指向来源的链接（href + 新标签）。
//
// 数据准备沿用 scripts/probe-change-history-and-sources.mjs 的做法：对运行中服务器的同一份
// .data/entities 目录直接写历史 JSONL，把「有真实数据可渲染」变成确定性前提，要核对的渲染
// 本身仍然是真实的。全程用一个带时间戳的一次性对象，结束时无论成败都 DELETE 清理。
//
// 为什么写 7 条：5 是上限，6 用来验「第 6 条默认不在 DOM 里」，7 用来验「展开后最后一条也在」。
// 只写 6 条的话，「展开后多出来的那条」与「上限那条」会是同一条，验不出展开的完整性。
import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

/**
 * 不硬编码对象根目录。按用户隔离（CR-20260918-per-user-data-isolation）之后，本机单管理员
 * 模式下实际是 `.data/users/admin/entities`，而不是 `.data/entities`——照后者写会悄悄写到
 * 一个服务器根本不读的地方，历史 API 读回 0 条（本探针第一版就是这么失败的）。
 * 所以建完对象先在盘上找到它的 `<name>.md`，再由那个位置推导 history 目录。
 */
async function findEntitiesRoot(name) {
  if (process.env.JARVIS_ENTITIES_PATH) {
    return process.env.JARVIS_ENTITIES_PATH;
  }
  const dataRoot = join(process.cwd(), ".data");
  const candidates = [join(dataRoot, "entities")];
  const usersRoot = join(dataRoot, "users");
  const users = await readdir(usersRoot).catch(() => []);
  for (const user of users) {
    candidates.push(join(usersRoot, user, "entities"));
  }
  for (const candidate of candidates) {
    const hit = await stat(join(candidate, `${name}.md`)).catch(() => null);
    if (hit) {
      return candidate;
    }
  }
  throw new Error(`盘上找不到刚建立的对象 ${name}.md，无法确定 entities 根目录`);
}
const testTitle = `探针测试友商-${Date.now()}`;
const TOTAL = 7;
const PREVIEW = 5;

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
  const created = await api("/api/entities", {
    method: "POST",
    body: JSON.stringify({ kind: "competitor", title: testTitle }),
  });
  if (created.status !== 201) {
    throw new Error(`建对象失败：HTTP ${created.status}`);
  }
  entityName = created.body.entity.name;
  console.log(`已建立探针对象：${entityName}`);

  // 7 条历史，新的在前（readHistory 返回 newest first，所以这里按时间递增写，第 7 条最新）。
  const entitiesRoot = await findEntitiesRoot(entityName);
  console.log(`entities 根目录=${entitiesRoot}`);
  const historyDir = join(entitiesRoot, "history");
  await mkdir(historyDir, { recursive: true });
  // `change` 按 describeChange 的真实格式写（`新增 N 行，移除 M 行：<首个新增行>`），这样才验得出
  // CP-4：界面上应当只出现冒号后面的标题，行数前缀不该露出来。
  const entries = Array.from({ length: TOTAL }, (_, i) => ({
    at: new Date(Date.UTC(2026, 9, 1 + i, 10, 0, 0)).toISOString(),
    url: `https://probe.example/board-card-info-first/${i + 1}`,
    change: `新增 ${i + 1} 行，移除 2 行：探针消息第 ${i + 1} 条`,
  }));
  await appendFile(
    join(historyDir, `${entityName}.jsonl`),
    entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    "utf8"
  );
  const historyCheck = await api(`/api/entities/${encodeURIComponent(entityName)}/history`);
  const readBack = historyCheck.body.entries ?? [];
  const historyOk = historyCheck.status === 200 && readBack.length === TOTAL;
  console.log(`API 读回 ${readBack.length} 条（期望 ${TOTAL}）=${historyOk}`);
  if (!historyOk) fail("history API 读回条数不符——探针自己的准备工作有问题");
  // 最新的一条应是第 7 条：下面「展开后可见」的断言依赖这个顺序。
  const newestFirst = (readBack[0]?.change ?? "").endsWith(`探针消息第 ${TOTAL} 条`);
  console.log(`最新的一条排在最前=${newestFirst}`);
  if (!newestFirst) fail("历史顺序不是 newest first");

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.mouse.click(720, 450);
  await page.waitForTimeout(300);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jarvis:display-stage", { detail: { stage: "board" } })));
  await page.waitForTimeout(500);

  const card = page.getByText(testTitle, { exact: true }).first();
  await card.waitFor({ timeout: 10_000 });
  await card.click();
  await page.waitForTimeout(400);

  // ① 第一眼只有 5 条：最新的 7、6、5、4、3 在，第 2 条与第 1 条不在。
  const visible = [];
  for (let i = 1; i <= TOTAL; i += 1) {
    const count = await page.getByRole("link", { name: `探针消息第 ${i} 条` }).count();
    if (count > 0) visible.push(i);
  }
  const expectedPreview = [3, 4, 5, 6, 7];
  const previewOk = visible.length === PREVIEW && expectedPreview.every((i) => visible.includes(i));
  console.log(`展开第一眼可见条目=${JSON.stringify(visible)}（期望 ${JSON.stringify(expectedPreview)}）=${previewOk}`);
  if (!previewOk) fail(`展开态不是只显示最近 ${PREVIEW} 条`);

  // ② 消息是真链接：href 指向来源，且在新标签打开。
  const newest = page.getByRole("link", { name: `探针消息第 ${TOTAL} 条` }).first();
  const href = await newest.getAttribute("href");
  const target = await newest.getAttribute("target");
  const linkOk = href === entries[TOTAL - 1].url && target === "_blank";
  console.log(`最新一条 href=${href} target=${target} 正确=${linkOk}`);
  if (!linkOk) fail("消息未渲染成指向来源的新标签链接");

  // ③ 卡片正面没有「问 Jarvis 关于这个对象」——先确认展开态真的渲染完了，否则「查不到」可能
  //    只是还没渲染，这条断言会变成永远通过的空断言。锚点用「最近消息」：CP-3 之后参数段不在了，
  //    不能再拿它当锚。
  await page.getByText("最近消息").first().waitFor({ timeout: 5_000 });
  const askCount = await page.getByText("问 Jarvis 关于这个对象").count();
  console.log(`卡片正面「问 Jarvis 关于这个对象」已消失=${askCount === 0}`);
  if (askCount !== 0) fail("卡片正面仍有「问 Jarvis 关于这个对象」按钮");

  // ③b CP-3：技术参数与要求整段不在卡片上。
  const paramsCount = await page.getByText("技术参数与要求").count();
  console.log(`「技术参数与要求」整段已消失=${paramsCount === 0}`);
  if (paramsCount !== 0) fail("卡片上仍有「技术参数与要求」段");

  // ③c CP-4：界面上只出现标题，行数前缀不露出来（已落盘的 change 里仍然有）。
  const prefixCount = await page.getByText(/新增 \d+ 行/).count();
  console.log(`行数前缀未出现在界面上=${prefixCount === 0}`);
  if (prefixCount !== 0) fail("消息行仍带着「新增 N 行」前缀");

  // ④ 「查看全部（7）」展开其余，再收回。
  const showAll = page.getByRole("button", { name: `查看全部（${TOTAL}）` });
  const showAllShown = (await showAll.count()) > 0;
  const ariaBefore = showAllShown ? await showAll.first().getAttribute("aria-expanded") : null;
  console.log(`「查看全部（${TOTAL}）」存在=${showAllShown}，aria-expanded=${ariaBefore}`);
  if (!showAllShown || ariaBefore !== "false") fail("「查看全部」按钮缺失或 aria-expanded 初值不对");

  if (showAllShown) {
    await showAll.first().click();
    await page.waitForTimeout(300);
    const firstShown = (await page.getByRole("link", { name: "探针消息第 1 条" }).count()) > 0;
    const secondShown = (await page.getByRole("link", { name: "探针消息第 2 条" }).count()) > 0;
    console.log(`展开后第 1 条可见=${firstShown}，第 2 条可见=${secondShown}`);
    if (!firstShown || !secondShown) fail("「查看全部」没有展开其余条目");

    const collapse = page.getByRole("button", { name: `只看最近 ${PREVIEW} 条` });
    const collapseShown = (await collapse.count()) > 0;
    const ariaAfter = collapseShown ? await collapse.first().getAttribute("aria-expanded") : null;
    console.log(`收回按钮存在=${collapseShown}，aria-expanded=${ariaAfter}`);
    if (!collapseShown || ariaAfter !== "true") fail("展开后没有可收回的入口或 aria-expanded 未翻转");

    if (collapseShown) {
      await collapse.first().click();
      await page.waitForTimeout(300);
      const firstGone = (await page.getByRole("link", { name: "探针消息第 1 条" }).count()) === 0;
      console.log(`收回后第 1 条重新消失=${firstGone}`);
      if (!firstGone) fail("收回没有把其余条目收起来");
    }
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

console.log(
  ok
    ? `PASS 展开只显示最近 ${PREVIEW} 条且各为指向来源的链接、「查看全部」可展开可收回、卡片正面已无「问 Jarvis 关于这个对象」`
    : "FAIL 见上方明细"
);
process.exit(ok ? 0 : 1);
