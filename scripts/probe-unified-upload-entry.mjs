// 真实入口：控制台的「上传」入口展开菜单，「文件夹」「zip 压缩包」两个选项各自打开
// 正确的系统选择器、选完之后真的注册出技能（CR-20260915-unified-upload-entry，
// REQ-F-020 ⑧）。文件夹一侧走到底（选一个探针自建的一次性小目录，注册后立即用既有
// 删除入口清理），验证的不只是「弹出了选择器」，是「弹出的是对的那一个、选完之后这
// 条链路真的还通」；zip 一侧只核对触发了选择器——那条注册链路本身已由既有的
// CR-20260910-skill-intake 真实入口覆盖，未受本次 UI 改动影响，不必重复走一遍模型调用。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const probeFolderPath = process.env.PROBE_FOLDER_PATH;
if (!probeFolderPath) {
  console.log("FAIL 缺少环境变量 PROBE_FOLDER_PATH（探针用的一次性文件夹的 Windows 路径）");
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.mouse.click(720, 450);
await page.waitForTimeout(300);

const oldFolderButton = await page.getByRole("button", { name: "上传文件夹" }).count();
const oldZipButton = await page.getByRole("button", { name: "上传 zip" }).count();
const trigger = page.getByRole("button", { name: "上传", exact: true });
const triggerCount = await trigger.count();
console.log(`旧按钮已消失：文件夹=${oldFolderButton === 0}，zip=${oldZipButton === 0}；新入口「上传」出现=${triggerCount === 1}`);

await trigger.click();
const folderItem = page.getByRole("menuitem", { name: "文件夹" });
const zipItem = page.getByRole("menuitem", { name: "zip 压缩包" });
const menuShown = (await folderItem.count()) === 1 && (await zipItem.count()) === 1;
console.log(`点击「上传」后菜单两个选项都出现=${menuShown}`);

let folderOpensChooser = false;
let folderRegistered = false;
let registeredName = null;
if (menuShown) {
  // 监听真实响应拿服务端定的 name（模型生成的 SKILL.md 决定显示名，不是文件夹名本身），
  // 清理时要用这个，不能靠猜文件夹名反推。
  const registerResponsePromise = page
    .waitForResponse((response) => response.url().endsWith("/api/skills") && response.request().method() === "POST", {
      timeout: 30_000,
    })
    .catch(() => null);
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
  await folderItem.click();
  const chooser = await chooserPromise;
  folderOpensChooser = chooser !== null;
  if (chooser) {
    await chooser.setFiles([probeFolderPath]);
    const response = await registerResponsePromise;
    if (response?.ok()) {
      const body = await response.json().catch(() => ({}));
      registeredName = body.name ?? null;
    }
    folderRegistered = registeredName !== null;
  }
}
console.log(`点击「文件夹」触发了系统文件选择器=${folderOpensChooser}，选完真的注册出技能=${folderRegistered}（name=${registeredName}）`);

await trigger.click();
let zipOpensChooser = false;
if ((await zipItem.count()) === 1) {
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
  await zipItem.click();
  const chooser = await chooserPromise;
  zipOpensChooser = chooser !== null;
  if (chooser) {
    await chooser.setFiles([]);
  }
}
console.log(`点击「zip 压缩包」触发了系统文件选择器=${zipOpensChooser}`);

await browser.close();

// 清理：不管上面成不成功都尝试删一次，探针不该在真实技能列表里留下痕迹。
if (registeredName) {
  const cleanup = await fetch(`${base}/api/skills/${encodeURIComponent(registeredName)}`, { method: "DELETE" }).catch(() => null);
  console.log(`清理探针技能「${registeredName}」：${cleanup?.ok ? "已删除" : `失败（${cleanup?.status ?? "网络错误"}）`}`);
}

const ok =
  oldFolderButton === 0 &&
  oldZipButton === 0 &&
  triggerCount === 1 &&
  menuShown &&
  folderOpensChooser &&
  folderRegistered &&
  zipOpensChooser;
console.log(ok ? "PASS 上传入口已收敛为一个按钮，菜单两个选项各自可用且选完确实生效" : "FAIL 见上方明细");
process.exit(ok ? 0 : 1);
