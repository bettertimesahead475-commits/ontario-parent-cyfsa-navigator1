import { describe, expect, it } from "vitest";
import { flagEnabled, PARENT_REPORT_UI_ENABLED } from "./featureFlags";

describe("feature flag parsing", () => {
  it("is on only for the exact string true", () => {
    expect(flagEnabled("true")).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", true]) {
      expect(flagEnabled(v), String(v)).toBe(false);
    }
  });
});

describe("parent report flag", () => {
  it("is off unless the build variable is exactly true", () => {
    expect(PARENT_REPORT_UI_ENABLED).toBe(flagEnabled(import.meta.env.VITE_PARENT_REPORT_UI));
  });
});
