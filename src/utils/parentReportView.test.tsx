import { describe, expect, it } from "vitest";
import { buildParentReportView, readability } from "./parentReportView";

// Sanitized fixture: no real names, file numbers, or document text.
const REPORT = {
  documentType: "Court Endorsement",
  fileSummary: "The judge reviewed the materials and adjourned the matter. The judge's reasons are summarized here.",
  documentAuthority: { recordKind: "JUDICIAL_ENDORSEMENT", scoring: "NOT_CREDIBILITY_SCORED" },
  whatIsMissing: ["The affidavit referred to in the reasons was not included in the upload."],
  whatToVerify: ["Obtain the affidavit from the court file to see what it says."],
  whatToAskALawyer: ["Question: Does the adjournment affect the interim order? | What the uploaded record shows: The matter was adjourned."],
  redFlags: [
    {
      id: "rf1",
      category: "Authority Overreach",
      severity: "Worth Raising With Counsel",
      evidenceClassification: "JUDICIAL_FINDING",
      phraseDetected: "I find that the concerns are supported by the reasons given.",
      explanation: "The judge states a finding and its basis.",
      verifyRequirement: "Obtain the hearing transcript.",
      legalReference: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.",
      citationStatus: "UNVERIFIED",
      locationInDocument: "Page 1, Paragraph 3",
      parentActionStep: "Ask your lawyer what the finding relied on.",
    },
  ],
};

describe("buildParentReportView", () => {
  it("builds the seven-part summary in order", () => {
    const view = buildParentReportView(REPORT);
    expect(view.summary.map((s) => s.heading)).toEqual([
      "1. What is this document?",
      "2. What happened?",
      "3. What does this mean for you?",
      "4. What rights or legal protections may apply?",
      "5. Is anything missing or concerning?",
      "6. What can you do to prepare?",
      "7. What should you check before your next court date?",
    ]);
  });

  it("keeps every finding and never drops one", () => {
    const view = buildParentReportView(REPORT);
    expect(view.findings).toHaveLength(REPORT.redFlags.length);
    expect(view.findings[0].evidenceLabel).toBe("JUDICIAL_FINDING");
  });

  it("states that court decisions are not attached, rather than inventing them", () => {
    const view = buildParentReportView(REPORT);
    expect(view.findings[0].whatCourtsHaveSaid).toMatch(/No verified court decision/);
  });

  it("shows unverified citations as unverified in the expandable detail", () => {
    const view = buildParentReportView(REPORT);
    expect(view.findings[0].evidenceDetail.citationStatus).toMatch(/Citation unverified/);
  });

  it("does not describe a court order as a judgment on the facts", () => {
    const view = buildParentReportView(REPORT);
    expect(view.summary[2].body).toMatch(/does not decide whether the facts it mentions are true/);
  });

  it("does not present a missing record as a confirmed defect", () => {
    const view = buildParentReportView(REPORT);
    expect(view.missingRecords[0]).toMatch(/not included in the upload/);
    expect(JSON.stringify(view)).not.toMatch(/violat|breach|unlawful|illegal/i);
  });
});

describe("buildParentReportView - accuracy of parent-facing claims", () => {
  it("carries threshold checks and timeline violations into the parent view, not only red flags", () => {
    const view = buildParentReportView({
      ...REPORT,
      thresholdAnalysis: [{ thresholdChecked: "Child in need of protection", isMet: "Inconclusive", reasoning: "The file does not show the harm alleged.", primarySourceLaw: "CYFSA s. 74" }],
      proceduralTimelineViolations: [{ timelineRule: "Hearing within five days", documentAssertion: "", evaluation: "No hearing date appears in the upload.", citation: "CYFSA s. 88" }],
    });
    const concerns = view.summary.find((part: { heading: string }) => part.heading.startsWith("5."))?.body ?? "";
    expect(concerns).toMatch(/Child in need of protection/);
    expect(concerns).toMatch(/No hearing date appears/);
    expect(view.thresholdChecks).toHaveLength(1);
    expect(view.timelineChecks).toHaveLength(1);
  });

  it("marks a legacy citation with no verification status as unverified", () => {
    const view = buildParentReportView({
      ...REPORT,
      redFlags: [{ ...REPORT.redFlags[0], citationStatus: undefined, legalReference: "CYFSA s. 74(2)" }],
    });
    expect(view.findings[0].evidenceDetail.citationStatus).not.toBe("CYFSA s. 74(2)");
    expect(view.findings[0].evidenceDetail.citationStatus).toMatch(/[Uu]nverified/);
  });

  it("labels an unverified quotation as a paraphrase rather than the record's words", () => {
    const view = buildParentReportView({
      ...REPORT,
      redFlags: [{ ...REPORT.redFlags[0], quoteVerified: false }],
    });
    const whatHappened = view.findings[0].whatHappened;
    expect(whatHappened).not.toMatch(/^The record says/);
    expect(whatHappened).toMatch(/paraphrase/);
  });

  it("does not say no rights were identified when the rights section was never run", () => {
    const view = buildParentReportView({ ...REPORT, charterAndHumanRightsIssues: [] });
    const rights = view.summary.find((part: { heading: string }) => part.heading.startsWith("4."));
    expect(rights?.body).not.toMatch(/No specific rights were identified/);
    expect(rights?.body).toMatch(/full analysis/);
  });

  it("does not present a court affidavit as an order or endorsement with legal effect", () => {
    const { documentAuthority: _omitted, ...withoutAuthority } = REPORT;
    const view = buildParentReportView({ ...withoutAuthority, documentType: "Court Affidavit" });
    expect(view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body)
      .not.toMatch(/court order or endorsement has legal effect/);
  });

  it("treats a court endorsement as a court record from documentType alone", () => {
    const { documentAuthority: _omitted, ...withoutAuthority } = REPORT;
    const view = buildParentReportView(withoutAuthority);
    expect(view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body)
      .toMatch(/court order or endorsement has legal effect/);
  });
});

describe("readability", () => {
  it("passes a short, plain-language summary with no unexplained terms", () => {
    const plain =
      "The judge read the papers. The judge put the matter on hold until a later date. " +
      "This means the case continues, but not yet.";
    const r = readability(plain);
    expect(r.wordsPerSentence).toBeLessThanOrEqual(15);
    expect(r.gradeLevel).toBeLessThanOrEqual(8);
    expect(r.unexplainedTerms).toEqual([]);
  });

  it("flags a legal term used without an explanation", () => {
    const r = readability("The reasons rely on hearsay from a worker.");
    expect(r.unexplainedTerms).toContain("hearsay");
  });

  it("accepts a legal term that is explained in plain words", () => {
    const r = readability("The reasons rely on hearsay (second-hand information) from a worker.");
    expect(r.unexplainedTerms).toEqual([]);
  });

  it("counts long sentences so reviewers can see reading burden", () => {
    const long = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ") + ".";
    expect(readability(long).longSentences).toBe(1);
  });
});
