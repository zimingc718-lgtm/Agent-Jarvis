import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

// CR-20260909-skills + CR-20260909-display-screen — TEST-038 (②③④) / TEST-041.
// Folder drag-drop itself is browser plumbing exercised by the unit/route tests;
// here we register through the API and drive the skill → insight → display flow.

const port = Number(process.env.JARVIS_E2E_MODEL_PORT ?? 3321) + 1;
let mock: Server;

/** One mock endpoint for both the router (stream:false) and the main reply (stream:true). */
function mockModel() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "m" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        const body = safeJson(raw);
        const lastUser = [...(body.messages ?? [])].reverse().find((m: { role: string }) => m.role === "user");
        const text: string = lastUser?.content ?? "";
        // CR-20260910-agent-tooling rewrote this mock. The pre-send routing call is gone
        // (DEC-016), so `stream === false` no longer identifies it — the only
        // non-streaming call left is SKILL.md generation. Everything the router used to
        // decide is now a tool the model asks for, so the mock has to emit `tool_calls`.
        if (body.stream === false) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      "---\nname: reporter\ndescription: writes an HTML report\n---\n\nUse it to report.",
                  },
                },
              ],
            })
          );
          return;
        }

        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
        // Only the CURRENT loop matters: a tool result is fed back as the last message.
        // Scanning the whole history would see earlier turns' tool rows and make every
        // later turn answer in plain text.
        const messages = body.messages ?? [];
        const alreadyRanTool = messages.at(-1)?.role === "tool";

        const emitToolCall = (name: string, args: Record<string, unknown>) => {
          response.write(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: `call_${name}`, function: { name, arguments: JSON.stringify(args) } },
                    ],
                  },
                },
              ],
            })}\n\n`
          );
        };
        const emitText = (chunks: string[]) => {
          for (const chunk of chunks) {
            response.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(chunk)}}}]}\n\n`);
          }
        };

        if (!alreadyRanTool && /首页|go home/i.test(text)) {
          emitToolCall("show_home", {});
        } else if (!alreadyRanTool && /report/i.test(text) && !/plain-skill/i.test(text)) {
          emitToolCall("save_insight", { html: "<h1>Insight Report</h1>" });
        } else if (!alreadyRanTool && /plain-skill/i.test(text)) {
          emitToolCall("read_skill", { name: "reporter" });
        } else {
          emitText(["Plain reply, no HTML."]);
        }
        response.write("data: [DONE]\n\n");
        response.end();
      });
      return;
    }
    response.writeHead(404).end();
  });
}

function safeJson(raw: string): { messages?: Array<{ role: string; content: string }>; stream?: boolean } {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** A minimal stored (method 0) zip, so the e2e exercises the real archive path. */
function storedZip(files: Array<{ name: string; body: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.body, "utf8");
    const nameBuf = Buffer.from(file.name, "utf8");
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lfh, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nameBuf);
    offset += lfh.length + nameBuf.length + data.length;
  }
  const localPart = Buffer.concat(locals);
  const cdPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, cdPart, eocd]);
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
  await dialog.getByLabel("Provider name").fill("Mock");
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByLabel("Model", { exact: true }).fill("m");
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

test("skill turn surfaces an insight on the display screen; 显示首页 returns to the title; both survive a reload", async ({
  page,
}) => {
  await configureProvider(page);

  // CR-20260910-skill-intake: register from a **zip**, through the real upload
  // control — the path that silently did nothing before this CR.
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传 zip" }).click();
  await (await chooser).setFiles({
    name: "Reporter Skill.zip",
    mimeType: "application/zip",
    buffer: storedZip([{ name: "reporter-skill/SKILL-notes.md", body: "how to write reports" }]),
  });
  await expect(page.getByText(/已注册技能：/)).toBeVisible();

  // REQ-F-028 ③: the ☰ menu's list picks it up without a reload.
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(page.getByRole("region", { name: "已注册技能" })).toContainText("reporter");
  await page.keyboard.press("Escape");

  await page.goto("/");
  // Home = full-screen display screen, default title view.
  await expect(page.locator(".display-screen--home h1")).toHaveText("Agent-Jarvis");

  // A skill turn that produces an ```html block → the display screen shows it,
  // with the non-dismissible notice above the frame.
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("make a report");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".floating-chat__step").filter({ hasText: "save_insight" })).toBeVisible();
  await expect(page.locator(".display-screen__notice")).toBeVisible();
  const frame = page.frameLocator(".display-screen__frame");
  await expect(frame.locator("h1")).toHaveText("Insight Report");
  // Non-dismissible: no close control, Escape does not remove it.
  await expect(page.locator(".display-screen__notice button")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".display-screen__notice")).toBeVisible();

  // The insight survives a reload (CP-4).
  await page.reload();
  await expect(page.locator(".display-screen__notice")).toBeVisible();
  await expect(page.frameLocator(".display-screen__frame").locator("h1")).toHaveText("Insight Report");

  // "显示首页" now goes through the `show_home` tool rather than a routing field
  // (REQ-F-032 ①). The step row is the visible proof the tool ran.
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("显示首页");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".floating-chat__step").filter({ hasText: "show_home" })).toBeVisible();
  await expect(page.locator(".display-screen--home h1")).toHaveText("Agent-Jarvis");

  await page.reload();
  await expect(page.locator(".display-screen--home h1")).toHaveText("Agent-Jarvis");
  // REQ-F-035 ④: the step stream is rebuilt from the persisted rows, so the history on
  // screen after a refresh matches what was there before it.
  await expect(page.locator(".floating-chat__step").first()).toBeVisible();

  // REQ-F-023 ③ (user ruling 1, keep it non-silent): a turn that consulted a skill but
  // produced no insight says so, rather than leaving the user guessing.
  await page.getByPlaceholder("Ask Agent-Jarvis").fill("plain-skill please");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".floating-chat__step").filter({ hasText: "read_skill" })).toBeVisible();
  await expect(page.getByText("本轮未产出洞察。")).toBeVisible();
});

test("the ☰ menu stays usable on top of the full-screen display screen (TEST-032 回归)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".display-screen")).toBeVisible();
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(page.getByRole("menu", { name: "Agent-Jarvis 菜单" })).toBeVisible();

  // Leave the shared e2e database as we found it: no provider of ours may outrank
  // the ones other spec files create (resolveActiveProvider walks priority order).
  await removeAllProviders(page);
});
