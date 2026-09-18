// 真实入口：模型能不能在被要求"学术会议参会前瞻"时，用既有的 save_insight/show_insight
// 机制产出一份结构合理（日程/panel/核心专家）的洞察，并固化显示在动态屏上
// （CR-20260918-conference-preview-insight，对应 INPUT-2026-09-18-001 第 9b 条）。
//
// 本 CR 投入实现前的代码核对已经确认：save_insight/show_insight 是完全通用的机制（任意
// HTML 内容、任意主题，无技能/内容类型耦合），且已有大量既有单测覆盖其通用行为
// （tests/tool-suites.test.ts、tests/tool-suites-append.test.ts、
// tests/skill-report-bridge.test.ts）。因此这个 CR 没有新代码——探针要核对的不是"这个
// 功能能不能用"，是"模型被这样问的时候，会不会自己想到调用这个已有机制，并且产出的内容
// 结构像不像一份及格的参会前瞻"。这是内容质量/模型行为层面的核验，不是代码层面的。
//
// 对话历史跨刷新持久（REQ-F-013）——先点「新对话」，避免历史对话影响本次判断。
import { chromium } from "@playwright/test";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";

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

// 特意用一个真实、近期会开的学术/行业会议做例子，让模型有真实信息可查（如果它会调用
// web_search/read_url 之类的工具）。用词直接取自用户原话："日程，panel，核心专家"。
await send(
  "帮我做一份 2026 年 APEC（国际电力电子会议）的参会前瞻洞察，包括日程、panel、核心专家，" +
    "参考业界最佳实践的会议前瞻报告应该有的结构来组织内容，完成后显示在展示屏上。"
);

// 真实一轮跑下来：一份带真实检索的会议前瞻报告耗时约 2 分钟（多轮 web_search/read_url +
// save_insight 分块），固定等 60 秒会在报告完全生成前就去查，得到假阴性——第一版探针正是
// 这样误判过一次。改为轮询"停止"按钮是否已经消失（等于流式真正结束），比猜一个固定时长
// 稳，上限 4 分钟。
async function waitForIdle(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const stillStreaming = (await page.getByRole("button", { name: "停止" }).count()) > 0;
    if (!stillStreaming) {
      return true;
    }
    await page.waitForTimeout(5_000);
  }
  return false;
}
const finished = await waitForIdle(240_000);
console.log(`流式在超时前结束=${finished}`);

// 洞察渲染在 sandbox="allow-scripts" 的 <iframe srcDoc> 里（DEC-015），跟外层页面不同源
// ——page.locator() 只查主 frame 的 DOM 树，看不进 iframe，之前两版探针用
// page.locator(".jarvis-insight") 因此稳定假阴性（同一时刻直接查 /api/display 能确认
// insight 其实已经真实生成）。用 frameLocator 按 iframe 的 title 精确定位再查内部内容。
const insightFrame = page.frameLocator('iframe[title="技能洞察报告"]');
const insightShown = (await page.locator('iframe[title="技能洞察报告"]').count()) > 0;
const bodyText = insightShown ? await insightFrame.locator("body").innerText() : "";

const hasScheduleHint = /日程|schedule|议程|时间表/i.test(bodyText);
const hasPanelHint = /panel|专题|讨论环节|分论坛/i.test(bodyText);
const hasExpertHint = /专家|speaker|嘉宾|keynote/i.test(bodyText);

console.log(`展示屏出现 insight=${insightShown}`);
console.log(`内容含日程相关字样=${hasScheduleHint}，panel 相关字样=${hasPanelHint}，专家相关字样=${hasExpertHint}`);
if (process.env.PROBE_DEBUG) {
  console.log("=== DEBUG：insight 正文前 2000 字 ===");
  console.log(bodyText.slice(0, 2000));
}

await browser.close();

// 这是内容质量核验，不是布尔正确性核验——三个关键词信号里只要多数命中，就认为模型确实
// 理解了"参会前瞻"这个体裁的既有认知已经够用，不需要专门为这类洞察新增任何机制或指引。
const signals = [hasScheduleHint, hasPanelHint, hasExpertHint].filter(Boolean).length;
const ok = finished && insightShown && signals >= 2;
console.log(
  ok
    ? "PASS 既有 save_insight/show_insight 机制足以支撑「学术会议参会前瞻」这类洞察，无需新增代码"
    : `FAIL 见上方明细（流式结束=${finished}，insightShown=${insightShown}，命中信号数=${signals}/3）——若持续不过，可能需要专门的技能而非依赖模型通识`
);
process.exit(ok ? 0 : 1);
