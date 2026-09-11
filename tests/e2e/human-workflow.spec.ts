import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

const mockModelPort = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321);
let mockServer: Server;

/** Reply echoes how many messages the server sent, so multi-turn context is observable. */
function streamingMock(reply: (count: number) => string[]) {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "human-model" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        let count = 0;
        try {
          count = JSON.parse(raw).messages?.length ?? 0;
        } catch {
          /* ignore */
        }
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        });
        for (const chunk of reply(count)) {
          response.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(chunk)}}}]}\n\n`);
        }
        response.write("data: [DONE]\n\n");
        response.end();
      });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
}

async function openCornerMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "打开菜单" });
  if (await trigger.count()) {
    await trigger.click();
  }
}

async function saveProviderThroughSettingsDialog(page: Page, name: string, baseUrl: string, model: string) {
  await openCornerMenu(page);
  await page.getByRole("button", { name: "模型" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "Model Providers" })).toBeVisible();

  await dialog.getByLabel("Provider type").selectOption("local");
  await dialog.getByLabel("Provider name").fill(name);
  await dialog.getByLabel("Base URL").fill(baseUrl);
  await dialog.getByLabel("Model", { exact: true }).fill(model);

  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/providers") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "Save provider" }).click();
  expect((await saved).status()).toBe(201);
  await expect(dialog.getByRole("status").first()).toContainText("Provider saved.");
  return dialog;
}

test.beforeAll(async () => {
  mockServer = streamingMock((count) => ["Human ", `ctx=${count}`, "\n\nUse `npm test` and **ship**.\n\n- one\n- two"]);
  await new Promise<void>((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(mockModelPort, "127.0.0.1", () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

test("human workflow: clean home, settings dialog, multi-turn chat with markdown, refresh restore", async ({ page }) => {
  await page.goto("/");

  // The home page is just the title; entries live in the bottom-left ☰ menu.
  await expect(page.getByRole("heading", { name: "Agent-Jarvis", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "配置" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开菜单" })).toBeVisible();
  await expect(page.getByRole("button", { name: "模型" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(page.getByRole("button", { name: "模型" })).toBeVisible();
  await expect(page.getByRole("button", { name: "账号登录" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "模型" })).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  const dialog = await saveProviderThroughSettingsDialog(
    page,
    "Human Local",
    `http://127.0.0.1:${mockModelPort}/v1`,
    "human-model"
  );

  await dialog.getByRole("button", { name: "Test connection" }).click();
  await expect(dialog.getByRole("status").first()).toContainText("Connection OK.");

  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Turn 1 — the model sees system + user. The console sends no provider; the
  // server resolves the only enabled one.
  await page.goto("/");
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("First question");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Human ctx=3")).toBeVisible();

  // Markdown is rendered, not shown as raw syntax.
  const transcript = page.locator(".floating-chat__messages");
  await expect(transcript.locator("code").first()).toHaveText("npm test");
  await expect(transcript.locator("strong").first()).toHaveText("ship");
  await expect(transcript.locator("li")).toHaveCount(2);
  await expect(transcript).not.toContainText("**ship**");

  // Turn 2 — prior turns are replayed, so the echoed context count grows.
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("Second question");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Human ctx=5")).toBeVisible();

  const recent = await (await page.request.get("/api/conversations/recent")).json();
  expect(recent.conversations).toHaveLength(1);
  expect(recent.conversations[0].title).toBe("First question");

  // Refresh — the active conversation comes back (REQ-F-013).
  await page.reload();
  await expect(page.getByText("First question")).toBeVisible();
  await expect(page.getByText("Second question")).toBeVisible();
});

test("human workflow: 新对话 clears the transcript and a refresh stays empty", async ({ page }) => {
  await page.goto("/");
  await saveProviderThroughSettingsDialog(
    page,
    "Fresh Local",
    `http://127.0.0.1:${mockModelPort}/v1`,
    "human-model"
  );
  await page.locator("dialog[open]").getByRole("button", { name: "关闭" }).click();

  await page.goto("/");
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("kept?");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("kept?")).toBeVisible();

  // Empty input -> the action button is 「新对话」.
  await page.getByRole("button", { name: "新对话" }).click();
  await expect(page.getByText("kept?")).toBeHidden();

  await page.reload();
  await expect(page.getByText("kept?")).toBeHidden();
});

test("human workflow: collapsing the panel keeps the conversation and survives a reload (REQ-F-019)", async ({ page }) => {
  await page.goto("/");
  await saveProviderThroughSettingsDialog(
    page,
    "Collapse Local",
    `http://127.0.0.1:${mockModelPort}/v1`,
    "human-model"
  );
  await page.locator("dialog[open]").getByRole("button", { name: "关闭" }).click();

  await page.goto("/");
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("collapse turn one");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Human ctx=3")).toBeVisible();

  // Collapse — transcript hidden, but the session is still active.
  await page.getByRole("button", { name: "收起对话" }).click();
  await expect(page.locator(".floating-chat__messages")).toBeHidden();

  await page.reload();
  await expect(page.locator(".floating-chat__messages")).toBeHidden();
  await expect(page.getByRole("button", { name: "展开对话" })).toBeVisible();

  // Sending while collapsed re-expands and continues the SAME conversation:
  // the echoed context count grows to 4 (system + turn1 user/assistant + turn2 user).
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("collapse turn two");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".floating-chat__messages")).toBeVisible();
  await expect(page.getByText("Human ctx=5")).toBeVisible();
});

test("human workflow: appearance toggle (in the ☰ menu) switches and persists the dark theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Switching theme opens no dialog.
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("human workflow: the ☰ menu stays reachable while the chat panel is expanded (TEST-032 ⑦)", async ({ page }) => {
  await page.goto("/");
  await saveProviderThroughSettingsDialog(
    page,
    "Menu Local",
    `http://127.0.0.1:${mockModelPort}/v1`,
    "human-model"
  );
  await page.locator("dialog[open]").getByRole("button", { name: "关闭" }).click();

  await page.goto("/");
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("expand the panel");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".floating-chat__messages")).toBeVisible();

  // With the panel expanded, the ☰ trigger still opens its menu.
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(page.getByRole("menu", { name: "Agent-Jarvis 菜单" })).toBeVisible();
  await expect(page.getByRole("button", { name: "模型" })).toBeVisible();
});

test("human workflow: the account dialog separates Agent-Jarvis login from model authorization", async ({ page }) => {
  await page.goto("/");
  await openCornerMenu(page);
  await page.getByRole("button", { name: "账号登录" }).click();

  const dialog = page.locator("dialog[open]");
  await expect(dialog).toContainText("Agent-Jarvis 账号 ≠ 模型授权");
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("human workflow: the NextAuth route handler is actually loadable", async ({ page }) => {
  // A corrupted .next build breaks /api/auth/* with a module-resolution 500 that
  // the JARVIS_TEST_USER_ID bypass hides from every other test.
  const csrf = await page.request.get("/api/auth/csrf");
  expect(csrf.status()).toBe(200);
  expect((await csrf.json()).csrfToken).toBeTruthy();

  const signin = await page.request.get("/api/auth/signin");
  expect(signin.status()).toBe(200);
});

test("human workflow: Stop halts the stream server-side", async ({ page }) => {
  const slowPort = mockModelPort + 5;
  const slow = createServer((request, response) => {
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    let i = 0;
    const timer = setInterval(() => {
      if (i++ > 20 || response.writableEnded) {
        clearInterval(timer);
        try {
          response.end();
        } catch {
          /* already closed */
        }
        return;
      }
      response.write(`data: {"choices":[{"delta":{"content":" more${i}"}}]}\n\n`);
    }, 200);
    request.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => slow.listen(slowPort, "127.0.0.1", () => resolve()));

  try {
    await page.goto("/");
    // Isolate: the console has no switcher, so "Slow Local" must be the only
    // provider for the server to resolve to it (REQ-F-006).
    const existing = await (await page.request.get("/api/providers")).json();
    for (const provider of existing.providers ?? []) {
      await page.request.delete(`/api/providers/${provider.id}`);
    }

    const dialog = await saveProviderThroughSettingsDialog(page, "Slow Local", `http://127.0.0.1:${slowPort}/v1`, "slow");
    await dialog.getByRole("button", { name: "关闭" }).click();

    await page.goto("/");
    await page.getByPlaceholder("Ask Agent-Jarvis").fill("stream forever");
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.getByText("partial")).toBeVisible();
    await page.getByRole("button", { name: "停止" }).click();
    await expect(page.getByText(/已停止/)).toBeVisible();

    // The persisted assistant turn is marked stopped, not complete.
    const recent = await (await page.request.get("/api/conversations/recent")).json();
    const conversationId = recent.conversations[0].id;
    const messages = await (await page.request.get(`/api/conversations/${conversationId}/messages`)).json();
    const assistant = messages.messages.at(-1);
    expect(assistant.role).toBe("assistant");
    expect(assistant.status).toBe("stopped");
  } finally {
    await new Promise<void>((resolve) => slow.close(() => resolve()));
  }
});
