// Stage 10 (parallel-safe slice): owner-facing matter access audit + effective-permission report.
//
// Roadmap authority: HANDOFF.md §9 names Stage 10 "Firm Collaboration / Permissions / Audit".
// STAGE_9_ROADMAP_DECISION.md records that no Stage 10 first-milestone contract or firm/team
// tenant model has been adopted, so this module deliberately introduces NONE: no firm, team,
// delegation, role, capability, table, column, migration, RLS policy or write path.
//
// SCOPE: read-only. It reconstructs, for ONE matter and ONLY for that matter's OWNER, the
// lifecycle of Stage 7B professional access grants (navigator_matter_access_grants) and the
// current effective access (navigator_matter_members), and flags inconsistencies between the
// two. It does not modify, repair, revoke or grant anything. Integrity findings are signals for
// a human to act on through the existing Stage 7B owner paths, never automatic remediation.
//
// Authorization reuses the existing model: server-verified Firebase UID -> findAccount() ->
// navigator_matter_members role === 'OWNER' for the exact matter. REVIEWERs are denied because
// the report reveals other reviewers' account identifiers (multi-reviewer isolation, Stage 7F).
//
// This is NOT an append-only audit log. No such table exists; see AUDIT_LIMITATIONS.

import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';

export type RecordedGrantStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
export type EffectiveGrantStatus = RecordedGrantStatus | 'UNRECOGNIZED';

export type AccessAuditEventKind =
  | 'GRANT_ISSUED'
  | 'GRANT_ACCEPTED'
  | 'GRANT_REVOKED'
  | 'GRANT_EXPIRED_UNACCEPTED';

// PERSISTED_TIMESTAMP: the event time is a stored lifecycle column written when the action ran.
// EXPIRES_AT: the grant was never accepted and its stored expiry has passed (or the row was
// marked EXPIRED, which the Stage 7B RPC does without recording when). The time shown is the
// scheduled expiry, not an observed action.
export type EventTimeBasis = 'PERSISTED_TIMESTAMP' | 'EXPIRES_AT';

export interface AccessAuditEvent {
  kind: AccessAuditEventKind;
  grantId: string;
  occurredAt: string;
  timeBasis: EventTimeBasis;
  actorAccountId: string | null;
}

export interface GrantAuditSummary {
  grantId: string;
  capability: string;
  grantorAccountId: string;
  recordedStatus: string;
  effectiveStatus: EffectiveGrantStatus;
  // true only when recordedStatus is PENDING but the expiry has passed (lazy expiry).
  expiryDerived: boolean;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByAccountId: string | null;
  revokedAt: string | null;
  revokedByAccountId: string | null;
}

// MATTER_OWNER: an OWNER membership row.
// ACCEPTED_GRANT: a REVIEWER membership row backed by an ACCEPTED grant accepted by that account.
// UNBACKED: a REVIEWER membership row with no ACCEPTED grant behind it (see integrity findings).
// UNRECOGNIZED_ROLE: a role outside the schema CHECK; never interpreted as any permission.
export type AccessBasis = 'MATTER_OWNER' | 'ACCEPTED_GRANT' | 'UNBACKED' | 'UNRECOGNIZED_ROLE';

export interface EffectiveAccessEntry {
  accountId: string;
  role: string;
  basis: AccessBasis;
  backingGrantIds: string[];
  isRequester: boolean;
}

export type IntegrityFindingCode =
  | 'REVOKED_GRANT_MEMBERSHIP_PERSISTS'
  | 'UNBACKED_REVIEWER_MEMBERSHIP'
  | 'ACCEPTED_GRANT_WITHOUT_MEMBERSHIP'
  | 'GRANT_ACCEPTED_BY_GRANTOR'
  | 'INCONSISTENT_GRANT_LIFECYCLE'
  | 'UNRECOGNIZED_GRANT_STATUS'
  | 'UNRECOGNIZED_MEMBER_ROLE'
  | 'INVALID_TIMESTAMP';

export type IntegritySeverity = 'CRITICAL' | 'WARNING';

export interface AccessIntegrityFinding {
  code: IntegrityFindingCode;
  severity: IntegritySeverity;
  grantId: string | null;
  accountId: string | null;
  detail: string;
}

export interface MatterAccessAuditReport {
  matterId: string;
  generatedAt: string;
  events: AccessAuditEvent[];
  grants: GrantAuditSummary[];
  currentAccess: EffectiveAccessEntry[];
  integrityFindings: AccessIntegrityFinding[];
  limitations: readonly string[];
}

export const AUDIT_LIMITATIONS: readonly string[] = Object.freeze([
  'Reconstructed from the current grant lifecycle columns and membership rows; this is not an append-only audit log.',
  'Reads of matter data by reviewers are not recorded anywhere, so this report cannot show who viewed what or when.',
  'A membership row removed on revocation leaves no trace other than the grant row; earlier membership history cannot be recovered.',
  'EXPIRED events are dated by the scheduled expiry, not by an observed action.',
  'Integrity findings are signals for the matter owner to review; this report changes no access and makes no legal determination.',
]);

const RECORDED_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']);
const EVENT_KIND_ORDER: Record<AccessAuditEventKind, number> = {
  GRANT_ISSUED: 0,
  GRANT_ACCEPTED: 1,
  GRANT_REVOKED: 2,
  GRANT_EXPIRED_UNACCEPTED: 3,
};
const ROLE_ORDER: Record<string, number> = { OWNER: 0, REVIEWER: 1 };

// Explicit column list: token_digest is never selected, so it can never be returned.
const GRANT_COLUMNS =
  'id, matter_id, grantor_account_id, capability, status, expires_at, accepted_at, ' +
  'accepted_by_account_id, revoked_at, revoked_by_account_id, created_at';

export interface GrantRow {
  id: string;
  matter_id: string;
  grantor_account_id: string;
  capability: string;
  status: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_account_id: string | null;
  revoked_at: string | null;
  revoked_by_account_id: string | null;
  created_at: string;
}

export interface MemberRow {
  matter_id: string;
  account_id: string;
  role: string;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure, deterministic report builder. Rows belonging to another matter are discarded
 * (defense in depth against a mis-scoped query) and never influence the report.
 */
export function buildMatterAccessAudit(input: {
  matterId: string;
  requesterAccountId: string;
  grants: GrantRow[];
  members: MemberRow[];
  now: Date;
}): MatterAccessAuditReport {
  const { matterId, requesterAccountId, now } = input;
  const nowMs = now.getTime();
  const grants = input.grants.filter(g => g && g.matter_id === matterId);
  const members = input.members.filter(m => m && m.matter_id === matterId);

  const events: AccessAuditEvent[] = [];
  const findings: AccessIntegrityFinding[] = [];
  const summaries: GrantAuditSummary[] = [];

  const finding = (
    code: IntegrityFindingCode,
    severity: IntegritySeverity,
    grantId: string | null,
    accountId: string | null,
    detail: string,
  ) => findings.push({ code, severity, grantId, accountId, detail });

  for (const g of grants) {
    const created = parseTime(g.created_at);
    const expires = parseTime(g.expires_at);
    const accepted = g.accepted_at == null ? null : parseTime(g.accepted_at);
    const revoked = g.revoked_at == null ? null : parseTime(g.revoked_at);

    if (created === null) finding('INVALID_TIMESTAMP', 'WARNING', g.id, null, 'created_at is missing or unparseable.');
    if (expires === null) finding('INVALID_TIMESTAMP', 'WARNING', g.id, null, 'expires_at is missing or unparseable.');
    if (g.accepted_at != null && accepted === null) finding('INVALID_TIMESTAMP', 'WARNING', g.id, null, 'accepted_at is unparseable.');
    if (g.revoked_at != null && revoked === null) finding('INVALID_TIMESTAMP', 'WARNING', g.id, null, 'revoked_at is unparseable.');

    const recognized = RECORDED_STATUSES.has(g.status);
    if (!recognized) {
      finding('UNRECOGNIZED_GRANT_STATUS', 'WARNING', g.id, null, 'Grant status is outside the recognized lifecycle and was not interpreted.');
    }

    // Mirrors accept_matter_grant: a PENDING grant is unusable once now() > expires_at.
    const expiryDerived = g.status === 'PENDING' && expires !== null && nowMs > expires;
    const effectiveStatus: EffectiveGrantStatus = !recognized ? 'UNRECOGNIZED' : expiryDerived ? 'EXPIRED' : (g.status as RecordedGrantStatus);

    if (g.status === 'ACCEPTED' && (g.accepted_at == null || !g.accepted_by_account_id)) {
      finding('INCONSISTENT_GRANT_LIFECYCLE', 'WARNING', g.id, null, 'Grant is ACCEPTED but has no acceptance time or accepting account.');
    }
    if (g.status === 'REVOKED' && g.revoked_at == null) {
      finding('INCONSISTENT_GRANT_LIFECYCLE', 'WARNING', g.id, null, 'Grant is REVOKED but has no revocation time.');
    }
    if ((g.status === 'PENDING' || g.status === 'EXPIRED') && (g.accepted_at != null || g.accepted_by_account_id)) {
      finding('INCONSISTENT_GRANT_LIFECYCLE', 'WARNING', g.id, null, `Grant is ${g.status} but records an acceptance.`);
    }
    if (created !== null && accepted !== null && accepted < created) {
      finding('INCONSISTENT_GRANT_LIFECYCLE', 'WARNING', g.id, null, 'Acceptance time precedes grant creation.');
    }
    if (created !== null && revoked !== null && revoked < created) {
      finding('INCONSISTENT_GRANT_LIFECYCLE', 'WARNING', g.id, null, 'Revocation time precedes grant creation.');
    }
    if (g.accepted_by_account_id && g.accepted_by_account_id === g.grantor_account_id) {
      finding('GRANT_ACCEPTED_BY_GRANTOR', 'CRITICAL', g.id, g.accepted_by_account_id,
        'The grantor accepted their own invitation; the Stage 7B acceptance upsert can overwrite an existing membership role.');
    }

    if (created !== null) {
      events.push({ kind: 'GRANT_ISSUED', grantId: g.id, occurredAt: new Date(created).toISOString(), timeBasis: 'PERSISTED_TIMESTAMP', actorAccountId: g.grantor_account_id ?? null });
    }
    if (accepted !== null) {
      events.push({ kind: 'GRANT_ACCEPTED', grantId: g.id, occurredAt: new Date(accepted).toISOString(), timeBasis: 'PERSISTED_TIMESTAMP', actorAccountId: g.accepted_by_account_id ?? null });
    }
    if (revoked !== null) {
      events.push({ kind: 'GRANT_REVOKED', grantId: g.id, occurredAt: new Date(revoked).toISOString(), timeBasis: 'PERSISTED_TIMESTAMP', actorAccountId: g.revoked_by_account_id ?? null });
    }
    if ((g.status === 'EXPIRED' || expiryDerived) && expires !== null && accepted === null) {
      events.push({ kind: 'GRANT_EXPIRED_UNACCEPTED', grantId: g.id, occurredAt: new Date(expires).toISOString(), timeBasis: 'EXPIRES_AT', actorAccountId: null });
    }

    summaries.push({
      grantId: g.id,
      capability: g.capability,
      grantorAccountId: g.grantor_account_id,
      recordedStatus: g.status,
      effectiveStatus,
      expiryDerived,
      createdAt: g.created_at,
      expiresAt: g.expires_at,
      acceptedAt: g.accepted_at ?? null,
      acceptedByAccountId: g.accepted_by_account_id ?? null,
      revokedAt: g.revoked_at ?? null,
      revokedByAccountId: g.revoked_by_account_id ?? null,
    });
  }

  const reviewerAccounts = new Set(members.filter(m => m.role === 'REVIEWER').map(m => m.account_id));
  const currentAccess: EffectiveAccessEntry[] = members.map(m => {
    if (m.role === 'OWNER') {
      return { accountId: m.account_id, role: m.role, basis: 'MATTER_OWNER', backingGrantIds: [], isRequester: m.account_id === requesterAccountId };
    }
    if (m.role !== 'REVIEWER') {
      finding('UNRECOGNIZED_MEMBER_ROLE', 'CRITICAL', null, m.account_id, 'Membership role is outside the recognized roles and grants no interpreted permission.');
      return { accountId: m.account_id, role: m.role, basis: 'UNRECOGNIZED_ROLE', backingGrantIds: [], isRequester: m.account_id === requesterAccountId };
    }
    const backing = grants
      .filter(g => g.status === 'ACCEPTED' && g.accepted_by_account_id === m.account_id)
      .map(g => g.id)
      .sort(cmp);
    if (backing.length === 0) {
      const revokedForAccount = grants.filter(g => g.status === 'REVOKED' && g.accepted_by_account_id === m.account_id);
      if (revokedForAccount.length > 0) {
        for (const g of revokedForAccount) {
          finding('REVOKED_GRANT_MEMBERSHIP_PERSISTS', 'CRITICAL', g.id, m.account_id,
            'Access was revoked, but this account still holds a REVIEWER membership and can still open the matter.');
        }
      } else {
        finding('UNBACKED_REVIEWER_MEMBERSHIP', 'CRITICAL', null, m.account_id,
          'This account holds a REVIEWER membership that no accepted grant for this matter explains.');
      }
    }
    return { accountId: m.account_id, role: m.role, basis: backing.length ? 'ACCEPTED_GRANT' : 'UNBACKED', backingGrantIds: backing, isRequester: m.account_id === requesterAccountId };
  });

  for (const g of grants) {
    if (g.status === 'ACCEPTED' && g.accepted_by_account_id && !reviewerAccounts.has(g.accepted_by_account_id)) {
      finding('ACCEPTED_GRANT_WITHOUT_MEMBERSHIP', 'WARNING', g.id, g.accepted_by_account_id,
        'Grant is ACCEPTED but the accepting account holds no REVIEWER membership, so it currently has no reviewer access.');
    }
  }

  events.sort((a, b) =>
    cmp(a.occurredAt, b.occurredAt) || EVENT_KIND_ORDER[a.kind] - EVENT_KIND_ORDER[b.kind] || cmp(a.grantId, b.grantId));
  const createdKey = (s: GrantAuditSummary) => parseTime(s.createdAt) ?? Number.POSITIVE_INFINITY;
  summaries.sort((a, b) => (createdKey(a) - createdKey(b) || 0) || cmp(a.grantId, b.grantId));
  currentAccess.sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 2) - (ROLE_ORDER[b.role] ?? 2) || cmp(a.accountId, b.accountId));
  findings.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'CRITICAL' ? -1 : 1) ||
    cmp(a.code, b.code) || cmp(a.grantId ?? '', b.grantId ?? '') || cmp(a.accountId ?? '', b.accountId ?? '') || cmp(a.detail, b.detail));

  return {
    matterId,
    generatedAt: now.toISOString(),
    events,
    grants: summaries,
    currentAccess,
    integrityFindings: findings,
    limitations: AUDIT_LIMITATIONS,
  };
}

/**
 * OWNER-only access audit for one matter. firebaseUid must come from verifyFirebaseToken().
 * Any database error fails closed; no partial report is returned.
 */
export async function getMatterAccessAudit(
  firebaseUid: string,
  matterId: string,
  options?: { now?: Date },
): Promise<MatterAccessAuditReport> {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const { data: membership, error: membershipError } = await db
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', matterId)
    .eq('account_id', account.id)
    .maybeSingle();
  if (membershipError) throw new Error('Matter access audit authorization failed.');
  if (!membership || membership.role !== 'OWNER') {
    // Same response for non-member and non-owner so the route does not reveal matter existence.
    throw new LifecycleError(403, 'FORBIDDEN', 'Only the matter owner can view its access audit.');
  }

  const [grantsResult, membersResult] = await Promise.all([
    db.from('navigator_matter_access_grants').select(GRANT_COLUMNS).eq('matter_id', matterId),
    db.from('navigator_matter_members').select('matter_id, account_id, role').eq('matter_id', matterId),
  ]);
  if (grantsResult.error || !Array.isArray(grantsResult.data)) throw new Error('Matter access audit grant read failed.');
  if (membersResult.error || !Array.isArray(membersResult.data)) throw new Error('Matter access audit membership read failed.');

  return buildMatterAccessAudit({
    matterId,
    requesterAccountId: account.id,
    grants: grantsResult.data as unknown as GrantRow[],
    members: membersResult.data as unknown as MemberRow[],
    now: options?.now ?? new Date(),
  });
}
