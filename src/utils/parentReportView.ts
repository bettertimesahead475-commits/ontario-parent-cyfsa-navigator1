/**
 * Parent presentation layer for an analyzer report.
 *
 * This module only reorganises findings the analyzer already produced. It never drops a finding,
 * never adds a legal conclusion, and never changes the factual content. The professional view uses
 * the same underlying report.
 */

import { titleSuggestsCourtOrder } from "../../shared/documentTitle";

export interface ParentFindingView {
  id: string;
  heading: string;
  /** Plain-language evidence label, e.g. "Second-hand (hearsay)". Empty when none was given. */
  evidenceLabel: string;
  severityLabel: string;
  whatHappened: string;
  whyItMatters: string;
  whatTheLawSays: string;
  /** Verified case law is not attached by this layer yet. Shown as a limitation, never invented. */
  whatCourtsHaveSaid: string;
  whatIsUnknown: string;
  /** Result of the independent second review, when the analyzer ran one. Empty when it did not. */
  secondReview: string;
  whatYouCanDo: string;
  /** Expandable detail: the exact quotation and where it appears. */
  evidenceDetail: { quote: string; location: string; citationStatus: string };
}

export interface ParentReportView {
  summary: { heading: string; body: string }[];
  findings: ParentFindingView[];
  thresholdChecks: string[];
  timelineChecks: string[];
  /** Deep Scan only: omissions the first pass did not flag. */
  gaps: string[];
  /** Deep Scan only: defense points, each with the claim, why it is weak, and the next step. */
  retortChecks: string[];
  /** Deep Scan only: evidence the parent should gather. */
  evidenceToGather: string[];
  /** Set when the analyzer's second review was incomplete or covered fewer findings than the report has. */
  secondReviewNotice: string;
  chronology: string[];
  contradictions: string[];
  missingRecords: string[];
  questionsForCourt: string[];
}

const CASE_LAW_LIMITATION =
  "No verified court decision has been attached to this point yet, so this report does not say what courts have decided on it.";
const UNVERIFIED_CITATION = "Citation unverified. Confirm the exact section with a lawyer before relying on it.";

type Loose = Record<string, any>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function citationStatus(flag: Loose): string {
  if (flag.citationStatus === "CONFIRMED_REFERENCE") return "Listed as a confirmed reference in the analyzer's internal list; not checked against the statute text in this report.";
  if (flag.citationStatus === "UNVERIFIED") return UNVERIFIED_CITATION;
  // A citation with no recorded verification status is unverified, never confirmed.
  return text(flag.legalReference) ? UNVERIFIED_CITATION : "No statute cited for this point.";
}

// Analyzer severity is an assessment of how serious a point is. It is not shown to parents.
const RETORT_QUESTION = "Is this claim supported by the document? Check the passages it relies on.";
const CONTRADICTION_QUESTION = "Which passage is correct? Check both locations in the document.";
const CHECK_QUESTION = "Does the document support this point? Check the quoted wording and where it appears.";

/**
 * Only whether a point went through the second review is shown. Its verdict and note are assessments of the
 * point, so they are not shown to parents. A lawyer can see them.
 */
function secondReviewLine(item: Loose): string {
  const review = item.forensicVerification;
  return review && typeof review === "object"
    ? "This point went through an independent second review. Ask your lawyer what that review found."
    : "This point has not been second-reviewed.";
}

/** Report-level second-review status. Findings the review never reached must not look reviewed. */
function secondReviewNotice(report: Loose): string {
  const review = report.forensicVerification;
  if (!review || typeof review !== "object") return "";
  const parts: string[] = [];
  // The analyzer's free-text reason is not shown: on a failed review it can contain a provider error message.
  if (review.status === "incomplete") {
    parts.push("Not every finding was independently second-reviewed. The independent verification could not be completed for every finding.");
  }
  const checked = Number(review.checkedFindings);
  const total = Number(review.totalFindings);
  if (Number.isFinite(checked) && Number.isFinite(total) && checked < total) {
    parts.push(`The independent second review checked ${checked} of ${total} findings. The others have no second-review result.`);
  }
  // The verifier's overall assessment is not shown: it is an assessment of the findings, not a parent-facing fact.
  return parts.filter(Boolean).join(" ");
}

const EVIDENCE_LABELS: Record<string, string> = {
  HEARSAY: "Second-hand (hearsay)",
  INFERENCE: "Inference, not stated directly",
  UNSUPPORTED: "Supporting evidence not identified in the reviewed documents.",
};

/** Plain-language evidence label. An analyzer enum is never shown raw to a parent. */
function evidenceLabel(classification: unknown): string {
  const key = text(classification).toUpperCase();
  if (!key) return "";
  if (EVIDENCE_LABELS[key]) return EVIDENCE_LABELS[key];
  const words = key.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function chronologyLine(entry: Loose): string {
  const where = text(entry.locationInDocument);
  const label = evidenceLabel(entry.evidenceClassification);
  return [text(entry.date), text(entry.event), where ? `(${where})` : "", label ? `Evidence: ${label}.` : ""].filter(Boolean).join(" ");
}

/**
 * The analyzer's met, not met, or inconclusive result and its reasoning are not shown to parents. They are an
 * assessment of whether a statutory test is satisfied, so the parent gets the test and a question to check instead.
 */
const THRESHOLD_QUESTION = "does the file show the facts this test needs? Look for direct proof in the documents.";
const TIMELINE_QUESTION = "did this step happen within the time the rule sets? Check the dates in the documents.";

function thresholdLine(check: Loose): string {
  const name = text(check.thresholdChecked);
  const source = text(check.primarySourceLaw);
  // A source with no recorded verification status is unverified, the same as for red flags and timeline checks.
  const unverified = source && check.citationStatus !== "CONFIRMED_REFERENCE" ? "The statute reference for this check is unverified; confirm it with counsel." : "";
  const review = secondReviewLine(check);
  return [name, `Question to check: ${THRESHOLD_QUESTION}`, review, source ? `Source: ${source}.` : "", unverified].filter(Boolean).join(" ");
}


function retortLine(item: Loose): string {
  const claim = text(item.claim);
  const action = text(item.action);
  // The analyzer's objection is its own argument about the claim. The parent gets a question to check instead.
  return [claim ? `Claim: "${claim}".` : "", `Question to check: ${RETORT_QUESTION}`, action ? `Next step: ${action}` : ""]
    .filter(Boolean)
    .join(" ");
}

function contradictionLine(item: Loose): string {
  const places = list(item.locations).join("; ");
  // The analyzer's significance is its assessment of the conflict, so it is not shown. The parent checks both passages.
  return [text(item.description), places ? `Locations: ${places}.` : "", `Question to check: ${CONTRADICTION_QUESTION}`].filter(Boolean).join(" ");
}

function timelineLine(check: Loose): string {
  const citation = text(check.citation);
  // Only a cited provision can be unverified. A citation with no recorded status is treated as unverified too.
  const unverified =
    citation && !/unverified/i.test(citation) && citationStatus({ citationStatus: check.citationStatus, legalReference: citation }) === UNVERIFIED_CITATION
      ? UNVERIFIED_CITATION
      : "";
  const assertion = text(check.documentAssertion);
  const where = text(check.locationInDocument);
  const nextStep = text(check.parentActionStep);
  return [
    text(check.timelineRule),
    assertion ? `The document says: ${assertion}` : "",
    `Question to check: ${TIMELINE_QUESTION}`,
    where ? `Location: ${where}.` : "",
    citation ? `Source: ${citation}` : "",
    unverified,
    nextStep ? `Next step: ${nextStep}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The statute line carries its verification status, so an unverified citation is not read as settled. */
function lawWithStatus(flag: Loose): string {
  const law = text(flag.legalReference);
  if (!law) return "No statute is cited for this point.";
  const unverified = citationStatus(flag) === UNVERIFIED_CITATION && !/unverified/i.test(law);
  return unverified ? `${law} ${UNVERIFIED_CITATION}` : law;
}

function findingView(flag: Loose, index: number): ParentFindingView {
  const quote = text(flag.phraseDetected);
  return {
    id: text(flag.id) || `finding-${index + 1}`,
    // The analyzer's category is a breach-type label, so it is not used as a heading.
    heading: `Point ${index + 1}`,
    evidenceLabel: evidenceLabel(flag.evidenceClassification),
    severityLabel: "",
    whatHappened: quote
      ? flag.quoteVerified === true
        ? `The record says: "${quote}"`
        : flag.quoteVerified === false
          ? `The analyzer quoted this point, but the exact wording could not be matched to the document, so treat it as a paraphrase: "${quote}"`
          : `The analyzer quoted this point. Its exact wording has not been checked against the document, so treat it as a paraphrase until it is: "${quote}"`
      : "The record quote for this point was not found.",
    // The analyzer's explanation is its reasoning about the point. The parent gets a question to check instead.
    whyItMatters: CHECK_QUESTION,
    whatTheLawSays: lawWithStatus(flag),
    whatCourtsHaveSaid: CASE_LAW_LIMITATION,
    whatIsUnknown: text(flag.verifyRequirement),
    secondReview: secondReviewLine(flag),
    whatYouCanDo: text(flag.parentActionStep),
    evidenceDetail: {
      quote,
      location: text(flag.locationInDocument) || "Location not given",
      citationStatus: citationStatus(flag),
    },
  };
}

/** Builds the seven-part parent summary from fields the analyzer already returns. */
export function buildParentReportView(report: Loose): ParentReportView {
  const redFlags = Array.isArray(report.redFlags) ? report.redFlags : [];
  const missing = list(report.whatIsMissing);
  // Threshold checks and timeline checks are analyzer findings too. Carry them into the view, not drop them.
  const thresholds = (Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis : []).map(thresholdLine).filter(Boolean);
  const timelines = (Array.isArray(report.proceduralTimelineViolations) ? report.proceduralTimelineViolations : []).map(timelineLine).filter(Boolean);
  const chronology = (Array.isArray(report.chronology) ? report.chronology : []).map(chronologyLine).filter(Boolean);
  const contradictions = (Array.isArray(report.contradictions) ? report.contradictions : []).map(contradictionLine).filter(Boolean);
  const notice = secondReviewNotice(report);
  const gaps = list(report.gaps);
  const evidenceToGather = list(report.missingEvidence);
  const retortChecks = (Array.isArray(report.retorts) ? report.retorts : []).map(retortLine).filter(Boolean);
  const questions = list(report.whatToAskALawyer);
  const verify = list(report.whatToVerify);
  // Legal status is never taken from the title. No analyzer output in this codebase sets documentAuthority yet,
  // so the title caveat applies in practice; the authority branch is ready for when the analyzer provides it.
  // A title such as "Final Court Order" or "Draft Order" does not show whether the document was signed, entered,
  // served, or is in effect, so the parent view says that instead of asserting it.
  const documentType = text(report.documentType);
  const titleCaveat = titleSuggestsCourtOrder(documentType);
  // Only explicit analyzer authority of a known court-record kind counts. Any other value falls back to the title caveat.
  const authority = report.documentAuthority && typeof report.documentAuthority === "object" ? report.documentAuthority : null;
  const hasAuthorityRecord = authority !== null && ["COURT_ORDER", "JUDICIAL_ENDORSEMENT"].includes(text(authority.recordKind));

  const summary = [
    { heading: "1. What is this document?", body: text(report.documentType) || "Document type not identified." },
    {
      heading: "2. What happened?",
      body: [text(report.fileSummary) || "No summary was produced for this document.", ...chronology].join(" "),
    },
    {
      heading: "3. What does this mean for you?",
      body: hasAuthorityRecord
        ? "The analyzer recorded this as a court record. This report does not confirm whether it is final, signed, entered, served, or still in effect. Confirm that with counsel and the court file. This report does not decide whether the facts it mentions are true."
        : titleCaveat
          ? "The title suggests a court order, endorsement, or draft. The title alone does not show whether it is final, signed, entered, served, or in effect, and this report cannot confirm those from the text. Confirm with counsel and the court file before relying on any of its terms."
          : "This report shows what the document says and what is still unclear. It does not decide who is right.",
    },
    {
      heading: "4. What rights or legal protections may apply?",
      // Fast Analysis does not run the rights section, and normalization turns that absence into an empty list.
      // An empty list therefore means "not checked here", not "no rights issues".
      // These are issues the analysis raised for a lawyer to check. They are not findings that a right was breached.
      body: list(report.charterAndHumanRightsIssues).map((issue) => `Raised for a lawyer to check, not a finding: ${issue}`).join(" ")
        || "No rights issues are listed in this report. A full analysis is needed before anyone can say whether rights apply.",
    },
    {
      heading: "5. Is anything missing or concerning?",
      body: [notice, ...gaps, ...missing, ...thresholds, ...timelines, ...contradictions].filter(Boolean).length
        ? [notice, ...gaps, ...missing, ...thresholds, ...timelines, ...contradictions].filter(Boolean).join(" ")
        : "This analysis listed no missing records. That does not show that none exist; a lawyer should check the file.",
    },
    {
      heading: "6. What can you do to prepare?",
      body: [...evidenceToGather, ...verify, ...retortChecks].filter(Boolean).length
        ? [...evidenceToGather, ...verify, ...retortChecks].filter(Boolean).join(" ")
        : "Gather the records this document refers to, and keep them in date order.",
    },
    {
      heading: "7. What should you check before your next court date?",
      body: questions.length ? questions.join(" ") : "Write down your questions for your lawyer or duty counsel before the date.",
    },
  ];

  return {
    summary,
    findings: redFlags.map((flag, i) => findingView(flag, i)),
    thresholdChecks: thresholds,
    timelineChecks: timelines,
    gaps,
    retortChecks,
    evidenceToGather,
    secondReviewNotice: notice,
    chronology,
    contradictions,
    missingRecords: missing,
    questionsForCourt: questions,
  };
}

// ---------------------------------------------------------------------------
// Readability
// ---------------------------------------------------------------------------

/** Legal terms a parent may not know. Each needs a plain explanation where it first appears. */
export const LEGAL_TERMS_NEEDING_EXPLANATION = [
  "hearsay",
  "affidavit",
  "adjournment",
  "interim",
  "disclosure",
  "admissibility",
  "corroborat",
  "statutory",
  "Charter",
  "placement",
  "endorsement",
  "ex parte",
];

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (w.endsWith("e") && !w.endsWith("le") && n > 1) n -= 1;
  return Math.max(1, n);
}

export interface ReadabilityResult {
  sentences: number;
  words: number;
  wordsPerSentence: number;
  /** Flesch-Kincaid grade level. Used as one signal only; see unexplainedTerms and reviewer checks. */
  gradeLevel: number;
  longSentences: number;
  unexplainedTerms: string[];
}

export function readability(input: string): ReadabilityResult {
  const sentenceList = input.split(/[.!?]+\s|[.!?]+$/).map((s) => s.trim()).filter(Boolean);
  const words = input.split(/\s+/).map((w) => w.replace(/[^A-Za-z'-]/g, "")).filter(Boolean);
  const syllables = words.reduce((total, w) => total + countSyllables(w), 0);
  const sentences = Math.max(1, sentenceList.length);
  const wordCount = Math.max(1, words.length);
  const longSentences = sentenceList.filter((s) => s.split(/\s+/).length > 20).length;
  const lower = input.toLowerCase();
  const unexplainedTerms = LEGAL_TERMS_NEEDING_EXPLANATION.filter((term) => {
    const i = lower.indexOf(term.toLowerCase());
    if (i < 0) return false;
    // A term counts as explained when a plain definition follows it in parentheses, a dash, or "means".
    const after = input.slice(i, i + 160).toLowerCase();
    return !/\(|—|–| means | is when | is a | refers to /.test(after);
  });
  return {
    sentences,
    words: wordCount,
    wordsPerSentence: Number((wordCount / sentences).toFixed(1)),
    gradeLevel: Number((0.39 * (wordCount / sentences) + 11.8 * (syllables / wordCount) - 15.59).toFixed(1)),
    longSentences,
    unexplainedTerms,
  };
}
