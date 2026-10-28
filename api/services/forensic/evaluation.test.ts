import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectInstructionLikeText } from "./documentIsolation";
import { fromLegacyReport, scoreCase, summarize, type BenchmarkCase, type ScoredFinding } from "./evaluation";

const DIR = new URL("../../../eval/forensic/cases/", import.meta.url);
const CASES: BenchmarkCase[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, DIR), "utf8")));
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("benchmark cases are well-formed", () => {
  it("has cases across categories, including a no-problem case and an injection case", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(7);
    expect(CASES.some((c) => c.expectNoMaterialFindings)).toBe(true);
    expect(CASES.some((c) => c.expectInjectionWarning)).toBe(true);
    expect(CASES.some((c) => c.category === "MULTI_DOCUMENT")).toBe(true);
  });

  it.each(CASES.map((c) => [c.id, c] as const))("%s: every anchor is source text, every pattern compiles", (_id, c) => {
    const all = squash(c.documents.map((d) => d.text).join("\n"));
    for (const e of c.expected) for (const a of e.anchors) expect(all).toContain(squash(a));
    for (const f of c.forbidden) expect(() => new RegExp(f.pattern, "i")).not.toThrow();
    // Honesty: no case claims independent review it has not had.
    expect(c.annotation.independentlyReviewed).toBe(false);
  });

  it("the injection case trips the instruction detector", () => {
    const c = CASES.find((x) => x.expectInjectionWarning)!;
    expect(detectInstructionLikeText(c.documents).length).toBeGreaterThan(0);
  });
});

describe("scoring", () => {
  const c = CASES.find((x) => x.id === "endorsement-attendance")!;
  const f = (id: string, quote: string, statement = "s", cls: ScoredFinding["evidenceClass"] = "A"): ScoredFinding => ({
    id, title: id, statement, evidenceClass: cls, quotes: [{ documentId: "end", quote, verified: true }], citations: [],
  });

  it("credits an issue only through a verified evidence quotation", () => {
    const s = scoreCase(c, [f("p1", "The mother did not attend."), { ...f("p2", "adjourned to November 23, 2026"), quotes: [{ documentId: "end", quote: "adjourned to November 23, 2026", verified: false }] }], null);
    expect(s.requiredFound).toBe(1);
    expect(s.missed).toEqual(["adjournment-length"]);
  });

  it("counts a forbidden conclusion as a confirmed false positive, and an unmatched finding only as unmatched", () => {
    const s = scoreCase(c, [f("p1", "Justice R. Okafor", "All presence boxes are unmarked."), f("p2", "Present:", "Something new.")], null);
    expect(s.forbiddenHits).toEqual(["all-unmarked:p1"]);
    expect(s.unmatchedPredicted).toBe(2);
  });

  it("summarizes recall, false positives and no-problem cases", () => {
    const clean = CASES.find((x) => x.expectNoMaterialFindings)!;
    const scores = [
      scoreCase(c, [f("p1", "The mother did not attend."), f("p2", "adjourned to November 23, 2026", "s", "D")], null),
      scoreCase(clean, [f("q1", "On consent of all parties present", "The adjournment violates s. 94(1).")], null),
    ];
    const sum = summarize([c, clean], scores);
    expect(sum.recallRequired).toBe(1);
    expect(sum.noProblemCasesWithFindings).toBe(1);
    expect(sum.falsePositiveCases).toBe(1);
  });

  it("adapts the existing analyzer's report to the same scoring shape", () => {
    const legacy = fromLegacyReport({ redFlags: [{ category: "Absent party", phraseDetected: "The mother did not attend.", legalReference: "CYFSA s. 94(1)", citationStatus: "INTERNAL_REFERENCE_MATCH" }] }, c.documents);
    expect(legacy[0].quotes[0]).toEqual({ documentId: "end", quote: "The mother did not attend.", verified: true });
    expect(scoreCase(c, legacy, null).requiredFound).toBe(1);
  });
});
