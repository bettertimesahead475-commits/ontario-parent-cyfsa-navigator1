import { describe, expect, it } from "vitest";
import { buildDirectBriefPrompt, generateDirectBrief, DIRECT_BRIEF_SYSTEM } from "./directCaseBrief.js";
describe("direct case brief prompt", () => {
  it("rejects empty source text", () => {
    expect(() => buildDirectBriefPrompt({ sourceName: "test", documentText: " " })).toThrow();
  });
  it("preserves document and source while requiring attribution and limitations", () => {
    const prompt = buildDirectBriefPrompt({ sourceName: "Affidavit", documentText: "Worker alleges X." });
    expect(prompt).toContain("Worker alleges X.");
    expect(prompt).toContain("Source Coverage and Limitations");
    expect(prompt).toContain("location unavailable");
    expect(DIRECT_BRIEF_SYSTEM).toContain("Do not invent");
  });
  it("includes optional legal references as reference material", () => {
    expect(buildDirectBriefPrompt({ sourceName: "A", documentText: "B", legalContext: "CYFSA excerpt" })).toContain("<reference_material>\nCYFSA excerpt");
  });
});

describe("direct brief bounded invocation", () => {
  it("skips oversized documents without truncation or provider calls", async () => {
    let called = false;
    const result = await generateDirectBrief(
      { sourceName: "A", documentText: "x".repeat(75_001) },
      async () => { called = true; return { text: "unexpected", durationMs: 1 }; },
      "test-model", "request-1", Date.now() + 90_000
    );
    expect(result).toBeNull();
    expect(called).toBe(false);
  });
  it("uses one provider call for an eligible document", async () => {
    let calls = 0;
    const result = await generateDirectBrief(
      { sourceName: "A", documentText: "Evidence paragraph." },
      async (params, model) => {
        calls++;
        expect(params.stage).toBe("direct_preliminary_brief");
        expect(params.messages[0].content[0].text).toContain("Evidence paragraph.");
        expect(model).toBe("test-model");
        return { text: "Preliminary findings", durationMs: 50 };
      },
      "test-model", "request-2", Date.now() + 90_000
    );
    expect(calls).toBe(1);
    expect(result?.text).toBe("Preliminary findings");
  });
  it("does not call provider when deadline is too close", async () => {
    let called = false;
    const result = await generateDirectBrief(
      { sourceName: "A", documentText: "Evidence." },
      async () => { called = true; return { text: "unexpected", durationMs: 1 }; },
      "test-model", "request-3", Date.now() + 10_000
    );
    expect(result).toBeNull();
    expect(called).toBe(false);
  });
});
