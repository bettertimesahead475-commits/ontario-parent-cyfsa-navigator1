// Shared fixtures for analyzer route tests. The analyzer requests each report section separately
// (api/services/analyzerSections.ts), so a test supplies ONE complete report and every section
// request picks its own keys out of it. The Forensic verification request gets VERIFICATION_RESULT.

export function claudeText(text: string, usage = { input_tokens: 100, output_tokens: 50 }, stopReason = "end_turn") {
  return { content: [{ type: "text", text }], stop_reason: stopReason, usage };
}

export function claudeJson(obj: unknown, usage?: { input_tokens: number; output_tokens: number }) {
  return claudeText(JSON.stringify(obj), usage);
}

const component = (score: number, max: number) => ({ score, max, explanation: "Assessed from the document." });

/** A report that passes every section validator. Spread and override fields per test. */
export const COMPLETE_ANALYSIS = {
  documentTitle: "Uploaded Document",
  documentType: "Affidavit",
  metadata: { fileNumber: "", applicantName: "", respondentName: "", childNames: "", hearingDate: "" },
  disclaimer: "disclaimer",
  completenessScore: 50,
  completenessScoreMethod: "Completeness of the information in this document only.",
  evidenceStrengthIndex: {
    score: 50,
    components: {
      firsthandKnowledge: component(10, 20),
      sourceReliability: component(8, 15),
      corroboration: component(7, 15),
      documentarySupport: component(8, 15),
      internalConsistency: component(6, 10),
      contradictoryEvidenceHandling: component(5, 10),
      legalAuthorityVerification: component(4, 10),
      proceduralDocumentation: component(2, 5),
    },
    limitations: "Heuristic only.",
  },
  fileSummary:
    "This affidavit describes the Society's concerns. It relies mainly on worker observations and one third-party report. The parent should verify the dates and obtain the referenced records.",
  redFlags: [] as any[],
  chronology: [] as any[],
  contradictions: [] as any[],
  whatToVerify: ["Obtain the referenced worker notes to confirm the dates."],
  whatToAskALawyer: ["Ask whether the third-party statements carry weight as hearsay."],
  whatIsMissing: ["The referenced school record is not attached."],
  lawyerCaseBrief: ["ISSUE — hearsay reliance — DOCUMENT EVIDENCE — para 3 — SIGNIFICANCE — weight — LIMITATION — source disclosed — VERIFY — notes."],
  thresholdAnalysis: [
    { thresholdChecked: "CYFSA s. 81 — Application authority", isMet: "Inconclusive", reasoning: "Not determinable.", primarySourceLaw: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this." },
    { thresholdChecked: "Child in Need of Protection grounds (CYFSA s. 74)", isMet: "Inconclusive", reasoning: "Allegations only.", primarySourceLaw: "CYFSA 2017, Section 74" },
    { thresholdChecked: "Duty to Report standard (CYFSA s. 125)", isMet: "No", reasoning: "Reporting standard is distinct.", primarySourceLaw: "CYFSA 2017, Section 125" },
    { thresholdChecked: "Kinship / Family-Based Alternatives", isMet: "Inconclusive", reasoning: "Not documented.", primarySourceLaw: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this." },
  ],
  proceduralTimelineViolations: [
    { timelineRule: "30-Day Adjournment Limit (CYFSA s. 94(1))", documentAssertion: "", evaluation: "Not Determinable From This Document.", citation: "CYFSA, S.O. 2017, c. 14, s. 94(1)", locationInDocument: "", parentActionStep: "Track dates." },
    { timelineRule: "Court hearing timeline after apprehension", documentAssertion: "", evaluation: "Not applicable.", citation: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.", locationInDocument: "", parentActionStep: "Ask counsel." },
    { timelineRule: "Child Ombudsman Access", documentAssertion: "", evaluation: "Not mentioned.", citation: "Bill 188, Supporting Children's Futures Act, 2024 (S.O. 2024, c. 17)", locationInDocument: "", parentActionStep: "Confirm awareness." },
    { timelineRule: "300-Day Presumption of Parentage", documentAssertion: "", evaluation: "Not relevant.", citation: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.", locationInDocument: "", parentActionStep: "None." },
  ],
  charterAndHumanRightsIssues: [
    "Section 7 (Canadian Charter): no specific engagement documented.",
    "Section 15 (Canadian Charter): no equality issue documented.",
    "Indigenous heritage (CYFSA Section 2): not addressed in the document.",
  ],
};

export const VERIFICATION_RESULT = {
  findings: [] as any[],
  thresholds: [] as any[],
  overallAssessment: "The findings are consistent with the document.",
};

/** True for the Forensic verification request (as opposed to a section request). */
export function isVerificationRequest(body: any): boolean {
  return JSON.stringify(body?.messages ?? "").includes("independent verification reviewer");
}

/** The section title a request asked for, e.g. "Evidence findings", or null for other requests. */
export function requestedSection(body: any): string | null {
  const m = JSON.stringify(body?.messages ?? "").match(/Produce ONLY the \\"([^\\"]+)\\" section/);
  return m ? m[1] : null;
}

/** mockImplementation for the Anthropic messages mock: answers sections and verification. */
export function sectionResponder(
  report: Record<string, any> = COMPLETE_ANALYSIS,
  verification: Record<string, any> = VERIFICATION_RESULT
) {
  return async (body: any) => claudeJson(isVerificationRequest(body) ? verification : report);
}
