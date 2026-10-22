import { describe, expect, it } from "vitest";
import { redactCustomerReport, toCustomerModelMetadata } from "./analyzerCustomerMetadata.js";

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

describe("redactCustomerReport", () => {
  it("strips provider IDs, tokens and cost from a report saved before the allowlist", () => {
    const legacy = {
      documentTitle: "Notice",
      modelMetadata: {
        engine: "claude-sonnet-5", model: "claude-sonnet-5", primaryModel: "claude-sonnet-5",
        verificationModel: "claude-opus-5", engineName: "Claude Sonnet", mode: "full",
        modeName: "Forensic Deep Scan", durationMs: 9000, sectionAttempts: {},
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        cost: { totalCostUsd: 0.5, totalCostCad: 0.7, byModel: {} },
      },
      forensicVerification: { status: "completed", model: "claude-opus-5", checkedFindings: 2 },
      redFlags: [{ category: "Hearsay", verifiedBy: "claude-opus-5" }, { category: "Other" }],
    };
    const redacted = redactCustomerReport(legacy);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toMatch(/claude-|usage|cost|tokens|sectionAttempts|primaryModel/i);
    expect(Object.keys(redacted.modelMetadata).sort()).toEqual(["durationMs", "engineName", "mode", "modeName"]);
    expect(redacted.forensicVerification).toEqual({ status: "completed", checkedFindings: 2 });
    expect(redacted.redFlags[0].verifiedBy).toBe("Independent second review");
    expect(redacted.redFlags[1]).toEqual({ category: "Other" });
  });

  it("relabels a verifier ID stored in the nested forensicVerification of a legacy finding", () => {
    const legacy = {
      thresholdAnalysis: [
        { thresholdChecked: "CYFSA s. 74", forensicVerification: { verdict: "OVERSTATED", verifiedBy: "claude-opus-5" } },
      ],
    };
    const serialized = JSON.stringify(redactCustomerReport(legacy));
    expect(serialized).not.toMatch(/claude-/);
    expect(redactCustomerReport(legacy).thresholdAnalysis[0].forensicVerification).toEqual({
      verdict: "OVERSTATED",
      verifiedBy: "Independent second review",
    });
  });

  it("leaves a report without internal fields unchanged in content", () => {
    const report = { documentTitle: "Plain", redFlags: [] };
    expect(redactCustomerReport(report)).toEqual(report);
  });
});
