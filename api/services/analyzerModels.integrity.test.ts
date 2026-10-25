// Model integrity: a Forensic In-Depth run must never silently use a different model, and an unlisted model
// identifier is refused rather than replaced.
import { afterEach, describe, expect, it, vi } from "vitest";

const savedForensic = process.env.ANTHROPIC_FORENSIC_MODEL;
const savedQuick = process.env.ANTHROPIC_QUICK_MODEL;

async function loadWithEnv(env: { forensic?: string; quick?: string }) {
  vi.resetModules();
  if (env.forensic === undefined) delete process.env.ANTHROPIC_FORENSIC_MODEL;
  else process.env.ANTHROPIC_FORENSIC_MODEL = env.forensic;
  if (env.quick === undefined) delete process.env.ANTHROPIC_QUICK_MODEL;
  else process.env.ANTHROPIC_QUICK_MODEL = env.quick;
  return await import("./analyzerModels.js");
}

afterEach(() => {
  if (savedForensic === undefined) delete process.env.ANTHROPIC_FORENSIC_MODEL;
  else process.env.ANTHROPIC_FORENSIC_MODEL = savedForensic;
  if (savedQuick === undefined) delete process.env.ANTHROPIC_QUICK_MODEL;
  else process.env.ANTHROPIC_QUICK_MODEL = savedQuick;
  vi.resetModules();
});

describe("assertAllowlistedModel", () => {
  it("accepts a listed model", async () => {
    const m = await loadWithEnv({});
    expect(() => m.assertAllowlistedModel("claude-opus-5")).not.toThrow();
  });

  it("refuses an unlisted model with a configuration error, never a substitute", async () => {
    const m = await loadWithEnv({});
    expect(() => m.assertAllowlistedModel("claude-opus-9-future")).toThrow(
      expect.objectContaining({ code: "AI_PROVIDER_CONFIGURATION_ERROR", statusCode: 503, retryable: false })
    );
  });
});

describe("Forensic model configuration", () => {
  it("Forensic In-Depth runs on the configured Opus model when it is listed", async () => {
    const m = await loadWithEnv({});
    const r = m.resolveServerAuthoritativeModel({ mode: "full", isPaid: true, tier: "Premium" });
    expect(r.verificationModel).toBe("claude-opus-5");
  });

  it("fails clearly, and does not run on Sonnet, when the configured Forensic model is not listed", async () => {
    const m = await loadWithEnv({ forensic: "claude-opus-typo-404" });
    expect(() => m.resolveServerAuthoritativeModel({ mode: "full", isPaid: true, tier: "Premium" })).toThrow(
      expect.objectContaining({ code: "FORENSIC_MODEL_UNAVAILABLE", statusCode: 503 })
    );
  });

  it("does not affect Quick Review when only the Forensic model is misconfigured", async () => {
    const m = await loadWithEnv({ forensic: "claude-opus-typo-404" });
    const r = m.resolveServerAuthoritativeModel({ mode: "fast", isPaid: true, tier: "Premium" });
    expect(r.primaryModel).toBe("claude-sonnet-5");
  });

  it("still enforces entitlement before any model check", async () => {
    const m = await loadWithEnv({ forensic: "claude-opus-typo-404" });
    expect(() => m.resolveServerAuthoritativeModel({ mode: "full", isPaid: false, tier: null })).toThrow(
      expect.objectContaining({ code: "FORENSIC_UPGRADE_REQUIRED" })
    );
  });
});
