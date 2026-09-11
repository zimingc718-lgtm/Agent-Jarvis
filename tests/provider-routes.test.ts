import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-provider-routes-"));
process.env.JARVIS_DB_PATH = join(dir, "routes.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { email: "route-user@example.com" } })),
}));

const { getServerSession } = await import("next-auth");
const providersRoute = await import("@/app/api/providers/route");
const providerIdRoute = await import("@/app/api/providers/[id]/route");
const providerTestRoute = await import("@/app/api/providers/test/route");
const { getStore } = await import("@/lib/store-singleton");

function post(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function createProvider(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await providersRoute.POST(
    post("http://test/api/providers", {
      name: "OpenAI",
      kind: "openai",
      authMode: "api_key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5",
      enabled: true,
      secret: "sk-secret",
      ...overrides,
    })
  );
  return (await res.json()).id as string;
}

afterAll(() => {
  try {
    getStore().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { email: "route-user@example.com" } } as never);
  // clean slate
  const list = await (await providersRoute.GET()).json();
  for (const provider of list.providers ?? []) {
    await providerIdRoute.DELETE(new Request("http://test"), { params: Promise.resolve({ id: provider.id }) });
  }
});

describe("/api/providers", () => {
  it("rejects unauthenticated callers with 401", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);
    const res = await providersRoute.GET();
    expect(res.status).toBe(401);
  });

  it("creates then updates a provider in place (no duplicate row)", async () => {
    const id = await createProvider();

    const update = await providersRoute.POST(
      post("http://test/api/providers", {
        id,
        name: "OpenAI main",
        kind: "openai",
        authMode: "api_key",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-5-mini",
        enabled: true,
      })
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ id, created: false });

    const list = await (await providersRoute.GET()).json();
    expect(list.providers).toHaveLength(1);
    expect(list.providers[0]).toMatchObject({ name: "OpenAI main", defaultModel: "gpt-5-mini", secretPreview: expect.any(String) });
  });

  it("refuses to save an OAuth provider in this version", async () => {
    const res = await providersRoute.POST(
      post("http://test/api/providers", {
        name: "X",
        kind: "openai",
        authMode: "oauth",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-5",
        enabled: true,
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/OAuth/);
  });

  it("requires an API key only when creating, not when updating", async () => {
    const missingKey = await providersRoute.POST(
      post("http://test/api/providers", {
        name: "NeedsKey",
        kind: "openai",
        authMode: "api_key",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-5",
        enabled: true,
      })
    );
    expect(missingKey.status).toBe(400);
  });

  it("enables, disables and deletes via the id route", async () => {
    const id = await createProvider();

    const disable = await providerIdRoute.PATCH(post("http://test", { enabled: false }), {
      params: Promise.resolve({ id }),
    });
    expect(disable.status).toBe(200);
    let list = await (await providersRoute.GET()).json();
    expect(list.providers[0].enabled).toBe(false);

    const del = await providerIdRoute.DELETE(new Request("http://test"), { params: Promise.resolve({ id }) });
    expect(del.status).toBe(200);
    list = await (await providersRoute.GET()).json();
    expect(list.providers).toHaveLength(0);

    const missing = await providerIdRoute.DELETE(new Request("http://test"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(missing.status).toBe(404);
  });

  // CR-20260909 — TASK-021 / TEST-025
  it("reorders provider priority via PATCH { direction } and rejects an edge move", async () => {
    const first = await createProvider({ name: "First", secret: "sk-1" });
    const second = await createProvider({ name: "Second", secret: "sk-2" });

    let list = await (await providersRoute.GET()).json();
    expect(list.providers.map((p: { name: string }) => p.name)).toEqual(["First", "Second"]);

    const moved = await providerIdRoute.PATCH(post("http://test", { direction: "down" }), {
      params: Promise.resolve({ id: first }),
    });
    expect(moved.status).toBe(200);
    expect((await moved.json()).direction).toBe("down");

    list = await (await providersRoute.GET()).json();
    expect(list.providers.map((p: { name: string }) => p.name)).toEqual(["Second", "First"]);

    // "Second" is now at the top — moving it up is a no-op 404.
    const edge = await providerIdRoute.PATCH(post("http://test", { direction: "up" }), {
      params: Promise.resolve({ id: second }),
    });
    expect(edge.status).toBe(404);
  });
});

describe("/api/providers/test", () => {
  it("actually probes the provider and returns a readable result", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await providerTestRoute.POST(
      post("http://test/api/providers/test", { baseUrl: "https://api.openai.com/v1", secret: "bad" })
    );
    const body = await res.json();
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.anything());
    // CR-20260910-agent-tooling (CP-16): the response now also carries the tool-calling
    // probe result. It stays null here because the connection test itself failed.
    expect(body).toEqual({ ok: false, message: "Authentication failed — check the API key.", toolSupport: null });

    vi.unstubAllGlobals();
  });

  // REQ-F-040 ②: `/models` says nothing about tool calling, so a successful connection
  // test follows up with a real completion carrying a `tools` array.
  it("probes tool-calling capability with POST /chat/completions when the connection works", async () => {
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method, body: init?.body as string | undefined });
      if (url.endsWith("/models")) {
        return new Response("{}", { status: 200 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { tool_calls: [{ id: "c1" }] } }] }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const res = await providerTestRoute.POST(
      post("http://test/api/providers/test", {
        baseUrl: "https://api.deepseek.com/v1",
        secret: "k",
        id: "missing-provider",
        defaultModel: "deepseek-chat",
      })
    );
    const body = await res.json();

    const probe = seen.find((call) => call.url.endsWith("/chat/completions"));
    expect(probe?.method).toBe("POST");
    expect(probe?.body).toContain("tools");
    expect(body.toolSupport).toBe("yes");

    vi.unstubAllGlobals();
  });

  it("requires a base URL", async () => {
    const res = await providerTestRoute.POST(post("http://test/api/providers/test", { secret: "x" }));
    expect(res.status).toBe(400);
  });
});
