// Stage 10 slice 4: service-level checks for the audited (v3) invitation-creation path.
// Atomicity itself is proven against real PostgreSQL in professionalMatterAccessAudit.pg.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import * as accounts from './accounts';
import { createProfessionalGrant, ACCESS_LIFECYCLE_CONTRACT } from './professionalMatterAccess';

const MATTER = '22000000-0000-4000-8000-00000000000a';
const RECIPIENT = 'pro@example.test';
let rpc: ReturnType<typeof vi.fn> & ((fn: string, args?: unknown) => Promise<unknown>);
let calls: string[];
vi.mock('./access', () => ({ getSupabase: () => ({ rpc: (fn: string, args: any) => { calls.push(fn); return rpc(fn, args); }, from: () => { throw new Error('no direct table access expected'); } }) }));

const created = (over: Record<string, unknown> = {}) => ({
  id: '32000000-0000-4000-8000-000000000001', matter_id: MATTER, grantor_account_id: 'acct-owner', capability: 'REVIEWER',
  status: 'PENDING', expires_at: '2026-10-01T00:00:00Z', created_at: '2026-09-24T00:00:00Z', recipient_email: RECIPIENT, ...over,
});

beforeEach(() => {
  calls = [];
  vi.spyOn(accounts, 'findAccount').mockResolvedValue({ id: 'acct-owner', primaryRole: 'parent', status: 'active' } as any);
  rpc = vi.fn(async (fn: string) => fn === 'navigator_matter_access_lifecycle_contract_v4'
    ? { data: ACCESS_LIFECYCLE_CONTRACT, error: null }
    : { data: created(), error: null });
});

describe('createProfessionalGrant (contract v4, atomic create_recipient_bound_matter_grant)', () => {
  it('requires the v4 contract and uses exactly one lifecycle RPC; no direct table write', async () => {
    expect(ACCESS_LIFECYCLE_CONTRACT).toBe('navigator_matter_access_lifecycle_v4');
    const { grant, rawToken } = await createProfessionalGrant('uid-owner', MATTER, { recipientEmail: RECIPIENT });
    expect(calls).toEqual(['navigator_matter_access_lifecycle_contract_v4', 'create_recipient_bound_matter_grant']);
    expect(grant).toMatchObject({ id: created().id, matterId: MATTER, status: 'PENDING' });
    const args = rpc.mock.calls[1][1];
    expect(args).toEqual({ p_firebase_uid: 'uid-owner', p_matter_id: MATTER, p_token_digest: crypto.createHash('sha256').update(rawToken).digest('hex'), p_expires_in_days: 7, p_recipient_email: RECIPIENT });
    // Only the digest leaves the server; never the raw token, never an actor, role or timestamp.
    expect(JSON.stringify(args)).not.toContain(rawToken);
    expect(Object.keys(args).sort()).toEqual(['p_expires_in_days', 'p_firebase_uid', 'p_matter_id', 'p_recipient_email', 'p_token_digest']);
  });

  it.each([
    ['absent', { data: null, error: { message: 'function does not exist' } }],
    ['v2 only', { data: 'navigator_matter_access_lifecycle_v2', error: null }],
    ['v3 only (no recipient binding)', { data: 'navigator_matter_access_lifecycle_v3', error: null }],
  ])('refuses before any lifecycle call when the contract is %s', async (_l, contract) => {
    rpc.mockImplementation(async (fn: string) => fn === 'navigator_matter_access_lifecycle_contract_v4' ? contract : { data: created(), error: null });
    await expect(createProfessionalGrant('uid-owner', MATTER, { recipientEmail: RECIPIENT })).rejects.toThrow(/access lifecycle contract/);
    expect(calls).toEqual(['navigator_matter_access_lifecycle_contract_v4']);
  });

  it.each([[0], [-1], [366], [1.5]])('rejects expiry %s days before any database call', async days => {
    await expect(createProfessionalGrant('uid-owner', MATTER, { recipientEmail: RECIPIENT, expiresInDays: days })).rejects.toThrow(/1 to 365 days/);
    expect(calls).toEqual([]);
  });

  it.each([
    ['NOT_OWNER: Only the matter OWNER can grant access.', /UNAUTHORIZED: Only OWNER can grant access/],
    ['ACCOUNT_UNAVAILABLE: Account not found or inactive.', /Account not found/],
    ['INJECTED_AUDIT_FAILURE on relation "navigator_matter_access_events"', /^Failed to create grant\.$/],
  ])('maps database error %j without leaking raw text', async (message, expected) => {
    rpc.mockImplementation(async (fn: string) => fn === 'navigator_matter_access_lifecycle_contract_v4'
      ? { data: ACCESS_LIFECYCLE_CONTRACT, error: null } : { data: null, error: { message } });
    const err = await createProfessionalGrant('uid-owner', MATTER, { recipientEmail: RECIPIENT }).catch(e => e);
    expect(err.message).toMatch(expected);
    expect(err.message).not.toMatch(/relation|navigator_matter_access_events/);
  });

  it.each([
    ['no data', null],
    ['a grant for a different matter', created({ matter_id: '22000000-0000-4000-8000-0000000000ff' })],
    ['a non-PENDING grant', created({ status: 'ACCEPTED' })],
    ['a missing id', created({ id: undefined })],
  ])('fails closed on %s from the database (response identity guard)', async (_l, data) => {
    rpc.mockImplementation(async (fn: string) => fn === 'navigator_matter_access_lifecycle_contract_v4'
      ? { data: ACCESS_LIFECYCLE_CONTRACT, error: null } : { data, error: null });
    await expect(createProfessionalGrant('uid-owner', MATTER, { recipientEmail: RECIPIENT })).rejects.toThrow(/Failed to create grant/);
  });

  it('accepts a matter id in any case (PostgreSQL canonicalizes uuids)', async () => {
    await expect(createProfessionalGrant('uid-owner', MATTER.toUpperCase(), { recipientEmail: RECIPIENT })).resolves.toBeTruthy();
  });
});
