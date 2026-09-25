import { getSupabase } from './access';
import { findAccount } from './accounts';
import { requireUuid } from './lifecycleErrors';
import crypto from 'crypto';
import { canonicalRecipientEmail } from './recipientEmail';

// Required database contract. v2 (Stage 7B remediation, frozen at a452c6c) made the lifecycle
// functions safe; v3 (Stage 10 slice 4) records every access transition in the append-only event
// log inside the SAME transaction; v4 (Stage 10 slice 7,
// create_navigator_matter_access_lifecycle_recipient_v4.sql) binds every invitation to one
// canonical recipient email and lets only that verified recipient accept, checked before any
// write. Creation, acceptance and revocation all refuse to run unless the database reports
// exactly v4. The check happens BEFORE any lifecycle RPC. Older contract functions stay in place.
export const ACCESS_LIFECYCLE_CONTRACT = 'navigator_matter_access_lifecycle_v4';

async function requireAccessLifecycleContract(supabase: any): Promise<void> {
  const { data, error } = await supabase.rpc('navigator_matter_access_lifecycle_contract_v4');
  if (error || data !== ACCESS_LIFECYCLE_CONTRACT) {
    throw new Error('Professional access is unavailable: the required access lifecycle contract is not installed.');
  }
}

export type GrantStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface ProfessionalGrant {
  id: string;
  matterId: string;
  grantorAccountId: string;
  capability: string;
  status: GrantStatus;
  expiresAt: string;
  acceptedAt?: string | null;
  acceptedByAccountId?: string | null;
  revokedAt?: string | null;
  revokedByAccountId?: string | null;
  createdAt: string;
  /** Canonical recipient email the invitation is bound to (contract v4). */
  recipientEmail: string;
}

/**
 * Identity claims taken ONLY from a successfully verified Firebase ID token
 * (firebaseAdmin.verifyFirebaseIdentity). Never from a request body, query or route.
 */
export interface VerifiedEmailClaims {
  email: string | null;
  emailVerified: boolean;
}

/**
 * Creates a new invitation for ONE intended professional, identified by email, to access a matter.
 * The raw token is returned exactly once and is never stored in plaintext; only its SHA-256
 * digest reaches the database. Ownership is checked, the grant is inserted with its canonical
 * recipient email and its GRANT_CREATED audit event is recorded by one owner-checked database
 * function, in one transaction (create_recipient_bound_matter_grant, contract v4). The database
 * canonicalizes the recipient again; the JavaScript check only refuses bad input early.
 */
export async function createProfessionalGrant(
  firebaseUid: string,
  matterId: string,
  options: { recipientEmail: string; expiresInDays?: number }
): Promise<{ grant: ProfessionalGrant; rawToken: string }> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new Error('Account not found');

  const days = options?.expiresInDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('Invitation expiry must be 1 to 365 days.');
  }
  const recipient = canonicalRecipientEmail(options?.recipientEmail);
  if (!recipient) throw new Error('Recipient email must be a valid address.');

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenDigest = crypto.createHash('sha256').update(rawToken).digest('hex');

  const supabase = getSupabase();
  await requireAccessLifecycleContract(supabase);
  const { data, error } = await supabase.rpc('create_recipient_bound_matter_grant', {
    p_firebase_uid: firebaseUid,
    p_matter_id: matterId,
    p_token_digest: tokenDigest,
    p_expires_in_days: days,
    p_recipient_email: recipient
  });

  if (error) {
    const message = String(error.message || '');
    if (message.includes('NOT_OWNER')) throw new Error('UNAUTHORIZED: Only OWNER can grant access.');
    if (message.includes('ACCOUNT_UNAVAILABLE')) throw new Error('Account not found');
    if (message.includes('INVALID_RECIPIENT')) throw new Error('Recipient email must be a valid address.');
    // Raw database text is never returned to the caller.
    throw new Error('Failed to create grant.');
  }
  if (!data || typeof data.id !== 'string' || data.status !== 'PENDING'
      || String(data.matter_id).toLowerCase() !== String(matterId).toLowerCase()
      || data.recipient_email !== recipient) {
    throw new Error('Failed to create grant.');
  }

  return {
    grant: mapToGrant(data),
    rawToken
  };
}

/**
 * Accepts an invitation using a raw token, as its verified recipient only.
 * `claims` must come from firebaseAdmin.verifyFirebaseIdentity(): the verified token's email and
 * email_verified. A caller without a verified email is refused before any database call. The
 * database compares the verified email with the invitation's recipient BEFORE any write
 * (accept_recipient_bound_matter_grant, contract v4): a non-recipient is refused exactly like an
 * unknown token and changes nothing. For the recipient the frozen rules apply unchanged: an OWNER
 * of the matter (or the grantor) is refused and never downgraded, and an expired invitation is
 * persisted as EXPIRED and refused.
 */
export async function acceptProfessionalGrant(
  firebaseUid: string,
  rawToken: string,
  claims: VerifiedEmailClaims
): Promise<{ success: boolean; matterId?: string }> {
  if (!claims || claims.emailVerified !== true || !canonicalRecipientEmail(claims.email)) {
    throw new Error('Verified email required.');
  }
  const tokenDigest = crypto.createHash('sha256').update(rawToken).digest('hex');
  const supabase = getSupabase();
  await requireAccessLifecycleContract(supabase);

  const { data, error } = await supabase.rpc('accept_recipient_bound_matter_grant', {
    p_firebase_uid: firebaseUid,
    p_token_digest: tokenDigest,
    p_verified_email: claims.email,
    p_email_verified: true
  });

  if (error) {
    const message = String(error.message || '');
    if (message.includes('INVALID_TOKEN')) throw new Error('Invalid token.');
    if (message.includes('INVALID_STATE')) throw new Error('Invitation is no longer pending.');
    if (message.includes('EXPIRED_TOKEN')) throw new Error('Invitation has expired.');
    if (message.includes('OWNER_CANNOT_ACCEPT')) {
      throw new Error('A matter owner cannot accept a professional invitation to their own matter.');
    }
    if (message.includes('ACCOUNT_UNAVAILABLE')) throw new Error('Account is unavailable.');
    if (message.includes('EMAIL_NOT_VERIFIED')) throw new Error('Verified email required.');
    // Raw database text is never returned to the caller.
    throw new Error('Acceptance failed.');
  }

  if (data?.outcome === 'EXPIRED') throw new Error('Invitation has expired.');
  if (data?.outcome !== 'ACCEPTED' || typeof data.matter_id !== 'string' || !data.matter_id) {
    throw new Error('Acceptance failed.');
  }

  return { success: true, matterId: data.matter_id };
}

/**
 * Revokes a pending or accepted grant through the atomic, owner-checked revoke_matter_grant
 * RPC. The accepting professional's REVIEWER membership is removed only when no other
 * ACCEPTED grant for the same account and matter still authorizes it.
 *
 * Fails closed: success is reported only when the database confirms the grant is REVOKED.
 * Repeating a revocation is safe and also clears a membership left behind by an earlier,
 * pre-remediation partial revocation.
 */
export async function revokeProfessionalGrant(
  firebaseUid: string,
  grantId: string
): Promise<{ success: boolean; membershipRemoved: boolean }> {
  // Validate and canonicalize once; PostgreSQL returns uuids in lowercase, so the request,
  // the RPC argument and the response identity check all use the same canonical value.
  const canonicalGrantId = requireUuid(grantId, 'grantId').toLowerCase();

  const account = await findAccount(firebaseUid);
  if (!account) throw new Error('Account not found');

  const supabase = getSupabase();
  await requireAccessLifecycleContract(supabase);
  const { data, error } = await supabase.rpc('revoke_matter_grant', {
    p_firebase_uid: firebaseUid,
    p_grant_id: canonicalGrantId
  });

  if (error) {
    const message = String(error.message || '');
    if (message.includes('GRANT_NOT_FOUND')) throw new Error('Grant not found');
    if (message.includes('NOT_OWNER')) throw new Error('UNAUTHORIZED: Only OWNER can revoke access.');
    if (message.includes('ACCOUNT_UNAVAILABLE')) throw new Error('Account not found');
    // Raw database text is never returned to the caller.
    throw new Error('Revocation failed. Access may not have been removed.');
  }

  if (!data || data.grant_id !== canonicalGrantId || data.status !== 'REVOKED' || typeof data.membership_removed !== 'boolean') {
    throw new Error('Revocation failed. Access may not have been removed.');
  }

  return { success: true, membershipRemoved: data.membership_removed };
}

function mapToGrant(row: any): ProfessionalGrant {
  return {
    id: row.id,
    matterId: row.matter_id,
    grantorAccountId: row.grantor_account_id,
    capability: row.capability,
    status: row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedByAccountId: row.accepted_by_account_id,
    revokedAt: row.revoked_at,
    revokedByAccountId: row.revoked_by_account_id,
    createdAt: row.created_at,
    recipientEmail: row.recipient_email
  };
}
