import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';

export async function requireMatterOwnerAccess(db: any, accountId: string, matterId: string) {
  const { data: member, error } = await db
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', matterId)
    .eq('account_id', accountId)
    .eq('role', 'OWNER')
    .single();

  if (error || !member) {
    throw new LifecycleError(403, 'UNAUTHORIZED', 'Only the matter owner can view collaboration status.');
  }
}

export async function getParentCollaborationSummary(firebaseUid: string, matterId: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterOwnerAccess(db, account.id, matterId);

  // Fetch grants, reviews, and finalized work product versions concurrently
  const [grantsRes, reviewsRes, versionsRes] = await Promise.all([
    db.from('navigator_matter_access_grants')
      .select('id, recipient_email, status, expires_at, created_at, accepted_at, revoked_at')
      .eq('matter_id', matterId),
    db.from('professional_reviews')
      .select('id, finding_type, finding_id, review_state, updated_at')
      .eq('matter_id', matterId),
    db.from('professional_work_product_versions')
      .select('id, version_number, work_product_type, status, created_at, finalized_at')
      .eq('matter_id', matterId)
      .eq('status', 'FINALIZED')
      .order('version_number', { ascending: false })
  ]);

  if (grantsRes.error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to fetch access grants');
  if (reviewsRes.error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to fetch professional reviews');
  if (versionsRes.error) throw new LifecycleError(500, 'DB_ERROR', 'Failed to fetch work product versions');

  const grants = grantsRes.data || [];
  const reviews = reviewsRes.data || [];
  const versions = versionsRes.data || [];

  // Calculate review status counts for parent summary (privacy-safe, no raw reviewer notes)
  const reviewCounts = {
    totalReviewed: reviews.length,
    confirmedRelevant: reviews.filter((r: any) => r.review_state === 'CONFIRMED_RELEVANT').length,
    possiblyRelevant: reviews.filter((r: any) => r.review_state === 'POSSIBLY_RELEVANT').length,
    requiresResearch: reviews.filter((r: any) => r.review_state === 'REQUIRES_RESEARCH').length,
    notRelevant: reviews.filter((r: any) => r.review_state === 'NOT_RELEVANT').length,
    superseded: reviews.filter((r: any) => r.review_state === 'SUPERSEDED').length,
    unreviewed: reviews.filter((r: any) => r.review_state === 'UNREVIEWED').length
  };

  // Map grants with status labelling
  const activeCollaborators = grants.map((g: any) => {
    let effectiveStatus = g.status;
    if (g.status === 'PENDING' && g.expires_at && new Date(g.expires_at).getTime() < Date.now()) {
      effectiveStatus = 'EXPIRED';
    }
    return {
      grantId: g.id,
      recipientEmail: g.recipient_email || 'Unspecified recipient',
      status: effectiveStatus,
      createdAt: g.created_at,
      expiresAt: g.expires_at,
      acceptedAt: g.accepted_at || null,
      revokedAt: g.revoked_at || null
    };
  });

  return {
    matterId,
    collaborators: activeCollaborators,
    reviewProgressSummary: reviewCounts,
    finalizedWorkProducts: versions.map((v: any) => ({
      id: v.id,
      versionNumber: v.version_number,
      workProductType: v.work_product_type,
      status: v.status,
      finalizedAt: v.finalized_at || v.created_at
    }))
  };
}
