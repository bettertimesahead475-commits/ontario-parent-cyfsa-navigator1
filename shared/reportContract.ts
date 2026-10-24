/**
 * Versioned 16-section report contract.
 *
 * One analysis result (this contract) feeds two presentations: a parent view in plain language and
 * a professional view with formal terms and full source detail. Both read the same findings, so
 * neither can show facts the other hides.
 *
 * Legacy reports (saved in the browser under the existing analyzer keys, with no schema version)
 * are converted by `adaptLegacyReport`. Nothing is migrated in place, and the original report is
 * not changed.
 *
 * Policy carried over from the analyzer's court-record corrections:
 *  - A judicial finding is kept separate from a party's allegation and from ordinary evidence.
 *  - A court order or endorsement is not given an evidence-strength or completeness score.
 *  - A referenced record that was not uploaded is missing information, not a procedural violation.
 *  - Token counts, model identifiers, and API cost are never copied into the contract.
 */

export const REPORT_SCHEMA_VERSION = "2.0.0" as const;

/** Feature flag. Off by default; nothing reads it yet. Turning it on is a separate, reviewed change. */
export const REPORT_CONTRACT_V2_ENABLED = false;

export const REPORT_SECTIONS = [
  { id: "S01", slug: "case_at_a_glance", number: 1, title: "Your Case at a Glance" },
  { id: "S02", slug: "understanding_documents", number: 2, title: "Understanding Your Documents" },
  { id: "S03", slug: "case_timeline", number: 3, title: "What Happened: Case Timeline" },
  { id: "S04", slug: "court_orders", number: 4, title: "What the Court Has Ordered" },
  { id: "S05", slug: "rights_protections", number: 5, title: "Your Rights and Legal Protections" },
  { id: "S06", slug: "evidence_strength", number: 6, title: "Evidence Strength and Reliability" },
  { id: "S07", slug: "contradictions", number: 7, title: "Contradictions and Inconsistencies" },
  { id: "S08", slug: "missing_evidence", number: 8, title: "Missing Evidence and Disclosure Questions" },
  { id: "S09", slug: "procedural_concerns", number: 9, title: "Possible Procedural and Legal Concerns" },
  { id: "S10", slug: "court_decisions", number: 10, title: "Relevant Court Decisions" },
  { id: "S11", slug: "other_side", number: 11, title: "The Other Side's Arguments" },
  { id: "S12", slug: "key_questions", number: 12, title: "Key Questions to Resolve" },
  { id: "S13", slug: "organizing_evidence", number: 13, title: "Organizing Your Evidence" },
  { id: "S14", slug: "forms_preparation", number: 14, title: "Court Forms and Document Preparation" },
  { id: "S15", slug: "dates_deadlines", number: 15, title: "Court Dates, Deadlines and Checklist" },
  { id: "S16", slug: "sources_record", number: 16, title: "Sources, Verification and Full Forensic Record" },
] as const;

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]["id"];

/** A section is EMPTY when its source exists but has no entries; NOT_GENERATED when the analyzer has no source for it yet. */
export type SectionStatus = "POPULATED" | "EMPTY" | "NOT_APPLICABLE" | "NOT_GENERATED";

export type FindingKind =
  | "COURT_ORDER"
  | "JUDICIAL_ENDORSEMENT"
  | "JUDICIAL_FINDING"
  | "PARTY_ALLEGATION"
  | "REFERENCED_RECORD_NOT_PROVIDED"
  | "EVIDENCE"
  | "CONTRADICTION"
  | "MISSING_RECORD"
  | "ANALYSIS"
  | "SUMMARY";

/** Whether the concern is supported, unresolved, or missing. Never a probability. */
export type ConcernStatus =
  | "POSSIBLE_CONCERN"
  | "MISSING_INFORMATION"
  | "NOT_INDEPENDENTLY_VERIFIED"
  | "NOT_APPLICABLE";

/** Whether a quotation was found in the uploaded text. */
export type QuoteStatus = "CONFIRMED_FROM_SOURCE" | "NOT_FOUND_IN_SOURCE" | "NOT_CHECKED";

export type AuthorityStatus = "CONFIRMED_SECTION_NUMBER" | "CITATION_UNVERIFIED" | "NOT_CHECKED";

export interface SourceReference {
  documentId: string;
  /** Page, paragraph or section as the analyzer reported it. Free text, never inferred. */
  locator: string;
  /** The exact quoted text, when the analyzer provided one. */
  quote: string;
}

export interface LegalAuthorityRef {
  citation: string;
  status: AuthorityStatus;
}

export interface ReportFinding {
  /** Stable across re-adaptation of the same legacy report. */
  id: string;
  sectionId: ReportSectionId;
  /** The analyzer's own identifier for this item, when it had one (for example "rf1"). */
  legacyId: string | null;
  kind: FindingKind;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  whatLawSays: string;
  whatIsUnknown: string;
  whatYouCanDo: string;
  /** Evidence classification label, when one exists. */
  evidenceClassification: string | null;
  /** The analyzer's own severity wording, kept as given. */
  severity: string | null;
  /** The analyzer's own statutory test result (for example "Yes", "Inconclusive"), kept as given. */
  legalTestResult: string | null;
  concern: ConcernStatus;
  quote: QuoteStatus;
  sources: SourceReference[];
  authorities: LegalAuthorityRef[];
  uncertainty: string;
  supportingFindingIds: string[];
  contraryFindingIds: string[];
  relatedFindingIds: string[];
  order: number;
}

export interface ReportSection {
  id: ReportSectionId;
  number: number;
  title: string;
  status: SectionStatus;
  /** Plain note explaining a NOT_GENERATED, EMPTY or NOT_APPLICABLE status. */
  note: string;
  findingIds: string[];
}

export interface ReportContract {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  origin: "LEGACY_ADAPTER" | "ANALYZER_V2";
  documentId: string;
  documentType: string;
  sections: ReportSection[];
  findings: ReportFinding[];
  /** Notes about the source report, for example fields that were missing. */
  warnings: string[];
  /** Run-level notes kept for professional review. No cost, token, or model data. */
  runNotes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Loose = Record<string, any>;

const PRIMARY_DOCUMENT_ID = "primary-document";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const UNVERIFIED_LAW = "Citation unverified. Confirm the exact section with a lawyer before relying on it.";

/** The statute text, with the unverified warning attached unless the analyzer's internal list confirms it. */
function lawWithStatus(flag: Loose): string {
  const law = text(flag.legalReference);
  if (!law) return "";
  return text(flag.citationStatus) === "CONFIRMED_REFERENCE" || /unverified/i.test(law) ? law : `${law} ${UNVERIFIED_LAW}`;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/** FNV-1a, 32-bit. Used only to make IDs stable across re-adaptation. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function sectionOf(id: ReportSectionId) {
  return REPORT_SECTIONS.find((s) => s.id === id)!;
}

function authorityStatus(citationText: string, citationStatus?: string): AuthorityStatus {
  if (citationStatus === "CONFIRMED_REFERENCE") return "CONFIRMED_SECTION_NUMBER";
  if (citationStatus === "UNVERIFIED" || /unverified/i.test(citationText)) return "CITATION_UNVERIFIED";
  return "NOT_CHECKED";
}

function authorities(citation: string, citationStatus?: string): LegalAuthorityRef[] {
  if (!citation) return [];
  return [{ citation, status: authorityStatus(citation, citationStatus) }];
}

function quoteStatus(value: unknown): QuoteStatus {
  if (value === true) return "CONFIRMED_FROM_SOURCE";
  if (value === false) return "NOT_FOUND_IN_SOURCE";
  return "NOT_CHECKED";
}

function kindFromClassification(classification: string | null): FindingKind {
  switch (classification) {
    case "COURT_ORDER":
      return "COURT_ORDER";
    case "JUDICIAL_ENDORSEMENT":
      return "JUDICIAL_ENDORSEMENT";
    case "JUDICIAL_FINDING":
      return "JUDICIAL_FINDING";
    case "PARTY_ALLEGATION":
      return "PARTY_ALLEGATION";
    case "REFERENCED_DOCUMENT_NOT_PROVIDED":
      return "REFERENCED_RECORD_NOT_PROVIDED";
    default:
      return "EVIDENCE";
  }
}

/** Builds a finding with every field present. Missing values become empty strings, never guesses. */
function makeFinding(init: Partial<ReportFinding> & Pick<ReportFinding, "sectionId" | "kind" | "title">): ReportFinding {
  return {
    legacyId: null,
    whatHappened: "",
    whyItMatters: "",
    whatLawSays: "",
    whatIsUnknown: "",
    whatYouCanDo: "",
    evidenceClassification: null,
    severity: null,
    legalTestResult: null,
    concern: "NOT_APPLICABLE",
    quote: "NOT_CHECKED",
    sources: [],
    authorities: [],
    uncertainty: "",
    supportingFindingIds: [],
    contraryFindingIds: [],
    relatedFindingIds: [],
    order: 0,
    id: "",
    ...init,
  };
}

// ---------------------------------------------------------------------------
// Legacy adapter
// ---------------------------------------------------------------------------

export interface AdaptOptions {
  documentId?: string;
}

/**
 * Converts a saved legacy analyzer report into the contract.
 *
 * Every legacy item in a list field becomes exactly one finding, so nothing is dropped. Red flags
 * are placed in one section each, by the rules in `placeRedFlag`. The original object is not
 * modified.
 */
export function adaptLegacyReport(legacy: unknown, options: AdaptOptions = {}): ReportContract {
  const report: Loose = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? (legacy as Loose) : {};
  const documentId = options.documentId || PRIMARY_DOCUMENT_ID;
  const warnings: string[] = [];
  if (!report || Object.keys(report).length === 0) warnings.push("The saved report is empty or not an object.");

  const findings: ReportFinding[] = [];
  const seenIds = new Map<string, number>();
  const generated = new Set<ReportSectionId>();

  const add = (f: ReportFinding) => {
    const base = `F-${sectionOf(f.sectionId).number.toString().padStart(2, "0")}-${fnv1a(
      [f.sectionId, f.kind, f.legacyId ?? "", f.title, f.whatHappened, f.whyItMatters].join("|")
    )}`;
    const count = (seenIds.get(base) ?? 0) + 1;
    seenIds.set(base, count);
    f.id = count === 1 ? base : `${base}-${count}`;
    f.order = findings.filter((x) => x.sectionId === f.sectionId).length + 1;
    findings.push(f);
    generated.add(f.sectionId);
  };

  const isCourtRecord = Boolean(report.documentAuthority && typeof report.documentAuthority === "object");

  // S01 Case at a glance: the analyzer's summary of the file.
  const summary = text(report.fileSummary);
  if (summary) {
    add(makeFinding({ sectionId: "S01", kind: "SUMMARY", title: "Summary of the document", whatHappened: summary, concern: "NOT_APPLICABLE", quote: "NOT_CHECKED" }));
  }

  // S02 Understanding your documents: type and identifying details.
  const docType = text(report.documentType);
  const meta: Loose = report.metadata && typeof report.metadata === "object" ? report.metadata : {};
  const metaLines = Object.entries(meta)
    .map(([k, v]) => [k, text(v)] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  if (docType || metaLines.length) {
    add(makeFinding({ sectionId: "S02", kind: "SUMMARY", title: "Document type and identifying details", whatHappened: [docType, ...metaLines].filter(Boolean).join("; ") }));
  }

  // S04 Court orders: only for court records. Never scored.
  if (isCourtRecord) {
    const auth: Loose = report.documentAuthority;
    add(
      makeFinding({
        sectionId: "S04",
        kind: auth.recordKind === "JUDICIAL_ENDORSEMENT" ? "JUDICIAL_ENDORSEMENT" : "COURT_ORDER",
        title: "The court document itself",
        whatHappened: docType,
        // Analyzer-supplied wording about legal effect is not copied: effect is not established by this report.
        whyItMatters: "This is a court document. This report does not show its legal effect.",
        whatIsUnknown: "Whether it is final, signed, entered, served, or in effect. Confirm with counsel and the court file.",
        concern: "NOT_APPLICABLE",
        sources: [{ documentId, locator: "Whole document", quote: "" }],
        uncertainty: "Authenticity and current status are not verified by this tool.",
      })
    );
  }

  // S03 Timeline: one finding per chronology entry.
  const chronology: Loose[] = Array.isArray(report.chronology) ? report.chronology : [];
  for (const entry of chronology) {
    const event = text(entry?.event);
    if (!event) continue;
    const classification = text(entry.evidenceClassification) || null;
    add(
      makeFinding({
        sectionId: "S03",
        kind: kindFromClassification(classification),
        title: `${text(entry.date) || "Undated"}`,
        whatHappened: event,
        evidenceClassification: classification,
        sources: [{ documentId, locator: text(entry.locationInDocument) || "Location not given", quote: "" }],
      })
    );
  }

  // Red flags: each goes to exactly one section.
  for (const [i, flag] of (Array.isArray(report.redFlags) ? report.redFlags : []).entries()) {
    if (!flag || typeof flag !== "object") continue;
    const classification = text(flag.evidenceClassification) || null;
    const category = text(flag.category);
    const sectionId = placeRedFlag(classification, category, isCourtRecord);
    const concern: ConcernStatus =
      classification === "REFERENCED_DOCUMENT_NOT_PROVIDED"
        ? "MISSING_INFORMATION"
        : flag.quoteVerified === false
          ? "NOT_INDEPENDENTLY_VERIFIED"
          : "POSSIBLE_CONCERN";
    add(
      makeFinding({
        sectionId,
        kind: kindFromClassification(classification),
        legacyId: text(flag.id) || `flag-${i + 1}`,
        title: category || `Point ${i + 1}`,
        whatHappened: text(flag.phraseDetected) ? `The record says: ${text(flag.phraseDetected)}` : "",
        whyItMatters: text(flag.explanation),
        whatLawSays: lawWithStatus(flag),
        whatIsUnknown: text(flag.verifyRequirement),
        whatYouCanDo: text(flag.parentActionStep),
        evidenceClassification: classification,
        severity: text(flag.severity) || null,
        concern: isCourtRecord && kindFromClassification(classification) === "EVIDENCE" ? "NOT_APPLICABLE" : concern,
        quote: quoteStatus(flag.quoteVerified),
        sources: [{ documentId, locator: text(flag.locationInDocument) || "Location not given", quote: text(flag.phraseDetected) }],
        authorities: authorities(text(flag.legalReference), text(flag.citationStatus)),
      })
    );
  }

  // S05 Rights and statutory timelines.
  for (const item of Array.isArray(report.proceduralTimelineViolations) ? report.proceduralTimelineViolations : []) {
    if (!item || typeof item !== "object") continue;
    const rule = text(item.timelineRule);
    if (!rule) continue;
    add(
      makeFinding({
        sectionId: "S05",
        kind: "ANALYSIS",
        title: rule,
        whatHappened: text(item.documentAssertion),
        whyItMatters: text(item.evaluation),
        whatYouCanDo: text(item.parentActionStep),
        legalTestResult: null,
        concern: "NOT_INDEPENDENTLY_VERIFIED",
        sources: [{ documentId, locator: text(item.locationInDocument) || "Location not given", quote: "" }],
        authorities: authorities(text(item.citation)),
      })
    );
  }
  for (const right of strings(report.charterAndHumanRightsIssues)) {
    add(makeFinding({ sectionId: "S05", kind: "ANALYSIS", title: "Charter and human rights point", whyItMatters: right, concern: "NOT_INDEPENDENTLY_VERIFIED" }));
  }

  // S09 Procedural and legal concerns: statutory threshold checks, kept with the analyzer's own result.
  for (const t of Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis : []) {
    if (!t || typeof t !== "object") continue;
    const checked = text(t.thresholdChecked);
    if (!checked) continue;
    add(
      makeFinding({
        sectionId: "S09",
        kind: "ANALYSIS",
        title: checked,
        whyItMatters: text(t.reasoning),
        legalTestResult: text(t.isMet) || null,
        concern: "NOT_INDEPENDENTLY_VERIFIED",
        authorities: authorities(text(t.primarySourceLaw)),
      })
    );
  }

  // S07 Contradictions.
  const contradictions: Loose[] = Array.isArray(report.contradictions) ? report.contradictions : [];
  for (const c of contradictions) {
    const description = text(c?.description);
    if (!description) continue;
    const locations = strings(c.locations);
    // A contradiction needs two source passages. With fewer, it is kept but not treated as confirmed.
    const twoSources = locations.length >= 2;
    add(
      makeFinding({
        sectionId: "S07",
        kind: "CONTRADICTION",
        title: "Possible contradiction",
        whatHappened: description,
        whyItMatters: text(c.significance),
        concern: twoSources ? "POSSIBLE_CONCERN" : "NOT_INDEPENDENTLY_VERIFIED",
        uncertainty: twoSources
          ? ""
          : "Only one source location was given. A second passage is needed before this can be treated as a conflict.",
        sources: locations.length
          ? locations.map((loc) => ({ documentId, locator: loc, quote: "" }))
          : [{ documentId, locator: "Location not given", quote: "" }],
      })
    );
  }

  // S06 Evidence strength. Not scored for court records.
  const esi: Loose | null = report.evidenceStrengthIndex && typeof report.evidenceStrengthIndex === "object" ? report.evidenceStrengthIndex : null;
  if (!isCourtRecord && (esi || typeof report.completenessScore === "number")) {
    const components = esi?.components && typeof esi.components === "object" ? Object.keys(esi.components).length : 0;
    add(
      makeFinding({
        sectionId: "S06",
        kind: "ANALYSIS",
        title: "Evidence strength and information completeness (heuristic)",
        whyItMatters: text(esi?.limitations),
        uncertainty: text(esi?.method) || "Heuristic assessment of this document only.",
        concern: "NOT_APPLICABLE",
        whatHappened: components ? `${components} component scores were reported.` : "",
      })
    );
  }

  // S08 Missing records (plain list from the analyzer).
  for (const m of strings(report.whatIsMissing)) {
    add(makeFinding({ sectionId: "S08", kind: "MISSING_RECORD", title: "Missing record or information", whatHappened: m, concern: "MISSING_INFORMATION" }));
  }

  // S12 Key questions and S13 organising the evidence.
  for (const q of strings(report.whatToAskALawyer)) {
    add(makeFinding({ sectionId: "S12", kind: "ANALYSIS", title: "Question for counsel", whatHappened: q, concern: "NOT_APPLICABLE" }));
  }
  for (const v of strings(report.whatToVerify)) {
    add(makeFinding({ sectionId: "S13", kind: "ANALYSIS", title: "Item to verify", whatHappened: v, concern: "NOT_APPLICABLE" }));
  }

  // S16 Sources, professional brief, verification and the full record.
  for (const b of strings(report.lawyerCaseBrief)) {
    add(makeFinding({ sectionId: "S16", kind: "ANALYSIS", title: "Professional case brief point", whatHappened: b, concern: "NOT_APPLICABLE" }));
  }
  const verification: Loose | null = report.forensicVerification && typeof report.forensicVerification === "object" ? report.forensicVerification : null;
  const runNotes: string[] = [];
  if (verification) {
    // Only the outcome is kept. The verifying model's identifier is deliberately not copied.
    runNotes.push(
      `Independent second review: ${text(verification.status) || "unknown"}; ${Number(verification.checkedFindings) || 0} findings checked.`
    );
    if (text(verification.overallAssessment)) runNotes.push(text(verification.overallAssessment));
    if (text(verification.reason)) runNotes.push(text(verification.reason));
  }
  if (text(report.disclaimer)) runNotes.push(text(report.disclaimer));

  // S10, S11, S14, S15: no analyzer source exists yet, so they are marked, never filled.
  const notes: Record<ReportSectionId, string> = {
    S01: "No summary was produced.",
    S02: "No document type or details were produced.",
    S03: "The analyzer produced no chronology entries.",
    S04: "This document is not a court order or endorsement.",
    S05: "No rights or timeline items were produced.",
    S06: isCourtRecord
      ? "Not scored. Court orders and endorsements are not given an evidence-strength or completeness score."
      : typeof esi?.score === "number"
        ? "Items about how reliable the evidence is. The analyzer reported a heuristic evidence-strength score; it is not a verified measure of reliability."
        : "Items about how reliable the evidence is. No evidence-strength score was produced.",
    S07: "The analyzer found no contradictions.",
    S08: "The analyzer listed no missing records.",
    S09: "No threshold checks were produced (Quick Review does not run them).",
    S10: "Court decisions are not retrieved yet. No verified case-law source is connected.",
    S11: "The analyzer does not yet produce the other side's arguments.",
    S12: "No questions for counsel were produced.",
    S13: "No verification items were produced.",
    S14: "Form preparation is not available yet. It needs legal-services review first.",
    S15: "Deadlines are not calculated. They need verified rules and dates first.",
    S16: "Sources and the professional brief from this analysis.",
  };
  const sectionFor = (id: ReportSectionId): SectionStatus => {
    if (id === "S04" && !isCourtRecord) return "NOT_APPLICABLE";
    if (id === "S06" && isCourtRecord && !generated.has("S06")) return "NOT_APPLICABLE";
    if (id === "S10" || id === "S11" || id === "S14" || id === "S15") return "NOT_GENERATED";
    return generated.has(id) ? "POPULATED" : "EMPTY";
  };
  const sections: ReportSection[] = REPORT_SECTIONS.map((s) => ({
    id: s.id,
    number: s.number,
    title: s.title,
    status: sectionFor(s.id),
    note: notes[s.id],
    findingIds: findings.filter((f) => f.sectionId === s.id).map((f) => f.id),
  }));

  if (!text(report.fileSummary) && !docType) warnings.push("The saved report has no summary or document type.");
  if (!Array.isArray(report.redFlags)) warnings.push("The saved report has no redFlags list.");

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    origin: "LEGACY_ADAPTER",
    documentId,
    documentType: docType,
    sections,
    findings,
    warnings,
    runNotes,
  };
}

/** Section placement for a red flag. One section per flag. */
export function placeRedFlag(classification: string | null, category: string, isCourtRecord: boolean): ReportSectionId {
  const kind = kindFromClassification(classification);
  if (kind === "REFERENCED_RECORD_NOT_PROVIDED") return "S08";
  if (isCourtRecord && (kind === "COURT_ORDER" || kind === "JUDICIAL_ENDORSEMENT" || kind === "JUDICIAL_FINDING")) return "S04";
  if (/missing|not provided|not attached/i.test(category)) return "S08";
  if (/hearsay|unsupported|evidence|weight|opinion/i.test(category) || ["HEARSAY", "UNSUPPORTED", "OPINION"].includes(classification ?? "")) return "S06";
  return "S09";
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const PARENT_CONCERN_LABEL: Record<ConcernStatus, string> = {
  POSSIBLE_CONCERN: "Something to look at",
  MISSING_INFORMATION: "Information that is missing",
  NOT_INDEPENDENTLY_VERIFIED: "Not yet checked against other records",
  NOT_APPLICABLE: "",
};

export interface ParentFindingPresentation {
  id: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  whatLawSays: string;
  whatIsUnknown: string;
  whatYouCanDo: string;
  concernLabel: string;
  evidenceLabel: string;
  sourceLocators: string[];
}

export interface ProfessionalFindingPresentation extends ParentFindingPresentation {
  kind: FindingKind;
  concern: ConcernStatus;
  quote: QuoteStatus;
  severity: string | null;
  legalTestResult: string | null;
  sources: SourceReference[];
  authorities: LegalAuthorityRef[];
  uncertainty: string;
  supportingFindingIds: string[];
  contraryFindingIds: string[];
  relatedFindingIds: string[];
}

export interface PresentedSection<F> {
  id: ReportSectionId;
  number: number;
  title: string;
  status: SectionStatus;
  note: string;
  findings: F[];
}

/** Parent presentation: the same findings, in short plain fields and plain status labels. */
export function presentForParent(contract: ReportContract): PresentedSection<ParentFindingPresentation>[] {
  return contract.sections.map((section) => ({
    id: section.id,
    number: section.number,
    title: section.title,
    status: section.status,
    note: section.note,
    findings: section.findingIds.map((id) => {
      const f = contract.findings.find((x) => x.id === id)!;
      return {
        id: f.id,
        title: f.title,
        whatHappened: f.whatHappened,
        whyItMatters: f.whyItMatters,
        whatLawSays: f.whatLawSays,
        whatIsUnknown: f.whatIsUnknown,
        whatYouCanDo: f.whatYouCanDo,
        concernLabel: PARENT_CONCERN_LABEL[f.concern],
        evidenceLabel: f.evidenceClassification ?? "",
        sourceLocators: f.sources.map((s) => s.locator),
      };
    }),
  }));
}

/** Professional presentation: the same findings with sources, authority status, and test results. */
export function presentForProfessional(contract: ReportContract): PresentedSection<ProfessionalFindingPresentation>[] {
  return contract.sections.map((section) => ({
    id: section.id,
    number: section.number,
    title: section.title,
    status: section.status,
    note: section.note,
    findings: section.findingIds.map((id) => {
      const f = contract.findings.find((x) => x.id === id)!;
      return {
        id: f.id,
        title: f.title,
        whatHappened: f.whatHappened,
        whyItMatters: f.whyItMatters,
        whatLawSays: f.whatLawSays,
        whatIsUnknown: f.whatIsUnknown,
        whatYouCanDo: f.whatYouCanDo,
        concernLabel: f.concern,
        evidenceLabel: f.evidenceClassification ?? "",
        sourceLocators: f.sources.map((s) => s.locator),
        kind: f.kind,
        concern: f.concern,
        quote: f.quote,
        severity: f.severity,
        legalTestResult: f.legalTestResult,
        sources: f.sources,
        authorities: f.authorities,
        uncertainty: f.uncertainty,
        supportingFindingIds: f.supportingFindingIds,
        contraryFindingIds: f.contraryFindingIds,
        relatedFindingIds: f.relatedFindingIds,
      };
    }),
  }));
}
