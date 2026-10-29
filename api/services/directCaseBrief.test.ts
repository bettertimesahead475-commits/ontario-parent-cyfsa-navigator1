import { describe, expect, it } from "vitest";
import { buildDirectBriefPrompt, DIRECT_BRIEF_SYSTEM } from "./directCaseBrief.js";
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
