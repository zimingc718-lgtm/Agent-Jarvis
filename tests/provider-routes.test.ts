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
    expect(body).toEqual({ ok: false, message: "Authentication failed — check the API key." });

    vi.unstubAllGlobals();
  });

  it("requires a base URL", async () => {
    const res = await providerTestRoute.POST(post("http://test/api/providers/test", { secret: "x" }));
    expect(res.status).toBe(400);
  });
});
