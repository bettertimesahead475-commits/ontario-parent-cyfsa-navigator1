import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import * as access from './access.js';
import * as accounts from './accounts.js';
import { LifecycleError } from './lifecycleErrors.js';
import {
  AUDIT_LIMITATIONS,
  buildMatterAccessAudit,
  getMatterAccessAudit,
  type GrantRow,
  type MemberRow,
} from './matterAccessAudit.js';

vi.mock('./access.js');
vi.mock('./accounts.js');

const MATTER_A = randomUUID();
const MATTER_B = randomUUID();
const OWNER_A = 'acct-owner-a';
const OWNER_B = 'acct-owner-b';
const REVIEWER_1 = 'acct-reviewer-1';
const REVIEWER_2 = 'acct-reviewer-2';
const NOW = new Date('2026-09-24T12:00:00.000Z');

function grant(overrides: Partial<GrantRow> & { id: string }): GrantRow & { token_digest: string } {
  return {
    matter_id: MATTER_A,
    grantor_account_id: OWNER_A,
    capability: 'REVIEWER',
    status: 'PENDING',
    expires_at: '2026-09-30T00:00:00.000Z',
    accepted_at: null,
    accepted_by_account_id: null,
    revoked_at: null,
    revoked_by_account_id: null,
    created_at: '2026-09-20T00:00:00.000Z',
    token_digest: 'SECRET-DIGEST-' + overrides.id,
    ...overrides,
  };
}

const owner = (matter = MATTER_A, account = OWNER_A): MemberRow => ({ matter_id: matter, account_id: account, role: 'OWNER' });
const reviewer = (account: string, matter = MATTER_A): MemberRow => ({ matter_id: matter, account_id: account, role: 'REVIEWER' });

function build(grants: GrantRow[], members: MemberRow[]) {
  return buildMatterAccessAudit({ matterId: MATTER_A, requesterAccountId: OWNER_A, grants, members, now: NOW });
}

describe('Stage 10 matter access audit -- pure report builder', () => {
  it('reconstructs issue/accept/revoke events in chronological order with actors', () => {
    const g = grant({
      id: 'g1', status: 'REVOKED',
      accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1,
      revoked_at: '2026-09-22T00:00:00.000Z', revoked_by_account_id: OWNER_A,
    });
    const report = build([g], [owner()]);
    expect(report.events.map(e => [e.kind, e.actorAccountId, e.timeBasis])).toEqual([
      ['GRANT_ISSUED', OWNER_A, 'PERSISTED_TIMESTAMP'],
      ['GRANT_ACCEPTED', REVIEWER_1, 'PERSISTED_TIMESTAMP'],
      ['GRANT_REVOKED', OWNER_A, 'PERSISTED_TIMESTAMP'],
    ]);
    expect(report.integrityFindings).toEqual([]);
    expect(report.currentAccess).toEqual([
      { accountId: OWNER_A, role: 'OWNER', basis: 'MATTER_OWNER', backingGrantIds: [], isRequester: true },
    ]);
  });

  it('derives expiry for a lapsed PENDING grant, matching the RPC strict now() > expires_at rule', () => {
    const lapsed = grant({ id: 'g-lapsed', expires_at: '2026-09-24T11:59:59.999Z' });
    const boundary = grant({ id: 'g-boundary', expires_at: NOW.toISOString() });
    const report = build([lapsed, boundary], [owner()]);
    const byId = Object.fromEntries(report.grants.map(s => [s.grantId, s]));
    expect(byId['g-lapsed']).toMatchObject({ recordedStatus: 'PENDING', effectiveStatus: 'EXPIRED', expiryDerived: true });
    expect(byId['g-boundary']).toMatchObject({ recordedStatus: 'PENDING', effectiveStatus: 'PENDING', expiryDerived: false });
    const expired = report.events.filter(e => e.kind === 'GRANT_EXPIRED_UNACCEPTED');
    expect(expired).toEqual([
      { kind: 'GRANT_EXPIRED_UNACCEPTED', grantId: 'g-lapsed', occurredAt: '2026-09-24T11:59:59.999Z', timeBasis: 'EXPIRES_AT', actorAccountId: null },
    ]);
  });

  it('labels a recorded EXPIRED grant by its scheduled expiry, not as an observed action', () => {
    const report = build([grant({ id: 'g-exp', status: 'EXPIRED', expires_at: '2026-09-21T00:00:00.000Z' })], [owner()]);
    expect(report.grants[0]).toMatchObject({ effectiveStatus: 'EXPIRED', expiryDerived: false });
    expect(report.events.at(-1)).toMatchObject({ kind: 'GRANT_EXPIRED_UNACCEPTED', timeBasis: 'EXPIRES_AT', actorAccountId: null });
  });

  it('marks a REVIEWER membership backed by an ACCEPTED grant as ACCEPTED_GRANT', () => {
    const g = grant({ id: 'g1', status: 'ACCEPTED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1 });
    const report = build([g], [owner(), reviewer(REVIEWER_1)]);
    expect(report.currentAccess[1]).toEqual({
      accountId: REVIEWER_1, role: 'REVIEWER', basis: 'ACCEPTED_GRANT', backingGrantIds: ['g1'], isRequester: false,
    });
    expect(report.integrityFindings).toEqual([]);
  });

  it('flags CRITICAL when a revoked reviewer still holds membership (incomplete revocation)', () => {
    const g = grant({
      id: 'g1', status: 'REVOKED',
      accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1,
      revoked_at: '2026-09-22T00:00:00.000Z', revoked_by_account_id: OWNER_A,
    });
    const report = build([g], [owner(), reviewer(REVIEWER_1)]);
    expect(report.currentAccess[1].basis).toBe('UNBACKED');
    expect(report.integrityFindings).toEqual([
      expect.objectContaining({ code: 'REVOKED_GRANT_MEMBERSHIP_PERSISTS', severity: 'CRITICAL', grantId: 'g1', accountId: REVIEWER_1 }),
    ]);
  });

  it('does not flag a reviewer re-invited after revocation when a live ACCEPTED grant backs the membership', () => {
    const revoked = grant({
      id: 'g-old', status: 'REVOKED', accepted_at: '2026-09-20T01:00:00.000Z', accepted_by_account_id: REVIEWER_1,
      revoked_at: '2026-09-20T02:00:00.000Z', revoked_by_account_id: OWNER_A,
    });
    const live = grant({ id: 'g-new', status: 'ACCEPTED', created_at: '2026-09-21T00:00:00.000Z', accepted_at: '2026-09-21T01:00:00.000Z', accepted_by_account_id: REVIEWER_1 });
    const report = build([revoked, live], [owner(), reviewer(REVIEWER_1)]);
    expect(report.integrityFindings).toEqual([]);
    expect(report.currentAccess[1]).toMatchObject({ basis: 'ACCEPTED_GRANT', backingGrantIds: ['g-new'] });
  });

  it('flags CRITICAL for a REVIEWER membership no grant explains', () => {
    const report = build([], [owner(), reviewer(REVIEWER_2)]);
    expect(report.integrityFindings).toEqual([
      expect.objectContaining({ code: 'UNBACKED_REVIEWER_MEMBERSHIP', severity: 'CRITICAL', accountId: REVIEWER_2 }),
    ]);
  });

  it('does not let one reviewer\'s accepted grant back a different reviewer\'s membership', () => {
    const g = grant({ id: 'g1', status: 'ACCEPTED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1 });
    const report = build([g], [owner(), reviewer(REVIEWER_1), reviewer(REVIEWER_2)]);
    expect(report.currentAccess.map(a => [a.accountId, a.basis, a.backingGrantIds])).toEqual([
      [OWNER_A, 'MATTER_OWNER', []],
      [REVIEWER_1, 'ACCEPTED_GRANT', ['g1']],
      [REVIEWER_2, 'UNBACKED', []],
    ]);
    expect(report.integrityFindings).toEqual([
      expect.objectContaining({ code: 'UNBACKED_REVIEWER_MEMBERSHIP', accountId: REVIEWER_2 }),
    ]);
  });

  it('does not let a grant from another matter back a membership in this matter', () => {
    const foreign = grant({ id: 'g-foreign', matter_id: MATTER_B, grantor_account_id: OWNER_B, status: 'ACCEPTED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1 });
    const report = build([foreign], [owner(), reviewer(REVIEWER_1)]);
    expect(report.grants).toEqual([]);
    expect(report.events).toEqual([]);
    expect(report.integrityFindings.map(f => f.code)).toEqual(['UNBACKED_REVIEWER_MEMBERSHIP']);
  });

  it('discards membership rows from another matter', () => {
    const report = build([], [owner(), reviewer(REVIEWER_1, MATTER_B), owner(MATTER_B, OWNER_B)]);
    expect(report.currentAccess.map(a => a.accountId)).toEqual([OWNER_A]);
  });

  it('warns when an ACCEPTED grant has no corresponding membership', () => {
    const g = grant({ id: 'g1', status: 'ACCEPTED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1 });
    const report = build([g], [owner()]);
    expect(report.integrityFindings).toEqual([
      expect.objectContaining({ code: 'ACCEPTED_GRANT_WITHOUT_MEMBERSHIP', severity: 'WARNING', grantId: 'g1' }),
    ]);
  });

  it('flags CRITICAL when the grantor accepted their own invitation', () => {
    const g = grant({ id: 'g1', status: 'ACCEPTED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: OWNER_A });
    const report = build([g], [owner()]);
    expect(report.integrityFindings.map(f => [f.code, f.severity])).toEqual([
      ['GRANT_ACCEPTED_BY_GRANTOR', 'CRITICAL'],
      ['ACCEPTED_GRANT_WITHOUT_MEMBERSHIP', 'WARNING'],
    ]);
  });

  it('reports inconsistent lifecycle rows instead of trusting them', () => {
    const report = build([
      grant({ id: 'g-acc-missing', status: 'ACCEPTED' }),
      grant({ id: 'g-rev-missing', status: 'REVOKED' }),
      grant({ id: 'g-pending-accepted', status: 'PENDING', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1 }),
      grant({ id: 'g-backwards', status: 'REVOKED', revoked_at: '2026-09-19T00:00:00.000Z' }),
    ], [owner()]);
    const lifecycle = report.integrityFindings.filter(f => f.code === 'INCONSISTENT_GRANT_LIFECYCLE').map(f => f.grantId);
    expect(lifecycle).toEqual(['g-acc-missing', 'g-backwards', 'g-pending-accepted', 'g-rev-missing']);
  });

  it('never interprets unrecognized statuses or roles as permissions', () => {
    const report = build(
      [grant({ id: 'g-weird', status: 'SUPERUSER' })],
      [owner(), { matter_id: MATTER_A, account_id: 'acct-x', role: 'ADMIN' }],
    );
    expect(report.grants[0].effectiveStatus).toBe('UNRECOGNIZED');
    expect(report.currentAccess[1]).toMatchObject({ accountId: 'acct-x', basis: 'UNRECOGNIZED_ROLE' });
    expect(report.integrityFindings.map(f => f.code)).toEqual(['UNRECOGNIZED_MEMBER_ROLE', 'UNRECOGNIZED_GRANT_STATUS']);
  });

  it('reports unparseable timestamps and omits the corresponding events', () => {
    const report = build([grant({ id: 'g1', created_at: 'not-a-date' })], [owner()]);
    expect(report.events).toEqual([]);
    expect(report.integrityFindings.map(f => f.code)).toEqual(['INVALID_TIMESTAMP']);
  });

  it('is deterministic regardless of input row order', () => {
    const rows = [
      grant({ id: 'g-b', created_at: '2026-09-20T00:00:00.000Z' }),
      grant({ id: 'g-a', created_at: '2026-09-20T00:00:00.000Z' }),
      grant({ id: 'g-c', created_at: '2026-09-19T00:00:00.000Z', status: 'ACCEPTED', accepted_at: '2026-09-20T00:00:00.000Z', accepted_by_account_id: REVIEWER_1 }),
    ];
    const members = [reviewer(REVIEWER_2), reviewer(REVIEWER_1), owner()];
    const forward = build(rows, members);
    const reversed = build([...rows].reverse(), [...members].reverse());
    expect(reversed).toEqual(forward);
    expect(forward.grants.map(g => g.grantId)).toEqual(['g-c', 'g-a', 'g-b']);
    expect(forward.events.map(e => `${e.kind}:${e.grantId}`)).toEqual([
      'GRANT_ISSUED:g-c', 'GRANT_ISSUED:g-a', 'GRANT_ISSUED:g-b', 'GRANT_ACCEPTED:g-c',
    ]);
    expect(forward.currentAccess.map(a => a.accountId)).toEqual([OWNER_A, REVIEWER_1, REVIEWER_2]);
  });

  it('never emits token digests even if a row carries one', () => {
    const report = build([grant({ id: 'g1' })], [owner()]);
    expect(JSON.stringify(report)).not.toContain('SECRET-DIGEST');
    expect(JSON.stringify(report)).not.toContain('token');
  });

  it('always carries the explicit audit limitations', () => {
    const report = build([], [owner()]);
    expect(report.limitations).toBe(AUDIT_LIMITATIONS);
    expect(Object.isFrozen(AUDIT_LIMITATIONS)).toBe(true);
    expect(AUDIT_LIMITATIONS.join(' ')).toMatch(/not an append-only audit log/);
    expect(AUDIT_LIMITATIONS.join(' ')).toMatch(/makes no legal determination/);
  });
});

// ---------------------------------------------------------------------------
// Service boundary: authentication, OWNER-only authorization, fail-closed reads.
// ---------------------------------------------------------------------------

type Tables = { navigator_matter_members: any[]; navigator_matter_access_grants: any[] };
let tables: Tables;
let failTable: string | null;
let selectedColumns: Record<string, string[]>;
let writes: string[];

function installFakeDb() {
  vi.mocked(access.getSupabase).mockReturnValue({
    from: (table: keyof Tables) => {
      let rows = [...(tables[table] || [])];
      const result = () => (failTable === table ? { data: null, error: new Error('db down') } : { data: rows, error: null });
      const chain: any = {
        select: (cols: string) => { (selectedColumns[table] ||= []).push(cols); return chain; },
        eq: (col: string, val: unknown) => { rows = rows.filter(r => r[col] === val); return chain; },
        maybeSingle: async () => (failTable === table ? { data: null, error: new Error('db down') } : { data: rows[0] ?? null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        insert: () => { writes.push(`insert:${table}`); return chain; },
        update: () => { writes.push(`update:${table}`); return chain; },
        delete: () => { writes.push(`delete:${table}`); return chain; },
        upsert: () => { writes.push(`upsert:${table}`); return chain; },
      };
      return chain;
    },
    rpc: () => { writes.push('rpc'); return Promise.resolve({ data: null, error: null }); },
  } as any);
}

describe('Stage 10 matter access audit -- service authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failTable = null;
    selectedColumns = {};
    writes = [];
    tables = {
      navigator_matter_members: [owner(), reviewer(REVIEWER_1), owner(MATTER_B, OWNER_B), reviewer(REVIEWER_2, MATTER_B)],
      navigator_matter_access_grants: [
        grant({ id: 'g-a', status: 'ACCEPTED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1 }),
        grant({ id: 'g-b', matter_id: MATTER_B, grantor_account_id: OWNER_B, status: 'ACCEPTED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_2 }),
      ],
    };
    installFakeDb();
    vi.mocked(accounts.findAccount).mockImplementation(async (uid: string) => {
      const map: Record<string, string> = { 'uid-owner-a': OWNER_A, 'uid-owner-b': OWNER_B, 'uid-reviewer-1': REVIEWER_1 };
      return map[uid] ? ({ id: map[uid], primaryRole: 'parent', status: 'active' } as any) : null;
    });
  });

  it('returns only the owner\'s own matter report', async () => {
    const report = await getMatterAccessAudit('uid-owner-a', MATTER_A, { now: NOW });
    expect(report.matterId).toBe(MATTER_A);
    expect(report.grants.map(g => g.grantId)).toEqual(['g-a']);
    expect(report.currentAccess.map(a => a.accountId)).toEqual([OWNER_A, REVIEWER_1]);
    expect(JSON.stringify(report)).not.toContain(REVIEWER_2);
    expect(JSON.stringify(report)).not.toContain('SECRET-DIGEST');
  });

  it('never selects token_digest from the grants table', async () => {
    await getMatterAccessAudit('uid-owner-a', MATTER_A, { now: NOW });
    expect(selectedColumns.navigator_matter_access_grants).toHaveLength(1);
    expect(selectedColumns.navigator_matter_access_grants[0]).not.toMatch(/token|\*/);
  });

  it('performs no writes or RPCs', async () => {
    await getMatterAccessAudit('uid-owner-a', MATTER_A, { now: NOW });
    expect(writes).toEqual([]);
  });

  it('denies an owner of a different matter (cross-matter isolation)', async () => {
    await expect(getMatterAccessAudit('uid-owner-b', MATTER_A)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(selectedColumns.navigator_matter_access_grants).toBeUndefined();
  });

  it('denies a REVIEWER of the matter (reviewers cannot enumerate other reviewers)', async () => {
    await expect(getMatterAccessAudit('uid-reviewer-1', MATTER_A)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(selectedColumns.navigator_matter_access_grants).toBeUndefined();
  });

  it('gives a non-member of an existing matter and any caller of a nonexistent matter the same 403', async () => {
    const a = await getMatterAccessAudit('uid-owner-b', MATTER_A).catch(e => e);
    const b = await getMatterAccessAudit('uid-owner-b', randomUUID()).catch(e => e);
    expect([a.statusCode, a.code, a.message]).toEqual([b.statusCode, b.code, b.message]);
  });

  it('rejects an unknown account with 401', async () => {
    await expect(getMatterAccessAudit('uid-unknown', MATTER_A)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a malformed matter id before any lookup', async () => {
    await expect(getMatterAccessAudit('uid-owner-a', 'not-a-uuid')).rejects.toBeInstanceOf(LifecycleError);
    expect(accounts.findAccount).not.toHaveBeenCalled();
  });

  it('fails closed when the authorization read errors', async () => {
    failTable = 'navigator_matter_members';
    const err = await getMatterAccessAudit('uid-owner-a', MATTER_A).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LifecycleError);
  });

  it('fails closed (no partial report) when the grants read errors', async () => {
    failTable = 'navigator_matter_access_grants';
    await expect(getMatterAccessAudit('uid-owner-a', MATTER_A)).rejects.toThrow('grant read failed');
  });

  it('surfaces an incomplete revocation to the owner through the real service path', async () => {
    tables.navigator_matter_access_grants[0] = grant({
      id: 'g-a', status: 'REVOKED', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: REVIEWER_1,
      revoked_at: '2026-09-22T00:00:00.000Z', revoked_by_account_id: OWNER_A,
    });
    const report = await getMatterAccessAudit('uid-owner-a', MATTER_A, { now: NOW });
    expect(report.integrityFindings[0]).toMatchObject({ code: 'REVOKED_GRANT_MEMBERSHIP_PERSISTS', severity: 'CRITICAL', accountId: REVIEWER_1 });
  });
});
