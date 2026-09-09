import { describe, expect, it } from "vitest";
import { runStatic } from "../scripts/ui-contract.mjs";

/**
 * REQ-F-014 (sci-fi console visual, no text overflow) and the architecture's DEC-005
 * layout rules are enforced by the executable UI contract in scripts/ui-contract.mjs,
 * which also encodes WCAG 2.2 AA / Apple HIG / Material guidance.
 * This test fails the build on any FAIL; WARN items are advisory and printed for review.
 */
describe("UI contract (scripts/ui-contract.mjs, static tier)", () => {
  const results = runStatic();

  it("produces a result for every rule", () => {
    expect(results.length).toBeGreaterThan(20);
  });

  it("has no failing rules", () => {
    const failed = results.filter((r) => r.status === "fail");
    if (failed.length) {
      console.error(
        "UI contract failures:\n" + failed.map((r) => `  ${r.id} ${r.title} — ${r.detail}`).join("\n")
      );
    }
    expect(failed.map((r) => r.id)).toEqual([]);
  });

  it("reports current warnings (advisory, does not fail the build)", () => {
    const warnings = results.filter((r) => r.status === "warn");
    console.info("UI contract warnings:", warnings.map((r) => r.id).join(", ") || "none");
    expect(Array.isArray(warnings)).toBe(true);
  });
});
