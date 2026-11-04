import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/request-access';
import * as authCheck from '../functions/api/_auth-check';

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
    expect(json.referenceNumber).toMatch(/^PS-[A-Z0-9]{5}$/);
    expect(json.amount).toBe(129);
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
});
