import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { requireProfessionalAccess } from './professionalWorkspace.js';

export async function generateCaseBrief(firebaseUid: string, matterId: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  // Fetch all necessary data
  const [
    { data: matters },
    { data: entities },
    { data: events },
    { data: evidence },
    { data: claims },
    { data: relationships },
    { data: gaps },
    { data: legal },
    { data: reviews }
  ] = await Promise.all([
    db.from('navigator_matters').select('*').eq('id', matterId).maybeSingle(),
    db.from('navigator_entities').select('*').eq('matter_id', matterId),
    db.from('navigator_events').select('*').eq('matter_id', matterId).order('date_lower_bound', { ascending: true }),
    db.from('navigator_evidence_items').select('*').eq('matter_id', matterId),
    db.from('navigator_claims').select('*').eq('matter_id', matterId),
    db.from('navigator_claim_relationships').select('*').eq('matter_id', matterId),
    db.from('navigator_evidence_gap_findings').select('*').eq('matter_id', matterId),
    db.from('navigator_case_intelligence_snapshots').select('*').eq('matter_id', matterId),
    db.from('professional_reviews').select('*').eq('matter_id', matterId)
  ]);

  const timestamp = new Date().toISOString();

  // Structure the Work Product
  const caseBrief = {
    id: `brief-${matterId}-${Date.now()}`,
    matterId,
    type: 'CASE_BRIEF',
    title: `Case Brief: ${matters?.title || 'Unknown Matter'}`,
    status: 'GENERATED',
    createdBy: account.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceSnapshot: {
      generatedAt: timestamp,
      matterId
    },
    sections: {
      matterOverview: {
        title: matters?.title || 'No Title',
        createdAt: matters?.created_at
      },
      keyPeopleAndOrganizations: (entities || []).map((e: any) => ({
        id: e.id,
        type: e.entity_type,
        name: e.display_name,
        reviewState: e.review_state,
        provenance: { matterId, canonicalId: e.id, type: 'ENTITY' }
      })),
      proceduralChronology: (events || []).map((e: any) => ({
        id: e.id,
        description: e.description,
        dateText: e.date_original_text,
        datePrecision: e.date_precision,
        dateLowerBound: e.date_lower_bound,
        dateUpperBound: e.date_upper_bound,
        reviewState: e.review_state,
        provenance: { matterId, canonicalId: e.id, type: 'EVENT' }
      })),
      materialEvidence: (evidence || []).map((e: any) => ({
        id: e.id,
        content: e.normalized_statement,
        exactQuote: (e.quote_verification === 'EXACT' || e.quote_verification === 'NORMALIZED_WHITESPACE') ? e.exact_quote : null,
        classification: e.classification || 'UNKNOWN',
        sourceDocumentId: e.document_id || null,
        sourceVersionId: e.document_version_id || null,
        pageNumber: e.page_number || null,
        reviewState: e.review_state,
        provenance: { 
          matterId, 
          canonicalId: e.id, 
          type: 'EVIDENCE', 
          sourceDocumentId: e.document_id || null, 
          sourceVersionId: e.document_version_id || null, 
          pageNumber: e.page_number || null 
        }
      })),
      materialClaims: (claims || []).map((c: any) => ({
        id: c.id,
        claimText: c.claim_text,
        classification: c.classification || 'UNVERIFIED_CLAIM',
        reviewState: c.review_state,
        provenance: { matterId, canonicalId: c.id, type: 'CLAIM' }
      })),
      corroborationRelationships: (relationships || []).filter((r: any) => r.relationship_type === 'CORROBORATION' || r.relationship_type === 'SUPPORT').map((r: any) => ({
        id: r.id,
        sourceClaimId: r.source_claim_id,
        targetClaimId: r.target_claim_id,
        relationshipType: r.relationship_type,
        provenance: { matterId, canonicalId: r.id, type: 'RELATIONSHIP' }
      })),
      potentialInconsistencies: (relationships || []).filter((r: any) => r.relationship_type === 'CONTRADICTION' || r.relationship_type === 'INCONSISTENCY').map((r: any) => ({
        id: r.id,
        sourceClaimId: r.source_claim_id,
        targetClaimId: r.target_claim_id,
        relationshipType: r.relationship_type,
        neutralDescription: 'Potential inconsistency requiring review.',
        provenance: { matterId, canonicalId: r.id, type: 'RELATIONSHIP' }
      })),
      evidenceGaps: (gaps || []).map((g: any) => ({
        id: g.id,
        gapType: g.gap_type,
        description: g.description,
        provenance: { matterId, canonicalId: g.id, type: 'GAP' }
      })),
      potentialLegalRelevanceFlags: (legal || []).map((l: any) => ({
        id: l.id,
        snapshotType: l.snapshot_type,
        content: l.content,
        provenance: { matterId, canonicalId: l.id, type: 'LEGAL' }
      })),
      professionalReview: (reviews || []).map((r: any) => ({
        id: r.id,
        findingType: r.finding_type,
        findingId: r.finding_id,
        reviewState: r.review_state,
        reviewNote: r.review_note,
        reviewerAccountId: r.reviewer_account_id,
        provenance: { matterId, canonicalId: r.id, type: 'REVIEW' }
      })),
      sourceIndex: Array.from(new Set((evidence || []).map((e: any) => e.document_id).filter(Boolean)))
    }
  };

  return caseBrief;
}
