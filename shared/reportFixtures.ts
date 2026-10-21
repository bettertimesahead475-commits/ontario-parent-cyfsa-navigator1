/**
 * Sanitized legacy-report fixtures for the report tests. No real names, file numbers, or documents.
 * Each fixture is shaped like a saved analyzer report, including some fields that must never
 * reach the report view (operating metadata and verifier identifiers).
 */

const OPERATING_METADATA = {
  modelMetadata: { engineName: "Engine A", mode: "full", durationMs: 1200, usage: { inputTokens: 9, outputTokens: 4 }, cost: { totalCostUsd: 0.1 }, model: "model-x" },
  forensicVerification: { status: "completed", model: "model-x", checkedFindings: 1, overallAssessment: "Checked." },
};

/** A judicial endorsement: a judge's finding, and a referenced affidavit that was not uploaded. */
export const JUDICIAL_ENDORSEMENT_FIXTURE = {
  documentType: "Court Endorsement",
  fileSummary: "The judge reviewed the materials, found the concerns supported by the reasons given, and adjourned the matter.",
  documentAuthority: { recordKind: "JUDICIAL_ENDORSEMENT", scoring: "NOT_CREDIBILITY_SCORED", authenticity: "Not verified by this tool.", status: "Current status not determinable.", statement: "A court order has legal authority." },
  evidenceStrengthIndex: { score: null, components: {}, scoringApplicable: false, limitations: "Not scored." },
  completenessScore: null,
  metadata: { fileNumber: "FC-00-0000" },
  redFlags: [
    { id: "rf1", category: "Authority Overreach", severity: "Worth Raising With Counsel", evidenceClassification: "JUDICIAL_FINDING", phraseDetected: "I find that the concerns are supported by the reasons given.", explanation: "The judge states a finding and its basis.", verifyRequirement: "Obtain the hearing transcript.", legalReference: "", locationInDocument: "Page 1, Paragraph 3", parentActionStep: "Ask counsel what the finding relied on.", quoteVerified: true },
    { id: "rf2", category: "Referenced Record Not Provided", severity: "Affects Evidentiary Weight", evidenceClassification: "REFERENCED_DOCUMENT_NOT_PROVIDED", phraseDetected: "The affidavit of June 2 is referred to but was not included.", explanation: "The reasons rely on an affidavit that is not in the upload.", verifyRequirement: "Obtain the affidavit from the court file.", legalReference: "", locationInDocument: "Page 1, Paragraph 4", parentActionStep: "Request the affidavit.", quoteVerified: true },
  ],
  chronology: [{ date: "June 1, 2026", event: "The court adjourned the matter.", locationInDocument: "Page 1", evidenceClassification: "COURT_ORDER" }],
  whatIsMissing: ["The affidavit referred to in the reasons."],
  whatToVerify: ["Obtain the affidavit from the court file."],
  whatToAskALawyer: ["What did the finding rely on?"],
  lawyerCaseBrief: ["ISSUE — judicial finding — DOCUMENT EVIDENCE — Page 1."],
  ...OPERATING_METADATA,
};

/** A court order with operative directions and no scoring. */
export const COURT_ORDER_FIXTURE = {
  documentType: "Final Order",
  fileSummary: "The order directs that the child remain in care and sets a supervised access schedule.",
  documentAuthority: { recordKind: "COURT_ORDER", scoring: "NOT_CREDIBILITY_SCORED", authenticity: "Not verified by this tool.", status: "Interim, final or varied status not stated.", statement: "A court order has legal authority." },
  evidenceStrengthIndex: { score: null, components: {}, scoringApplicable: false, limitations: "Not scored." },
  completenessScore: null,
  redFlags: [],
  chronology: [{ date: "May 3, 2026", event: "The court ordered supervised access.", locationInDocument: "Page 2", evidenceClassification: "COURT_ORDER" }],
  whatIsMissing: [],
  whatToVerify: ["Compare the copy with the court-issued original."],
  whatToAskALawyer: ["Is this order interim or final?"],
  ...OPERATING_METADATA,
};

/** A CAS affidavit with hearsay and a dated event, with the affidavit's own source passages. */
export const CAS_AFFIDAVIT_FIXTURE = {
  documentType: "Affidavit",
  fileSummary: "A worker describes concerns about supervision and reports what a neighbour said.",
  evidenceStrengthIndex: { score: 47, components: { firsthandKnowledge: { score: 10, max: 20, explanation: "Mixed." } }, limitations: "Heuristic only." },
  completenessScore: 62,
  redFlags: [
    { id: "rf1", category: "Hearsay", severity: "Affects Evidentiary Weight", evidenceClassification: "HEARSAY", phraseDetected: "a neighbour told me the child was left alone", explanation: "Second-hand account.", verifyRequirement: "Identify the neighbour and what they saw.", legalReference: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.", citationStatus: "UNVERIFIED", locationInDocument: "Page 1, Paragraph 2", parentActionStep: "Ask counsel about weight.", quoteVerified: true },
    { id: "rf2", category: "Unsupported Claim", severity: "Worth Raising With Counsel", evidenceClassification: "UNSUPPORTED", phraseDetected: "The child was at risk.", explanation: "No record supports this statement.", verifyRequirement: "Request the risk assessment.", legalReference: "CYFSA s. 74(2)", citationStatus: "CONFIRMED_REFERENCE", locationInDocument: "Page 2", parentActionStep: "Ask for the risk assessment.", quoteVerified: false },
  ],
  contradictions: [],
  whatIsMissing: ["Worker notes."],
  thresholdAnalysis: [{ thresholdChecked: "Grounds (s. 74)", isMet: "Inconclusive", reasoning: "Allegations only.", primarySourceLaw: "CYFSA s. 74(2)" }],
  whatToVerify: ["Obtain the worker's notes."],
  whatToAskALawyer: ["How much weight can the court give a second-hand account?"],
  ...OPERATING_METADATA,
};

/** An ordinary documentary record: a dated school attendance record. */
export const DOCUMENTARY_FIXTURE = {
  documentType: "School Attendance Record",
  fileSummary: "A record of attendance for the term, with dates of absence.",
  redFlags: [],
  chronology: [
    { date: "September 9, 2025", event: "Attendance recorded as present.", locationInDocument: "Page 1", evidenceClassification: "DOCUMENTARY" },
    { date: "October 2, 2025", event: "Absence recorded for the day.", locationInDocument: "Page 1", evidenceClassification: "DOCUMENTARY" },
  ],
  whatIsMissing: [],
  whatToVerify: ["Compare with the school's own calendar."],
  whatToAskALawyer: [],
  ...OPERATING_METADATA,
};

/** A missing referenced affidavit, with nothing else to say about it. */
export const MISSING_AFFIDAVIT_FIXTURE = {
  documentType: "Court Endorsement",
  fileSummary: "The reasons refer to a worker's affidavit that is not included in the upload.",
  documentAuthority: { recordKind: "JUDICIAL_ENDORSEMENT", scoring: "NOT_CREDIBILITY_SCORED", authenticity: "Not verified by this tool.", status: "Not stated.", statement: "Legal authority." },
  redFlags: [
    { id: "rf1", category: "Referenced Record Not Provided", severity: "Affects Evidentiary Weight", evidenceClassification: "REFERENCED_DOCUMENT_NOT_PROVIDED", phraseDetected: "The worker's affidavit is referred to.", explanation: "The affidavit is not in the upload.", verifyRequirement: "Obtain the affidavit.", legalReference: "", locationInDocument: "Page 1", parentActionStep: "Request it.", quoteVerified: true },
  ],
  whatIsMissing: ["The worker's affidavit."],
  ...OPERATING_METADATA,
};

/** Two records that disagree on the same date. Neither is treated as the correct one. */
export const CONFLICTING_RECORDS_FIXTURE = {
  documentType: "Worker Summary",
  fileSummary: "The summary gives a different date for the visit than the attached log.",
  redFlags: [],
  contradictions: [
    { description: "The summary dates the visit to March 3; the attached log dates it to March 5.", locations: ["Summary, Page 1", "Attached log, Entry 4"], significance: "The dates differ; one may be a clerical error." },
  ],
  whatIsMissing: [],
  whatToVerify: ["Check the visit date against the calendar and any other records."],
  whatToAskALawyer: ["Which date is supported by other records?"],
  ...OPERATING_METADATA,
};

/** An incomplete saved report: some fields are absent, one is malformed. */
export const INCOMPLETE_FIXTURE = { documentType: "Unknown", redFlags: "not a list", chronology: undefined };

export const ALL_REPORT_FIXTURES = {
  judicialEndorsement: JUDICIAL_ENDORSEMENT_FIXTURE,
  courtOrder: COURT_ORDER_FIXTURE,
  casAffidavit: CAS_AFFIDAVIT_FIXTURE,
  documentary: DOCUMENTARY_FIXTURE,
  missingAffidavit: MISSING_AFFIDAVIT_FIXTURE,
  conflictingRecords: CONFLICTING_RECORDS_FIXTURE,
  incomplete: INCOMPLETE_FIXTURE,
} as const;
