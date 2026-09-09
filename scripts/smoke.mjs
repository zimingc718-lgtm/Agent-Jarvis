import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const appPort = Number(process.env.JARVIS_SMOKE_PORT ?? 3210);
const mockPort = Number(process.env.JARVIS_SMOKE_MODEL_PORT ?? 3211);
const root = process.cwd();
const smokeRoot = join(root, ".data");
mkdirSync(smokeRoot, { recursive: true });
const tempDir = mkdtempSync(join(smokeRoot, "smoke-"));
const dbPath = join(tempDir, "smoke.sqlite");
let devProcess;
let logs = "";
let smokePassed = false;

const mockServer = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "smoke-model" }] }));
    return;
  }

  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      let count = 0;
      try {
        count = JSON.parse(raw).messages?.length ?? 0;
      } catch {
        /* ignore */
      }
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache"
      });
      response.write('data: {"choices":[{"delta":{"content":"Smoke"}}]}\n\n');
      response.write(`data: {"choices":[{"delta":{"content":" ctx=${count}"}}]}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
    });
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ message: "not found" }));
});

try {
  await listen(mockServer, mockPort);
  devProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
    cwd: root,
    env: {
      ...process.env,
      // Own build dir so this server never corrupts a developer's `.next`.
      NEXT_DIST_DIR: ".next-smoke",
      JARVIS_TEST_USER_ID: "smoke-user",
      JARVIS_SECRET_KEY: "0123456789abcdef0123456789abcdef",
      JARVIS_DB_PATH: dbPath,
      NEXTAUTH_SECRET: "0123456789abcdef0123456789abcdef",
      NEXTAUTH_URL: `http://127.0.0.1:${appPort}`,
      GOOGLE_CLIENT_ID: "smoke-google-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "smoke-google-client-secret"
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });

  devProcess.stdout?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  devProcess.stderr?.on("data", (chunk) => {
    logs += chunk.toString();
  });

  await waitForApp(`http://127.0.0.1:${appPort}`);

  const home = await fetchText(`http://127.0.0.1:${appPort}/`);
  assert(home.includes("Agent-Jarvis"), "home page must render the application shell");
  assert(home.includes("配置") && home.includes("账号登录"), "home page must expose the settings and account dialog buttons");

  // The NextAuth route handler must actually load — a corrupted build makes it
  // 500 with "Cannot find module './vendor-chunks/jose.js'", which no other
  // check catches because every test path uses the JARVIS_TEST_USER_ID bypass.
  const csrf = await fetch(`http://127.0.0.1:${appPort}/api/auth/csrf`);
  const csrfBody = await csrf.text();
  assert(csrf.status === 200, `/api/auth/csrf must return 200, got ${csrf.status}. body=${csrfBody}`);
  assert(csrfBody.includes("csrfToken"), `/api/auth/csrf must return a token, got: ${csrfBody.slice(0, 200)}`);

  const authProviders = await fetchJson(`http://127.0.0.1:${appPort}/api/auth/providers`);
  assert(authProviders.google?.id === "google", `NextAuth must expose the Google provider, got ${JSON.stringify(authProviders)}`);

  const settings = await fetchText(`http://127.0.0.1:${appPort}/settings/models`);
  assert(settings.includes("Model Providers"), "settings page must render model provider controls");

  const providerResponse = await fetch(`http://127.0.0.1:${appPort}/api/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Local",
      kind: "local",
      authMode: "local",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      defaultModel: "smoke-model",
      enabled: true,
      secret: ""
    })
  });
  const providerResponseText = await providerResponse.text();
  assert(
    providerResponse.status === 201,
    `provider save must return 201, got ${providerResponse.status}. body=${providerResponseText}\nlogs=${logs}`
  );

  const providersBody = await fetchJson(`http://127.0.0.1:${appPort}/api/providers`);
  const providerId = providersBody.providers?.[0]?.id;
  assert(typeof providerId === "string", "saved provider must be returned by /api/providers");

  // Editing an existing provider must update in place, not create a duplicate row.
  const editResponse = await fetch(`http://127.0.0.1:${appPort}/api/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: providerId,
      name: "Smoke Local (edited)",
      kind: "local",
      authMode: "local",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      defaultModel: "smoke-model",
      enabled: true
    })
  });
  assert(editResponse.status === 200, `provider edit must return 200, got ${editResponse.status}`);
  const afterEdit = await fetchJson(`http://127.0.0.1:${appPort}/api/providers`);
  assert(afterEdit.providers.length === 1, `provider edit must not duplicate rows, got ${afterEdit.providers.length}`);
  assert(afterEdit.providers[0].name === "Smoke Local (edited)", "provider edit must persist the new name");

  // Real connectivity probe against the mock /v1/models endpoint.
  const testResponse = await fetch(`http://127.0.0.1:${appPort}/api/providers/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: providerId, baseUrl: `http://127.0.0.1:${mockPort}/v1` })
  });
  const testBody = await testResponse.json();
  assert(testBody.ok === true, `provider test must reach the mock, got ${JSON.stringify(testBody)}`);

  const connectedHome = await fetchText(`http://127.0.0.1:${appPort}/`);
  assert(connectedHome.includes("Ask Agent-Jarvis"), "home page must render the floating chat entry after provider setup");

  // CR-20260909: the live probe the console light uses.
  const probe = await fetchJson(`http://127.0.0.1:${appPort}/api/providers/probe`);
  assert(probe.anyConnected === true, `probe must report the mock provider connected, got ${JSON.stringify(probe)}`);

  // Turn 1 — new conversation.
  const chatResponse = await fetch(`http://127.0.0.1:${appPort}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId, message: "Smoke prompt" })
  });
  assert(chatResponse.ok, `chat stream must return 2xx, got ${chatResponse.status}`);
  const chatText = await chatResponse.text();
  assert(chatText.includes('"text":"Smoke"'), "chat stream must include the first mock token");
  assert(chatText.includes('"text":" ctx=2"'), `turn 1 must send system+user (ctx=2); got: ${chatText}`);
  assert(chatText.includes("event: done"), "chat stream must complete");
  const conversationId = JSON.parse(chatText.match(/data: (\{"type":"start"[^\n]*)/)[1]).conversationId;
  assert(typeof conversationId === "string", "start event must carry a conversationId");

  // Turn 2 — same conversation, model must receive prior turns as context.
  const followUp = await fetch(`http://127.0.0.1:${appPort}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId, conversationId, message: "Follow up" })
  });
  const followUpText = await followUp.text();
  assert(followUpText.includes('"text":" ctx=4"'), `turn 2 must replay history (ctx=4); got: ${followUpText}`);

  const conversations = await fetchJson(`http://127.0.0.1:${appPort}/api/conversations/recent`);
  assert(conversations.conversations.length === 1, "follow-up must stay in the same conversation");
  assert(conversations.conversations[0].title === "Smoke prompt", "recent conversation must persist the first prompt");

  // Refresh restore — messages come back through the real endpoint the home page uses.
  const restored = await fetchJson(`http://127.0.0.1:${appPort}/api/conversations/${conversationId}/messages`);
  const restoredRoles = restored.messages.map((m) => m.role);
  assert(
    restoredRoles.join(",") === "user,assistant,user,assistant",
    `restored transcript must contain both turns, got ${restoredRoles.join(",")}`
  );

  // CR-20260909: the console sends no providerId — the server resolves by priority.
  const resolvedTurn = await fetch(`http://127.0.0.1:${appPort}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Resolve me" })
  });
  assert(resolvedTurn.ok, `provider-less chat must resolve and return 2xx, got ${resolvedTurn.status}`);
  assert((await resolvedTurn.text()).includes("event: done"), "provider-less chat must complete");

  // Disable then delete through the real id route.
  const disable = await fetch(`http://127.0.0.1:${appPort}/api/providers/${providerId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false })
  });
  assert(disable.status === 200, `provider disable must return 200, got ${disable.status}`);
  const disabledHome = await fetchText(`http://127.0.0.1:${appPort}/`);
  assert(
    disabledHome.includes("floating-chat__light--off"),
    "with no enabled provider the console light must render the 'off' state"
  );
  // With no provider, a send is a request-level error and creates no conversation (REQ-F-006 ⑥).
  const blockedTurn = await fetch(`http://127.0.0.1:${appPort}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "should be blocked" })
  });
  assert(blockedTurn.status === 409, `chat with no connected provider must return 409, got ${blockedTurn.status}`);

  const del = await fetch(`http://127.0.0.1:${appPort}/api/providers/${providerId}`, { method: "DELETE" });
  assert(del.status === 200, `provider delete must return 200, got ${del.status}`);
  const afterDelete = await fetchJson(`http://127.0.0.1:${appPort}/api/providers`);
  assert(afterDelete.providers.length === 0, "deleted provider must be gone");

  smokePassed = true;
} finally {
  await closeServer(mockServer);
  if (devProcess?.pid) {
    stopProcessTree(devProcess.pid);
    devProcess.stdout?.destroy();
    devProcess.stderr?.destroy();
    devProcess.unref();
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`WARN smoke cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (smokePassed) {
  console.log("OK smoke passed");
  process.exit(0);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function waitForApp(baseUrl) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (devProcess?.exitCode !== null && devProcess?.exitCode !== undefined) {
      throw new Error(`Next dev server exited early with code ${devProcess.exitCode}.\n${logs}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next dev server did not become ready.\n${logs}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  assert(response.ok, `${url} returned ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert(response.ok, `${url} returned ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stopProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}



