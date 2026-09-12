import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

/**
 * TEST-096 — real-entry proof for CR-20260911-display-console-ux
 * (REQ-F-050 ①, REQ-F-052, REQ-F-053, REQ-F-054).
 *
 * Each of the three user reports is checked where the user saw it:
 *   ① a chunked report ends up as ONE styled document on the display screen;
 *   ② the ☰ drawer fits a 1024×700 viewport and covers the chat with a backdrop;
 *   ③ moving the pointer onto the display screen tucks the transcript away.
 *
 * The file name puts this spec LAST. Every spec shares one database and one worker
 * (see playwright.config.ts), and `human-workflow.spec.ts` counts the messages the model
 * receives — a conversation left behind by an earlier spec changes that count. This spec
 * creates conversations, so it runs after the ones that assume a fresh database.
 */

const port = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321) + 5;
let mock: Server;

/**
 * The mock answers "report" with two `save_insight` calls: the first creates the
 * insight, the second appends to it using the id the tool handed back. That id only
 * exists in the tool result, so this exercises the real round trip rather than a
 * pre-arranged value.
 */
function mockModel() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "m" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }

    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body = safeJson(raw);
      const messages = body.messages ?? [];
      // Only the CURRENT loop decides what to emit: the last row is the tool result we
      // just produced. Scanning the whole history would see restored earlier turns (this
      // spec runs last, on a database other specs have already written to).
      const last = messages.at(-1);
      const lastToolContent = last?.role === "tool" ? (last.content ?? "") : "";

      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      const emitToolCall = (id: string, name: string, args: Record<string, unknown>) => {
        response.write(
          `data: ${JSON.stringify({
            choices: [
              { delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } },
            ],
          })}\n\n`
        );
      };

      const createdId = /洞察已保存（id ([0-9a-f-]{36})/.exec(lastToolContent)?.[1];
      const lastUser = [...messages].reverse().find((message) => message.role === "user");

      if (createdId) {
        // The id came back inside the first tool result — parse it the way a model would.
        emitToolCall("call_2", "save_insight", { html: "<h2>第二部分</h2><p>追加的内容。</p>", insightId: createdId });
      } else if (lastToolContent) {
        // Any other tool result (append done, or 回首页) ends the loop with plain text.
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "好的。" } }] })}\n\n`);
      } else if (/回首页/.test(lastUser?.content ?? "")) {
        // Hands the shared display state back before the spec ends — every spec file runs
        // against one database and one global `display_state` row.
        emitToolCall("call_home", "show_home", {});
      } else {
        emitToolCall("call_1", "save_insight", {
          html: "<h1>分块报告</h1><h2>第一部分</h2><table><tr><th>维度</th><th>值</th></tr><tr><td>供电</td><td>800 VDC</td></tr></table>",
        });
      }
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
}

function safeJson(raw: string): {
  messages?: Array<{ role: string; content?: string; tool_calls?: unknown }>;
  stream?: boolean;
} {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Leave the shared display state as we found it. `display_state` is one global row, so a
 * spec that ends on an insight would make every later spec's "home" assertion fail.
 */
async function returnDisplayHome(page: Page) {
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("回首页");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".display-screen--home h1")).toHaveText("Agent-Jarvis", { timeout: 15_000 });
}

async function removeAllProviders(page: Page) {
  const existing = await (await page.request.get("/api/providers")).json();
  for (const provider of existing.providers ?? []) {
    await page.request.delete(`/api/providers/${provider.id}`);
  }
}

/** Start from an empty console: this spec runs last, so a previous spec's conversation is restored. */
async function startFreshConversation(page: Page) {
  const newChat = page.getByRole("button", { name: "新对话" });
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click();
  }
  await expect(page.locator(".floating-chat__messages")).toHaveCount(0);
}

async function configureProvider(page: Page) {
  await page.goto("/");
  await removeAllProviders(page);
  await page.goto("/");
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "模型" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Provider type").selectOption("local");
  await dialog.getByLabel("Provider name").fill("MockUX");
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByLabel("Model", { exact: true }).fill("m");
  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(dialog.getByRole("status").first()).toContainText("Provider saved.");
  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.keyboard.press("Escape");
}

test.beforeAll(async () => {
  mock = mockModel();
  await new Promise<void>((resolve) => mock.listen(port, "127.0.0.1", () => resolve()));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

test("① 分块提交拼成一份带样式的报告上屏 (REQ-F-050 ①, REQ-F-052)", async ({ page }) => {
  await configureProvider(page);
  await page.goto("/");
  await startFreshConversation(page);

  await page.getByPlaceholder("Ask Agent-Jarvis").fill("make a chunked report");
  await page.getByRole("button", { name: "发送" }).click();

  // Two save_insight steps, and the second one succeeded (the append).
  await expect(page.locator(".floating-chat__step").filter({ hasText: "save_insight" })).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(page.locator('.floating-chat__step[data-state="failed"]')).toHaveCount(0);

  // REQ-F-140 ④ (CR-20260912-skill-report-bridge): the report is the deliverable, so the
  // console steps aside once the turn ends. Measured at 1440×900 the two are both centred
  // and overlap by 768px — 78% of the report sits behind the chat until this happens.
  await expect(page.locator(".floating-chat__messages")).toHaveCSS("opacity", "0", { timeout: 10_000 });
  await expect(page.locator(".floating-chat")).toHaveClass(/floating-chat--auto-hidden/);
  // And it comes straight back the moment the user goes to type (REQ-F-054 ③).
  await page.getByPlaceholder("Ask Agent-Jarvis").focus();
  await expect(page.locator(".floating-chat__messages")).not.toHaveClass(/floating-chat__messages--hidden/, {
    timeout: 10_000,
  });

  const frame = page.frameLocator(".display-screen__frame");
  // Both chunks are in the SAME document — the whole point of the append mode.
  await expect(frame.locator("h1")).toHaveText("分块报告");
  await expect(frame.locator("h2")).toHaveCount(2);
  await expect(frame.locator("h2").nth(1)).toHaveText("第二部分");

  // REQ-F-052 ①: the base stylesheet actually applies — a bare fragment's table has borders.
  const borderWidth = await frame.locator("td").first().evaluate((node) => getComputedStyle(node).borderTopWidth);
  expect(parseFloat(borderWidth)).toBeGreaterThan(0);
  const bodyClass = await frame.locator("body").getAttribute("class");
  expect(bodyClass).toContain("jarvis-insight");

  // REQ-F-101 ①② (CR-20260912-sandbox-and-budget). Everything above already proves the
  // sandbox did not break rendering — styles, theme and both chunks are still there.
  // These two check the isolation itself, at the real entry.
  const sandbox = await page.locator(".display-screen__frame").getAttribute("sandbox");
  expect(sandbox).toBeTruthy();
  expect(sandbox).not.toContain("allow-same-origin");

  // The property that actually cuts the injection chain: inside an opaque origin, reaching
  // for this app's storage throws. Before the sandbox this returned "accessible", and a
  // script in a model- or web-authored report could read the host origin's data and call
  // its API with the user's session.
  const storageReach = await frame.locator("body").evaluate(() => {
    try {
      void window.localStorage.length;
      return "accessible";
    } catch {
      return "blocked";
    }
  });
  expect(storageReach).toBe("blocked");

  // REQ-F-052 ②: the iframe document follows the host theme.
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "深色" }).click();
  await page.keyboard.press("Escape");
  await expect(page.frameLocator(".display-screen__frame").locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "浅色" }).click();
  await page.keyboard.press("Escape");

  await returnDisplayHome(page);
});

test("② 1024×700 下抽屉完整在视口内，且以遮罩隔开对话框 (REQ-F-053 ①②)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto("/");

  await page.getByRole("button", { name: "打开菜单" }).click();
  const drawer = page.getByRole("dialog", { name: "Agent-Jarvis 菜单" });
  await expect(drawer).toBeVisible();
  // The drawer slides in; measuring mid-flight reads an off-screen x. Wait for the
  // animation to settle before asserting geometry.
  await drawer.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));

  const box = (await drawer.boundingBox())!;
  // Fully inside the viewport — the popover used to be clipped 26px off the top.
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(700 + 1);
  expect(box.x + box.width).toBeLessThanOrEqual(1024 + 1);

  // The drawer is modal, so it may sit over the chat — what must not happen is the old
  // popover behaviour, where a non-modal panel overlapped a still-interactive console.
  // The backdrop covers the viewport and takes the clicks (REQ-F-053 ②).
  const backdrop = page.locator(".corner-menu__backdrop");
  await expect(backdrop).toBeVisible();
  const backdropBox = (await backdrop.boundingBox())!;
  const chat = (await page.locator(".floating-chat").boundingBox())!;
  expect(backdropBox.width).toBeGreaterThanOrEqual(1024);
  expect(backdropBox.height).toBeGreaterThanOrEqual(700);
  // The chat's send control is behind the backdrop: a click there closes the drawer
  // rather than reaching the console.
  await page.mouse.click(chat.x + chat.width / 2, chat.y + chat.height - 20);
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(drawer).toBeVisible();

  // Every group heading is reachable inside the scrolling drawer.
  await expect(drawer.getByRole("heading", { name: "外观" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "浅色" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "打开菜单" })).toBeFocused();
});

test("③ 指针移到展示屏收缩、回到输入框展开 (REQ-F-054)", async ({ page }) => {
  await configureProvider(page);
  await page.goto("/");
  await startFreshConversation(page);

  await page.getByPlaceholder("Ask Agent-Jarvis").fill("make a chunked report");
  await page.getByRole("button", { name: "发送" }).click();
  const transcript = page.locator(".floating-chat__messages");
  await expect(transcript).toBeVisible();
  await expect(page.locator(".floating-chat__step").filter({ hasText: "save_insight" }).first()).toBeVisible({
    timeout: 15_000,
  });
  // Wait out the stream: auto-hide is deliberately suppressed while it runs.
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0, { timeout: 15_000 });

  // Move the pointer onto the display screen and leave it there.
  await page.mouse.move(600, 60);
  await expect(transcript).toHaveClass(/floating-chat__messages--hidden/, { timeout: 5_000 });

  // Coming back to the input restores it at once.
  await page.getByPlaceholder("Ask Agent-Jarvis").focus();
  await expect(transcript).not.toHaveClass(/floating-chat__messages--hidden/);

  await returnDisplayHome(page);
  await removeAllProviders(page);
});
