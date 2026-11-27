/**
 * Redaction for exported copies. Every free-text string is replaced, including summaries, quotations, titles,
 * parents' own words, dates and metadata. A string survives only under a structural key, and only when it is an exact
 * member of that key's allowlist (ids, controlled vocabulary, verification labels, short legal references such as
 * "CYFSA s. 88"). Anything else is removed (default deny). The result is NOT guaranteed to be anonymous. Free text can
 * still carry identifying facts that a structural field does not show, so the export carries a notice saying so.
 */
import { EVIDENCE_CLASSIFICATIONS } from "./evidenceReview";
import { QUOTE_MATCH_STATUSES, SEVERITY_LEVELS, UNRECORDED_MATCH, NOT_CHECKED, VERIFICATION_STATUS } from "./quoteVerification";

export const REDACTED_TEXT = "[removed from redacted copy]";

export const REDACTED_COPY_NOTICE =
  "Redacted copy: document text, names, and other free text are removed. This copy is not guaranteed to be anonymous. Review it before sharing.";

// Dates can identify a family (hearing dates, birth dates, event dates), so no structural value may look like one.
const DATE_LIKE = /\d{4}\s*[-/.]\s*\d{1,2}|\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{2,4}|\b(19|20)\d{2}\b/;

/**
 * System-generated identifiers: "rf1", "S01", "ev-2", "E-missing"-style short codes, or long hex hashes. Letter runs are
 * capped at 7 so that a name or a word of prose cannot pass as an id.
 */
function isSafeId(value: string): boolean {
  if (/^[0-9a-f]{16,64}$/i.test(value)) return true;
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,47}$/.test(value) && !/[A-Za-z]{8,}/.test(value) && !DATE_LIKE.test(value);
}

const exact = (values: readonly string[]) => {
  const set = new Set(values);
  return (value: string) => set.has(value);
};
const anyCase = (values: readonly string[]) => {
  const set = new Set(values.map((v) => v.toLowerCase()));
  return (value: string) => set.has(value.toLowerCase());
};

const LEVELS = ["low", "medium", "high", "critical"];
const FINDING_KINDS = [
  "COURT_ORDER", "JUDICIAL_ENDORSEMENT", "JUDICIAL_FINDING", "PARTY_ALLEGATION", "REFERENCED_RECORD_NOT_PROVIDED",
  "EVIDENCE", "CONTRADICTION", "MISSING_RECORD", "ANALYSIS", "SUMMARY",
];
const EVENT_TYPES = ["ALLEGED_EVENT", "DOCUMENT_EVENT", "COURT_ORDER", "JUDICIAL_FINDING", "STATED_HEARING_DATE", "UNCLASSIFIED_EVENT"];
const CLAIM_CLASSIFICATIONS = ["FACT", "ALLEGATION", "OPINION", "PROFESSIONAL_ASSESSMENT", "INFERENCE", "UNVERIFIED_CLAIM", "UNKNOWN"];
const CLASSIFICATIONS = [...EVIDENCE_CLASSIFICATIONS, ...CLAIM_CLASSIFICATIONS, "Procedural", "Substantive", "Evidentiary"];
// Red-flag categories named in the analyzer prompt and normalizer, plus the gap categories of the intelligence layer.
const CATEGORIES = [
  "Hearsay", "Unsupported Claim", "Procedural Defect", "Authority Overreach", "Rights Omission", "Referenced Record Not Provided",
  "Disclosure", "Unclassified",
  "SUPPORT_GAP", "INDEPENDENCE_GAP", "SOURCE_GAP", "DATE_GAP", "ACTOR_GAP", "LOCATION_GAP", "UNRESOLVED_CONFLICT",
  "UNRESOLVED_CLAIM_EVOLUTION", "ATTRIBUTION_GAP", "EVIDENCE_QUALITY_REVIEW", "UNANSWERED_QUESTION", "HUMAN_REVIEW_REQUIRED",
];
const STATUSES = [
  "POPULATED", "EMPTY", "NOT_APPLICABLE", "NOT_GENERATED", "OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED", "SUPERSEDED",
  "completed", "incomplete", "verified", "unverified", "pending", "failed", "UNVERIFIED",
];
const CITATION_STATUSES = ["INTERNAL_REFERENCE_MATCH", "UNVERIFIED", "NONE", "CONFIRMED_REFERENCE", "CITATION_UNVERIFIED", "NOT_CHECKED", "verified", "unverified"];
const QUOTE_STATUSES = [...QUOTE_MATCH_STATUSES, UNRECORDED_MATCH, NOT_CHECKED, "NORMALIZED_PUNCTUATION"];

/** Per-key allowlists. A string under one of these keys is kept only if its validator accepts it. */
const STRUCTURAL_VALIDATORS: Record<string, (value: string) => boolean> = {
  id: isSafeId,
  ids: isSafeId,
  legacyId: isSafeId,
  sectionId: isSafeId,
  findingId: isSafeId,
  allegationFindingId: isSafeId,
  supportingEntryIds: isSafeId,
  contraryEntryIds: isSafeId,
  disputedByFindingIds: isSafeId,
  supportingFindingIds: isSafeId,
  contraryFindingIds: isSafeId,
  relatedFindingIds: isSafeId,
  documentId: isSafeId,
  kind: exact(FINDING_KINDS),
  type: exact(["template", "analysis", "redFlag", "threshold", "timeline", "chronology", "contradiction", ...FINDING_KINDS]),
  concern: exact(["POSSIBLE_CONCERN", "MISSING_INFORMATION", "NOT_INDEPENDENTLY_VERIFIED", "NOT_APPLICABLE"]),
  classification: anyCase(CLASSIFICATIONS),
  evidenceClassification: exact(EVIDENCE_CLASSIFICATIONS),
  citationStatus: exact(CITATION_STATUSES),
  recordKind: exact(["COURT_ORDER", "JUDICIAL_ENDORSEMENT"]),
  scoring: exact(["NOT_CREDIBILITY_SCORED"]),
  verdict: anyCase(["SUPPORTED", "OVERSTATED", "UNSUPPORTED", "MISQUOTED", "NEEDS_CONTEXT"]),
  eventType: exact(EVENT_TYPES),
  verifiedBy: exact(["Independent second review"]),
  schemaVersion: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) && !DATE_LIKE.test(v),
  severity: anyCase([...SEVERITY_LEVELS, ...LEVELS]),
  originalSeverity: anyCase([...SEVERITY_LEVELS, ...LEVELS]),
  modelSeverity: anyCase([...SEVERITY_LEVELS, ...LEVELS]),
  category: anyCase(CATEGORIES),
  status: exact(STATUSES),
  confidence: anyCase(LEVELS),
  materiality: anyCase(LEVELS),
  isMet: exact(["Yes", "No", "Inconclusive", "Not Determinable From This Document"]),
  identifiedAct: exact(["CYFSA", "OTHER", "MULTIPLE", "NONE"]),
  quoteVerification: exact(QUOTE_STATUSES),
  quote: exact(QUOTE_STATUSES),
  verificationStatus: exact(Object.values(VERIFICATION_STATUS)),
  mode: exact(["fast", "full"]),
};

// Legal references are kept only when the value is a short citation such as "CYFSA s. 74(2)".
// Any other prose stored under a citation key is free text and is removed.
const CITATION_KEYS = new Set(["legalReference", "citation", "primarySourceLaw"]);
// A single section reference only. Connectives and trailing words are not allowed, so no name can follow a citation.
const CITATION_PATTERN = /^(CYFSA\s+)?s\.\s*\d+(\(\d+\)|\([a-z]\))*$/i;

/** True when `value` may appear unchanged under `key` in a redacted copy. */
export function isSafeStructuralValue(key: string, value: string): boolean {
  if (CITATION_KEYS.has(key)) return value.length <= 60 && CITATION_PATTERN.test(value.trim());
  const validate = Object.prototype.hasOwnProperty.call(STRUCTURAL_VALIDATORS, key) ? STRUCTURAL_VALIDATORS[key] : undefined;
  return validate !== undefined && value.length <= 64 && validate(value);
}

function redactNode(node: unknown, key: string | undefined): unknown {
  // An empty string is not free text. Replacing it would make an unanswered field look answered.
  if (typeof node === "string") {
    if (node === "") return node;
    return key !== undefined && isSafeStructuralValue(key, node) ? node : REDACTED_TEXT;
  }
  if (Array.isArray(node)) return node.map((item) => redactNode(item, key));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, value] of Object.entries(node as Record<string, unknown>)) {
      // Identifying metadata is dropped whole, not just its strings.
      out[childKey] = childKey === "metadata" ? {} : redactNode(value, childKey);
    }
    return out;
  }
  return node;
}

/** Returns a copy with all free text replaced. The input is not modified. */
export function redactForExport<T>(value: T): T {
  return redactNode(value, undefined) as T;
}
