/**
 * Normalizes a database session for the Cloudflare staging entitlement layer.
 * The caller MUST supply a row returned by a server-only Supabase query, not
 * request JSON. This helper does not itself authenticate the caller.
 */
export type PaidSessionRow = {
  id: string;
  firebase_uid: string;
  tier: string;
  issued_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export type VerifiedSession = {
  sessionId: string;
  ownerUid: string;
  tier: string;
  issuedAt: string | null;
  expiresAt: string | null;
};

const TIERS = new Set([
  'Basic', 'AnalyzerBasic', 'Premium', 'AnalyzerPremium',
  'Pro', 'Community5', 'Community10', 'Community25',
]);

function validTimestamp(value: string | null): boolean {
  return value === null || (typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)));
}

/**
 * Fail closed on missing, foreign, expired, revoked or malformed sessions.
 * Credits must still be checked/reserved atomically in the existing RPCs.
 */
export function validatePaidSessionRow(
  row: PaidSessionRow | null,
  verifiedFirebaseUid: string,
  requestedSessionId: string,
  now: number = Date.now(),
): VerifiedSession | null {
  if (!row || !verifiedFirebaseUid || !requestedSessionId ||
      row.id !== requestedSessionId || row.firebase_uid !== verifiedFirebaseUid ||
      !TIERS.has(row.tier) || row.revoked_at !== null ||
      !validTimestamp(row.issued_at) || !validTimestamp(row.expires_at) ||
      (row.issued_at !== null && Date.parse(row.issued_at) > now) ||
      (row.expires_at !== null && Date.parse(row.expires_at) <= now)) {
    return null;
  }
  return {
    sessionId: row.id,
    ownerUid: row.firebase_uid,
    tier: row.tier,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
}
