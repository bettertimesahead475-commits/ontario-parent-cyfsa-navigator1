import { describe, expect, it } from "vitest";
import { stripVerifierIdentity, toCustomerModelMetadata } from "./analyzerCustomerMetadata.js";

describe("customer model metadata", () => {
  it("returns only the display fields a parent needs", () => {
    const result = toCustomerModelMetadata({
      engineName: "Claude Sonnet",
      mode: "fast",
      modeName: "Quick Review",
      durationMs: 1234,
    });
    expect(Object.keys(result).sort()).toEqual(["durationMs", "engineName", "mode", "modeName"]);
  });

  it("never carries token counts, provider model IDs, or cost", () => {
    const input = {
      engineName: "Claude Opus",
      mode: "full" as const,
      modeName: "Forensic Deep Scan",
      durationMs: 9000,
      // Extra fields a caller might pass by mistake must not survive the allowlist.
      ...({
        model: "claude-opus-5",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        cost: { totalCostUsd: 0.5, totalCostCad: 0.7 },
      } as object),
    };
    const serialized = JSON.stringify(toCustomerModelMetadata(input));
    expect(serialized).not.toMatch(/claude-/);
    expect(serialized).not.toMatch(/usage|cost|tokens/i);
  });
});

describe("verifier identity", () => {
  it("removes the verifying model ID but keeps the verdicts and notes", () => {
    const report = {
      forensicVerification: { status: "completed", model: "claude-opus-5", checkedFindings: 1 },
      redFlags: [{ id: "rf1", forensicVerification: { verdict: "OVERSTATED", note: "Single source.", verifiedBy: "claude-opus-5" } }],
      thresholdAnalysis: [{ thresholdChecked: "s. 74", forensicVerification: { verdict: "NEEDS_CONTEXT", verifiedBy: "claude-opus-5" } }],
    };
    stripVerifierIdentity(report);
    expect(report.forensicVerification).toEqual({ status: "completed", checkedFindings: 1 });
    expect(report.redFlags[0].forensicVerification).toEqual({ verdict: "OVERSTATED", note: "Single source." });
    expect(report.thresholdAnalysis[0].forensicVerification).toEqual({ verdict: "NEEDS_CONTEXT" });
    expect(JSON.stringify(report)).not.toMatch(/claude-/);
  });
});
