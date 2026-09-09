import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No JARVIS_SECRET_KEY here on purpose: this file proves the store-backed routes
// answer with a diagnosable 503 instead of throwing when the key is absent.
delete process.env.JARVIS_TEST_USER_ID;

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { email: "guard-user@example.com" } })),
}));

const { storageUnavailable } = await import("@/lib/api-guard");
const providersRoute = await import("@/app/api/providers/route");
const recentRoute = await import("@/app/api/conversations/recent/route");
const chatRoute = await import("@/app/api/chat/stream/route");

const original = process.env.JARVIS_SECRET_KEY;

beforeEach(() => {
  delete process.env.JARVIS_SECRET_KEY;
});

afterEach(() => {
  if (original === undefined) delete process.env.JARVIS_SECRET_KEY;
  else process.env.JARVIS_SECRET_KEY = original;
});

describe("storageUnavailable", () => {
  it("returns a 503 naming the missing variable", async () => {
    const response = storageUnavailable();
    expect(response).not.toBeNull();
    expect(response!.status).toBe(503);
    const body = await response!.json();
    expect(body.missing).toEqual(["JARVIS_SECRET_KEY"]);
    expect(body.message).toMatch(/JARVIS_SECRET_KEY/);
    expect(body.message).toMatch(/\.env\.local/);
  });

  it("returns null once the key is configured", () => {
    process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";
    expect(storageUnavailable()).toBeNull();
  });
});

describe("store-backed routes when JARVIS_SECRET_KEY is missing", () => {
  it("GET /api/providers answers 503 instead of throwing", async () => {
    const response = await providersRoute.GET();
    expect(response.status).toBe(503);
    expect((await response.json()).message).toMatch(/JARVIS_SECRET_KEY/);
  });

  it("GET /api/conversations/recent answers 503 instead of throwing", async () => {
    const response = await recentRoute.GET();
    expect(response.status).toBe(503);
  });

  it("POST /api/chat/stream answers 503 instead of throwing", async () => {
    const response = await chatRoute.POST(
      new Request("http://test/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "x", message: "hi" }),
      })
    );
    expect(response.status).toBe(503);
  });
});
