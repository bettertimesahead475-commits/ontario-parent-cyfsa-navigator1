// Stage 6 Milestone 1 — CYFSA Legal Intelligence & Authority Foundation.
// Deterministic, provider-independent logic only. No live model calls. No database access.
// Legal source/provision/version text and any future case-law text are UNTRUSTED DATA,
// never instructions: nothing here interprets embedded content as a command.
import { LifecycleError, requireUuid } from "./lifecycleErrors.js";

const invalid = (message: string) => new LifecycleError(400, "INVALID_LEGAL_AUTHORITY", message);

// ---------------------------------------------------------------------------
// Legal source / provision / version model
// ---------------------------------------------------------------------------

export const JURISDICTIONS = ["ON", "CA"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const SOURCE_TYPES = ["STATUTE", "REGULATION", "COURT_RULE", "CASE_LAW", "CHARTER"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// AI-proposed authority identification is UNVERIFIED until a human confirms it against the
// official publisher text. Only VERIFIED sources/versions/provisions may resolve a mapping.
export const VERIFICATION_STATES = ["VERIFIED", "UNVERIFIED", "SUPERSEDED"] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const VERSION_STATUSES = ["NOT_YET_IN_FORCE", "IN_FORCE", "REPEALED", "SUPERSEDED"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export interface LegalSource {
  id: string;
  jurisdiction: Jurisdiction;
  title: string;
  sourceType: SourceType;
  citation: string;
  officialPublisher: string;
  sourceUrl: string;
  verificationState: VerificationState;
  retrievedAt: string; // ISO timestamp of verification/retrieval
}

export interface LegalSourceVersion {
  id: string;
  legalSourceId: string;
  versionLabel: string;
  effectiveFrom: string; // ISO date, inclusive
  effectiveTo: string | null; // ISO date, exclusive; null = open-ended/current
  status: VersionStatus;
  verificationState: VerificationState;
  retrievedAt: string;
  supersedesVersionId: string | null;
}

export interface LegalProvision {
  id: string;
  legalSourceId: string;
  citation: string; // e.g. "s. 74(2)"
  label: string;
  verificationState: VerificationState;
}

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export function validateLegalSource(value: unknown): LegalSource {
  const v = value as any;
  if (!v || typeof v !== "object") throw invalid("Legal source must be an object.");
  requireUuid(v.id, "Legal source id");
  if (!JURISDICTIONS.includes(v.jurisdiction)) throw invalid("Unknown jurisdiction.");
  if (typeof v.title !== "string" || !v.title.trim()) throw invalid("Legal source title is required.");
  if (!SOURCE_TYPES.includes(v.sourceType)) throw invalid("Unknown legal source type.");
  if (typeof v.citation !== "string" || !v.citation.trim()) throw invalid("Legal source citation is required.");
  if (typeof v.officialPublisher !== "string" || !v.officialPublisher.trim())
    throw invalid("Official publisher is required.");
  if (typeof v.sourceUrl !== "string" || !/^https:\/\//.test(v.sourceUrl)) throw invalid("Authoritative URL must be https.");
  if (!VERIFICATION_STATES.includes(v.verificationState)) throw invalid("Unknown verification state.");
  if (typeof v.retrievedAt !== "string" || Number.isNaN(Date.parse(v.retrievedAt)))
    throw invalid("retrievedAt must be a valid timestamp.");
  return v as LegalSource;
}

export function validateLegalSourceVersion(value: unknown): LegalSourceVersion {
  const v = value as any;
  if (!v || typeof v !== "object") throw invalid("Legal source version must be an object.");
  requireUuid(v.id, "Version id");
  requireUuid(v.legalSourceId, "Version legalSourceId");
  if (typeof v.versionLabel !== "string" || !v.versionLabel.trim()) throw invalid("Version label is required.");
  if (!isIsoDate(v.effectiveFrom)) throw invalid("effectiveFrom must be an ISO date.");
  if (v.effectiveTo !== null && !isIsoDate(v.effectiveTo)) throw invalid("effectiveTo must be an ISO date or null.");
  if (v.effectiveTo !== null && !(v.effectiveTo > v.effectiveFrom))
    throw invalid("effectiveTo must be strictly after effectiveFrom.");
  if (!VERSION_STATUSES.includes(v.status)) throw invalid("Unknown version status.");
  if (!VERIFICATION_STATES.includes(v.verificationState)) throw invalid("Unknown verification state.");
  if (typeof v.retrievedAt !== "string" || Number.isNaN(Date.parse(v.retrievedAt)))
    throw invalid("retrievedAt must be a valid timestamp.");
  if (v.supersedesVersionId !== null) requireUuid(v.supersedesVersionId, "supersedesVersionId");
  return v as LegalSourceVersion;
}

export function validateLegalProvision(value: unknown): LegalProvision {
  const v = value as any;
  if (!v || typeof v !== "object") throw invalid("Legal provision must be an object.");
  requireUuid(v.id, "Provision id");
  requireUuid(v.legalSourceId, "Provision legalSourceId");
  if (typeof v.citation !== "string" || !v.citation.trim()) throw invalid("Provision citation is required.");
  if (typeof v.label !== "string" || !v.label.trim()) throw invalid("Provision label is required.");
  if (!VERIFICATION_STATES.includes(v.verificationState)) throw invalid("Unknown verification state.");
  return v as LegalProvision;
}

// ---------------------------------------------------------------------------
// Temporal version resolution — deterministic, never silently guesses.
// ---------------------------------------------------------------------------

export type CaseDate = { kind: "EXACT"; date: string } | { kind: "APPROXIMATE"; date: string } | { kind: "UNKNOWN" };

export type ResolutionOutcome =
  | "RESOLVED"
  | "RESOLVED_OPEN_ENDED"
  | "RESOLVED_APPROXIMATE"
  | "UNKNOWN_DATE"
  | "NO_VERIFIED_VERSION"
  | "BEFORE_EARLIEST_VERSION"
  | "AFTER_LAST_CLOSED_VERSION"
  | "GAP_IN_COVERAGE"
  | "OVERLAPPING_VERSIONS"
  | "MULTIPLE_APPLICABLE_VERSIONS"
  | "INVALID_VERSION_DATA";

export interface ResolutionResult {
  outcome: ResolutionOutcome;
  version: LegalSourceVersion | null;
  candidates: LegalSourceVersion[];
  warnings: string[];
}

function ambiguous(outcome: ResolutionOutcome, warnings: string[], candidates: LegalSourceVersion[] = []): ResolutionResult {
  return { outcome, version: null, candidates, warnings };
}

/**
 * Resolve which verified version of a legal source was applicable on a given case date.
 * Half-open intervals [effectiveFrom, effectiveTo) — a date exactly on a shared boundary
 * belongs to the version that begins there, never both. Ambiguity is always returned
 * explicitly; this function never picks a version when the data does not support one.
 */
export function resolveApplicableVersion(versions: LegalSourceVersion[], date: CaseDate): ResolutionResult {
  for (const v of versions) validateLegalSourceVersion(v);

  const sameSource = new Set(versions.map((v) => v.legalSourceId));
  if (sameSource.size > 1) throw invalid("All versions passed to the resolver must share one legal source.");

  const sorted = [...versions].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (prev.effectiveTo === null || prev.effectiveTo > sorted[i].effectiveFrom) {
      return ambiguous("OVERLAPPING_VERSIONS", [
        `Versions ${prev.versionLabel} and ${sorted[i].versionLabel} overlap or ${prev.versionLabel} is open-ended before a later version begins.`,
      ]);
    }
  }

  if (date.kind === "UNKNOWN") return ambiguous("UNKNOWN_DATE", ["No case date was provided; version cannot be resolved."]);
  // A malformed case date must fail closed rather than silently compare as a garbage string.
  if (!isIsoDate(date.date)) return ambiguous("INVALID_VERSION_DATA", ["The case date is not a valid ISO date."]);

  const verified = sorted.filter((v) => v.verificationState === "VERIFIED");
  if (!verified.length) return ambiguous("NO_VERIFIED_VERSION", ["No verified version of this legal source exists."]);

  const d = date.date;
  const matches = verified.filter((v) => v.effectiveFrom <= d && (v.effectiveTo === null || d < v.effectiveTo));

  if (matches.length > 1) return ambiguous("MULTIPLE_APPLICABLE_VERSIONS", ["More than one verified version matches this date."], matches);

  if (matches.length === 0) {
    const earliest = verified[0];
    const latest = verified[verified.length - 1];
    if (d < earliest.effectiveFrom)
      return ambiguous("BEFORE_EARLIEST_VERSION", ["The case date precedes the earliest verified version on record."]);
    if (latest.effectiveTo !== null && d >= latest.effectiveTo)
      return ambiguous("AFTER_LAST_CLOSED_VERSION", ["The case date is after the last verified version's effective range, and no open-ended version exists."]);
    return ambiguous("GAP_IN_COVERAGE", ["The case date falls in a gap between verified versions. Do not assume continuity."]);
  }

  const match = matches[0];
  const warnings: string[] = [];
  let outcome: ResolutionOutcome = match.effectiveTo === null ? "RESOLVED_OPEN_ENDED" : "RESOLVED";
  if (date.kind === "APPROXIMATE") {
    outcome = "RESOLVED_APPROXIMATE";
    warnings.push("Case date is approximate; an adjacent version may also apply. Confirm the exact date before relying on this result.");
  }
  return { outcome, version: match, candidates: [match], warnings };
}

// ---------------------------------------------------------------------------
// Legal authority vs. legal conclusion — safe-language enforcement.
// ---------------------------------------------------------------------------

// Mirrors the neutral-attribution intent of pageSources' evidence-language guard, but for
// legal-relevance reasoning: authority identification must never assert a legal conclusion.
// This must apply only to AI/reviewer-authored relevance reasoning, never to immutable quoted
// authority text (a statute or judgment may itself legitimately use these words) — callers must
// never run this against legalSource.title, provision citations, or quoted source material.
const CONCLUSION_LANGUAGE =
  /\bviolat(?:ed|es|ion)\b|\bbroke\s+the\s+law\b|\bunlawful(?:ly)?\b|\bproves?\s+misconduct\b|\bis\s+guilty\b|\bcommitted\s+an?\s+offen[cs]e\b|\bthe\s+court\s+erred\b|\bnegligent(?:ly)?\b|\bliable\b|\bin\s+breach\s+of\b|\bfailed\s+to\s+comply\s+with\b|\bacted\s+contrary\s+to\b/i;

const PERMITTED_FRAMING_HINTS = [
  "potentially relevant",
  "potential legal issue",
  "may engage",
  "authority identified for legal review",
  "further factual/legal review required",
  "further factual and legal review required",
];

export function assertSafeLegalLanguage(text: string): void {
  if (typeof text !== "string" || !text.trim()) throw invalid("Legal-relevance reasoning text is required.");
  if (CONCLUSION_LANGUAGE.test(text)) {
    throw invalid("Legal-relevance reasoning must state potential relevance, not a legal conclusion.");
  }
}

export const REVIEW_STATES = [
  "UNREVIEWED",
  "CONFIRMED_RELEVANT",
  "POSSIBLY_RELEVANT",
  "NOT_RELEVANT",
  "REQUIRES_RESEARCH",
  "SUPERSEDED",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

// Outcomes that mean the resolver could not cleanly pick one version. A mapping built on
// one of these must never present as confidently confirmed.
const AMBIGUOUS_OUTCOMES: ResolutionOutcome[] = [
  "UNKNOWN_DATE",
  "NO_VERIFIED_VERSION",
  "BEFORE_EARLIEST_VERSION",
  "AFTER_LAST_CLOSED_VERSION",
  "GAP_IN_COVERAGE",
  "OVERLAPPING_VERSIONS",
  "MULTIPLE_APPLICABLE_VERSIONS",
  "INVALID_VERSION_DATA",
];

// ---------------------------------------------------------------------------
// Provider-independent legal mapping contract (Stage 5 integration boundary).
// ---------------------------------------------------------------------------

// Mirrors the Stage 4 evidence review-state vocabulary (pageSources.ts REVIEW_STATES) so a
// legal mapping can distinguish "the underlying evidence has been human-reviewed" from
// "this legal mapping has been human-reviewed" — the two must never be conflated.
export const EVIDENCE_REVIEW_STATES = ["UNREVIEWED", "REVIEWED", "CONFIRMED", "DISPUTED", "REQUIRES_SOURCE", "NOT_RELEVANT"] as const;
export type EvidenceReviewState = (typeof EVIDENCE_REVIEW_STATES)[number];
const EVIDENCE_HUMAN_CONFIRMED: EvidenceReviewState[] = ["REVIEWED", "CONFIRMED"];

export interface LegalMappingInput {
  matterId: string;
  evidenceItemId: string; // navigator_evidence_items.id — the only Stage 4 dependency required
  evidenceClassification: string;
  evidenceReviewState: EvidenceReviewState;
  legalSource: LegalSource;
  provision: LegalProvision;
  caseDate: CaseDate;
  potentialIssue: string;
  reasonForRelevance: string;
  associatedEventOrPersonId?: string | null;
}

export interface LegalMappingResult {
  matterId: string;
  evidenceItemIds: string[];
  legalSourceId: string;
  legalSourceVersionId: string | null;
  provisionId: string;
  citation: string;
  potentialIssue: string;
  reasonForRelevance: string;
  // Meaning is deliberately narrow and MUST stay narrow: relevance/match confidence in this
  // authority identification, never a probability that a violation occurred, that the user
  // would win, or that any legal conclusion is correct. Stage 6 M1 never sets this (always
  // null); a future provider must not overload it with conclusion-strength semantics.
  confidence: number | null;
  temporalResolution: ResolutionResult;
  warnings: string[];
  reviewStatus: ReviewState;
  associatedEventOrPersonId: string | null;
}

/**
 * Builds a provider-independent legal mapping candidate. This never calls a model; it only
 * validates and assembles a structurally safe result from already-produced inputs. A future
 * Stage 6 provider (Claude, Gemini, or a rules engine) must produce inputs matching this
 * contract — no speculative Stage 5 table is required.
 */
export function buildLegalMapping(input: LegalMappingInput, versions: LegalSourceVersion[]): LegalMappingResult {
  if (!input || typeof input !== "object") throw invalid("Mapping input is required.");
  requireUuid(input.matterId, "matterId");
  requireUuid(input.evidenceItemId, "evidenceItemId");
  if (typeof input.evidenceClassification !== "string" || !input.evidenceClassification)
    throw invalid("evidenceClassification is required.");
  if (!EVIDENCE_REVIEW_STATES.includes(input.evidenceReviewState)) throw invalid("Unknown evidence review state.");
  if (typeof input.potentialIssue !== "string" || !input.potentialIssue.trim())
    throw invalid("potentialIssue is required.");
  if (input.associatedEventOrPersonId != null) requireUuid(input.associatedEventOrPersonId, "associatedEventOrPersonId");
  assertSafeLegalLanguage(input.reasonForRelevance);

  const source = validateLegalSource(input.legalSource);
  const provision = validateLegalProvision(input.provision);
  if (provision.legalSourceId !== source.id) throw invalid("Provision does not belong to the given legal source.");

  // The underlying evidence being human-reviewed is a separate fact from this mapping being
  // human-reviewed; surfacing it only as a warning (never folded into reviewStatus) keeps the
  // two states from being conflated by a downstream consumer that only reads reviewStatus.
  const evidenceWarning = EVIDENCE_HUMAN_CONFIRMED.includes(input.evidenceReviewState)
    ? []
    : ["Underlying evidence has not itself been human-reviewed/confirmed; this mapping's relevance is unconfirmed independent of that."];

  if (source.verificationState !== "VERIFIED" || provision.verificationState !== "VERIFIED") {
    // Unverified authority can still be surfaced, but never as confirmed relevance.
    const resolution = resolveApplicableVersion(versions, input.caseDate);
    return {
      matterId: input.matterId,
      evidenceItemIds: [input.evidenceItemId],
      legalSourceId: source.id,
      legalSourceVersionId: null,
      provisionId: provision.id,
      citation: `${source.citation} ${provision.citation}`,
      potentialIssue: input.potentialIssue.trim(),
      reasonForRelevance: input.reasonForRelevance.trim(),
      confidence: null,
      temporalResolution: resolution,
      warnings: ["Legal source or provision is not yet verified against the official publisher text.", ...resolution.warnings, ...evidenceWarning],
      reviewStatus: "REQUIRES_RESEARCH",
      associatedEventOrPersonId: input.associatedEventOrPersonId ?? null,
    };
  }

  const resolution = resolveApplicableVersion(versions, input.caseDate);
  const warnings = [...resolution.warnings, ...evidenceWarning];
  let reviewStatus: ReviewState = "UNREVIEWED";
  if (AMBIGUOUS_OUTCOMES.includes(resolution.outcome)) {
    reviewStatus = "REQUIRES_RESEARCH";
    warnings.push("Temporal resolution is ambiguous; a human reviewer must confirm which version, if any, applies.");
  }

  return {
    matterId: input.matterId,
    evidenceItemIds: [input.evidenceItemId],
    legalSourceId: source.id,
    legalSourceVersionId: resolution.version?.id ?? null,
    provisionId: provision.id,
    citation: `${source.citation} ${provision.citation}`,
    potentialIssue: input.potentialIssue.trim(),
    reasonForRelevance: input.reasonForRelevance.trim(),
    confidence: null, // Stage 6 M1 assembles structure only; no provider confidence score yet exists.
    temporalResolution: resolution,
    warnings,
    reviewStatus,
    associatedEventOrPersonId: input.associatedEventOrPersonId ?? null,
  };
}

/** Human/lawyer confirmation transition — the only way a mapping may leave UNREVIEWED/REQUIRES_RESEARCH toward CONFIRMED_RELEVANT. */
export function applyHumanReview(current: ReviewState, next: ReviewState): ReviewState {
  if (!REVIEW_STATES.includes(next)) throw invalid("Unknown review state.");
  if (next === "CONFIRMED_RELEVANT" && current !== "POSSIBLY_RELEVANT" && current !== "UNREVIEWED" && current !== "REQUIRES_RESEARCH") {
    throw invalid("Only an unreviewed, possibly-relevant, or research-flagged mapping may be confirmed relevant.");
  }
  return next;
}
