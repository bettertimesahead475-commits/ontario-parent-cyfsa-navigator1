// Regression tests for applyReportGuards: the quotation check, the red-flag severity policy, and citation checks.
// The model's original finding is preserved in every case; only display-facing fields are added or lowered.
import { describe, expect, it } from "vitest";
import { applyReportGuards } from "./analyzerSections";

const SOURCE = "Page one.\n[Page 2]\nThe worker stated that a neighbour told me the child was unsafe.";

function flag(over: Record<string, unknown> = {}) {
  return {
    id: "rf1",
    severity: "CRITICAL",
    category: "Hearsay",
    evidenceClassification: "HEARSAY",
    phraseDetected: "a neighbour told me the child was unsafe",
    explanation: "The point relies on a third party.",
    verifyRequirement: "Obtain the neighbour's statement.",
    legalReference: "CYFSA s. 74(2)",
    locationInDocument: "Page 2, Paragraph 1",
    parentActionStep: "Ask for the source.",
    ...over,
  };
}

function run(redFlags: unknown[]) {
  return applyReportGuards({ redFlags: JSON.parse(JSON.stringify(redFlags)) }, SOURCE).redFlags as Record<string, any>[];
}

describe("quotation located exactly", () => {
  it("keeps the model's severity and records the exact match with its page", () => {
    const [f] = run([flag()]);
    expect(f.severity).toBe("CRITICAL");
    expect(f.modelSeverity).toBe("CRITICAL");
    expect(f.quoteVerification).toBe("EXACT");
    expect(f.quoteVerified).toBe(true);
    expect(f.verificationStatus).toBe("LOCATED_EXACT");
    expect(f.quoteLocation.page).toBe(2);
    expect(f.severityCapReason).toBeUndefined();
    expect(f.verificationNote).toBeUndefined();
  });
});

describe("quotation not located: an unsupported critical finding is limited and labelled", () => {
  const absent = () => run([flag({ phraseDetected: "the parent admitted neglect in writing" })])[0];

  it("is no longer displayed as CRITICAL, but the model's severity is kept", () => {
    const f = absent();
    expect(f.severity).toBe("Affects Evidentiary Weight");
    expect(f.modelSeverity).toBe("CRITICAL");
    expect(f.severityCapReason).toMatch(/could not be located/);
  });

  it("is marked as an unverified allegation, not a located fact", () => {
    const f = absent();
    expect(f.quoteVerified).toBe(false);
    expect(f.verificationStatus).toBe("NOT_LOCATED");
    expect(f.verificationNote).toMatch(/could not be located/);
    expect(f.verificationNote).toMatch(/unverified allegation/);
  });

  it("does not silently delete the finding or rewrite the model's text or the quoted phrase", () => {
    const original = flag({ phraseDetected: "the parent admitted neglect in writing" });
    const f = run([original])[0];
    expect(f.phraseDetected).toBe(original.phraseDetected);
    expect(f.explanation).toBe(original.explanation);
    expect(f.locationInDocument).toBe(original.locationInDocument);
    expect(f.id).toBe("rf1");
  });

  it("a corroboration label is not kept when the supporting passage is not located", () => {
    const [f] = run([flag({ phraseDetected: "the parent admitted neglect", evidenceClassification: "CORROBORATED" })]);
    expect(f.evidenceClassification).toBe("CORROBORATED");
    expect(f.classificationCaveat).toMatch(/not shown as corroborated/);
  });

  it("a corroboration label on a located passage carries no caveat", () => {
    const [f] = run([flag({ evidenceClassification: "CORROBORATED" })]);
    expect(f.classificationCaveat).toBeUndefined();
  });
});

describe("quotation located only approximately or in several places", () => {
  it("a case-changed quotation is capped at Worth Raising With Counsel and asks the reader to check wording", () => {
    const [f] = run([flag({ phraseDetected: "A NEIGHBOUR TOLD ME THE CHILD WAS UNSAFE" })]);
    expect(f.quoteVerification).toBe("CASE_OR_PUNCTUATION_VARIANT");
    expect(f.quoteVerified).toBe(false);
    expect(f.severity).toBe("Worth Raising With Counsel");
    expect(f.verificationNote).toMatch(/capitalisation or punctuation/);
  });

  it("an ambiguous quotation is capped and its location is not fixed", () => {
    const source = "The worker stated it. The worker stated it.";
    const [f] = applyReportGuards({ redFlags: [flag({ phraseDetected: "The worker stated it.", severity: "CRITICAL" })] }, source).redFlags as any[];
    expect(f.quoteVerification).toBe("AMBIGUOUS");
    expect(f.severity).toBe("Worth Raising With Counsel");
    expect(f.quoteLocation.startOffset).toBeNull();
  });

  it("a whitespace-only difference keeps the model's severity: the words are in the document", () => {
    const [f] = run([flag({ phraseDetected: "a neighbour told me\nthe child was unsafe", severity: "CRITICAL" })]);
    expect(f.quoteVerification).toBe("NORMALIZED_WHITESPACE");
    expect(f.severity).toBe("CRITICAL");
    expect(f.quoteVerified).toBe(true);
  });
});

describe("severity policy", () => {
  it("never raises a severity, and leaves a lower model severity unchanged", () => {
    const [f] = run([flag({ severity: "Affects Evidentiary Weight", phraseDetected: "not in the document" })]);
    expect(f.severity).toBe("Affects Evidentiary Weight");
    expect(f.severityCapReason).toBeUndefined();
  });

  it("re-running the guards does not overwrite the preserved model severity", () => {
    const once = applyReportGuards({ redFlags: [flag({ phraseDetected: "not in the document" })] }, SOURCE);
    const twice = applyReportGuards(once, SOURCE);
    expect((twice.redFlags as any[])[0].modelSeverity).toBe("CRITICAL");
  });
});

describe("citations inside red flags", () => {
  it("a Family Law Act citation is never shown as a CYFSA match, and keeps its text", () => {
    const [f] = run([flag({ legalReference: "Family Law Act, s. 88" })]);
    expect(f.citationStatus).toBe("UNVERIFIED");
    expect(f.identifiedAct).toBe("OTHER");
    expect(f.legalReference).toMatch(/^Family Law Act, s\. 88/);
    expect(f.legalReference).toMatch(/unverified/);
  });

  it("CYFSA, s. 88 is an internal reference match, with no warning appended", () => {
    const [f] = run([flag({ legalReference: "CYFSA, s. 88" })]);
    expect(f.citationStatus).toBe("INTERNAL_REFERENCE_MATCH");
    expect(f.legalReference).toBe("CYFSA, s. 88");
    expect(f.citationReason).toMatch(/Not checked against official e-Laws/);
  });

  it("a section number with no Act is unverified", () => {
    const [f] = run([flag({ legalReference: "s. 81(7)" })]);
    expect(f.citationStatus).toBe("UNVERIFIED");
    expect(f.identifiedAct).toBe("NONE");
  });
});

describe("report-level", () => {
  it("states that the internal list has not been checked against official e-Laws", () => {
    const out = applyReportGuards({ redFlags: [] }, SOURCE);
    expect(out.citationVerification.method).toMatch(/has not been checked against official e-Laws/);
  });

  it("applies citation checks to thresholds and timeline entries as well", () => {
    const out = applyReportGuards(
      {
        thresholdAnalysis: [{ thresholdChecked: "x", primarySourceLaw: "Criminal Code, s. 81(7)" }],
        proceduralTimelineViolations: [{ timelineRule: "x", evaluation: "y", citation: "CYFSA, s. 88" }],
      },
      SOURCE
    );
    expect((out.thresholdAnalysis as any[])[0].citationStatus).toBe("UNVERIFIED");
    expect((out.proceduralTimelineViolations as any[])[0].citationStatus).toBe("INTERNAL_REFERENCE_MATCH");
  });
});
