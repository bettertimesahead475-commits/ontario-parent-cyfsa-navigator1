// Stage 7B access-lifecycle remediation: service-layer regression tests.
//
// The fake database below answers BOTH the pre-remediation service shape (direct table
// update/delete) and the remediated shape (the atomic revoke_matter_grant RPC), so the same
// behavioural assertions ran against the defective implementation (and failed) and now pass.
// The RPC here is a reference model of the SQL contract; the real SQL is exercised against
// PostgreSQL in professionalMatterAccess.pg.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import * as accounts from './accounts';
import { acceptProfessionalGrant, revokeProfessionalGrant } from './professionalMatterAccess';

type Row = Record<string, any>;
let tables: { navigator_matter_members: Row[]; navigator_matter_access_grants: Row[] };
let failWrites: boolean;
let rpcCalls: { fn: string; args: Row }[];
let directMemberDeletes: number;
let rpcOverride: ((fn: string, args: Row) => { data: any; error: any } | undefined) | null;
// Contract version the fake database reports; null models a database without the remediation.
let contractVersion: string | null;
// Stage 10 slice 7: acceptance needs the caller's verified email claims (from the verified token).
const CLAIMS = { email: 'recipient@example.test', emailVerified: true };

const GA = '0a0a0a0a-0000-4000-8000-00000000000a';
const GB = '0b0b0b0b-0000-4000-8000-00000000000b';
const GO = '0c0c0c0c-0000-4000-8000-00000000000c';
const GM = '0d0d0d0d-0000-4000-8000-00000000000d';
const G2 = '0e0e0e0e-0000-4000-8000-00000000000e';

const uidToAccount: Record<string, string> = {
  'uid-owner': 'acct-owner',
  'uid-owner2': 'acct-owner2',
  'uid-lawyer': 'acct-lawyer',
  'uid-lawyer2': 'acct-lawyer2',
};

function referenceRevoke(uid: string, grantId: string) {
  const account = uidToAccount[uid];
  if (!account) return { data: null, error: { message: 'ACCOUNT_UNAVAILABLE: Account not found or inactive.' } };
  const grant = tables.navigator_matter_access_grants.find(g => g.id === grantId);
  if (!grant) return { data: null, error: { message: 'GRANT_NOT_FOUND: Grant not found.' } };
  const owner = tables.navigator_matter_members.find(m => m.matter_id === grant.matter_id && m.account_id === account && m.role === 'OWNER');
  if (!owner) return { data: null, error: { message: 'NOT_OWNER: Only the matter OWNER can revoke access.' } };
  if (failWrites) return { data: null, error: { message: 'could not write: disk full' } };
  if (grant.status !== 'REVOKED') Object.assign(grant, { status: 'REVOKED', revoked_at: new Date().toISOString(), revoked_by_account_id: account });
  let removed = false;
  const acc = grant.accepted_by_account_id;
  const stillBacked = tables.navigator_matter_access_grants.some(g =>
    g.id !== grant.id && g.matter_id === grant.matter_id && g.status === 'ACCEPTED' && g.accepted_by_account_id === acc);
  if (acc && !stillBacked) {
    const i = tables.navigator_matter_members.findIndex(m => m.matter_id === grant.matter_id && m.account_id === acc && m.role === 'REVIEWER');
    if (i > -1) { tables.navigator_matter_members.splice(i, 1); removed = true; }
  }
  return { data: { grant_id: grant.id, matter_id: grant.matter_id, status: 'REVOKED', membership_removed: removed }, error: null };
}

vi.mock('./access', () => ({
  getSupabase: () => ({
    from: (table: 'navigator_matter_members' | 'navigator_matter_access_grants') => {
      let filters: [string, any][] = [];
      const rows = () => tables[table].filter(r => filters.every(([c, v]) => r[c] === v));
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { filters.push([c, v]); return q; },
        single: async () => {
          const found = rows()[0];
          return { data: found ?? null, error: found ? null : { message: 'Not found' } };
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        update: (patch: Row) => {
          const u: any = {
            eq: (c: string, v: any) => {
              filters.push([c, v]);
              if (failWrites) return Promise.resolve({ data: null, error: { message: 'could not write: disk full' } });
              rows().forEach(r => Object.assign(r, patch));
              return Promise.resolve({ data: null, error: null });
            },
          };
          return u;
        },
        delete: () => {
          const del: any = {
            eq: (c: string, v: any) => { filters.push([c, v]); return del; },
            then: (resolve: any, reject: any) => {
              if (table === 'navigator_matter_members') directMemberDeletes++;
              if (failWrites) return Promise.resolve({ error: { message: 'could not write: disk full' } }).then(resolve, reject);
              const doomed = new Set(rows());
              tables[table] = tables[table].filter(r => !doomed.has(r)) as any;
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return del;
        },
      };
      return q;
    },
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      const override = rpcOverride?.(fn, args);
      if (override) return Promise.resolve(override);
      if (fn === 'navigator_matter_access_lifecycle_contract_v4') {
        return Promise.resolve(contractVersion === null
          ? { data: null, error: { message: 'function public.navigator_matter_access_lifecycle_contract_v4() does not exist' } }
          : { data: contractVersion, error: null });
      }
      if (fn === 'revoke_matter_grant') return Promise.resolve(referenceRevoke(args.p_firebase_uid, args.p_grant_id));
      return Promise.resolve({ data: null, error: { message: 'Unknown RPC' } });
    },
  }),
}));

const acceptedGrant = (id: string, account: string, matter = 'matter-1', grantor = 'acct-owner') =>
  ({ id, matter_id: matter, grantor_account_id: grantor, status: 'ACCEPTED', accepted_by_account_id: account, accepted_at: '2026-09-20T00:00:00Z' });

beforeEach(() => {
  failWrites = false;
  rpcCalls = [];
  directMemberDeletes = 0;
  rpcOverride = null;
  contractVersion = 'navigator_matter_access_lifecycle_v4';
  tables = {
    navigator_matter_members: [
      { matter_id: 'matter-1', account_id: 'acct-owner', role: 'OWNER' },
      { matter_id: 'matter-2', account_id: 'acct-owner2', role: 'OWNER' },
      { matter_id: 'matter-1', account_id: 'acct-lawyer', role: 'REVIEWER' },
    ],
    navigator_matter_access_grants: [acceptedGrant(GA, 'acct-lawyer')],
  };
  vi.spyOn(accounts, 'findAccount').mockImplementation(async (uid: string) =>
    uidToAccount[uid] ? ({ id: uidToAccount[uid], primaryRole: 'parent', status: 'active' } as any) : null);
});

const reviewerMembership = (account = 'acct-lawyer', matter = 'matter-1') =>
  tables.navigator_matter_members.find(m => m.matter_id === matter && m.account_id === account && m.role === 'REVIEWER');

describe('BUG 1 -- revocation must fail closed', () => {
  it('rejects (never reports success) when the database write fails, and access is not reported removed', async () => {
    failWrites = true;
    await expect(revokeProfessionalGrant('uid-owner', GA)).rejects.toThrow();
    expect(reviewerMembership()).toBeDefined();
  });

  it('rejects when the database returns no confirmation of the revocation', async () => {
    rpcOverride = fn => (fn === 'revoke_matter_grant' ? { data: null, error: null } : undefined);
    await expect(revokeProfessionalGrant('uid-owner', GA)).rejects.toThrow(/Revocation failed/);
  });

  it('rejects a confirmation that does not report REVOKED for the requested grant', async () => {
    rpcOverride = fn => (fn === 'revoke_matter_grant'
      ? { data: { grant_id: GO, status: 'REVOKED', membership_removed: true }, error: null } : undefined);
    await expect(revokeProfessionalGrant('uid-owner', GA)).rejects.toThrow(/Revocation failed/);
  });

  it('re-revoking an already-REVOKED grant still removes a lingering membership instead of short-circuiting to success', async () => {
    Object.assign(tables.navigator_matter_access_grants[0], { status: 'REVOKED', revoked_at: '2026-09-21T00:00:00Z' });
    const res = await revokeProfessionalGrant('uid-owner', GA);
    expect(res.success).toBe(true);
    expect(reviewerMembership()).toBeUndefined();
  });

  it('does not leak raw database error text to the caller', async () => {
    failWrites = true;
    const err = await revokeProfessionalGrant('uid-owner', GA).catch(e => e);
    expect(String(err.message)).not.toMatch(/disk full/);
  });
});

describe('BUG 4 -- stale grant revocation must not remove independently authorized access', () => {
  it('revoking an older accepted grant keeps access backed by a newer accepted grant', async () => {
    tables.navigator_matter_access_grants.push(acceptedGrant(GB, 'acct-lawyer'));
    const res = await revokeProfessionalGrant('uid-owner', GA);
    expect(reviewerMembership()).toBeDefined();
    expect(res).toMatchObject({ success: true, membershipRemoved: false });
    const res2 = await revokeProfessionalGrant('uid-owner', GB);
    expect(res2).toMatchObject({ success: true, membershipRemoved: true });
    expect(reviewerMembership()).toBeUndefined();
  });

  it('never deletes memberships directly from the service; removal happens only inside the atomic RPC', async () => {
    await revokeProfessionalGrant('uid-owner', GA);
    expect(directMemberDeletes).toBe(0);
    expect(rpcCalls).toEqual([
      { fn: 'navigator_matter_access_lifecycle_contract_v4', args: undefined },
      { fn: 'revoke_matter_grant', args: { p_firebase_uid: 'uid-owner', p_grant_id: GA } },
    ]);
  });
});

describe('Revocation authorization and edge cases', () => {
  it('unknown invitation is refused', async () => {
    await expect(revokeProfessionalGrant('uid-owner', GM)).rejects.toThrow(/Grant not found/);
  });

  it('a reviewer cannot revoke', async () => {
    await expect(revokeProfessionalGrant('uid-lawyer', GA)).rejects.toThrow(/UNAUTHORIZED/);
    expect(reviewerMembership()).toBeDefined();
  });

  it('the owner of a different matter cannot revoke', async () => {
    await expect(revokeProfessionalGrant('uid-owner2', GA)).rejects.toThrow(/UNAUTHORIZED/);
    expect(tables.navigator_matter_access_grants[0].status).toBe('ACCEPTED');
  });

  it('an unknown account cannot revoke', async () => {
    await expect(revokeProfessionalGrant('uid-unknown', GA)).rejects.toThrow(/Account not found/);
    expect(rpcCalls).toEqual([]);
  });

  it('double revoke is idempotent', async () => {
    await revokeProfessionalGrant('uid-owner', GA);
    const again = await revokeProfessionalGrant('uid-owner', GA);
    expect(again).toMatchObject({ success: true, membershipRemoved: false });
    expect(reviewerMembership()).toBeUndefined();
  });

  it('revoking on matter 1 does not touch the same reviewer on matter 2', async () => {
    tables.navigator_matter_members.push({ matter_id: 'matter-2', account_id: 'acct-lawyer', role: 'REVIEWER' });
    tables.navigator_matter_access_grants.push(acceptedGrant(G2, 'acct-lawyer', 'matter-2', 'acct-owner2'));
    await revokeProfessionalGrant('uid-owner', GA);
    expect(reviewerMembership('acct-lawyer', 'matter-2')).toBeDefined();
  });
});

describe('BUG 2 / BUG 3 -- acceptance outcomes surfaced by the service', () => {
  const token = 'raw-token';
  const expectedDigest = crypto.createHash('sha256').update(token).digest('hex');

  it('maps the owner-acceptance refusal to a clear error', async () => {
    rpcOverride = fn => (fn === 'accept_recipient_bound_matter_grant'
      ? { data: null, error: { message: 'OWNER_CANNOT_ACCEPT: An OWNER of this matter cannot accept a professional invitation to it.' } } : undefined);
    await expect(acceptProfessionalGrant('uid-owner', token, CLAIMS)).rejects.toThrow(/matter owner cannot accept/i);
    expect(rpcCalls.map(c => c.fn)).toEqual(['navigator_matter_access_lifecycle_contract_v4', 'accept_recipient_bound_matter_grant']);
    // The only identity arguments are the verified uid and the verified-token email claims.
    expect(rpcCalls[1].args).toEqual({ p_firebase_uid: 'uid-owner', p_token_digest: expectedDigest, p_verified_email: CLAIMS.email, p_email_verified: true });
  });

  it('treats a persisted EXPIRED outcome as a refusal, never as acceptance', async () => {
    rpcOverride = fn => (fn === 'accept_recipient_bound_matter_grant' ? { data: { outcome: 'EXPIRED', grant_id: 'g' }, error: null } : undefined);
    await expect(acceptProfessionalGrant('uid-lawyer', token, CLAIMS)).rejects.toThrow(/Invitation has expired/);
  });

  it('rejects an acceptance response that does not confirm ACCEPTED with a matter id', async () => {
    rpcOverride = fn => (fn === 'accept_recipient_bound_matter_grant' ? { data: { outcome: 'SOMETHING_ELSE' }, error: null } : undefined);
    await expect(acceptProfessionalGrant('uid-lawyer', token, CLAIMS)).rejects.toThrow(/Acceptance failed/);
    rpcOverride = fn => (fn === 'accept_recipient_bound_matter_grant' ? { data: null, error: null } : undefined);
    await expect(acceptProfessionalGrant('uid-lawyer', token, CLAIMS)).rejects.toThrow(/Acceptance failed/);
  });

  it('returns the matter only on a confirmed ACCEPTED outcome', async () => {
    rpcOverride = fn => (fn === 'accept_recipient_bound_matter_grant'
      ? { data: { outcome: 'ACCEPTED', grant_id: 'g', matter_id: 'matter-1', role: 'REVIEWER' }, error: null } : undefined);
    await expect(acceptProfessionalGrant('uid-lawyer', token, CLAIMS)).resolves.toEqual({ success: true, matterId: 'matter-1' });
  });

  it('does not leak raw database error text on unexpected acceptance failures', async () => {
    rpcOverride = fn => (fn === 'accept_recipient_bound_matter_grant' ? { data: null, error: { message: 'relation "x" does not exist' } } : undefined);
    const err = await acceptProfessionalGrant('uid-lawyer', token, CLAIMS).catch(e => e);
    expect(err.message).toMatch(/Acceptance failed/);
    expect(err.message).not.toMatch(/relation/);
  });
});

describe('B-1 -- the remediated database contract is required before any lifecycle RPC', () => {
  it.each([
    ['absent (legacy database)', null],
    ['a different version', 'navigator_matter_access_lifecycle_v1'],
    ['v2 only (safe functions but no audit wiring)', 'navigator_matter_access_lifecycle_v2'],
    ['an empty value', ''],
  ])('acceptance is refused when the contract is %s, and the accept RPC is never called', async (_label, version) => {
    contractVersion = version as string | null;
    await expect(acceptProfessionalGrant('uid-lawyer', 'raw-token', CLAIMS)).rejects.toThrow(/access lifecycle contract/i);
    expect(rpcCalls.map(c => c.fn)).toEqual(['navigator_matter_access_lifecycle_contract_v4']);
  });

  it.each([
    ['absent (legacy database)', null],
    ['a different version', 'navigator_matter_access_lifecycle_v1'],
    ['v2 only (safe functions but no audit wiring)', 'navigator_matter_access_lifecycle_v2'],
  ])('revocation is refused when the contract is %s; no revoke RPC and no direct table write', async (_label, version) => {
    contractVersion = version as string | null;
    await expect(revokeProfessionalGrant('uid-owner', GA)).rejects.toThrow(/access lifecycle contract/i);
    expect(rpcCalls.map(c => c.fn)).toEqual(['navigator_matter_access_lifecycle_contract_v4']);
    expect(directMemberDeletes).toBe(0);
    expect(tables.navigator_matter_access_grants[0].status).toBe('ACCEPTED');
    expect(reviewerMembership()).toBeDefined();
  });
});

describe('B-2 -- grant ids are validated and canonicalized before revocation', () => {
  it.each([
    ['uppercase', GA.toUpperCase()],
    ['mixed case', GA.split('').map((ch, i) => (i % 2 ? ch.toUpperCase() : ch)).join('')],
    ['surrounding whitespace', `  ${GA}  `],
  ])('a %s form of a valid id revokes the same grant and reports success', async (_label, variant) => {
    const res = await revokeProfessionalGrant('uid-owner', variant);
    expect(res).toEqual({ success: true, membershipRemoved: true });
    expect(rpcCalls.at(-1)).toEqual({ fn: 'revoke_matter_grant', args: { p_firebase_uid: 'uid-owner', p_grant_id: GA } });
    expect(reviewerMembership()).toBeUndefined();
  });

  it.each([['not-a-uuid'], [''], ['0a0a0a0a-0000-4000-8000-00000000000'], [`${GA}; drop table x`]])(
    'malformed id %j is rejected before any database call', async (bad) => {
      await expect(revokeProfessionalGrant('uid-owner', bad)).rejects.toThrow(/grantId must be a UUID/);
      expect(rpcCalls).toEqual([]);
      expect(reviewerMembership()).toBeDefined();
    });

  it('a response for a different valid grant id still fails closed', async () => {
    rpcOverride = fn => (fn === 'revoke_matter_grant'
      ? { data: { grant_id: GB, matter_id: 'matter-1', status: 'REVOKED', membership_removed: true }, error: null } : undefined);
    await expect(revokeProfessionalGrant('uid-owner', GA.toUpperCase())).rejects.toThrow(/Revocation failed/);
  });
});
