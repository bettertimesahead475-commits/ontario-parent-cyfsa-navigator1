/** Mutation gap M14: the purchase-email comparison for a code redeemed from a different signed-in email was untested. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../../functions/api/activate-code';
import * as authCheck from '../../functions/api/_auth-check';

const env = { FIREBASE_PROJECT_ID: 'synthetic', SESSION_SECRET: 'synthetic-session-secret-0123456789', STAGING_SUPABASE_URL: 'https://synthetic.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };

function setup(purchase: { email: string; reference_number: string }) {
  vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'attacker_uid', email: 'attacker@example.test', emailVerified: true } as any);
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/rest/v1/access_codes')) return Response.json([purchase]);
    if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) return Response.json({ status: 'activated', session_id: 's', tier: 'Pro', email: purchase.email, expires_at: new Date(Date.now() + 86400000).toISOString() });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const redeem = (email: string, referenceNumber: string) => onRequestPost({
  request: new Request('http://localhost/api/activate-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'SYNT-1234-CODE', email, referenceNumber }) }),
  env,
} as any);

describe('access-code redemption from a different signed-in email', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('rejects a typed email that is not the purchase email even with the right reference', async () => {
    const fetchMock = setup({ email: 'buyer@example.test', reference_number: 'REF-SYN-1' });
    const res = await redeem('someone-else@example.test', 'REF-SYN-1');
    expect(res.status).toBe(401);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('redeem_access_code_atomic'))).toBe(false);
  });

  it('rejects the purchase email with a wrong reference', async () => {
    const fetchMock = setup({ email: 'buyer@example.test', reference_number: 'REF-SYN-1' });
    expect((await redeem('buyer@example.test', 'REF-SYN-2')).status).toBe(401);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('redeem_access_code_atomic'))).toBe(false);
  });

  it('reaches the atomic RPC with the purchase email and matching reference', async () => {
    const fetchMock = setup({ email: 'buyer@example.test', reference_number: 'REF-SYN-1' });
    await redeem('Buyer@Example.test', 'ref-syn-1');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('redeem_access_code_atomic'))).toBe(true);
  });
});
