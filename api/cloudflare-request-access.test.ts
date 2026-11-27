import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/request-access';
import * as authCheck from '../functions/api/_auth-check';
import { TIER_PRICES as PRICING } from '../functions/api/access-pricing';

describe('Cloudflare Request Access API (/api/request-access)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const validEnv = {
    FIREBASE_PROJECT_ID: 'test-firebase-proj',
    PAYMENT_EMAIL: 'pay@cyfsanavigator.com',
    STAGING_SUPABASE_URL: 'https://test-supabase.co',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  };

  it('rejects invalid or missing plan tier', async () => {
    const req = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'NonExistentPlan' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('tier must be a valid plan tier');
  });

  it('rejects invalid requestKey syntax', async () => {
    const req = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'Basic', requestKey: 'bad!chars$' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('INVALID_REQUEST_KEY');
  });

  it('requires authentication and verified email', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'denied' });
    const req = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'Basic' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe('SIGN_IN_REQUIRED');
  });

  it('rejects unverified email addresses', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'uid-123',
      email: 'parent@example.com',
      emailVerified: false,
    });
    const req = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'Basic' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects email mismatch between token and request body', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'uid-123',
      email: 'parent@example.com',
      emailVerified: true,
    });
    const req = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'Basic', email: 'different@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('EMAIL_MISMATCH');
  });

  it('creates payment reference and returns payment instructions', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'uid-123',
      email: 'parent@example.com',
      emailVerified: true,
    });

    let insertedBody: any = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        insertedBody = JSON.parse(init.body as string);
        return new Response(null, { status: 201 });
      }
      return Response.json([], { status: 200 });
    }));

    const req = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'Pro', email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.referenceNumber).toMatch(/^PS-[A-Z0-9]{8}$/);
    expect(json.amount).toBe(149);
    expect(insertedBody?.amount).toBe(149);
    expect(json.payTo).toBe('pay@cyfsanavigator.com');
    expect(json.reused).toBe(false);
    expect(json.instructions).toContain(json.referenceNumber);
    expect(insertedBody?.plan).toBe('Pro');
    expect(insertedBody?.firebase_uid).toBe('uid-123');
  });

  it('idempotently returns existing payment reference for keyed request', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'uid-123',
      email: 'parent@example.com',
      emailVerified: true,
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('request_key=eq.existing-key-123')) {
        return Response.json([
          { reference_number: 'PS-EXIST', amount: 89, plan: 'Premium' },
        ]);
      }
      return Response.json([], { status: 200 });
    }));

    const req = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'Premium', requestKey: 'existing-key-123' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.referenceNumber).toBe('PS-EXIST');
    expect(json.amount).toBe(89);
    expect(json.reused).toBe(true);
  });
  it('fails checkout without retrying an insert without its idempotency key', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified', uid: 'uid-123', email: 'parent@example.com', emailVerified: true,
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);

    const request = new Request('http://localhost/api/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'Basic', requestKey: 'checkout-123' }),
    });
    const response = await onRequestPost({ request, env: validEnv });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'PAYMENT_INSERT_FAILED' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });


  describe('recorded amount and open orders', () => {
    const verified = () => vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified', uid: 'uid-123', email: 'parent@example.com', emailVerified: true,
    });
    const post = (tier: string) => onRequestPost({
      request: new Request('http://localhost/api/request-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) }),
      env: validEnv,
    });

    it.each(Object.entries(PRICING))('records the advertised price for %s', async (tier, price) => {
      verified();
      let inserted: any = null;
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') { inserted = JSON.parse(init.body as string); return new Response(null, { status: 201 }); }
        return Response.json([]);
      }));
      const json = await (await post(tier)).json();
      expect(inserted.amount).toBe(price);
      expect(json.amount).toBe(price);
      expect(json.instructions).toContain(`$${Number.isInteger(price) ? price.toLocaleString('en-CA') : price.toFixed(2)} CAD`);
    });

    it('returns the open pending order for the same package instead of creating a second reference', async () => {
      verified();
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return new Response(null, { status: 201 });
        if (url.includes('status=eq.pending') && url.includes('plan=eq.Premium') && url.includes('firebase_uid=eq.uid-123')) {
          return Response.json([{ reference_number: 'PS-OPEN1234', amount: PRICING.Premium, plan: 'Premium' }]);
        }
        return Response.json([]);
      });
      vi.stubGlobal('fetch', fetcher);
      const json = await (await post('Premium')).json();
      expect(json).toMatchObject({ referenceNumber: 'PS-OPEN1234', reused: true, openOrder: true, amount: PRICING.Premium });
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    });

    it('does not reuse an open order recorded at an old price', async () => {
      verified();
      let inserted: any = null;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') { inserted = JSON.parse(init.body as string); return new Response(null, { status: 201 }); }
        if (url.includes('status=eq.pending')) return Response.json([{ reference_number: 'PS-OLDPRICE', amount: 89, plan: 'Premium' }]);
        return Response.json([]);
      }));
      const json = await (await post('Premium')).json();
      expect(json.reused).toBe(false);
      expect(json.referenceNumber).not.toBe('PS-OLDPRICE');
      expect(inserted.amount).toBe(PRICING.Premium);
    });

    it('still creates the order when the open-order lookup fails', async () => {
      verified();
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return new Response(null, { status: 201 });
        if (url.includes('status=eq.pending')) throw new Error('network');
        return Response.json([]);
      }));
      const res = await post('Pro');
      expect(res.status).toBe(200);
      expect((await res.json()).reused).toBe(false);
    });
  });
});
