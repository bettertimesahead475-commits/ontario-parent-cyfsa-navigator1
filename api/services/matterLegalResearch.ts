import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { 
  type CaseDate, 
  type ReviewState,
  assertSafeLegalLanguage
} from './legalAuthority.js';
import { getAuthorityCitation, verifyLegalContentIntegrity } from './legalSources.js';
import { EVIDENCE_CLASSIFICATIONS } from '../../shared/evidenceReview.js';
import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';

const invalid = (message: string) => new LifecycleError(400, "INVALID_RESEARCH_INPUT", message);
const notFound = (message: string) => new LifecycleError(404, "NOT_FOUND", message);

export type IntegrityStatus = "VERIFIED" | "UNVERIFIED" | "FAILED" | "NOT_CHECKED";

export interface MatterLegalResearchCandidate {
  id: string;
  matterId: string;
  evidenceItemId: string | null;
  evidenceClassification: string | null;
  legalSourceId: string;
  legalSourceVersionId: string | null;
  provisionId: string | null;
  authorityIdentifier: string | null;
  reasonForRelevance: string;
  retrievalBasis: string;
  effectiveDateContext: string | null;
  sourceProvenance: string;
  confidence: number | null;
  reviewState: ReviewState;
  contentIntegrityStatus: IntegrityStatus;
  createdAt: string;
  retrievedAt: string;
}

export interface ResearchCandidateInput {
  matterId: string;
  evidenceItemId?: string | null;
  evidenceClassification?: string | null;
  legalSourceId: string;
  legalSourceVersionId?: string | null;
  provisionId?: string | null;
  authorityIdentifier?: string | null;
  reasonForRelevance: string;
  retrievalBasis: string;
  confidence?: number | null;
  expectedContentHash?: string | null;
  actualContent?: string | null;
}

export async function buildMatterLegalResearchCandidate(
  input: ResearchCandidateInput
): Promise<Omit<MatterLegalResearchCandidate, 'id' | 'createdAt'>> {
  if (!input || typeof input !== 'object') throw invalid("Input must be an object.");
  const matterId = requireUuid(input.matterId, "matterId");
  const evidenceItemId = input.evidenceItemId ? requireUuid(input.evidenceItemId, "evidenceItemId") : null;
  const legalSourceId = requireUuid(input.legalSourceId, "legalSourceId");
  const legalSourceVersionId = input.legalSourceVersionId ? requireUuid(input.legalSourceVersionId, "legalSourceVersionId") : null;
  const provisionId = input.provisionId ? requireUuid(input.provisionId, "provisionId") : null;
  
  if (input.evidenceClassification && !EVIDENCE_CLASSIFICATIONS.includes(input.evidenceClassification as never)) {
    throw invalid("Invalid evidence classification. Must be a valid Stage 5 classification.");
  }
  
  if (typeof input.reasonForRelevance !== 'string' || !input.reasonForRelevance.trim()) {
    throw invalid("Reason for relevance is required.");
  }
  assertSafeLegalLanguage(input.reasonForRelevance);

  if (typeof input.retrievalBasis !== 'string' || !input.retrievalBasis.trim()) {
    throw invalid("Retrieval basis is required.");
  }
  
  if (input.confidence !== undefined && input.confidence !== null && (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1)) {
    throw invalid("Confidence must be a number between 0 and 1.");
  }

  const citation = await getAuthorityCitation(
    legalSourceId,
    legalSourceVersionId || undefined,
    provisionId || undefined,
    input.authorityIdentifier || undefined
  );

  let integrityStatus: IntegrityStatus = "NOT_CHECKED";
  let reviewState: ReviewState = "UNREVIEWED";

  if (input.expectedContentHash && input.actualContent) {
    try {
      verifyLegalContentIntegrity(input.actualContent, input.expectedContentHash);
      integrityStatus = "VERIFIED";
    } catch (e: any) {
      integrityStatus = "FAILED";
      reviewState = "REQUIRES_RESEARCH";
    }
  } else if (input.expectedContentHash && !input.actualContent) {
     integrityStatus = "UNVERIFIED";
     reviewState = "REQUIRES_RESEARCH";
  } else if (input.actualContent && !input.expectedContentHash) {
     integrityStatus = "UNVERIFIED";
     reviewState = "REQUIRES_RESEARCH";
  }

  if (!legalSourceVersionId) {
     reviewState = "REQUIRES_RESEARCH";
  }

  return {
    matterId,
    evidenceItemId,
    evidenceClassification: input.evidenceClassification || null,
    legalSourceId,
    legalSourceVersionId,
    provisionId,
    authorityIdentifier: input.authorityIdentifier || null,
    reasonForRelevance: input.reasonForRelevance.trim(),
    retrievalBasis: input.retrievalBasis.trim(),
    effectiveDateContext: citation.effectiveDateContext || null,
    sourceProvenance: citation.sourceUrl,
    confidence: input.confidence ?? null,
    reviewState,
    contentIntegrityStatus: integrityStatus,
    retrievedAt: citation.retrievedAt
  };
}

/** 
 * Verify caller is a member (Owner/Viewer/Reviewer) of this matter.
 * This explicitly rejects unauthorized callers across unrelated matters.
 */
async function requireMatterAccess(db: any, accountId: string, matterId: string) {
  const { data: member, error } = await db
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', requireUuid(matterId, 'matterId'))
    .eq('account_id', accountId)
    .single();

  if (error || !member) throw new LifecycleError(403, 'UNAUTHORIZED', 'Access denied to this matter.');
  return member;
}

export async function saveMatterLegalResearchCandidate(
  firebaseUid: string,
  candidate: Omit<MatterLegalResearchCandidate, 'id' | 'createdAt'>
): Promise<MatterLegalResearchCandidate> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, candidate.matterId);

  const { data, error } = await db.from('navigator_matter_legal_research_candidates').insert({
    matter_id: candidate.matterId,
    evidence_item_id: candidate.evidenceItemId,
    evidence_classification: candidate.evidenceClassification,
    legal_source_id: candidate.legalSourceId,
    legal_source_version_id: candidate.legalSourceVersionId,
    provision_id: candidate.provisionId,
    authority_identifier: candidate.authorityIdentifier,
    reason_for_relevance: candidate.reasonForRelevance,
    retrieval_basis: candidate.retrievalBasis,
    effective_date_context: candidate.effectiveDateContext,
    source_provenance: candidate.sourceProvenance,
    confidence: candidate.confidence,
    review_state: candidate.reviewState,
    content_integrity_status: candidate.contentIntegrityStatus,
    retrieved_at: candidate.retrievedAt
  }).select().single();

  if (error || !data) throw new LifecycleError(500, 'DB_ERROR', 'Failed to save candidate');

  return {
    id: data.id,
    matterId: data.matter_id,
    evidenceItemId: data.evidence_item_id,
    evidenceClassification: data.evidence_classification,
    legalSourceId: data.legal_source_id,
    legalSourceVersionId: data.legal_source_version_id,
    provisionId: data.provision_id,
    authorityIdentifier: data.authority_identifier,
    reasonForRelevance: data.reason_for_relevance,
    retrievalBasis: data.retrieval_basis,
    effectiveDateContext: data.effective_date_context,
    sourceProvenance: data.source_provenance,
    confidence: data.confidence,
    reviewState: data.review_state,
    contentIntegrityStatus: data.content_integrity_status,
    createdAt: data.created_at,
    retrievedAt: data.retrieved_at
  };
}

export async function listMatterLegalResearchCandidates(
  firebaseUid: string,
  matterId: string
): Promise<MatterLegalResearchCandidate[]> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const { data, error } = await db
    .from('navigator_matter_legal_research_candidates')
    .select('*')
    .eq('matter_id', matterId);

  if (error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to list candidates');

  return (data || []).map((row: any) => ({
    id: row.id,
    matterId: row.matter_id,
    evidenceItemId: row.evidence_item_id,
    evidenceClassification: row.evidence_classification,
    legalSourceId: row.legal_source_id,
    legalSourceVersionId: row.legal_source_version_id,
    provisionId: row.provision_id,
    authorityIdentifier: row.authority_identifier,
    reasonForRelevance: row.reason_for_relevance,
    retrievalBasis: row.retrieval_basis,
    effectiveDateContext: row.effective_date_context,
    sourceProvenance: row.source_provenance,
    confidence: row.confidence,
    reviewState: row.review_state,
    contentIntegrityStatus: row.content_integrity_status,
    createdAt: row.created_at,
    retrievedAt: row.retrieved_at
  }));
}
