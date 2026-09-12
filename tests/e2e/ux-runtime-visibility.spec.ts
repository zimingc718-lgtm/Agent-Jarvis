import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

/**
 * TEST-182 — real-entry proof that the runtime describes itself (REQ-F-120 ④).
 * CR-20260912-runtime-visibility.
 *
 * The report was that Jarvis could not say which model it was on. Asked「现在你知道接了
 * 什么模型了吗」it answered「我没有自检接口，拿不到当前接入的是哪家模型」— and that was
 * true, because nothing in the prompt said.
 *
 * So the thing to check at the real entry is what the provider actually receives: the
 * mock records the messages of a real send from a real browser and the assertions run
 * against those, not against a unit-level call to the assembler.
 */

const port = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321) + 7;
const PROVIDER_NAME = "MockRuntime";
const MODEL_ID = "mock-model-x";

let mock: Server;
let lastMessages: Array<{ role: string; content?: string }> = [];

function mockModel() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: MODEL_ID }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      try {
        lastMessages = (JSON.parse(raw).messages ?? []) as typeof lastMessages;
      } catch {
        lastMessages = [];
      }
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "好的。" } }] })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
}

async function removeAllProviders(page: Page) {
  const existing = await (await page.request.get("/api/providers")).json();
  for (const provider of existing.providers ?? []) {
    await page.request.delete(`/api/providers/${provider.id}`);
  }
}

test.beforeAll(async () => {
  mock = mockModel();
  await new Promise<void>((resolve) => mock.listen(port, "127.0.0.1", () => resolve()));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

test("① 发出的提示里带着当前 Provider 与模型 (REQ-F-120 ④)", async ({ page }) => {
  await page.goto("/");
  await removeAllProviders(page);
  await page.goto("/");
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "模型" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Provider type").selectOption("local");
  await dialog.getByLabel("Provider name").fill(PROVIDER_NAME);
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByLabel("Model", { exact: true }).fill(MODEL_ID);
  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(dialog.getByRole("status").first()).toContainText("Provider saved.");
  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.keyboard.press("Escape");

  const newChat = page.getByRole("button", { name: "新对话" });
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click();
  }

  await page.getByPlaceholder("Ask Agent-Jarvis").fill("你现在接的是什么模型？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".floating-chat__message--assistant").last()).toContainText("好的。", { timeout: 20_000 });

  const systems = lastMessages.filter((message) => message.role === "system").map((message) => message.content ?? "");
  const runtime = systems.find((content) => content.includes("当前运行时"));
  expect(runtime, "提示里应当有一条描述当前运行时的 system 消息").toBeTruthy();
  // Both halves matter: 「是不是 DeepSeek」 and 「是不是我配的那个」 are different questions.
  expect(runtime).toContain(PROVIDER_NAME);
  expect(runtime).toContain(MODEL_ID);

  // It must sit AFTER the stable prefix, not inside it — switching model must not rewrite
  // the cached prefix (REQ-NF-008 ①).
  const identity = systems.findIndex((content) => content.includes("Agent-Jarvis"));
  const runtimeAt = systems.findIndex((content) => content.includes("当前运行时"));
  expect(identity).toBeGreaterThanOrEqual(0);
  expect(runtimeAt).toBeGreaterThan(identity);
});
