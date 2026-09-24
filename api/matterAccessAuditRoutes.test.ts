import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import * as access from './services/access.js';
import * as accounts from './services/accounts.js';

vi.mock('./services/access.js');
vi.mock('./services/accounts.js');
vi.mock('./services/firebaseAdmin.js', () => ({
  verifyFirebaseToken: vi.fn(async (header: string | undefined) => {
    const match = header ? /^Bearer (.+)$/.exec(header) : null;
    // Only these literal tokens resolve; any forged uid in a header, body or query fails closed.
    return match && ['uid-owner-a', 'uid-owner-b', 'uid-reviewer-1'].includes(match[1]) ? { uid: match[1], email: null } : null;
  }),
}));

import { registerMatterAccessAuditRoutes } from './matterAccessAuditRoutes.js';

const MATTER_A = randomUUID();
const MATTER_B = randomUUID();
let failGrants: boolean;

function installFakeDb() {
  const tables: Record<string, any[]> = {
    navigator_matter_members: [
      { matter_id: MATTER_A, account_id: 'acct-owner-a', role: 'OWNER' },
      { matter_id: MATTER_A, account_id: 'acct-reviewer-1', role: 'REVIEWER' },
      { matter_id: MATTER_B, account_id: 'acct-owner-b', role: 'OWNER' },
    ],
    navigator_matter_access_grants: [
      {
        id: 'grant-a', matter_id: MATTER_A, grantor_account_id: 'acct-owner-a', capability: 'REVIEWER', status: 'ACCEPTED',
        expires_at: '2026-09-30T00:00:00.000Z', accepted_at: '2026-09-21T00:00:00.000Z', accepted_by_account_id: 'acct-reviewer-1',
        revoked_at: null, revoked_by_account_id: null, created_at: '2026-09-20T00:00:00.000Z', token_digest: 'SECRET-DIGEST',
      },
    ],
  };
  vi.mocked(access.getSupabase).mockReturnValue({
    from: (table: string) => {
      let rows = [...(tables[table] || [])];
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => { rows = rows.filter(r => r[col] === val); return chain; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: any, reject: any) =>
          Promise.resolve(failGrants && table === 'navigator_matter_access_grants'
            ? { data: null, error: new Error('internal detail: relation does not exist') }
            : { data: rows, error: null }).then(resolve, reject),
      };
      return chain;
    },
  } as any);
}

function app() {
  const a = express();
  a.use(express.json());
  registerMatterAccessAuditRoutes(a);
  return a;
}

describe('Stage 10 -- GET /api/matters/:matterId/access-audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failGrants = false;
    installFakeDb();
    vi.mocked(accounts.findAccount).mockImplementation(async (uid: string) => {
      const map: Record<string, string> = { 'uid-owner-a': 'acct-owner-a', 'uid-owner-b': 'acct-owner-b', 'uid-reviewer-1': 'acct-reviewer-1' };
      return map[uid] ? ({ id: map[uid], primaryRole: 'parent', status: 'active' } as any) : null;
    });
  });

  it('requires authentication', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER_A}/access-audit`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SIGN_IN_REQUIRED');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('ignores caller-supplied identity in query or body', async () => {
    const res = await request(app())
      .get(`/api/matters/${MATTER_A}/access-audit?uid=uid-owner-a&accountId=acct-owner-a`)
      .set('Authorization', 'Bearer forged')
      .send({ uid: 'uid-owner-a' });
    expect(res.status).toBe(401);
  });

  it('returns the report to the matter owner without secrets', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER_A}/access-audit`).set('Authorization', 'Bearer uid-owner-a');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.matterId).toBe(MATTER_A);
    expect(res.body.currentAccess.map((a: any) => [a.accountId, a.basis])).toEqual([
      ['acct-owner-a', 'MATTER_OWNER'],
      ['acct-reviewer-1', 'ACCEPTED_GRANT'],
    ]);
    expect(res.body.integrityFindings).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-DIGEST');
  });

  it('denies a reviewer of the matter', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER_A}/access-audit`).set('Authorization', 'Bearer uid-reviewer-1');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('denies the owner of another matter', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER_A}/access-audit`).set('Authorization', 'Bearer uid-owner-b');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('acct-reviewer-1');
  });

  it('rejects a malformed matter id with 400', async () => {
    const res = await request(app()).get('/api/matters/not-a-uuid/access-audit').set('Authorization', 'Bearer uid-owner-a');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  it('fails closed with a generic 503 that leaks no internal error text', async () => {
    failGrants = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app()).get(`/api/matters/${MATTER_A}/access-audit`).set('Authorization', 'Bearer uid-owner-a');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'ACCESS_AUDIT_UNAVAILABLE', error: 'Access audit is unavailable.' });
    expect(JSON.stringify(res.body)).not.toContain('relation');
  });

  it('exposes no write methods on the audit path', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app())[method](`/api/matters/${MATTER_A}/access-audit`).set('Authorization', 'Bearer uid-owner-a');
      expect(res.status).toBe(404);
    }
  });
});
