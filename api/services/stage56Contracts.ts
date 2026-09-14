/**
 * Stage 5 -> Stage 6 Implementation-Neutral Integration Contract
 *
 * Defines the contract shapes and runtime validation rules for consuming
 * Stage 5 Matter-Scoped Evidence Review outputs inside Stage 6 Legal Intelligence.
 *
 * Invariants Enforced:
 * - Matter isolation
 * - Document, Version, Page, Run identity preservation
 * - Source provenance immutability
 * - Review state separation from source provenance
 * - Fact vs Allegation distinction
 * - Legal authority vs Legal conclusion distinction
 * - Source traceability for all legal mappings
 * - Explicit handling of temporal legal version ambiguities
 * - Treatment of uploaded content as untrusted material
 */

export const CONTRACT_VERSION = '1.1.0-stage56-contract-aligned';

export type ClassificationType =
  | 'FACT'
  | 'ALLEGATION'
  | 'OPINION'
  | 'PROFESSIONAL_ASSESSMENT'
  | 'INFERENCE'
  | 'UNVERIFIED_CLAIM'
  | 'UNKNOWN';

export type EvidenceReviewState =
  | 'UNREVIEWED'
  | 'REVIEWED'
  | 'CONFIRMED'
  | 'DISPUTED'
  | 'REQUIRES_SOURCE'
  | 'NOT_RELEVANT';

export type LegalMappingReviewState =
  | 'UNREVIEWED'
  | 'CONFIRMED_RELEVANT'
  | 'POSSIBLY_RELEVANT'
  | 'NOT_RELEVANT'
  | 'REQUIRES_RESEARCH'
  | 'SUPERSEDED';

export type ReviewState = EvidenceReviewState;

export type LegalAuthorityType =
  | 'STATUTE_SECTION'
  | 'REGULATION'
  | 'CASE_LAW_PRECEDENT'
  | 'POLICY_GUIDELINE'
  | 'PRACTICE_DIRECTION';

export type LegalVersionAmbiguityReason =
  | 'MULTIPLE_HISTORICAL_VERSIONS_APPLY'
  | 'AMBIGUOUS_FACT_DATE'
  | 'TRANSITIONAL_PROVISION_UNRESOLVED'
  | 'PROVINCIAL_AMENDMENT_PENDING'
  | 'EXPLICIT_SOURCE_DATE_MISSING';

/**
 * Immutable source provenance pointing to physical evidence item & source document page.
 * Note: exactQuote and quote offsets belong to navigator_evidence_items in Stage 4 schema.
 */
export interface SourceProvenance {
  readonly matterId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly extractionRunId: string;
  readonly exactQuote: string;
  readonly quoteStartOffset: number | null;
  readonly quoteEndOffset: number | null;
  readonly quoteVerification: 'EXACT' | 'NORMALIZED_WHITESPACE' | 'AMBIGUOUS' | 'ABSENT';
}

/**
 * Matter-scoped evidence item prior to human review or analysis
 */
export interface MatterEvidenceReference {
  readonly id: string;
  readonly matterId: string;
  readonly provenance: SourceProvenance;
  readonly normalizedStatement: string;
  readonly classification: ClassificationType;
  readonly createdAt: string;
}

/**
 * Human-reviewed evidence reference with explicit separation between source & review status
 */
export interface ReviewedEvidenceReference {
  readonly evidenceId: string;
  readonly matterId: string;
  readonly provenance: SourceProvenance; // Immutable source provenance
  readonly originalClassification: ClassificationType;
  readonly reviewState: EvidenceReviewState;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewerNotes: string | null;
  readonly isConfirmedFact: boolean; // True ONLY if reviewState is CONFIRMED and classification was verified
}

/**
 * Relevant date with precision and explicit ambiguity tracking
 */
export interface RelevantDate {
  readonly rawText: string;
  readonly isoDate: string | null; // YYYY-MM-DD or null if ambiguous
  readonly precision: 'EXACT_DAY' | 'MONTH_YEAR' | 'YEAR_ONLY' | 'APPROXIMATE' | 'UNKNOWN';
  readonly isAmbiguous: boolean;
  readonly ambiguityNotes: string | null;
}

/**
 * Candidate legal issue spotted from evidence, requiring source-traceable mapping
 */
export interface PotentialIssueReference {
  readonly issueId: string;
  readonly matterId: string;
  readonly issueCategory: string; // e.g. 'BEST_INTERESTS_OF_CHILD', 'LESS_DISRUPTIVE_ALTERNATIVES'
  readonly supportingEvidenceIds: readonly string[];
  readonly relevantDates: readonly RelevantDate[];
  readonly summaryStatement: string;
}

/**
 * Candidate legal authority (statute section, regulation, precedent) matched to an issue
 */
export interface LegalAuthorityCandidate {
  readonly authorityId: string;
  readonly authorityType: LegalAuthorityType;
  readonly citation: string; // e.g. 'CYFSA 2017, S.O. 2017, c. 14, Sched. 1, s. 74(2)'
  readonly title: string;
  readonly sectionNumber: string | null;
  readonly inEffectDate: string; // ISO Date YYYY-MM-DD
  readonly repealedDate: string | null;
  readonly isCurrentLaw: boolean;
  readonly ambiguityReason: LegalVersionAmbiguityReason | null;
}

/**
 * Final mapping of evidence to legal authority with review status & provenance check
 */
export interface LegalMappingReview {
  readonly mappingId: string;
  readonly matterId: string;
  readonly issueReference: PotentialIssueReference;
  readonly authorityCandidate: LegalAuthorityCandidate;
  readonly mappedEvidenceReferences: readonly ReviewedEvidenceReference[];
  readonly legalConclusionType: 'CANDIDATE_ISSUE' | 'SUPPORTED_ARGUMENT' | 'REBUTTED_CLAIM' | 'UNRESOLVED_AMBIGUITY';
  readonly reviewState: LegalMappingReviewState;
  readonly isDefinitiveConclusion: false; // Invariant: AI/System mappings are NEVER definitive legal findings
  readonly generatedAt: string;
}

/**
 * Validation result for cross-stage contract compliance
 */
export interface ContractValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates that a SourceProvenance structure satisfies immutability and provenance invariants.
 */
export function validateSourceProvenance(prov: unknown): ContractValidationResult {
  const errors: string[] = [];
  if (!prov || typeof prov !== 'object') {
    return { isValid: false, errors: ['Provenance must be a non-null object'] };
  }
  const p = prov as Record<string, unknown>;

  if (typeof p.matterId !== 'string' || !p.matterId.trim()) errors.push('matterId is required');
  if (typeof p.documentId !== 'string' || !p.documentId.trim()) errors.push('documentId is required');
  if (typeof p.documentVersionId !== 'string' || !p.documentVersionId.trim()) errors.push('documentVersionId is required');
  if (typeof p.pageId !== 'string' || !p.pageId.trim()) errors.push('pageId is required');
  if (typeof p.extractionRunId !== 'string' || !p.extractionRunId.trim()) errors.push('extractionRunId is required');
  if (typeof p.pageNumber !== 'number' || p.pageNumber < 1) errors.push('pageNumber must be a positive integer');
  if (typeof p.exactQuote !== 'string') errors.push('exactQuote is required');

  const validVerifications = ['EXACT', 'NORMALIZED_WHITESPACE', 'AMBIGUOUS', 'ABSENT'];
  if (typeof p.quoteVerification !== 'string' || !validVerifications.includes(p.quoteVerification)) {
    errors.push(`quoteVerification must be one of: ${validVerifications.join(', ')}`);
  }

  if (p.quoteVerification === 'EXACT' || p.quoteVerification === 'NORMALIZED_WHITESPACE') {
    if (typeof p.quoteStartOffset !== 'number' || p.quoteStartOffset < 0) errors.push('quoteStartOffset must be >= 0 for verified quotes');
    if (typeof p.quoteEndOffset !== 'number' || p.quoteEndOffset === null || (p.quoteStartOffset !== null && p.quoteEndOffset <= (p.quoteStartOffset as number))) {
      errors.push('quoteEndOffset must be greater than quoteStartOffset for verified quotes');
    }
  } else {
    if (p.quoteStartOffset !== null || p.quoteEndOffset !== null) {
      errors.push('Unverified/ambiguous quotes must have null offsets');
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validates that an evidence item never promotes an ALLEGATION to FACT.
 */
export function validateFactPromotionInvariant(
  originalClassification: ClassificationType,
  reviewState: ReviewState,
  isConfirmedFact: boolean
): ContractValidationResult {
  const errors: string[] = [];
  if (originalClassification === 'ALLEGATION' && isConfirmedFact) {
    errors.push('INVARIANT VIOLATION: Allegation cannot be promoted to confirmed fact automatically or without factual verification');
  }
  if (reviewState === 'UNREVIEWED' && isConfirmedFact) {
    errors.push('INVARIANT VIOLATION: Unreviewed evidence cannot be treated as confirmed fact');
  }
  return { isValid: errors.length === 0, errors };
}

/**
 * Validates that a LegalMappingReview contains complete source provenance and no prohibited definitive conclusions.
 */
export function validateLegalMappingContract(mapping: unknown): ContractValidationResult {
  const errors: string[] = [];
  if (!mapping || typeof mapping !== 'object') {
    return { isValid: false, errors: ['Legal mapping must be an object'] };
  }
  const m = mapping as Record<string, unknown>;

  if (typeof m.matterId !== 'string' || !m.matterId.trim()) errors.push('matterId is required');

  if (m.isDefinitiveConclusion === true) {
    errors.push('INVARIANT VIOLATION: Legal mappings must never be marked as definitive conclusions (must be lawyer-reviewable candidates)');
  }

  if (!Array.isArray(m.mappedEvidenceReferences) || m.mappedEvidenceReferences.length === 0) {
    errors.push('INVARIANT VIOLATION: Legal mapping cannot exist without supporting evidence references');
  } else {
    for (let i = 0; i < m.mappedEvidenceReferences.length; i++) {
      const ref = m.mappedEvidenceReferences[i];
      if (!ref || typeof ref !== 'object') {
        errors.push(`Evidence reference at index ${i} is invalid`);
        continue;
      }
      const refObj = ref as Record<string, unknown>;
      if (refObj.matterId !== m.matterId) {
        errors.push(`INVARIANT VIOLATION: Evidence reference matterId (${refObj.matterId}) does not match mapping matterId (${m.matterId})`);
      }
      const provRes = validateSourceProvenance(refObj.provenance);
      if (!provRes.isValid) {
        errors.push(`Evidence reference at index ${i} has invalid provenance: ${provRes.errors.join('; ')}`);
      }
    }
  }

  const candidate = m.authorityCandidate as Record<string, unknown> | undefined;
  if (!candidate || typeof candidate !== 'object') {
    errors.push('authorityCandidate is required');
  } else {
    if (candidate.isCurrentLaw === false && !candidate.ambiguityReason) {
      errors.push('INVARIANT VIOLATION: Historical/repealed legal authority must specify an ambiguityReason');
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validates unsafe definitive legal language in generated text outputs.
 */
export function validateLegalLanguageSafety(text: string): ContractValidationResult {
  const errors: string[] = [];
  const prohibitedPatterns = [
    /\bthis proves that the parent lied\b/i,
    /\bthe CAS has proven child abuse\b/i,
    /\bthe court has definitively held that\b/i,
    /\bthis is a clear violation of law\b/i,
    /\bguilty of child neglect\b/i,
  ];

  for (const pattern of prohibitedPatterns) {
    if (pattern.test(text)) {
      errors.push(`PROHIBITED DEFINITIVE LANGUAGE DETECTED: Match for pattern ${pattern.source}`);
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validates that client-supplied matterId is never trusted over server-authenticated matter scope
 * or persisted evidence item matter_id.
 */
export function validateMatterAuthorizationBoundary(
  clientMatterId: string,
  serverAuthorizedMatterId: string,
  evidenceItemMatterId: string
): ContractValidationResult {
  const errors: string[] = [];
  if (clientMatterId !== serverAuthorizedMatterId) {
    errors.push('INVARIANT VIOLATION: Client-supplied matterId does not match server-authorized matter session');
  }
  if (evidenceItemMatterId !== serverAuthorizedMatterId) {
    errors.push('INVARIANT VIOLATION: Evidence item matter_id does not match server-authorized matter session');
  }
  return { isValid: errors.length === 0, errors };
}
