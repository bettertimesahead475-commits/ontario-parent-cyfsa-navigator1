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
    tier: 'quick' | 'full';
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
  if (session?.ownerUid === evidence.firebaseUid && !session.revokedAt &&
      (!session.expiresAt || (Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > Date.now())) &&
      (session.remainingCredits === null || (Number.isSafeInteger(session.remainingCredits) && session.remainingCredits > 0))) {
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
