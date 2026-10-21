import { describe, expect, it } from "vitest";
import { flagEnabled } from "./featureFlags";

describe("feature flag parsing", () => {
  it("is on only for the exact string true", () => {
    expect(flagEnabled("true")).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", true]) {
      expect(flagEnabled(v), String(v)).toBe(false);
    }
  });
});
