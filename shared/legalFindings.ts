/**
 * Structured legal findings for the CYFSA Document Analyzer report.
 *
 * Shared by the server (generation, validation, authority resolution) and the browser
 * (rendering, legacy-report handling). Pure types and pure functions only: no I/O.
 *
 * Authority status vocabulary (never relax this):
 *   VERIFIED   a retrieval check against the authority's published source was RECORDED
 *              (see api/services/legalAuthorityVerification.ts). A model saying "this is a real
 *              case" never produces this status.
 *   CANDIDATE  an entry curated into CYFSA Navigator's authority registry that has not yet had a
 *              recorded retrieval check. Real-looking is not verified.
 *   UNVERIFIED a legal reference that is not in the registry at all (typically model-written
 *              text). Shown so counsel can look at it, never as authority.
 */

export type AuthorityStatus = "VERIFIED" | "CANDIDATE" | "UNVERIFIED";
export type AuthorityKind = "CHARTER" | "STATUTE" | "REGULATION" | "COURT_RULE" | "CASE" | "OTHER";
/** VERIFIED: link was fetched and matched. UNCHECKED: never fetched. BROKEN: a check failed. NONE: no link. */
export type LinkStatus = "VERIFIED" | "UNCHECKED" | "BROKEN" | "NONE";

export interface LegalReference {
  key?: string;
  kind: AuthorityKind;
  citation: string;
  title: string;
  pinpoint?: string;
  status: AuthorityStatus;
  url?: string;
  urlStatus: LinkStatus;
  /** A real landing page where the citation can be looked up, when no deep link is recorded. */
  lookupUrl?: string;
  lookupLabel?: string;
  /** Statutory wording as recorded in the registry (not model-written). */
  statuteText?: string;
  /** Registry-written one-sentence orientation: what the authority is generally cited for. */
  generallyCitedFor?: string;
  /** Registry-written outline of the legal test, for orientation only. */
  testOutline?: string;
  /** Model-written: how the authority bears on THIS document. Always requires lawyer review. */
  howItApplies?: string;
  limitation?: string;
  /** True when the section appears in CYFSA Navigator's previously confirmed statute reference. */
  confirmedReference?: boolean;
}

export type QuoteCheck = "EXACT" | "NORMALIZED_WHITESPACE" | "NORMALIZED_PUNCTUATION" | "AMBIGUOUS" | "ABSENT" | "NOT_PROVIDED";

export interface EvidenceRef {
  /** Text the model attributes to the document. Only trustworthy when quoteVerified is true. */
  quote?: string;
  locationInDocument?: string;
  sourceDocument?: string;
  quoteCheck: QuoteCheck;
  quoteVerified: boolean;
}

export type CharterSection = "1" | "7" | "8" | "9" | "10" | "12" | "15" | "24";
export const CHARTER_SECTIONS: readonly CharterSection[] = ["7", "8", "9", "10", "12", "15", "1", "24"];

/** A potential concern is never an established violation; there is deliberately no VIOLATION value. */
export type CharterAssessment = "POTENTIAL_CONCERN" | "INSUFFICIENT_INFORMATION";

export interface FindingBase {
  id: string;
  title: string;
  plainLanguage: string;
  whyItMatters: string;
  evidence: EvidenceRef[];
  contraryEvidence: string;
  missingInformation: string[];
  verificationSteps: string[];
  questionsForCounsel: string[];
  authorities: LegalReference[];
  /** Ids of other findings or red flags this one relates to. */
  relatedIds: string[];
  /** Set for findings derived from a legacy (string-only) report: nothing structured was generated. */
  legacy?: boolean;
}

export interface CharterFinding extends FindingBase {
  section: CharterSection;
  assessment: CharterAssessment;
  stateAction: string;
  affectedRight: string;
  legalTest: string;
  /** Registry-written outline of the test for this section (orientation, not a ruling). */
  testOutline?: string;
  missingLegalElements: string[];
  remediesForCounsel: string;
  /** Prior authorities the server dropped because they did not apply to this section. */
  droppedAuthorityKeys?: string[];
}

export type VerificationResult = "VERIFIED" | "CONTRADICTED" | "UNVERIFIED" | "INCONCLUSIVE" | "NOT_APPLICABLE";
export const VERIFICATION_RESULTS: readonly VerificationResult[] = ["VERIFIED", "CONTRADICTED", "UNVERIFIED", "INCONCLUSIVE", "NOT_APPLICABLE"];

export interface VerificationItem extends FindingBase {
  claim: string;
  sourceDocument: string;
  supportingPassage?: EvidenceRef;
  contradictoryPassage?: EvidenceRef;
  method: string;
  result: VerificationResult;
  /** Set when the server changed the model's result because a cited passage could not be located. */
  resultNote?: string;
  missingEvidence: string;
  nextAction: string;
}

/** Whether the item is merely absent from what was uploaded, or confirmed not to exist. */
export type AbsenceStatus = "NOT_IN_UPLOADED_MATERIALS" | "CONFIRMED_NONEXISTENT" | "UNKNOWN";

export interface MissingElement extends FindingBase {
  item: string;
  dependsOn: string;
  absenceStatus: AbsenceStatus;
  absenceBasis: string;
  nextSteps: string[];
}

export type LawyerQuestionLinkType = "charter" | "verification" | "missing" | "redFlag" | "threshold" | "timeline" | "general";

export interface LawyerQuestion extends FindingBase {
  question: string;
  whatLawyerAssesses: string;
  documentsToBring: string[];
  linkedType: LawyerQuestionLinkType;
  /** Id of the finding this question belongs to; only ids that exist in the report survive validation. */
  linkedFindingId?: string;
  /** Provisional answer drawn from the legacy "Question | What the record shows | ..." format. */
  recordShows?: string;
  stillUnknown?: string;
}

export type FindingSectionKey = "charter" | "verification" | "missing" | "lawyerQuestions";
export type FindingSectionState = "GENERATED" | "UNAVAILABLE" | "LEGACY";

export interface InteractiveFindings {
  schemaVersion: 1;
  charter: CharterFinding[];
  verification: VerificationItem[];
  missing: MissingElement[];
  lawyerQuestions: LawyerQuestion[];
  /** Per-section outcome. UNAVAILABLE sections fall back to the legacy arrays and say so. */
  sectionStatus: Record<FindingSectionKey, { state: FindingSectionState; reason?: string }>;
  authoritySummary: {
    registryVersion: string;
    lastRetrievalCheckAt: string | null;
    verifiedCount: number;
    candidateCount: number;
    unverifiedCount: number;
    /** Always present text describing what was and was not checked. Never omitted. */
    limitation: string;
  };
}

// ---------------------------------------------------------------------------
// Legacy (string-only) reports
// ---------------------------------------------------------------------------

const NOT_GENERATED = "Not generated for this report. This item was saved before detailed findings were available.";

function emptyBase(id: string, text: string): FindingBase {
  return {
    id,
    title: firstSentence(text, 110),
    plainLanguage: text,
    whyItMatters: "",
    evidence: [],
    contraryEvidence: "",
    missingInformation: [],
    verificationSteps: [],
    questionsForCounsel: [],
    authorities: [],
    relatedIds: [],
    legacy: true,
  };
}

export function firstSentence(text: string, max: number): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/**
 * Parses the "Question: ... | What the uploaded record shows: ... | Still unknown: ... | Source: ..."
 * format that earlier reports used inside a single string. Never invents a field that was absent.
 */
export function parseLegacyQuestion(raw: string): { question: string; recordShows?: string; stillUnknown?: string; source?: string } {
  const parts = String(raw || "").split("|").map((p) => p.trim()).filter(Boolean);
  const out: { question: string; recordShows?: string; stillUnknown?: string; source?: string } = { question: "" };
  const strip = (p: string, label: RegExp) => p.replace(label, "").trim();
  for (const p of parts) {
    if (/^question\s*:/i.test(p)) out.question = strip(p, /^question\s*:/i);
    else if (/^what the (uploaded )?record shows\s*:/i.test(p)) out.recordShows = strip(p, /^what the (uploaded )?record shows\s*:/i);
    else if (/^still unknown\s*:/i.test(p)) out.stillUnknown = strip(p, /^still unknown\s*:/i);
    else if (/^source\s*:/i.test(p)) out.source = strip(p, /^source\s*:/i);
    else if (!out.question) out.question = p;
  }
  if (!out.question) out.question = String(raw || "").trim();
  return out;
}

const SECTION_FROM_TEXT: Array<[RegExp, CharterSection]> = [
  [/\b(s\.?|section)\s*7\b/i, "7"],
  [/\b(s\.?|section)\s*8\b/i, "8"],
  [/\b(s\.?|section)\s*9\b/i, "9"],
  [/\b(s\.?|section)\s*10\b/i, "10"],
  [/\b(s\.?|section)\s*12\b/i, "12"],
  [/\b(s\.?|section)\s*15\b/i, "15"],
];

/** Builds the tab content for a report saved before structured findings existed. */
export function deriveLegacyFindings(report: Record<string, any> | null | undefined): InteractiveFindings {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")).filter((s) => s.trim()) : []);
  const charterTexts = list(report?.charterAndHumanRightsIssues);
  const verifyTexts = list(report?.whatToVerify);
  const missingTexts = list(report?.whatIsMissing);
  const questionTexts = list(report?.whatToAskALawyer);

  const charter: CharterFinding[] = charterTexts.map((text, i) => {
    const section = SECTION_FROM_TEXT.find(([re]) => re.test(text))?.[1] ?? "7";
    const sectionKnown = SECTION_FROM_TEXT.some(([re]) => re.test(text));
    return {
      ...emptyBase(`legacy-charter-${i + 1}`, text),
      title: sectionKnown ? `Charter s. ${section}: ${firstSentence(text.replace(/^[^:]*:\s*/, ""), 90)}` : firstSentence(text, 110),
      section,
      assessment: "INSUFFICIENT_INFORMATION" as const,
      stateAction: "",
      affectedRight: "",
      legalTest: "",
      missingLegalElements: [],
      remediesForCounsel: "",
    };
  });

  const verification: VerificationItem[] = verifyTexts.map((text, i) => ({
    ...emptyBase(`legacy-verify-${i + 1}`, text),
    claim: text,
    sourceDocument: "",
    method: "",
    result: "UNVERIFIED" as const,
    missingEvidence: "",
    nextAction: text,
  }));

  const missing: MissingElement[] = missingTexts.map((text, i) => ({
    ...emptyBase(`legacy-missing-${i + 1}`, text),
    item: text,
    dependsOn: "",
    absenceStatus: "NOT_IN_UPLOADED_MATERIALS" as const,
    absenceBasis: "This item is described as absent from the uploaded document. It was not confirmed that the record does not exist.",
    nextSteps: [],
  }));

  const lawyerQuestions: LawyerQuestion[] = questionTexts.map((text, i) => {
    const parsed = parseLegacyQuestion(text);
    const base = emptyBase(`legacy-question-${i + 1}`, parsed.question);
    return {
      ...base,
      question: parsed.question,
      title: firstSentence(parsed.question, 110),
      whatLawyerAssesses: "",
      documentsToBring: [],
      linkedType: "general" as const,
      recordShows: parsed.recordShows,
      stillUnknown: parsed.stillUnknown,
      evidence: parsed.source ? [{ locationInDocument: parsed.source, quoteCheck: "NOT_PROVIDED" as const, quoteVerified: false }] : [],
    };
  });

  const state = (n: number): { state: FindingSectionState; reason?: string } =>
    n > 0 ? { state: "LEGACY", reason: NOT_GENERATED } : { state: "LEGACY" };

  return {
    schemaVersion: 1,
    charter,
    verification,
    missing,
    lawyerQuestions,
    sectionStatus: {
      charter: state(charter.length),
      verification: state(verification.length),
      missing: state(missing.length),
      lawyerQuestions: state(lawyerQuestions.length),
    },
    authoritySummary: {
      registryVersion: "none",
      lastRetrievalCheckAt: null,
      verifiedCount: 0,
      candidateCount: 0,
      unverifiedCount: 0,
      limitation:
        "This report was saved before legal authority references were generated. No statutes or cases are attached to these items. Ask counsel to confirm any law that applies.",
    },
  };
}

/**
 * Returns the structured findings to render. Uses the report's own structured findings per section,
 * and fills any section that is missing or UNAVAILABLE from the legacy arrays so a tab is never
 * silently empty when the report did contain text for it.
 */
export function resolveInteractiveFindings(report: Record<string, any> | null | undefined): InteractiveFindings {
  const legacy = deriveLegacyFindings(report);
  const own = report?.interactiveFindings;
  if (!own || typeof own !== "object" || own.schemaVersion !== 1) return legacy;

  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const status = (key: FindingSectionKey) => own.sectionStatus?.[key] ?? { state: "GENERATED" as const };
  const use = <T,>(key: FindingSectionKey, ownItems: T[], legacyItems: T[]): { items: T[]; status: { state: FindingSectionState; reason?: string } } => {
    const st = status(key);
    if (st.state === "UNAVAILABLE" || (ownItems.length === 0 && st.state !== "GENERATED")) {
      return { items: legacyItems, status: legacyItems.length ? { state: "LEGACY", reason: st.reason || NOT_GENERATED } : st };
    }
    return { items: ownItems, status: st };
  };

  const c = use("charter", arr<CharterFinding>(own.charter), legacy.charter);
  const v = use("verification", arr<VerificationItem>(own.verification), legacy.verification);
  const m = use("missing", arr<MissingElement>(own.missing), legacy.missing);
  const q = use("lawyerQuestions", arr<LawyerQuestion>(own.lawyerQuestions), legacy.lawyerQuestions);

  return {
    schemaVersion: 1,
    charter: c.items,
    verification: v.items,
    missing: m.items,
    lawyerQuestions: q.items,
    sectionStatus: { charter: c.status, verification: v.status, missing: m.status, lawyerQuestions: q.status },
    authoritySummary: own.authoritySummary && typeof own.authoritySummary === "object" ? own.authoritySummary : legacy.authoritySummary,
  };
}

/** Plain-text rendering of one lawyer question, for copy-to-clipboard and the consolidated print list. */
export function lawyerQuestionToText(q: LawyerQuestion): string {
  const lines: string[] = [q.question.trim()];
  if (q.whyItMatters) lines.push(`Why it matters: ${q.whyItMatters}`);
  if (q.recordShows) lines.push(`What the uploaded record shows: ${q.recordShows}`);
  if (q.stillUnknown) lines.push(`Still unknown: ${q.stillUnknown}`);
  const ev = q.evidence.filter((e) => e.locationInDocument || (e.quote && e.quoteVerified));
  if (ev.length) {
    lines.push(
      "Evidence: " +
        ev.map((e) => [e.quote && e.quoteVerified ? `"${e.quote}"` : "", e.locationInDocument].filter(Boolean).join(" - ")).join("; ")
    );
  }
  if (q.authorities.length) {
    lines.push("Authorities (" + q.authorities.map((a) => `${a.citation}${a.pinpoint ? ", " + a.pinpoint : ""} [${a.status.toLowerCase()}]`).join("; ") + ")");
  }
  if (q.whatLawyerAssesses) lines.push(`For the lawyer to assess: ${q.whatLawyerAssesses}`);
  if (q.documentsToBring.length) lines.push(`Documents to bring: ${q.documentsToBring.join("; ")}`);
  return lines.join("\n");
}

/**
 * Combines the structured findings of an earlier pass with a later pass (Quick Review then Deep Scan).
 * The later pass wins for every section it generated; a section it could not generate keeps the
 * earlier pass's structured findings instead of dropping to the plain legacy list.
 */
export function mergeInteractiveFindings(prev: InteractiveFindings | undefined, next: InteractiveFindings | undefined): InteractiveFindings | undefined {
  if (!next) return prev;
  if (!prev) return next;
  const keys: FindingSectionKey[] = ["charter", "verification", "missing", "lawyerQuestions"];
  const out: InteractiveFindings = { ...next, sectionStatus: { ...next.sectionStatus } };
  for (const k of keys) {
    if (next.sectionStatus?.[k]?.state === "UNAVAILABLE" && prev.sectionStatus?.[k]?.state === "GENERATED") {
      (out as any)[k] = prev[k];
      out.sectionStatus[k] = prev.sectionStatus[k];
    }
  }
  return out;
}
