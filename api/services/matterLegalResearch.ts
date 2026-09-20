import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { 
  type CaseDate, 
  type ReviewState,
  assertSafeLegalLanguage
} from './legalAuthority.js';
import { getAuthorityCitation, resolveVersionForDate, computeLegalContentHash, verifyLegalContentIntegrity } from './legalSources.js';
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
  eventId: string | null;
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
  contentIntegrityStatus: IntegrityStatus;
  createdAt: string;
  retrievedAt: string;
}

export interface ResearchCandidateInput {
  matterId: string;
  evidenceItemId?: string | null;
  eventId?: string | null;
  evidenceClassification?: string | null;
  legalSourceId: string;
  provisionId?: string | null;
  authorityIdentifier?: string | null;
  reasonForRelevance: string;
  retrievalBasis: string;
  confidence?: number | null;
  actualContent?: string | null;
  legalSourceVersionId?: string | null; // retained for compatibility, used as assertion hint
}

export async function buildMatterLegalResearchCandidate(
  firebaseUid: string,
  input: ResearchCandidateInput
): Promise<Omit<MatterLegalResearchCandidate, 'id' | 'createdAt'>> {
  if (!input || typeof input !== 'object') throw invalid("Input must be an object.");
  
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const matterId = requireUuid(input.matterId, "matterId");
  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const evidenceItemId = input.evidenceItemId ? requireUuid(input.evidenceItemId, "evidenceItemId") : null;
  const eventId = input.eventId ? requireUuid(input.eventId, "eventId") : null;
  const legalSourceId = requireUuid(input.legalSourceId, "legalSourceId");
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

  // 1. Resolve Authoritative Version
  let resolvedVersionId: string | null = null;
  
  if (eventId) {
    const { data: event, error: eventError } = await db
      .from('navigator_events')
      .select('date_lower_bound, date_upper_bound, date_precision')
      .eq('id', eventId)
      .eq('matter_id', matterId)
      .single();
      
    if (eventError || !event) {
      throw new LifecycleError(404, 'NOT_FOUND', 'Event not found or access denied');
    }
    
    if (event.date_precision === 'UNKNOWN' || (!event.date_lower_bound && !event.date_upper_bound)) {
      throw new LifecycleError(400, 'REQUIRES_RESEARCH', 'Event date is unknown. Cannot resolve legal version.');
    }

    const isExact = ['EXACT_DATETIME', 'EXACT_DATE'].includes(event.date_precision);
    
    if (isExact && event.date_lower_bound) {
      const caseDate: CaseDate = { kind: 'EXACT', date: event.date_lower_bound };
      const res = await resolveVersionForDate(legalSourceId, caseDate);
      if (res.outcome.startsWith('RESOLVED') && res.version) {
        resolvedVersionId = res.version.id;
      } else {
        throw new LifecycleError(400, 'REQUIRES_RESEARCH', 'Event date does not unambiguously resolve to a legal version.');
      }
    } else {
      const lowerDate = event.date_lower_bound;
      const upperDate = event.date_upper_bound;

      if (!lowerDate || !upperDate) {
        throw new LifecycleError(400, 'REQUIRES_RESEARCH', 'Unbounded date ranges cannot unambiguously resolve to a legal version.');
      }

      const lowerRes = await resolveVersionForDate(legalSourceId, { kind: 'APPROXIMATE', date: lowerDate });
      const upperRes = await resolveVersionForDate(legalSourceId, { kind: 'APPROXIMATE', date: upperDate });

      const lowerVersionId = lowerRes.outcome.startsWith('RESOLVED') && lowerRes.version ? lowerRes.version.id : null;
      const upperVersionId = upperRes.outcome.startsWith('RESOLVED') && upperRes.version ? upperRes.version.id : null;

      if (lowerVersionId && upperVersionId && lowerVersionId === upperVersionId) {
        resolvedVersionId = lowerVersionId;
      } else {
        throw new LifecycleError(400, 'REQUIRES_RESEARCH', 'Event date range crosses legal version boundaries or is ambiguous.');
      }
    }
  }
  
  // Caller-supplied version is strictly a hint/assertion
  if (input.legalSourceVersionId && resolvedVersionId && input.legalSourceVersionId !== resolvedVersionId) {
    throw invalid('Caller-supplied version ID does not match authoritative resolution.');
  }

  const finalVersionId = resolvedVersionId;

  // 2. Fetch Citation and verify provision-version integrity
  // Stage 9A's getAuthorityCitation validates the provision belongs to the version
  const citation = await getAuthorityCitation(
    legalSourceId,
    finalVersionId || undefined,
    provisionId || undefined,
    input.authorityIdentifier || undefined
  );

  // 3. Verify Content Integrity
  let integrityStatus: IntegrityStatus = "NOT_CHECKED";
  
  if (input.actualContent) {
    integrityStatus = "UNVERIFIED";
    
    // Fetch authoritative expected hash
    if (finalVersionId && provisionId) {
      const { data: provVersion, error: provError } = await db
        .from('navigator_legal_provision_versions')
        .select('text_sha256')
        .eq('provision_id', provisionId)
        .eq('legal_source_version_id', finalVersionId)
        .maybeSingle();
        
      if (!provError && provVersion && provVersion.text_sha256) {
        try {
          verifyLegalContentIntegrity(input.actualContent, provVersion.text_sha256);
          integrityStatus = "VERIFIED";
        } catch (e: any) {
          integrityStatus = "FAILED";
        }
      }
    }
  }

  return {
    matterId,
    evidenceItemId,
    eventId,
    evidenceClassification: input.evidenceClassification || null,
    legalSourceId,
    legalSourceVersionId: finalVersionId,
    provisionId,
    authorityIdentifier: input.authorityIdentifier || null,
    reasonForRelevance: input.reasonForRelevance.trim(),
    retrievalBasis: input.retrievalBasis.trim(),
    effectiveDateContext: citation.effectiveDateContext || null,
    sourceProvenance: citation.sourceUrl,
    confidence: input.confidence ?? null,
    contentIntegrityStatus: integrityStatus,
    retrievedAt: citation.retrievedAt
  };
}

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

  const idempotenceKey = [
    candidate.matterId,
    candidate.evidenceItemId || '00000000-0000-0000-0000-000000000000',
    candidate.eventId || '00000000-0000-0000-0000-000000000000',
    candidate.legalSourceId,
    candidate.provisionId || '00000000-0000-0000-0000-000000000000',
    candidate.retrievalBasis
  ].join('|');

  // Using upsert on the uniqueness constraint to ensure idempotence
  const { data, error } = await db.from('navigator_matter_legal_research_candidates').upsert({
    matter_id: candidate.matterId,
    evidence_item_id: candidate.evidenceItemId,
    event_id: candidate.eventId,
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
    content_integrity_status: candidate.contentIntegrityStatus,
    idempotence_key: idempotenceKey,
    retrieved_at: candidate.retrievedAt
  }, { 
    onConflict: 'idempotence_key'
  }).select().single();

  if (error || !data) {
     throw new LifecycleError(500, 'DB_ERROR', 'Failed to save candidate (Idempotence/Write check failed)');
  }

  return {
    id: data.id,
    matterId: data.matter_id,
    evidenceItemId: data.evidence_item_id,
    eventId: data.event_id,
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
    eventId: row.event_id,
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
    contentIntegrityStatus: row.content_integrity_status,
    createdAt: row.created_at,
    retrievedAt: row.retrieved_at
  }));
}
