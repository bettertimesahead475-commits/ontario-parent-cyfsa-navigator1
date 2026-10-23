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
    expect(view.findings[0].evidenceLabel).toBe("Judicial finding");
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
      expect(body, documentType).not.toMatch(/has legal effect/);
      expect(body, documentType).toMatch(/cannot confirm/);
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
    expect(adjournment?.plainEnglish).toMatch(/all the parties present and the person caring for the child/);
    expect(adjournment?.plainEnglish).toMatch(/knows a party who is absent objects/);
    expect(adjournment?.plainEnglish).not.toMatch(/does not object/);
  });

  it("tells the parent when the second review was incomplete, without showing the analyzer's raw reason", () => {
    const view = buildParentReportView({
      ...REPORT,
      forensicVerification: { status: "incomplete", reason: "Second review timed out; no findings were checked." },
    });
    expect(view.secondReviewNotice).toMatch(/Not every finding was independently second-reviewed/);
    expect(view.secondReviewNotice).not.toMatch(/timed out/);
    expect(view.summary.find((part: { heading: string }) => part.heading.startsWith("5."))?.body).toMatch(/could not be completed/);
  });

  it("says how many findings a partial second review covered", () => {
    const view = buildParentReportView({
      ...REPORT,
      forensicVerification: { status: "completed", checkedFindings: 2, totalFindings: 3 },
    });
    expect(view.secondReviewNotice).toMatch(/checked 2 of 3 findings/);
  });

  it("shows no second-review notice when the review covered every finding", () => {
    const view = buildParentReportView({
      ...REPORT,
      forensicVerification: { status: "completed", checkedFindings: 3, totalFindings: 3 },
    });
    expect(view.secondReviewNotice).toBe("");
  });

  it("keeps the document assertion, location, citation, and next step on a timeline checkpoint", () => {
    const view = buildParentReportView({
      ...REPORT,
      proceduralTimelineViolations: [{
        timelineRule: "Hearing within five days",
        documentAssertion: "The order says the hearing was set for day nine.",
        evaluation: "The hearing date is outside the five-day window.",
        citation: "CYFSA s. 88",
        citationStatus: "CONFIRMED_REFERENCE",
        locationInDocument: "Page 4",
        parentActionStep: "Ask counsel whether an alternative outcome happened.",
      }],
    });
    const line = view.timelineChecks[0];
    expect(line).toMatch(/The order says the hearing was set for day nine/);
    expect(line).toMatch(/Page 4/);
    expect(line).toMatch(/CYFSA s\. 88/);
    expect(line).toMatch(/Ask counsel whether an alternative outcome happened/);
  });

  it("treats a threshold source with no verification status as unverified", () => {
    const view = buildParentReportView({
      ...REPORT,
      thresholdAnalysis: [{ thresholdChecked: "Place of safety, s. 81", isMet: "Inconclusive", reasoning: "Not shown.", primarySourceLaw: "CYFSA s. 81(2)" }],
    });
    expect(view.thresholdChecks[0]).toMatch(/unverified/);
  });

  it("does not describe the s. 88 five-day rule as a mandatory court hearing in its title", () => {
    const entry = PARENTAL_RIGHTS.find((item) => item.id === "five-day-hearing");
    expect(entry?.title).not.toMatch(/must go before a court/);
    expect(entry?.title).toMatch(/one of the listed steps must happen|five-day deadline/i);
  });

  it("does not treat an application or motion for an order as an order with legal effect", () => {
    for (const documentType of ["Application for a Supervision Order", "Motion Seeking an Order"]) {
      const { documentAuthority: _omitted, ...withoutAuthority } = REPORT;
      const view = buildParentReportView({ ...withoutAuthority, documentType });
      const body = view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body ?? "";
      expect(body, documentType).not.toMatch(/court order or endorsement has legal effect/);
    }
  });

  it("states the evidence classification on a chronology entry", () => {
    const view = buildParentReportView({
      ...REPORT,
      chronology: [{ date: "2026-03-02", event: "Worker says the parent was intoxicated", locationInDocument: "Page 2", evidenceClassification: "HEARSAY" }],
    });
    expect(view.chronology[0]).toMatch(/hearsay/i);
    expect(view.chronology[0]).toMatch(/Page 2/);
  });

  it("carries the completed review's overall assessment into the parent view", () => {
    const view = buildParentReportView({
      ...REPORT,
      forensicVerification: { status: "completed", checkedFindings: 3, totalFindings: 3, overallAssessment: "Several points rely on second-hand accounts." },
    });
    expect(view.secondReviewNotice).toMatch(/overall assessment: Several points rely on second-hand accounts/);
  });

  it("does not establish from a title that a signed or final court order is in effect", () => {
    for (const documentType of ["Final Court Order", "Signed Court Order"]) {
      const { documentAuthority: _omitted, ...withoutAuthority } = REPORT;
      const view = buildParentReportView({ ...withoutAuthority, documentType });
      const body = view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body ?? "";
      expect(body, documentType).not.toMatch(/has legal effect/);
      expect(body, documentType).toMatch(/title alone does not show/);
    }
  });

  it("uses the generic wording for a draft document that is not an order", () => {
    const { documentAuthority: _omitted, ...withoutAuthority } = REPORT;
    const view = buildParentReportView({ ...withoutAuthority, documentType: "Draft Affidavit" });
    const body = view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body ?? "";
    expect(body).not.toMatch(/draft or proposed order/);
    expect(body).not.toMatch(/legal effect/);
  });

  it("shows a plain-language evidence label on a finding, not the analyzer enum", () => {
    const view = buildParentReportView({
      ...REPORT,
      redFlags: [{ ...REPORT.redFlags[0], evidenceClassification: "HEARSAY" }],
    });
    expect(view.findings[0].evidenceLabel).toBe("Second-hand (hearsay)");
    expect(view.findings[0].evidenceLabel).not.toMatch(/^HEARSAY$/);
  });

  it("carries Deep Scan gaps, evidence to gather, and retorts into the parent view", () => {
    const view = buildParentReportView({
      ...REPORT,
      gaps: ["The first pass did not check whether the hearing was held within five days."],
      missingEvidence: ["The hearing notice with its date."],
      retorts: [{ claim: "The parent missed the appointment.", objection: "The record shows no notice of the appointment.", action: "Ask counsel to request the notice." }],
    });
    const concerns = view.summary.find((part: { heading: string }) => part.heading.startsWith("5."))?.body ?? "";
    const prepare = view.summary.find((part: { heading: string }) => part.heading.startsWith("6."))?.body ?? "";
    expect(view.gaps).toHaveLength(1);
    expect(concerns).toMatch(/five days/);
    expect(view.evidenceToGather).toHaveLength(1);
    expect(prepare).toMatch(/hearing notice with its date/);
    expect(view.retortChecks[0]).toMatch(/missed the appointment/);
    expect(prepare).toMatch(/request the notice/);
  });

  it("does not establish legal effect for an endorsement from its title alone", () => {
    const { documentAuthority: _omitted, ...withoutAuthority } = REPORT;
    const view = buildParentReportView(withoutAuthority);
    const body = view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body ?? "";
    expect(body).not.toMatch(/has legal effect/);
    expect(body).toMatch(/cannot confirm/);
  });

  it("uses explicit analyzer authority, not the title, to call a document a court record", () => {
    const view = buildParentReportView({ ...REPORT, documentType: "Letter from the society" });
    const body = view.summary.find((part: { heading: string }) => part.heading.startsWith("3."))?.body ?? "";
    expect(body).toMatch(/recorded this as a court record/);
    expect(body).toMatch(/does not confirm whether it is final, signed, entered, served, or still in effect/);
  });
  it("keeps the unverified warning on the statute line itself, not only in the detail", () => {
    const view = buildParentReportView({
      ...REPORT,
      redFlags: [{ ...REPORT.redFlags[0], legalReference: "CYFSA s. 74(2)", citationStatus: "UNVERIFIED" }],
    });
    expect(view.findings[0].whatTheLawSays).toMatch(/CYFSA s\. 74\(2\)/);
    expect(view.findings[0].whatTheLawSays).toMatch(/[Uu]nverified/);
  });

  it("does not say a quote could not be matched when no check was recorded", () => {
    const withoutCheck: Record<string, unknown> = { ...REPORT.redFlags[0] };
    delete withoutCheck.quoteVerified;
    const view = buildParentReportView({ ...REPORT, redFlags: [withoutCheck] });
    expect(view.findings[0].whatHappened).not.toMatch(/could not be matched/);
    expect(view.findings[0].whatHappened).toMatch(/has not been checked/);
  });

  it("does not present a missing-records reassurance when no analysis listed any", () => {
    const view = buildParentReportView({ ...REPORT, whatIsMissing: [], gaps: [], missingEvidence: [] });
    const concerns = view.summary.find((part: { heading: string }) => part.heading.startsWith("5."))?.body ?? "";
    expect(concerns).not.toMatch(/No missing records were identified/);
    expect(concerns).toMatch(/does not show that none exist/);
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
