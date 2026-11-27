import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/activate-code';
import * as authCheck from '../functions/api/_auth-check';

// DEVIN-OBS-01: access-code ownership is decided server-side before the atomic redemption RPC.
const env = { FIREBASE_PROJECT_ID: 'synthetic', SESSION_SECRET: 'synthetic-session-secret-0123456789', STAGING_SUPABASE_URL: 'https://synthetic.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };

function world(purchase: { email: string | null; reference_number: string | null } | null | 'down', signedIn: { email: string; verified: boolean }) {
  vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'uid_1', email: signedIn.email, emailVerified: signedIn.verified } as any);
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/rest/v1/access_codes')) {
      if (purchase === 'down') return new Response('{}', { status: 503 });
      return Response.json(purchase ? [purchase] : []);
    }
    if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) {
      return Response.json({ status: 'activated', session_id: 's1', tier: 'Pro', email: signedIn.email, expires_at: new Date(Date.now() + 86400000).toISOString() });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const redeem = (email: string, referenceNumber?: string) => onRequestPost({
  request: new Request('http://localhost/api/activate-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'PAID-CODE-0001', email, ...(referenceNumber ? { referenceNumber } : {}) }) }),
  env,
} as any);
const rpcCalled = (f: ReturnType<typeof vi.fn>) => f.mock.calls.some(([u]) => String(u).includes('redeem_access_code_atomic'));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('customer-specific paid code not bound to an email (legacy / manual issuance)', () => {
  const unbound = { email: null, reference_number: 'PS-ABCD2345' };
  it('cannot be redeemed by an account that does not present the payment reference', async () => {
    const f = world(unbound, { email: 'someone@example.test', verified: true });
    const r = await redeem('someone@example.test');
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('PURCHASE_REFERENCE_REQUIRED');
    expect(rpcCalled(f)).toBe(false);
  });
  it('a wrong payment reference is refused', async () => {
    const f = world(unbound, { email: 'someone@example.test', verified: true });
    expect((await redeem('someone@example.test', 'PS-WRONG234')).status).toBe(401);
    expect(rpcCalled(f)).toBe(false);
  });
  it('an unverified signed-in email is refused even with the reference', async () => {
    const f = world(unbound, { email: 'buyer@example.test', verified: false });
    expect((await redeem('buyer@example.test', 'PS-ABCD2345')).status).toBe(401);
    expect(rpcCalled(f)).toBe(false);
  });
  it('a typed email different from the verified signed-in email is refused', async () => {
    const f = world(unbound, { email: 'buyer@example.test', verified: true });
    expect((await redeem('other@example.test', 'PS-ABCD2345')).status).toBe(401);
    expect(rpcCalled(f)).toBe(false);
  });
  it('the payment reference with the verified signed-in email redeems (and the RPC binds the email)', async () => {
    const f = world(unbound, { email: 'buyer@example.test', verified: true });
    expect((await redeem('Buyer@Example.test', 'ps-abcd2345')).status).toBe(200);
    expect(rpcCalled(f)).toBe(true);
  });
});

describe('code bound to a purchase email', () => {
  const bound = { email: 'buyer@example.test', reference_number: 'PS-ABCD2345' };
  it('another signed-in account typing its own email is refused before the RPC', async () => {
    const f = world(bound, { email: 'intruder@example.test', verified: true });
    expect((await redeem('intruder@example.test')).status).toBe(401);
    expect(rpcCalled(f)).toBe(false);
  });
  it('the buyer redeems without the reference', async () => {
    const f = world(bound, { email: 'buyer@example.test', verified: true });
    expect((await redeem('buyer@example.test')).status).toBe(200);
    expect(rpcCalled(f)).toBe(true);
  });
});

describe('promotional code (no email, no payment reference)', () => {
  it('stays transferable', async () => {
    const f = world({ email: null, reference_number: null }, { email: 'anyone@example.test', verified: true });
    expect((await redeem('anyone@example.test')).status).toBe(200);
    expect(rpcCalled(f)).toBe(true);
  });
});

describe('failures', () => {
  it('purchase lookup unavailable: 503 and no redemption', async () => {
    const f = world('down', { email: 'buyer@example.test', verified: true });
    const r = await redeem('buyer@example.test');
    expect(r.status).toBe(503);
    expect(rpcCalled(f)).toBe(false);
  });
  it('unknown code goes to the RPC exactly as before (it answers invalid)', async () => {
    const f = world(null, { email: 'buyer@example.test', verified: true });
    await redeem('buyer@example.test');
    expect(rpcCalled(f)).toBe(true);
  });
});

describe('no oracle for a differently signed-in caller without a reference', () => {
  it.each([
    ['legacy paid code', { email: null, reference_number: 'PS-ABCD2345' }],
    ['email-bound code', { email: 'buyer@example.test', reference_number: 'PS-ABCD2345' }],
    ['unknown code', null],
  ] as const)('%s → the same 403 PURCHASE_REFERENCE_REQUIRED', async (_name, purchase) => {
    const f = world(purchase as any, { email: 'signedin@example.test', verified: true });
    const r = await redeem('typed-other@example.test');
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('PURCHASE_REFERENCE_REQUIRED');
    expect(rpcCalled(f)).toBe(false);
  });
});
