import { describe, expect, it } from "vitest";
import { normalizeAnalyzerReport } from "./analyzerQuality.js";

describe("analyzer report evidence guards", () => {
  it("drops invented quotations and retains exact source passages", () => {
    const result = normalizeAnalyzerReport({redFlags: [
      {phraseDetected: "The Society investigated the anonymous allegation."},
      {phraseDetected: "An invented quotation never in the source."}
    ]}, "Paragraph 45: The Society investigated the anonymous allegation.");
    expect(result.redFlags).toHaveLength(1);
  });

  it("does not turn removal alone into a five-day breach or cite s.94", () => {
    const result = normalizeAnalyzerReport({proceduralTimelineViolations: [{timelineRule: "Five-day post-apprehension hearing", citation: "CYFSA s.94(5)", evaluation: "Procedural violation"}]}, "The child was removed on March 8, 2026.");
    expect(result.proceduralTimelineViolations[0].citation).toContain("s.88");
    expect(result.proceduralTimelineViolations[0].evaluation).toContain("not determinable");
  });

  it("suppresses irrelevant parentage and Ombudsman entries", () => {
    const report = {proceduralTimelineViolations: [
      {timelineRule: "300-Day Presumption of Parentage"},
      {timelineRule: "Child Ombudsman Access & Continuous Care Rights"}
    ]};
    expect(normalizeAnalyzerReport(report, "A school attendance affidavit.").proceduralTimelineViolations).toEqual([]);
  });

  it("recalculates the displayed sum and rejects invalid component totals", () => {
    const components = Object.fromEntries([20,15,15,15,10,10,10,5].map((max, i) => [i, {score: max - 1, max}]));
    const report = normalizeAnalyzerReport({evidenceStrengthIndex: {score: 100, components}}, "document");
    expect(report.evidenceStrengthIndex.score).toBe(92);
    expect(normalizeAnalyzerReport({evidenceStrengthIndex: {components: {a: {score: 90, max: 20}}}}, "document").evidenceStrengthIndex).toBeUndefined();
  });

  it("uses neutral wording for a warrantless event", () => {
    const report = normalizeAnalyzerReport({redFlags: [{category: "Authority Overreach", phraseDetected: "apprehended without a warrant"}]}, "She wrote: apprehended without a warrant.");
    expect(report.redFlags[0].category).toContain("statutory authority review");
  });
});
