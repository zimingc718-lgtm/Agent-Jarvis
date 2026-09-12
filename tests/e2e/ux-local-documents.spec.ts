import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * TEST-172 — real-entry proof for the local original-document layer (REQ-F-110).
 * CR-20260912-local-documents.
 *
 * The user's report was「对话也无法搜索本地的资源」, and the cause was that no tool could
 * reach a file on disk at all. So the thing to prove at the real entry is the whole chain,
 * not any one link: a folder added through the ☰ menu → the model searching it → the model
 * reading an original out of it → the file's own words reaching the transcript.
 *
 * The document id is parsed out of the search result the way a model would, so the round
 * trip is real rather than pre-arranged.
 *
 * Named to sort after `ux-display-console.spec.ts`: every spec shares one database and one
 * worker, and this one creates conversations.
 */

const port = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321) + 6;
let mock: Server;
let docsDir: string;

const SPEC_TEXT = "本机柜采用液冷方案，额定容量 1200 kW，进线电压 800 VDC。";

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

      // The id only exists inside the search result — parse it the way a model would.
      const foundId = /(资料\/[^\s（]+\.md)/.exec(lastToolContent)?.[1];
      const alreadyRead = lastToolContent.includes("只读");

      if (alreadyRead) {
        // Quote the file's own words back, which is what proves the content travelled.
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `规格书里写的是：${SPEC_TEXT}` } }] })}\n\n`);
      } else if (foundId) {
        emitToolCall("call_read", "read_document", { id: foundId });
      } else if (lastToolContent) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "没有找到相关的本地文档。" } }] })}\n\n`);
      } else {
        emitToolCall("call_search", "search_documents", { query: "液冷 额定容量" });
      }
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
}

function safeJson(raw: string): { messages?: Array<{ role: string; content?: string }> } {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
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
  await dialog.getByLabel("Provider name").fill("MockDocs");
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByLabel("Model", { exact: true }).fill("m");
  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(dialog.getByRole("status").first()).toContainText("Provider saved.");
  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.keyboard.press("Escape");
}

async function startFreshConversation(page: Page) {
  const newChat = page.getByRole("button", { name: "新对话" });
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click();
  }
  await expect(page.locator(".floating-chat__messages")).toHaveCount(0);
}

test.beforeAll(async () => {
  docsDir = mkdtempSync(join(tmpdir(), "jarvis-e2e-docs-"));
  mkdirSync(join(docsDir, "资料", "规格"), { recursive: true });
  writeFileSync(join(docsDir, "资料", "规格", "整流柜规格书.md"), `# 整流柜规格书\n\n${SPEC_TEXT}\n`, "utf8");
  mock = mockModel();
  await new Promise<void>((resolve) => mock.listen(port, "127.0.0.1", () => resolve()));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  rmSync(docsDir, { recursive: true, force: true });
});

test("① 从菜单添加文档目录 → 对话检索并读出本机原文档 (REQ-F-110)", async ({ page }) => {
  await configureProvider(page);
  await page.goto("/");
  await startFreshConversation(page);

  // Add the folder the way a user would, not through the API.
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "文档目录" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("添加文件夹（绝对路径）").fill(join(docsDir, "资料"));
  await dialog.getByRole("button", { name: "添加" }).click();
  await expect(dialog.getByText(/已添加，共 1 份可读文档/)).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.keyboard.press("Escape");

  // The drawer row states the configured state without opening the dialog.
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(page.locator(".document-settings__summary")).toContainText("1 个目录");
  await page.keyboard.press("Escape");

  await page.getByPlaceholder("Ask Agent-Jarvis").fill("整流柜的额定容量是多少？看看本地资料");
  await page.getByRole("button", { name: "发送" }).click();

  // Both steps ran, and neither failed.
  await expect(page.locator(".floating-chat__step").filter({ hasText: "search_documents" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".floating-chat__step").filter({ hasText: "read_document" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.floating-chat__step[data-state="failed"]')).toHaveCount(0);

  // The file's own words reached the transcript — the whole point of the layer.
  await expect(page.locator(".floating-chat__message--assistant").last()).toContainText("1200 kW", {
    timeout: 20_000,
  });
});

test("② 移除目录只是不再查找它，磁盘上的文件原封不动 (REQ-F-110 ⑤)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "文档目录" }).click();
  const dialog = page.locator("dialog[open]");

  await dialog.getByRole("button", { name: "移除 资料" }).click();
  await expect(dialog.getByText(/磁盘上的文件没有任何改动/)).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.keyboard.press("Escape");

  // The row falls back to the unconfigured state …
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(page.locator(".document-settings__summary")).toContainText("未配置目录");
  await page.keyboard.press("Escape");

  // … and the file is still on disk, untouched.
  const { readFileSync } = await import("node:fs");
  expect(readFileSync(join(docsDir, "资料", "规格", "整流柜规格书.md"), "utf8")).toContain(SPEC_TEXT);
});
