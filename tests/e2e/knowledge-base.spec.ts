import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

// CR-20260911-knowledge-base — TEST-089 (real entry, REQ-F-044 / REQ-F-045 / REQ-F-046).
//
// One knowledge entry is created through the API, then a real browser turn makes the
// model retrieve it; a second turn makes the model PROPOSE knowledge, which must land in
// the pending queue (not in retrieval) until 采纳 is clicked in the ☰ list; a dropped
// text file becomes an entry directly. The file name sorts after human-workflow.spec.ts
// on purpose (that spec assumes a fresh conversation table).

const port = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321) + 3;
let mock: Server;

type Msg = { role: string; content: string; tool_call_id?: string };

/** Streams tool calls on cue words, echoes the tool result back as prose otherwise. */
function mockModel() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "kb-model" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        let messages: Msg[] = [];
        try {
          messages = JSON.parse(raw).messages ?? [];
        } catch {
          /* ignore */
        }
        const last = messages.at(-1);
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
        const emitToolCall = (name: string, args: Record<string, unknown>) => {
          response.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${name}`, function: { name, arguments: JSON.stringify(args) } }] } }],
            })}\n\n`
          );
        };
        const emitText = (text: string) => {
          response.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`);
        };
        if (last?.role === "tool") {
          emitText(`工具返回：${last.content}`);
        } else if (/查知识/.test(lastUser)) {
          emitToolCall("search_knowledge", { query: "部署端口" });
        } else if (/记住/.test(lastUser)) {
          emitToolCall("save_knowledge", { title: "用户偏好", content: "用户偏好用中文回答，代码块用 TypeScript。" });
        } else {
          emitText("普通回复。");
        }
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
  await dialog.getByLabel("Provider name").fill("KB Mock");
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByLabel("Model", { exact: true }).fill("kb-model");
  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(dialog.getByRole("status").first()).toContainText("Provider saved.");
  await dialog.getByRole("button", { name: "关闭" }).click();
}

async function send(page: Page, text: string) {
  await page.getByPlaceholder("Ask Agent-Jarvis").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
}

test.beforeAll(async () => {
  mock = mockModel();
  await new Promise<void>((resolve) => mock.listen(port, "127.0.0.1", () => resolve()));
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

test("knowledge base: retrieval through the model, proposal → adoption queue → 采纳, and a dropped note (TEST-089)", async ({ page }) => {
  await configureProvider(page);

  // A user-made entry goes straight into the base (REQ-F-046 ②).
  const created = await page.request.post("/api/knowledge", {
    data: { title: "部署说明", content: "生产环境部署端口是 8443，反向代理用 Caddy。", source: "manual" },
  });
  expect(created.status()).toBe(201);

  // ① The model retrieves it with search_knowledge; the step row is visible and the
  // reply carries what came back from the base.
  await page.goto("/");
  // Start clean: 新对话 so the previous spec's conversation is not what gets replayed.
  const newConversation = page.getByRole("button", { name: "新对话" });
  if (await newConversation.count()) {
    await newConversation.click();
  }
  await send(page, "查知识：部署端口是多少");
  await expect(page.locator(".floating-chat__step", { hasText: "search_knowledge" })).toBeVisible();
  await expect(page.getByText(/工具返回：.*8443/)).toBeVisible();

  // ② A model proposal is NOT knowledge yet: it is announced, it shows in the pending
  // queue, and it stays out of the base until 采纳 (REQ-F-046 ③).
  await send(page, "记住：我偏好中文回答");
  await expect(page.getByText(/模型提议了知识条目「用户偏好」/)).toBeVisible();
  let listed = await (await page.request.get("/api/knowledge")).json();
  expect(listed.pending.map((e: { title: string }) => e.title)).toEqual(["用户偏好"]);
  expect(listed.entries.map((e: { title: string }) => e.title)).toEqual(["部署说明"]);

  await page.getByRole("button", { name: "打开菜单" }).click();
  const queue = page.getByRole("region", { name: "待采纳的知识提议" });
  await expect(queue).toBeVisible();
  await expect(queue).toContainText("待采纳（1）");
  await page.getByRole("button", { name: "采纳知识提议「用户偏好」" }).click();
  await expect(page.getByText("已采纳「用户偏好」。")).toBeVisible();
  await expect(queue).toHaveCount(0);
  listed = await (await page.request.get("/api/knowledge")).json();
  expect(listed.pending).toEqual([]);
  expect(listed.entries.map((e: { title: string }) => e.title).sort()).toEqual(["用户偏好", "部署说明"].sort());
  await page.keyboard.press("Escape");

  // ③ A dropped .md becomes an entry, with a receipt in the transcript (REQ-F-046 ①).
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["# 周会纪要\n\n决定先做 C 期。"], "周会.md", { type: "text/markdown" }));
    return dt;
  });
  await page.dispatchEvent(".floating-chat", "drop", { dataTransfer });
  await expect(page.getByText("已存入知识库：周会纪要")).toBeVisible();
  listed = await (await page.request.get("/api/knowledge")).json();
  expect(listed.entries.map((e: { title: string }) => e.title)).toContain("周会纪要");

  // ④ Reload: the ☰ list is correct on first open, from the server-rendered data.
  await page.reload();
  await page.getByRole("button", { name: "打开菜单" }).click();
  const list = page.getByRole("region", { name: "本地知识库" });
  await expect(list).toContainText("周会纪要");
  await expect(list).toContainText("用户偏好");
  await expect(list).toContainText("部署说明");
});
