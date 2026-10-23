/**
 * Parent presentation layer for an analyzer report.
 *
 * This module only reorganises findings the analyzer already produced. It never drops a finding,
 * never adds a legal conclusion, and never changes the factual content. The professional view uses
 * the same underlying report.
 */

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
  if (flag.citationStatus === "CONFIRMED_REFERENCE") return "Statute reference confirmed against the reference list.";
  if (flag.citationStatus === "UNVERIFIED") return UNVERIFIED_CITATION;
  // A citation with no recorded verification status is unverified, never confirmed.
  return text(flag.legalReference) ? UNVERIFIED_CITATION : "No statute cited for this point.";
}

function severityLabel(severity: unknown): string {
  const s = text(severity);
  if (s === "CRITICAL") return "Serious concern to check";
  if (s === "Worth Raising With Counsel") return "Worth raising with a lawyer";
  return s ? "May affect how much weight this gets" : "";
}

const SECOND_REVIEW_WORDING: Record<string, string> = {
  SUPPORTED: "An independent second review found the record supports this.",
  OVERSTATED: "An independent second review found this overstated.",
  UNSUPPORTED: "An independent second review did not find the record supports this.",
  MISQUOTED: "An independent second review found the quotation does not match the record.",
  NEEDS_CONTEXT: "An independent second review says this needs more context.",
};

/** Carries the second-review verdict and its note. A rejected point must not read as settled. */
function secondReviewLine(item: Loose): string {
  const review = item.forensicVerification && typeof item.forensicVerification === "object" ? item.forensicVerification : {};
  const wording = SECOND_REVIEW_WORDING[text(review.verdict).toUpperCase()] ?? "";
  const note = text(review.note);
  return [wording, note].filter(Boolean).join(" ");
}

/** Report-level second-review status. Findings the review never reached must not look reviewed. */
function secondReviewNotice(report: Loose): string {
  const review = report.forensicVerification;
  if (!review || typeof review !== "object") return "";
  const parts: string[] = [];
  if (review.status === "incomplete") {
    parts.push("Not every finding was independently second-reviewed.", text(review.reason));
  }
  const checked = Number(review.checkedFindings);
  const total = Number(review.totalFindings);
  if (Number.isFinite(checked) && Number.isFinite(total) && checked < total) {
    parts.push(`The independent second review checked ${checked} of ${total} findings. The others have no second-review result.`);
  }
  // The analyzer's overall assessment qualifies the findings even when every finding was checked.
  const assessment = text(review.overallAssessment);
  if (assessment) parts.push(`The independent second review's overall assessment: ${assessment}`);
  return parts.filter(Boolean).join(" ");
}

const EVIDENCE_LABELS: Record<string, string> = {
  HEARSAY: "Second-hand (hearsay)",
  INFERENCE: "Inference, not stated directly",
  UNSUPPORTED: "Not supported by the document",
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

function thresholdLine(check: Loose): string {
  const name = text(check.thresholdChecked);
  const result = text(check.isMet);
  const reasoning = text(check.reasoning);
  const source = text(check.primarySourceLaw);
  // A source with no recorded verification status is unverified, the same as for red flags and timeline checks.
  const unverified = source && check.citationStatus !== "CONFIRMED_REFERENCE" ? "The statute reference for this check is unverified; confirm it with counsel." : "";
  const review = secondReviewLine(check);
  return [name, result ? `Result: ${result}.` : "", reasoning, review, source ? `Source: ${source}.` : "", unverified].filter(Boolean).join(" ");
}


function retortLine(item: Loose): string {
  const claim = text(item.claim);
  const objection = text(item.objection);
  const action = text(item.action);
  return [claim ? `Claim: "${claim}".` : "", objection ? `Why it may be weak: ${objection}` : "", action ? `Next step: ${action}` : ""]
    .filter(Boolean)
    .join(" ");
}

function contradictionLine(item: Loose): string {
  const places = list(item.locations).join("; ");
  return [text(item.description), places ? `Locations: ${places}.` : "", text(item.significance)].filter(Boolean).join(" ");
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
    text(check.evaluation),
    where ? `Location: ${where}.` : "",
    citation ? `Source: ${citation}` : "",
    unverified,
    nextStep ? `Next step: ${nextStep}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function findingView(flag: Loose, index: number): ParentFindingView {
  const explanation = text(flag.explanation);
  const quote = text(flag.phraseDetected);
  return {
    id: text(flag.id) || `finding-${index + 1}`,
    heading: text(flag.category) || `Point ${index + 1}`,
    evidenceLabel: evidenceLabel(flag.evidenceClassification),
    severityLabel: severityLabel(flag.severity),
    whatHappened: quote
      ? flag.quoteVerified === true
        ? `The record says: "${quote}"`
        : `The analyzer quoted this point, but the exact wording could not be matched to the document, so treat it as a paraphrase: "${quote}"`
      : "The record quote for this point was not found.",
    whyItMatters: explanation,
    whatTheLawSays: text(flag.legalReference) || "No statute is cited for this point.",
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
  // documentAuthority is not part of the live analyzer schema, so classify from documentType.
  // Draft and proposed orders are not operative, so they never get the legal-effect wording.
  const documentType = text(report.documentType);
  // Only a draft or proposed order is treated as unsigned. Other draft documents get the generic wording.
  const isDraft = /\b(draft|proposed)\b/i.test(documentType) && /\border/i.test(documentType);
  // Only a final order or endorsement has legal effect. Applications and motions that ask for an order do not.
  // Leading words may be any mix of court, signed, final, and similar qualifiers, in any order.
  const isFinalOrderType = /^((court|signed|final|interim|temporary|consent|entered|certified|judicial|supervision|custody|extended)\s+)*(order|endorsement)s?\b/i.test(documentType);
  const isCourtRecord = !isDraft && (Boolean(report.documentAuthority) || isFinalOrderType);

  const summary = [
    { heading: "1. What is this document?", body: text(report.documentType) || "Document type not identified." },
    {
      heading: "2. What happened?",
      body: [text(report.fileSummary) || "No summary was produced for this document.", ...chronology].join(" "),
    },
    {
      heading: "3. What does this mean for you?",
      body: isCourtRecord
        ? "A court order or endorsement has legal effect unless it is changed or ends. This report does not decide whether the facts it mentions are true."
        : isDraft
          ? "This is a draft or proposed order, not a signed order. Confirm whether a final order was made before relying on any of its terms."
          : "This report shows what the document says and what is still unclear. It does not decide who is right.",
    },
    {
      heading: "4. What rights or legal protections may apply?",
      // Fast Analysis does not run the rights section, and normalization turns that absence into an empty list.
      // An empty list therefore means "not checked here", not "no rights issues".
      body: list(report.charterAndHumanRightsIssues).join(" ")
        || "No rights issues are listed in this report. A full analysis is needed before anyone can say whether rights apply.",
    },
    {
      heading: "5. Is anything missing or concerning?",
      body: [notice, ...gaps, ...missing, ...thresholds, ...timelines, ...contradictions].filter(Boolean).length
        ? [notice, ...gaps, ...missing, ...thresholds, ...timelines, ...contradictions].filter(Boolean).join(" ")
        : "No missing records were identified from this document alone.",
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
