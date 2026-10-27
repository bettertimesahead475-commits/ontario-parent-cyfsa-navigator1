// Regression: an unlisted model is refused, never silently replaced by the Sonnet model.
import { describe, expect, it } from "vitest";
import { AnalyzerError } from "./analyzerErrors";
import { CLAUDE_MODELS, requireApprovedModel } from "./analyzerModels";

describe("requireApprovedModel", () => {
  it("returns a listed model unchanged, including Opus", () => {
    expect(requireApprovedModel("claude-opus-5")).toBe("claude-opus-5");
    expect(requireApprovedModel("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("refuses an unlisted model instead of substituting another", () => {
    let caught: unknown = null;
    try {
      requireApprovedModel("claude-unlisted-model");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnalyzerError);
    expect((caught as AnalyzerError).code).toBe("AI_PROVIDER_CONFIGURATION_ERROR");
    expect((caught as AnalyzerError).userMessage).toMatch(/rather than run on a different model/);
  });

  it("refuses an empty model id rather than defaulting it", () => {
    expect(() => requireApprovedModel("")).toThrow(AnalyzerError);
  });

  it("every model the forensic verification may use is on the approved list", () => {
    expect(CLAUDE_MODELS.has("claude-opus-5")).toBe(true);
  });
});
