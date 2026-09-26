import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';

export async function getProfessionalMatters(firebaseUid: string) {
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const { data: members, error } = await db
    .from('navigator_matter_members')
    .select('matter_id, role, navigator_matters ( id, title, created_at, updated_at )')
    .eq('account_id', account.id)
    .eq('role', 'REVIEWER');

  if (error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to fetch authorized matters');

  return (members || []).map((m: any) => ({
    id: m.matter_id,
    title: m.navigator_matters?.title,
    role: m.role,
    createdAt: m.navigator_matters?.created_at,
    updatedAt: m.navigator_matters?.updated_at
  }));
}

export async function requireProfessionalAccess(db: any, accountId: string, matterId: string) {
  const { data: member, error } = await db
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', matterId)
    .eq('account_id', accountId)
    .eq('role', 'REVIEWER')
    .single();

  if (error || !member) {
    throw new LifecycleError(403, 'UNAUTHORIZED', 'You do not have professional access to this matter.');
  }
}

export async function getMatterOverview(firebaseUid: string, matterId: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const [docs, events, claims, relations, gaps, legal, reviews] = await Promise.all([
    db.from('navigator_documents').select('id', { count: 'exact', head: true }).eq('matter_id', matterId),
    db.from('navigator_events').select('id', { count: 'exact', head: true }).eq('matter_id', matterId),
    db.from('navigator_claims').select('id', { count: 'exact', head: true }).eq('matter_id', matterId),
    db.from('navigator_claim_relationships').select('id', { count: 'exact', head: true }).eq('matter_id', matterId),
    db.from('navigator_evidence_gap_findings').select('id', { count: 'exact', head: true }).eq('matter_id', matterId),
    db.from('navigator_case_intelligence_snapshots').select('id', { count: 'exact', head: true }).eq('matter_id', matterId),
    db.from('professional_reviews').select('id', { count: 'exact', head: true }).eq('matter_id', matterId).eq('reviewer_account_id', account.id)
  ]);

  return {
    documents: docs.count || 0,
    chronologyEvents: events.count || 0,
    claims: claims.count || 0,
    relationships: relations.count || 0,
    evidenceGaps: gaps.count || 0,
    legalIssues: legal.count || 0,
    reviewedItems: reviews.count || 0
  };
}

export async function getIntelligenceCategory(firebaseUid: string, matterId: string, category: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  let tableName = '';
  if (category === 'EVIDENCE') tableName = 'navigator_evidence_items';
  else if (category === 'CHRONOLOGY') tableName = 'navigator_events';
  else if (category === 'CLAIMS') tableName = 'navigator_claims';
  else if (category === 'RELATIONSHIPS') tableName = 'navigator_claim_relationships';
  else if (category === 'GAPS') tableName = 'navigator_evidence_gap_findings';
  else if (category === 'LEGAL') tableName = 'navigator_case_intelligence_snapshots';
  else if (category === 'DOCUMENTS') tableName = 'navigator_documents';
  else throw new LifecycleError(400, 'INVALID_CATEGORY', 'Unknown category');

  // Fetch the items
  const { data: items, error } = await db.from(tableName).select('*').eq('matter_id', matterId).limit(50);
  if (error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to fetch items: ' + error.message);

  // Fetch professional reviews for this category
  const { data: reviews, error: reviewErr } = await db.from('professional_reviews')
    .select('*')
    .eq('matter_id', matterId)
    .eq('reviewer_account_id', account.id);

  return {
    items: items || [],
    reviews: reviews || []
  };
}

export async function getProfessionalSourcePage(firebaseUid: string, matterId: string, evidenceId: string) {
  matterId = requireUuid(matterId, 'matterId');
  evidenceId = requireUuid(evidenceId, 'evidenceId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const { data: item, error: itemErr } = await db
    .from('navigator_evidence_items')
    .select('id, matter_id, document_id, document_version_id, page_id, page_number')
    .eq('id', evidenceId)
    .eq('matter_id', matterId)
    .single();

  if (itemErr || !item) {
    throw new LifecycleError(404, 'NOT_FOUND', 'Evidence item not found in this matter.');
  }

  const { data: page, error: pageErr } = await db
    .from('navigator_document_pages')
    .select('id, page_number, text')
    .eq('id', item.page_id)
    .single();

  if (pageErr || !page) {
    throw new LifecycleError(404, 'NOT_FOUND', 'Source page text not found.');
  }

  return {
    evidenceId: item.id,
    documentId: item.document_id,
    versionId: item.document_version_id,
    page
  };
}

// Stage 9D-3: read-only counterpart to saveProfessionalReview, scoped to one finding_type,
// so the legal-discovery workspace can show the caller's own prior review state for a
// LEGAL_RESEARCH_RESULT finding without piggybacking on getIntelligenceCategory (which is
// hard-restricted to the six canonical intelligence categories and does not accept this
// finding_type). Reuses the exact same table, reviewer-scoping and access check as the
// existing write path -- no new review-state vocabulary, no new authorization path.
export async function listProfessionalReviewsForFindingType(
  firebaseUid: string,
  matterId: string,
  findingType: string
) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const { data, error } = await db.from('professional_reviews')
    .select('*')
    .eq('matter_id', matterId)
    .eq('finding_type', findingType)
    .eq('reviewer_account_id', account.id);

  if (error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to fetch reviews: ' + error.message);
  return data || [];
}

export async function saveProfessionalReview(
  firebaseUid: string, 
  matterId: string, 
  findingType: string, 
  findingId: string, 
  reviewState: string, 
  reviewNote: string | null
) {
  matterId = requireUuid(matterId, 'matterId');
  findingId = requireUuid(findingId, 'findingId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const { data, error } = await db.from('professional_reviews').upsert({
    matter_id: matterId,
    finding_id: findingId,
    finding_type: findingType,
    reviewer_account_id: account.id,
    review_state: reviewState,
    review_note: reviewNote,
    updated_at: new Date().toISOString()
  }, {
    onConflict: 'finding_type, finding_id, reviewer_account_id'
  }).select().single();

  if (error) {
    throw new LifecycleError(500, 'DB_ERROR', 'Failed to save review: ' + error.message);
  }

  return data;
}
