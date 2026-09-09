import { afterEach, describe, expect, it } from "vitest";
import { requireUserId } from "@/lib/auth-guard";

describe("auth guard", () => {
  afterEach(() => {
    delete process.env.JARVIS_TEST_USER_ID;
  });

  it("blocks unauthenticated API access with 401", () => {
    const result = requireUserId(null);

    expect(result).toEqual({ ok: false, status: 401, message: "Authentication required." });
  });

  it("returns the authenticated user id", () => {
    const result = requireUserId({ user: { id: "user-1", email: "user@example.com" } });

    expect(result).toEqual({ ok: true, userId: "user-1" });
  });

  it("allows a non-production test user for local smoke tests", () => {
    process.env.JARVIS_TEST_USER_ID = "smoke-user";

    expect(requireUserId(null)).toEqual({ ok: true, userId: "smoke-user" });
  });
});
