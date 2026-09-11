import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

// CR-20260911-proactive-wake — TEST-104 (real entry, REQ-F-060 / REQ-F-061 / REQ-NF-020).
//
// Wake-ups default off; 「现在唤醒」 fires one bounded, non-streaming call whose reminder
// lands in the transcript as a system row and survives a reload; the daily cap stops
// further wakes; the switch persists. The scheduler's timing itself is unit-tested with
// fake timers (TEST-103 ④) — a real 60-second wait belongs to no e2e run.

const port = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321) + 4;
let mock: Server;
let nonStreamingCalls = 0;

function mockModel() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "wake-model" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        let body: { stream?: boolean; max_tokens?: number; messages?: Array<{ role: string; content: string }> } = {};
        try {
          body = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        if (body.stream === false) {
          // The wake call: one non-streaming request with a bounded reply (REQ-NF-020 ①).
          nonStreamingCalls += 1;
          const bounded = body.max_tokens === 200 && /空闲唤醒/.test(body.messages?.[0]?.content ?? "");
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ choices: [{ message: { content: bounded ? "记得处理 8443 端口的反向代理。" : "UNEXPECTED PROMPT SHAPE" } }] })
          );
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
        response.write(`data: {"choices":[{"delta":{"content":"好的，明天配反向代理。"}}]}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
      });
      return;
    }
    response.writeHead(404).end();
  });
}

async function removeAllProviders(page: Page) {
  const existing = await (await page.request.get("/api/providers")).json();
  for (const provider of existing.providers ?? []) {
    await page.request.delete(`/api/providers/${provider.id}`);
  }
}

async function configureProvider(page: Page) {
  await page.goto("/");
  await removeAllProviders(page);
  await page.goto("/");
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "模型" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Provider type").selectOption("local");
  await dialog.getByLabel("Provider name").fill("Wake Mock");
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByLabel("Model", { exact: true }).fill("wake-model");
  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(dialog.getByRole("status").first()).toContainText("Provider saved.");
  await dialog.getByRole("button", { name: "关闭" }).click();
}

test.beforeAll(async () => {
  mock = mockModel();
  await new Promise<void>((resolve) => mock.listen(port, "127.0.0.1", () => resolve()));
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

test("proactive wake: off by default, 现在唤醒 produces one bounded reminder that persists, the daily cap stops it, the switch persists (TEST-104)", async ({ page }) => {
  await configureProvider(page);
  // Reset wake state left by any earlier run on this shared e2e database.
  await page.request.put("/api/settings/wake", { data: { enabled: false, intervalMinutes: 30, dailyTokenCap: 20_000 } });

  // A conversation for the wake to look at.
  await page.goto("/");
  const newConversation = page.getByRole("button", { name: "新对话" });
  if (await newConversation.count()) {
    await newConversation.click();
  }
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("明天记得把 8443 端口的反向代理配好");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("好的，明天配反向代理。")).toBeVisible();

  // ① Off by default, cost visible next to the switch.
  await page.getByRole("button", { name: "打开菜单" }).click();
  const wakeSwitch = page.getByRole("switch", { name: "主动唤醒开关" });
  await expect(wakeSwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/今日唤醒用量：/)).toBeVisible();

  // ② 现在唤醒: exactly one non-streaming call, and the reminder shows in the transcript.
  const before = nonStreamingCalls;
  await page.getByRole("button", { name: "现在唤醒" }).click();
  await expect(page.getByText("已在对话里给出一条主动提醒。")).toBeVisible();
  expect(nonStreamingCalls - before).toBe(1);
  await page.keyboard.press("Escape");
  const reminder = page.locator(".floating-chat__message--system", { hasText: "主动提醒：记得处理 8443 端口的反向代理。" });
  await expect(reminder).toHaveCount(1);

  // ③ Persisted as a system/wake row; still there after a reload; the API keeps the old fields.
  await page.reload();
  await expect(page.locator(".floating-chat__message--system", { hasText: "主动提醒：记得处理 8443" })).toHaveCount(1);
  const recent = await (await page.request.get("/api/conversations/recent")).json();
  const messages = await (await page.request.get(`/api/conversations/${recent.conversations[0].id}/messages`)).json();
  const wakeRow = messages.messages.find((m: { status: string }) => m.status === "wake");
  expect(wakeRow).toMatchObject({ role: "system" });
  expect(Object.keys(wakeRow).sort()).toEqual(["content", "id", "role", "status"]);

  // ④ Usage is counted and the daily cap stops the next wake — without a model call.
  const settings = await (await page.request.get("/api/settings/wake")).json();
  expect(settings.usage.runs).toBeGreaterThanOrEqual(1);
  expect(settings.usage.notices).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "打开菜单" }).click();
  const cap = page.getByLabel("每日唤醒 token 上限");
  await cap.fill("1");
  await cap.blur();
  await expect(page.getByText("已保存。")).toBeVisible();
  const beforeCap = nonStreamingCalls;
  await page.getByRole("button", { name: "现在唤醒" }).click();
  await expect(page.getByText(/已达上限/)).toBeVisible();
  expect(nonStreamingCalls - beforeCap).toBe(0);

  // ⑤ The switch persists server-side.
  await wakeSwitch.click();
  await expect(wakeSwitch).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await (await page.request.get("/api/settings/wake")).json()).enabled).toBe(true);
  // Leave the shared database tidy for later specs.
  await page.request.put("/api/settings/wake", { data: { enabled: false, dailyTokenCap: 20_000 } });
});
