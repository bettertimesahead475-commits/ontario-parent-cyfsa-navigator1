import { afterEach, describe, expect, it, vi } from "vitest";
import { flagEnabled } from "./featureFlags";

describe("feature flag parsing", () => {
  it("is on only for the exact string true", () => {
    expect(flagEnabled("true")).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", true]) {
      expect(flagEnabled(v), String(v)).toBe(false);
    }
  });
});

describe("parent report flag as read from the build environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is off when the build variable is empty", async () => {
    vi.stubEnv("VITE_PARENT_REPORT_UI", "");
    const { PARENT_REPORT_UI_ENABLED } = await import("./featureFlags");
    expect(PARENT_REPORT_UI_ENABLED).toBe(false);
  });

  it("is off for any value other than exactly true", async () => {
    vi.stubEnv("VITE_PARENT_REPORT_UI", "1");
    const { PARENT_REPORT_UI_ENABLED } = await import("./featureFlags");
    expect(PARENT_REPORT_UI_ENABLED).toBe(false);
  });

  it("is on only when the build variable is exactly true", async () => {
    vi.stubEnv("VITE_PARENT_REPORT_UI", "true");
    const { PARENT_REPORT_UI_ENABLED } = await import("./featureFlags");
    expect(PARENT_REPORT_UI_ENABLED).toBe(true);
  });
});
