import { describe, expect, it } from "vitest";
import { getStorageConfig, isRealValue } from "@/lib/runtime-config";
import { getGoogleOAuthConfig } from "@/lib/auth";
import { t } from "@/lib/i18n";

describe("isRealValue", () => {
  it("rejects absent, empty and placeholder values", () => {
    expect(isRealValue(undefined)).toBe(false);
    expect(isRealValue("")).toBe(false);
    expect(isRealValue("   ")).toBe(false);
    expect(isRealValue("missing-secret")).toBe(false);
  });

  it("accepts a real value", () => {
    expect(isRealValue("0123456789abcdef")).toBe(true);
  });
});

describe("getStorageConfig", () => {
  it("reports JARVIS_SECRET_KEY as missing when unset or blank", () => {
    expect(getStorageConfig({})).toEqual({ configured: false, missing: ["JARVIS_SECRET_KEY"] });
    expect(getStorageConfig({ JARVIS_SECRET_KEY: "  " })).toEqual({
      configured: false,
      missing: ["JARVIS_SECRET_KEY"],
    });
  });

  it("reports configured when the key is present", () => {
    expect(getStorageConfig({ JARVIS_SECRET_KEY: "0123456789abcdef" })).toEqual({ configured: true, missing: [] });
  });

  it("ships a hint that points at the file and the restart requirement (both languages)", () => {
    // The hint moved into the interface dictionary (CR-20260928-server-strings-i18n).
    expect(t("zh", "page.storageHint")).toMatch(/\.env\.local/);
    expect(t("zh", "page.storageHint")).toMatch(/重启/);
    expect(t("en", "page.storageHint")).toMatch(/\.env\.local/);
    expect(t("en", "page.storageHint")).toMatch(/restart/);
  });
});

describe("configuration gates are independent", () => {
  it("OAuth being complete does not imply storage is configured", () => {
    const env = {
      GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "secret",
      NEXTAUTH_SECRET: "nextauth",
      NEXTAUTH_URL: "http://localhost:3000",
    };

    expect(getGoogleOAuthConfig(env).configured).toBe(true);
    // This is the trap that produced a 500 after a successful login: the two
    // gates must be checked separately.
    expect(getStorageConfig(env).configured).toBe(false);
  });
});
