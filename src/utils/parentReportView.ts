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
  whatYouCanDo: string;
  /** Expandable detail: the exact quotation and where it appears. */
  evidenceDetail: { quote: string; location: string; citationStatus: string };
}

export interface ParentReportView {
  summary: { heading: string; body: string }[];
  findings: ParentFindingView[];
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
  const legal = text(flag.legalReference);
  return legal ? legal : "No statute cited for this point.";
}

function severityLabel(severity: unknown): string {
  const s = text(severity);
  if (s === "CRITICAL") return "Serious concern to check";
  if (s === "Worth Raising With Counsel") return "Worth raising with a lawyer";
  return s ? "May affect how much weight this gets" : "";
}

function findingView(flag: Loose, index: number): ParentFindingView {
  const explanation = text(flag.explanation);
  const quote = text(flag.phraseDetected);
  return {
    id: text(flag.id) || `finding-${index + 1}`,
    heading: text(flag.category) || `Point ${index + 1}`,
    evidenceLabel: text(flag.evidenceClassification),
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
  const questions = list(report.whatToAskALawyer);
  const verify = list(report.whatToVerify);
  // documentAuthority is not part of the live analyzer schema, so classify from documentType.
  const isCourtRecord = Boolean(report.documentAuthority) || /\b(order|endorsement)\b/i.test(text(report.documentType));

  const summary = [
    { heading: "1. What is this document?", body: text(report.documentType) || "Document type not identified." },
    { heading: "2. What happened?", body: text(report.fileSummary) || "No summary was produced for this document." },
    {
      heading: "3. What does this mean for you?",
      body: isCourtRecord
        ? "A court order or endorsement has legal effect unless it is changed or ends. This report does not decide whether the facts it mentions are true."
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
      body: missing.length ? missing.join(" ") : "No missing records were identified from this document alone.",
    },
    {
      heading: "6. What can you do to prepare?",
      body: verify.length ? verify.join(" ") : "Gather the records this document refers to, and keep them in date order.",
    },
    {
      heading: "7. What should you check before your next court date?",
      body: questions.length ? questions.join(" ") : "Write down your questions for your lawyer or duty counsel before the date.",
    },
  ];

  return {
    summary,
    findings: redFlags.map((flag, i) => findingView(flag, i)),
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
