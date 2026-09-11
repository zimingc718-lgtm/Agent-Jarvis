import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

// CR-20260911-context-compaction — TEST-083 (real entry, REQ-F-042 / REQ-F-043 / REQ-NF-012).
//
// Drives a conversation past the compaction trigger through the real HTTP entry, then
// sends one more turn from the real browser and checks: compaction happened (the model
// received a shorter context), the turn still completed, the boundary marker is visible
// and expandable, it survives a reload, and the messages API stays backward compatible.
//
// File name sorts after human-workflow.spec.ts on purpose: that spec asserts it is the
// only conversation on a fresh e2e database.

const port = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321) + 2;
let mock: Server;

const SUMMARY_TEXT = "摘要：早前四轮讨论了压缩方案，选定按预算触发。";
/** ~800 CJK chars ≈ 530 tokens per message; four such turns cross 80% of the local budget. */
const LONG_BODY = "细节".repeat(400);

/** One endpoint for the streamed reply and the non-streaming summary call (same provider, same model). */
function mockModel() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "compact-model" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        let body: { messages?: Array<{ role: string; content: string }>; stream?: boolean; model?: string } = {};
        try {
          body = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        if (body.stream === false) {
          // The compaction summary call (REQ-F-042 ②). Echo the model so the test can
          // confirm the summary was produced by the conversation's own model.
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ choices: [{ message: { content: `${SUMMARY_TEXT} model=${body.model}` } }] }));
          return;
        }
        const messages = body.messages ?? [];
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        // Long seeding turns get long replies (so the history actually grows); the final
        // turn from the browser gets a short reply that reveals how many messages arrived.
        const reply = lastUser.startsWith("seed") ? `说明${LONG_BODY}` : `收到 ctx=${messages.length}`;
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
        response.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(reply)}}}]}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
      });
      return;
    }
    response.writeHead(404).end();
  });
}

/** The e2e DB is shared by every spec file; this one must be the only provider while it runs. */
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
  await dialog.getByLabel("Provider name").fill("Compact Mock");
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByLabel("Model", { exact: true }).fill("compact-model");
  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(dialog.getByRole("status").first()).toContainText("Provider saved.");
  await dialog.getByRole("button", { name: "关闭" }).click();
}

/** Send one turn through the real chat endpoint and return the conversation id from `start`. */
async function sendTurn(page: Page, message: string, conversationId?: string): Promise<string> {
  const response = await page.request.post("/api/chat/stream", { data: { message, conversationId } });
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("event: done");
  const start = body.split("\n").find((line) => line.startsWith("data: ") && line.includes('"start"'));
  return (JSON.parse(start!.slice(6)) as { conversationId: string }).conversationId;
}

test.beforeAll(async () => {
  mock = mockModel();
  await new Promise<void>((resolve) => mock.listen(port, "127.0.0.1", () => resolve()));
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

test("a long conversation is compacted on the turn that crosses the budget; the boundary is visible, expandable, survives a reload, and the API stays compatible (TEST-083)", async ({
  page,
}) => {
  await configureProvider(page);

  // ① Four long turns through the real entry — enough to cross the trigger but not the budget.
  let conversationId = await sendTurn(page, `seed 1 ${LONG_BODY}`);
  for (const n of [2, 3, 4]) {
    conversationId = await sendTurn(page, `seed ${n} ${LONG_BODY}`, conversationId);
  }
  const before = await (await page.request.get(`/api/conversations/${conversationId}/messages`)).json();
  expect(before.messages.filter((m: { status: string }) => m.status === "summary")).toHaveLength(0);

  // The most recent conversation is restored into the console (REQ-F-013); the fifth
  // turn is sent from the real browser.
  await page.goto("/");
  await expect(page.getByText("seed 4", { exact: false }).first()).toBeVisible();
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("最后一问");
  await page.getByRole("button", { name: "发送" }).click();

  // ② Compaction happened AND the turn completed. Without compaction the model would see
  // 2 system + 8 history + 1 user = 11 messages; with the two oldest turns folded into one
  // summary it sees 2 + 1 + 4 + 1 = 8.
  const reply = page.getByText(/收到 ctx=\d+/);
  await expect(reply).toBeVisible();
  const ctx = Number((await reply.textContent())!.match(/ctx=(\d+)/)![1]);
  expect(ctx).toBeLessThan(11);
  expect(ctx).toBe(8);

  // ③ The boundary marker is on screen in the same send, ahead of the kept turns — a thin
  // marker, not a bubble; collapsed until opened.
  const marker = page.locator(".floating-chat__compaction");
  await expect(marker).toHaveCount(1);
  await expect(marker).not.toHaveClass(/floating-chat__message/);
  const toggle = page.getByRole("button", { name: "展开早前对话的摘要" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(SUMMARY_TEXT, { exact: false })).toHaveCount(0);
  await expect(marker.locator("xpath=preceding-sibling::*[1]")).toContainText("说明");
  await expect(marker.locator("xpath=following-sibling::*[1]")).toContainText("seed 3");

  await toggle.click();
  await expect(page.getByRole("button", { name: "收起早前对话的摘要" })).toHaveAttribute("aria-expanded", "true");
  // The summary came from the conversation's own model (user ruling Q2).
  await expect(page.getByText(`${SUMMARY_TEXT} model=compact-model`)).toBeVisible();

  // ④ Reload: the marker and the summary are rebuilt from the persisted row (REQ-F-043 ④).
  await page.reload();
  await expect(page.locator(".floating-chat__compaction")).toHaveCount(1);
  await page.getByRole("button", { name: "展开早前对话的摘要" }).click();
  await expect(page.getByText(`${SUMMARY_TEXT} model=compact-model`)).toBeVisible();
  // The folded-away originals are still on screen: compaction changes what the MODEL sees.
  await expect(page.getByText("seed 1", { exact: false }).first()).toBeVisible();

  // ⑤ The messages API returns the summary row and keeps the old fields for every row.
  const after = await (await page.request.get(`/api/conversations/${conversationId}/messages`)).json();
  const summaries = after.messages.filter((m: { status: string }) => m.status === "summary");
  expect(summaries).toHaveLength(1);
  expect(summaries[0].role).toBe("system");
  for (const message of after.messages) {
    expect(Object.keys(message).sort()).toEqual(["content", "id", "role", "status"]);
  }
  // Position: right after the last covered row (turn 2's reply), before turn 3.
  const at = after.messages.findIndex((m: { status: string }) => m.status === "summary");
  expect(after.messages[at - 1].role).toBe("assistant");
  expect(after.messages[at + 1].content.startsWith("seed 3")).toBe(true);
  // Original rows are all still there: 5 user + 5 assistant + 1 summary.
  expect(after.messages).toHaveLength(11);
});
