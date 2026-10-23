import { describe, expect, it } from "vitest";
import { buildParentReportView, readability } from "./parentReportView";
import { PARENTAL_RIGHTS } from "../../shared/parentalRights";

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

  it("keeps an unverified source warning on a threshold check", () => {
    const view = buildParentReportView({
      ...REPORT,
      thresholdAnalysis: [{ thresholdChecked: "Place of safety, s. 81", isMet: "Inconclusive", reasoning: "Not shown.", primarySourceLaw: "CYFSA s. 81(2)", citationStatus: "UNVERIFIED" }],
    });
    expect(view.thresholdChecks[0]).toMatch(/CYFSA s\. 81\(2\)/);
    expect(view.thresholdChecks[0]).toMatch(/unverified/);
  });

  it("carries the chronology and contradictions into the parent view", () => {
    const view = buildParentReportView({
      ...REPORT,
      chronology: [{ date: "2026-03-02", event: "Child placed in care", locationInDocument: "Page 2" }],
      contradictions: [{ description: "The affidavit gives two different dates for the visit.", locations: ["Page 3", "Page 5"], significance: "May affect credibility." }],
    });
    expect(view.chronology).toHaveLength(1);
    expect(view.contradictions).toHaveLength(1);
    expect(view.summary.find((part: { heading: string }) => part.heading.startsWith("2."))?.body).toMatch(/Child placed in care/);
    expect(view.summary.find((part: { heading: string }) => part.heading.startsWith("5."))?.body).toMatch(/two different dates/);
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

  it("keeps the unverified warning on a timeline checkpoint that cites an unverified provision", () => {
    const view = buildParentReportView({
      ...REPORT,
      proceduralTimelineViolations: [{ timelineRule: "Hearing within five days", evaluation: "No hearing date appears.", citation: "CYFSA s. 81(2)", citationStatus: "UNVERIFIED" }],
    });
    expect(view.timelineChecks[0]).toMatch(/No hearing date appears/);
    expect(view.timelineChecks[0]).toMatch(/[Uu]nverified/);
  });

  it("does not add an unverified warning to a timeline checkpoint with a confirmed citation", () => {
    const view = buildParentReportView({
      ...REPORT,
      proceduralTimelineViolations: [{ timelineRule: "Hearing within five days", evaluation: "No hearing date appears.", citation: "CYFSA s. 88", citationStatus: "CONFIRMED_REFERENCE" }],
    });
    expect(view.timelineChecks[0]).not.toMatch(/[Uu]nverified/);
  });

  it("does not treat a draft or proposed order as an order with legal effect", () => {
    for (const documentType of ["Draft Order", "Proposed Order", "Unofficial Draft Order"]) {
      const { documentAuthority: _omitted, ...withoutAuthority } = REPORT;
      const view = buildParentReportView({ ...withoutAuthority, documentType });
      const body = view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body ?? "";
      expect(body, documentType).not.toMatch(/court order or endorsement has legal effect/);
      expect(body, documentType).toMatch(/draft or proposed order/);
    }
  });

  it("carries a red-flag second-review verdict and note into the parent view", () => {
    const view = buildParentReportView({
      ...REPORT,
      redFlags: [{ ...REPORT.redFlags[0], forensicVerification: { verdict: "UNSUPPORTED", note: "The quoted finding does not appear in the reasons.", verifiedBy: "Second review" } }],
    });
    expect(view.findings[0].secondReview).toMatch(/did not find the record supports/);
    expect(view.findings[0].secondReview).toMatch(/does not appear in the reasons/);
  });

  it("leaves the second-review field empty when no second review ran", () => {
    const view = buildParentReportView(REPORT);
    expect(view.findings[0].secondReview).toBe("");
  });

  it("carries a threshold second-review verdict and note into the threshold line", () => {
    const view = buildParentReportView({
      ...REPORT,
      thresholdAnalysis: [{
        thresholdChecked: "Child in need of protection",
        isMet: "Met",
        reasoning: "The record describes a risk of harm.",
        primarySourceLaw: "CYFSA s. 74",
        forensicVerification: { verdict: "OVERSTATED", note: "The record shows a concern, not a confirmed risk." },
      }],
    });
    expect(view.thresholdChecks[0]).toMatch(/Result: Met/);
    expect(view.thresholdChecks[0]).toMatch(/found this overstated/);
    expect(view.thresholdChecks[0]).toMatch(/concern, not a confirmed risk/);
  });

  it("states the s. 94(1) objection rule without presenting an absent party's silence as an exception", () => {
    const adjournment = PARENTAL_RIGHTS.find((entry) => entry.id === "adjournment-limit");
    expect(adjournment).toBeDefined();
    expect(adjournment?.plainEnglish).toMatch(/everyone present and the child's caregiver agree/);
    expect(adjournment?.plainEnglish).toMatch(/knows that a party who is not present objects/);
    expect(adjournment?.plainEnglish).not.toMatch(/does not object/);
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
