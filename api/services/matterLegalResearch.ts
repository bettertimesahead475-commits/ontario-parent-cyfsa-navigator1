import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { 
  type CaseDate, 
  type ReviewState,
  assertSafeLegalLanguage
} from './legalAuthority.js';
import { getAuthorityCitation, getSourceVersion, resolveVersionForDate, computeLegalContentHash, verifyLegalContentIntegrity } from './legalSources.js';
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
  /**
   * A legal_source_version id independently pre-resolved and verified by a TRUSTED server-side
   * caller only (e.g. Stage 9D-2a discovery, which resolves it directly from the canonical
   * navigator_legal_source_versions / navigator_legal_provision_versions chain before ever
   * calling this function). Never sourced from an HTTP request body, ranking metadata, or any
   * other caller-controlled input. This function NEVER trusts it blindly: it is only used when
   * no eventId-based date resolution already produced a version, and it is independently
   * re-verified here (existence, source match, VERIFIED state) exactly as the eventId path is.
   */
  serverResolvedVersionId?: string | null;
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
  let evidenceClassification: string | null = null;
  if (evidenceItemId) {
    const { data: evidence, error: evidenceError } = await db
      .from('navigator_evidence_items')
      .select('classification')
      .eq('id', evidenceItemId)
      .eq('matter_id', matterId)
      .single();
    if (evidenceError || !evidence || !EVIDENCE_CLASSIFICATIONS.includes(evidence.classification as never)) {
      throw notFound('Evidence item not found in this matter.');
    }
    evidenceClassification = evidence.classification;
    if (input.evidenceClassification && input.evidenceClassification !== evidenceClassification) {
      throw invalid('Caller evidence classification does not match the persisted evidence item.');
    }
  } else if (input.evidenceClassification) {
    throw invalid('Evidence classification requires a persisted evidence item.');
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

  // No event date was available to resolve a version (discovery has no single event to date
  // against). Only a trusted server-side caller's already-verified version identity is accepted
  // here -- and even then it is independently re-verified against Stage 9A, never trusted as-is.
  if (!resolvedVersionId && input.serverResolvedVersionId) {
    const serverResolvedVersionId = requireUuid(input.serverResolvedVersionId, 'serverResolvedVersionId');
    const version = await getSourceVersion(serverResolvedVersionId);
    if (version.legalSourceId !== legalSourceId) {
      throw invalid('Server-resolved version does not belong to the specified legal source.');
    }
    if (version.verificationState !== 'VERIFIED') {
      throw invalid('Server-resolved version is not verified.');
    }
    resolvedVersionId = version.id;
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
  if (finalVersionId && provisionId) {
    const { data: provVersion, error: provError } = await db
      .from('navigator_legal_provision_versions')
      .select('text_sha256, exact_text')
      .eq('provision_id', provisionId)
      .eq('legal_source_version_id', finalVersionId)
      .maybeSingle();
    if (provError) throw new LifecycleError(500, 'DB_ERROR', 'Could not verify legal content.');
    if (provVersion?.text_sha256 && provVersion.exact_text) {
      try {
        verifyLegalContentIntegrity(provVersion.exact_text, provVersion.text_sha256);
        integrityStatus = 'VERIFIED';
      } catch {
        integrityStatus = 'FAILED';
      }
    }
    if (input.actualContent) {
      if (!provVersion?.text_sha256) integrityStatus = 'UNVERIFIED';
      else {
        try {
          verifyLegalContentIntegrity(input.actualContent, provVersion.text_sha256);
          if (integrityStatus === 'NOT_CHECKED') integrityStatus = 'VERIFIED';
        } catch {
          integrityStatus = 'FAILED';
        }
      }
    }
  } else if (input.actualContent) {
    integrityStatus = 'UNVERIFIED';
  }

  return {
    matterId,
    evidenceItemId,
    eventId,
    evidenceClassification,
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
  if (!candidate || typeof candidate !== 'object') throw invalid('Candidate is required.');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, candidate.matterId);

  // Rebuild from persisted evidence, event and authority records. A caller-provided
  // candidate is only an assertion; it cannot attest to its own provenance or integrity.
  const canonical = await buildMatterLegalResearchCandidate(firebaseUid, {
    matterId: candidate.matterId,
    evidenceItemId: candidate.evidenceItemId,
    eventId: candidate.eventId,
    evidenceClassification: candidate.evidenceClassification,
    legalSourceId: candidate.legalSourceId,
    legalSourceVersionId: candidate.legalSourceVersionId,
    provisionId: candidate.provisionId,
    authorityIdentifier: candidate.authorityIdentifier,
    reasonForRelevance: candidate.reasonForRelevance,
    retrievalBasis: candidate.retrievalBasis,
    confidence: candidate.confidence,
    // Re-derivation must be able to reproduce a version resolved via the trusted
    // server-resolved path (e.g. Stage 9D-2a discovery), not only via eventId date resolution.
    // This is independently re-verified inside buildMatterLegalResearchCandidate again -- never
    // taken on faith from the candidate object itself.
    serverResolvedVersionId: candidate.legalSourceVersionId
  });
  if (canonical.contentIntegrityStatus === 'FAILED' || candidate.contentIntegrityStatus !== canonical.contentIntegrityStatus ||
      candidate.evidenceClassification !== canonical.evidenceClassification ||
      candidate.legalSourceVersionId !== canonical.legalSourceVersionId ||
      candidate.sourceProvenance !== canonical.sourceProvenance ||
      candidate.effectiveDateContext !== canonical.effectiveDateContext ||
      candidate.retrievedAt !== canonical.retrievedAt) {
    throw invalid('Candidate does not match server-verified evidence or legal authority.');
  }

  const idempotenceKey = [
    canonical.matterId,
    canonical.evidenceItemId || '00000000-0000-0000-0000-000000000000',
    canonical.eventId || '00000000-0000-0000-0000-000000000000',
    canonical.legalSourceId,
    canonical.provisionId || '00000000-0000-0000-0000-000000000000',
    canonical.retrievalBasis
  ].join('|');

  // Using upsert on the uniqueness constraint to ensure idempotence
  const { data, error } = await db.from('navigator_matter_legal_research_candidates').upsert({
    matter_id: canonical.matterId,
    evidence_item_id: canonical.evidenceItemId,
    event_id: canonical.eventId,
    evidence_classification: canonical.evidenceClassification,
    legal_source_id: canonical.legalSourceId,
    legal_source_version_id: canonical.legalSourceVersionId,
    provision_id: canonical.provisionId,
    authority_identifier: canonical.authorityIdentifier,
    reason_for_relevance: canonical.reasonForRelevance,
    retrieval_basis: canonical.retrievalBasis,
    effective_date_context: canonical.effectiveDateContext,
    source_provenance: canonical.sourceProvenance,
    confidence: canonical.confidence,
    content_integrity_status: canonical.contentIntegrityStatus,
    idempotence_key: idempotenceKey,
    retrieved_at: canonical.retrievedAt
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
