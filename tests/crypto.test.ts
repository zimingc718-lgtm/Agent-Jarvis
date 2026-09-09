import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";

describe("provider secret encryption", () => {
  it("encrypts provider secrets without storing plaintext and can decrypt them", () => {
    const encrypted = encryptSecret("sk-test-secret", "0123456789abcdef0123456789abcdef");

    expect(encrypted).not.toContain("sk-test-secret");
    expect(encrypted).toMatch(/^v1:/);
    expect(decryptSecret(encrypted, "0123456789abcdef0123456789abcdef")).toBe("sk-test-secret");
  });

  it("returns a masked preview without exposing the full secret", () => {
    expect(maskSecret("sk-abcdefghijklmnopqrstuvwxyz")).toBe("sk-a...wxyz");
  });
});
