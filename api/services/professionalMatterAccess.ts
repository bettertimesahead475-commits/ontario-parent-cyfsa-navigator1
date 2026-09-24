import { getSupabase } from './access';
import { findAccount } from './accounts';
import { requireUuid } from './lifecycleErrors';
import crypto from 'crypto';

// The remediated database contract (remediate_navigator_matter_access_grants_lifecycle.sql).
// Acceptance and revocation depend on its semantics, so both refuse to run unless the database
// reports exactly this version. This check happens BEFORE any lifecycle RPC: the legacy
// accept_matter_grant can commit an OWNER downgrade before its result could be inspected.
export const ACCESS_LIFECYCLE_CONTRACT = 'navigator_matter_access_lifecycle_v2';

async function requireAccessLifecycleContract(supabase: any): Promise<void> {
  const { data, error } = await supabase.rpc('navigator_matter_access_lifecycle_contract');
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
}

/**
 * Creates a new invitation for a professional to access a matter.
 * The raw token is returned exactly once and is never stored in plaintext.
 */
export async function createProfessionalGrant(
  firebaseUid: string,
  matterId: string,
  options?: { expiresInDays?: number }
): Promise<{ grant: ProfessionalGrant; rawToken: string }> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new Error('Account not found');

  const supabase = getSupabase();

  // 1. Verify the caller is an OWNER of the matter
  const { data: member, error: memberErr } = await supabase
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', matterId)
    .eq('account_id', account.id)
    .single();

  if (memberErr || !member) {
    throw new Error('UNAUTHORIZED: You must be an owner of this matter to grant access.');
  }
  if (member.role !== 'OWNER') {
    throw new Error('UNAUTHORIZED: Only OWNER can grant access.');
  }

  // 2. Generate secure token and digest
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenDigest = crypto.createHash('sha256').update(rawToken).digest('hex');

  // 3. Insert grant
  const days = options?.expiresInDays || 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data: grant, error: insertErr } = await supabase
    .from('navigator_matter_access_grants')
    .insert({
      matter_id: matterId,
      grantor_account_id: account.id,
      token_digest: tokenDigest,
      capability: 'REVIEWER',
      status: 'PENDING',
      expires_at: expiresAt
    })
    .select()
    .single();

  if (insertErr || !grant) {
    throw new Error('Failed to create grant: ' + (insertErr?.message || 'unknown'));
  }

  return {
    grant: mapToGrant(grant),
    rawToken
  };
}

/**
 * Accepts an invitation using a raw token.
 * This is an atomic RPC that validates the token and creates the REVIEWER membership.
 * Success is reported only when the RPC confirms an ACCEPTED outcome; an OWNER of the
 * matter (or the grantor) is refused and never downgraded, and an expired invitation is
 * persisted as EXPIRED and refused (remediate_navigator_matter_access_grants_lifecycle.sql).
 */
export async function acceptProfessionalGrant(
  firebaseUid: string,
  rawToken: string
): Promise<{ success: boolean; matterId?: string }> {
  const tokenDigest = crypto.createHash('sha256').update(rawToken).digest('hex');
  const supabase = getSupabase();
  await requireAccessLifecycleContract(supabase);

  const { data, error } = await supabase.rpc('accept_matter_grant', {
    p_firebase_uid: firebaseUid,
    p_token_digest: tokenDigest
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
    createdAt: row.created_at
  };
}
