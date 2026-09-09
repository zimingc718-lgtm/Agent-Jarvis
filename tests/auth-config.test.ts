import { describe, expect, it } from "vitest";
import { createAuthOptions, getGoogleOAuthConfig } from "@/lib/auth";
import { requireUserId } from "@/lib/auth-guard";

describe("Google OAuth runtime configuration", () => {
  it("does not create a fake Google provider when OAuth env vars are missing", () => {
    const env = {};

    expect(getGoogleOAuthConfig(env)).toEqual({
      configured: false,
      missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXTAUTH_SECRET", "NEXTAUTH_URL"]
    });
    expect(createAuthOptions(env).providers).toHaveLength(0);
  });

  it("creates a Google provider only from real configured env vars", () => {
    const options = createAuthOptions({
      GOOGLE_CLIENT_ID: "real-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "real-client-secret",
      NEXTAUTH_SECRET: "real-nextauth-secret",
      NEXTAUTH_URL: "http://localhost:3000"
    });

    expect(options.providers).toHaveLength(1);
    expect(options.providers[0].id).toBe("google");
  });

  it("allows test-user bypass only outside production", () => {
    expect(requireUserId(null, { NODE_ENV: "development", JARVIS_TEST_USER_ID: "smoke-user" })).toEqual({
      ok: true,
      userId: "smoke-user"
    });
    expect(requireUserId(null, { NODE_ENV: "production", JARVIS_TEST_USER_ID: "smoke-user" })).toEqual({
      ok: false,
      status: 401,
      message: "Authentication required."
    });
  });
});

