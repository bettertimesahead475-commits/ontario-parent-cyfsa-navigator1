import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authCheck from '../functions/api/_auth-check';
import { onRequestPost as claim } from '../functions/api/claim-purchase';
import { onRequestGet as myPayments } from '../functions/api/my-payments';
import { auditObjectName } from '../functions/api/_admin-store';

const env = { FIREBASE_PROJECT_ID: 'p', SESSION_SECRET: 'secret', PAYMENT_EMAIL: 'pay@cyfsanavigator.com', STAGING_SUPABASE_URL: 'https://db.test', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'k' };
const OWNER = { status: 'verified', uid: 'uid-owner', email: 'parent@example.com', emailVerified: true } as const;

type Db = { payments: any[]; codes: any[]; sessions: any[]; audit: string[]; auditUnreadable?: boolean; rpc: any[]; writes: string[] };
let db: Db;
const order = (over: Partial<any> = {}) => ({ id: '11111111-1111-4111-8111-111111111111', reference_number: 'PS-ABCD2345', plan: 'Premium', amount: 49.99, status: 'approved',
  submitted_at: '2026-11-20T00:00:00Z', approved_at: '2026-11-21T00:00:00Z', notes: 'email:parent@example.com;uid:uid-owner', firebase_uid: 'uid-owner', ...over });
const refundRecord = (ref: string) => auditObjectName({ at: '2026-11-22T00:00:00.000Z', action: 'refund', target: ref }, 'n1');

function install() {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input); const method = init?.method ?? 'GET';
    if (method !== 'GET' && url.pathname !== '/storage/v1/object/list/analysis_jobs') db.writes.push(`${method} ${url.pathname}`);
    if (url.pathname === '/storage/v1/object/list/analysis_jobs') return db.auditUnreadable ? new Response('x', { status: 500 }) : Response.json(db.audit.map((name) => ({ name })));
    if (url.pathname.startsWith('/storage/v1/object/analysis_jobs/')) return Response.json({});
    if (url.pathname === '/rest/v1/payments') {
      const ref = url.searchParams.get('reference_number')?.replace('eq.', ''); const uid = url.searchParams.get('firebase_uid')?.replace('eq.', '');
      return Response.json(db.payments.filter((p) => (!ref || p.reference_number === ref) && (!uid || p.firebase_uid === uid)));
    }
    if (url.pathname === '/rest/v1/access_codes') {
      if (method === 'PATCH') { db.codes.filter((c) => !c.used_at).forEach((c) => { c.expires_at = 'now'; }); return new Response(null, { status: 204 }); }
      if (method === 'POST') { db.codes.push({ ...JSON.parse(String(init?.body)), used_at: null }); return new Response(null, { status: 201 }); }
      return Response.json(db.codes);
    }
    if (url.pathname === '/rest/v1/rpc/redeem_access_code_atomic') {
      const args = JSON.parse(String(init?.body)); db.rpc.push(args);
      return Response.json({ status: 'activated', session_id: 'sess-1', tier: 'Premium', expires_at: '2026-12-27T00:00:00Z' });
    }
    if (url.pathname === '/rest/v1/navigator_paid_sessions') return Response.json(db.sessions);
    return new Response('unexpected', { status: 500 });
  }));
}
const claimReq = (ref: unknown = 'PS-ABCD2345') => claim({ request: new Request('https://x/api/claim-purchase', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ referenceNumber: ref }) }), env });
const statusReq = () => myPayments({ request: new Request('https://x/api/my-payments', { headers: { 'cf-connecting-ip': `10.1.0.${Math.floor(Math.random() * 250)}` } }), env });

beforeEach(() => { db = { payments: [order()], codes: [], sessions: [], audit: [], rpc: [], writes: [] }; install(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('POST /api/claim-purchase', () => {
  it('activates an administrator-approved order for the account that placed it', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ ...OWNER, uid: `uid-owner` });
    const res = await claimReq();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, tier: 'Premium', referenceNumber: 'PS-ABCD2345' });
    expect(db.rpc).toEqual([expect.objectContaining({ p_firebase_uid: 'uid-owner', p_email: 'parent@example.com' })]);
    expect(db.codes).toHaveLength(1);
    expect(db.codes[0]).toMatchObject({ reference_number: 'PS-ABCD2345', tier: 'Premium', email: 'parent@example.com' });
    expect(db.codes[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never activates an order still awaiting payment verification', async () => {
    db.payments = [order({ status: 'pending', approved_at: null })];
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue(OWNER);
    const res = await claimReq();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PAYMENT_NOT_VERIFIED');
    expect(db.rpc).toHaveLength(0);
    expect(db.writes).toEqual([]);
  });

  it.each([
    ['another account', { ...OWNER, uid: 'uid-attacker' }],
    ['the same uid with a different verified email', { ...OWNER, email: 'other@example.com' }],
  ])('refuses %s with the not-found answer and writes nothing', async (_label, identity) => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue(identity as any);
    const res = await claimReq();
    expect(res.status).toBe(404);
    expect(db.rpc).toHaveLength(0);
    expect(db.writes).toEqual([]);
  });

  it('refuses an unverified email, a malformed reference and a signed-out caller', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ ...OWNER, emailVerified: false });
    expect((await claimReq()).status).toBe(403);
    expect((await claimReq('PS-x;drop')).status).toBe(400);
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'denied' } as any);
    expect((await claimReq()).status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it('refuses a refunded order and fails closed when the refund history cannot be read', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue(OWNER);
    db.audit = [refundRecord('PS-ABCD2345')];
    expect((await claimReq()).status).toBe(409);
    db.audit = []; db.auditUnreadable = true;
    expect((await claimReq()).status).toBe(503);
    expect(db.rpc).toHaveLength(0);
  });

  it('does not issue a second entitlement once the order was redeemed', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue(OWNER);
    db.codes = [{ reference_number: 'PS-ABCD2345', used_at: '2026-11-21T01:00:00Z', expires_at: null }];
    const res = await claimReq();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ALREADY_ACTIVATED');
    expect(db.rpc).toHaveLength(0);
  });

  it('refuses a duplicated reference instead of choosing a row', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue(OWNER);
    db.payments = [order(), order({ id: '22222222-2222-4222-8222-222222222222' })];
    expect((await claimReq()).status).toBe(404);
    expect(db.rpc).toHaveLength(0);
  });
});

describe('GET /api/my-payments', () => {
  it('lists only the caller\'s orders with states, instructions for pending ones, and renewal reminders', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue(OWNER);
    db.payments = [
      order({ reference_number: 'PS-PEND2345', status: 'pending', approved_at: null }),
      order({ reference_number: 'PS-READY234' }),
      order({ reference_number: 'PS-USED2345' }),
      order({ reference_number: 'PS-REFD2345' }),
      order({ reference_number: 'PS-THEIRS23', firebase_uid: 'uid-other' }),
    ];
    db.codes = [{ reference_number: 'PS-USED2345', used_at: '2026-11-21T01:00:00Z', expires_at: null }];
    db.audit = [refundRecord('PS-REFD2345')];
    db.sessions = [{ tier: 'Premium', issued_at: '2026-11-01T00:00:00Z', expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }];
    const res = await statusReq();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orders.map((o: any) => [o.referenceNumber, o.state])).toEqual([
      ['PS-PEND2345', 'awaiting_verification'], ['PS-READY234', 'ready_to_activate'], ['PS-USED2345', 'activated'], ['PS-REFD2345', 'refunded'],
    ]);
    expect(json.orders[0].instructions).toContain('$49.99 CAD');
    expect(json.orders[0].instructions).toContain('PS-PEND2345');
    expect(json.orders[1].instructions).toBeUndefined();
    expect(json.entitlements[0]).toMatchObject({ tier: 'Premium', daysLeft: 3, renewalDue: true });
    expect(JSON.stringify(json)).not.toContain('uid-');
    expect(db.writes).toEqual([]);
  });

  it('shows approved orders as unknown, not activatable, when the refund history cannot be read', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue(OWNER);
    db.auditUnreadable = true;
    const json = await (await statusReq()).json();
    expect(json.orders[0].state).toBe('unknown');
  });

  it('requires sign-in', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'denied' } as any);
    expect((await statusReq()).status).toBe(401);
  });
});
