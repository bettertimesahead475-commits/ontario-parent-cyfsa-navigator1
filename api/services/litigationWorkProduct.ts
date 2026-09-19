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
    db.from('professional_reviews').select('*').eq('matter_id', matterId).eq('reviewer_account_id', account.id)
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

export async function finalizeCaseBrief(firebaseUid: string, matterId: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const caseBrief = await generateCaseBrief(firebaseUid, matterId);

  // Implement deterministic versioning with a retry loop for uniqueness conflicts
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: maxVerData } = await db
      .from('professional_work_product_versions')
      .select('version_number')
      .eq('matter_id', matterId)
      .eq('reviewer_account_id', account.id)
      .eq('work_product_type', 'CASE_BRIEF')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersionNumber = (maxVerData?.version_number || 0) + 1;

    caseBrief.status = 'FINALIZED';
    caseBrief.versionNumber = nextVersionNumber;

    const { data, error } = await db.from('professional_work_product_versions').insert({
      matter_id: matterId,
      reviewer_account_id: account.id,
      work_product_type: 'CASE_BRIEF',
      version_number: nextVersionNumber,
      status: 'FINALIZED',
      snapshot: caseBrief
    }).select('*').single();

    if (!error && data) {
      return data;
    }

    if (error && error.code !== '23505') { // If it's not a unique violation, throw
      throw new LifecycleError(500, 'FINALIZATION_FAILED', 'Failed to finalize work product version');
    }
  }

  throw new LifecycleError(409, 'CONCURRENT_FINALIZATION', 'Could not finalize due to concurrent requests');
}

export async function getWorkProductVersions(firebaseUid: string, matterId: string, workProductType: string = 'CASE_BRIEF') {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const { data, error } = await db
    .from('professional_work_product_versions')
    .select('id, matter_id, work_product_type, version_number, status, created_at, finalized_at')
    .eq('matter_id', matterId)
    .eq('reviewer_account_id', account.id)
    .eq('work_product_type', workProductType)
    .order('version_number', { ascending: false });

  if (error) throw new LifecycleError(500, 'FETCH_FAILED', 'Failed to fetch work product versions');
  return data || [];
}

export async function getWorkProductVersion(firebaseUid: string, matterId: string, versionId: string) {
  matterId = requireUuid(matterId, 'matterId');
  versionId = requireUuid(versionId, 'versionId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const { data, error } = await db
    .from('professional_work_product_versions')
    .select('*')
    .eq('id', versionId)
    .eq('matter_id', matterId)
    .eq('reviewer_account_id', account.id)
    .single();

  if (error || !data) throw new LifecycleError(404, 'NOT_FOUND', 'Work product version not found');
  
  return data;
}

