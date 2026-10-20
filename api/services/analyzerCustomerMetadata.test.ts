import { describe, expect, it } from "vitest";
import { toCustomerModelMetadata } from "./analyzerCustomerMetadata.js";

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
