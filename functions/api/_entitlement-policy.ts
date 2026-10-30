/**
 * Pure authorization policy for the Cloudflare migration.
 * Database reads must happen in a separate authenticated adapter.
 * Never infer access from a frontend plan, configured secret or HTTP reachability.
 */
export type EntitlementEvidence = {
  firebaseUid: string;
  ownerUid: string;
  session?: {
    ownerUid: string;
    tier: string;
    revokedAt: string | null;
    expiresAt: string | null;
    remainingCredits: number | null;
  } | null;
  free?: { ownerUid: string; used: number; limit: number } | null;
};
export type AccessDecision =
  | { allowed: true; source: 'paid' | 'free' }
  | { allowed: false; reason: 'IDENTITY_MISMATCH' | 'VERIFICATION_REQUIRED' | 'NO_CREDITS' };

export function evaluateQuickReviewAccess(evidence: EntitlementEvidence): AccessDecision {
  if (!evidence.firebaseUid || evidence.ownerUid !== evidence.firebaseUid) {
    return { allowed: false, reason: 'IDENTITY_MISMATCH' };
  }
  const session = evidence.session;
  // A session's tier must be sourced from the verified database row, never from the request.
  // Unknown tiers fail closed; 'unlimited' monthly quick access is not established by this
  // read-only predicate and must be enforced by the authoritative reservation service.
  const paidTier = session?.tier;
  const supportedPaidTier = paidTier === 'Basic' || paidTier === 'AnalyzerBasic' ||
    paidTier === 'Premium' || paidTier === 'AnalyzerPremium' || paidTier === 'Pro' ||
    paidTier === 'Community5' || paidTier === 'Community10' || paidTier === 'Community25';
  if (supportedPaidTier && session?.ownerUid === evidence.firebaseUid && !session.revokedAt &&
      (!session.expiresAt || (Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > Date.now())) &&
      (Number.isSafeInteger(session.remainingCredits) && session.remainingCredits !== null && session.remainingCredits > 0)) {
    return { allowed: true, source: 'paid' };
  }
  const free = evidence.free;
  if (free?.ownerUid === evidence.firebaseUid &&
      Number.isSafeInteger(free.used) && Number.isSafeInteger(free.limit) &&
      free.used >= 0 && free.limit > 0 && free.used < free.limit) {
    return { allowed: true, source: 'free' };
  }
  if (!session && !free) return { allowed: false, reason: 'VERIFICATION_REQUIRED' };
  return { allowed: false, reason: 'NO_CREDITS' };
}
