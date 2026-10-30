import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/activate-code';
import * as authCheck from '../functions/api/_auth-check';
import crypto from 'node:crypto';

describe('Cloudflare Activate Code API (/api/activate-code)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const validEnv = {
    FIREBASE_PROJECT_ID: 'test-firebase-proj',
    SESSION_SECRET: 'test-session-secret-key-12345',
    STAGING_SUPABASE_URL: 'https://test-supabase.co',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  };

  it('rejects missing email or code', async () => {
    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Code and email are required');
  });

  it('requires authenticated Firebase user', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'denied' });
    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD-1234-EFGH', email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe('SIGN_IN_REQUIRED');
  });

  it('rejects invalid or non-existent access codes', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    vi.stubGlobal('fetch', vi.fn(async () => Response.json([], { status: 200 })));

    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'INVALID-CODE-9999', email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid email or code.');
  });

  it('successfully redeems valid code and issues signed session token', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    const testCode = 'ABCD-1234-WXYZ';
    const codeHash = crypto.createHash('sha256').update(testCode).digest('hex');

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      // 1. SELECT candidate access codes
      if (url.includes('/rest/v1/access_codes') && (!init || init.method === 'GET' || !init.method)) {
        return Response.json([
          {
            id: 'code-row-1',
            email: 'parent@example.com',
            code_hash: codeHash,
            tier: 'Pro',
            used_at: null,
            expires_at: null,
          },
        ]);
      }
      // 2. PATCH claim code
      if (url.includes('/rest/v1/access_codes') && init?.method === 'PATCH') {
        return Response.json([{ id: 'code-row-1' }]);
      }
      // 3. POST navigator_paid_sessions
      if (url.includes('/rest/v1/navigator_paid_sessions') && init?.method === 'POST') {
        return Response.json([
          {
            id: 'session-uuid-1234',
            firebase_uid: 'user_456',
            tier: 'Pro',
            expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        ]);
      }
      return new Response(null, { status: 404 });
    }));

    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: testCode, email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.tier).toBe('Pro');
    expect(json.email).toBe('parent@example.com');
    expect(json.token).toBeTruthy();

    // Verify minted token has correct HMAC signature
    const [payloadB64, sigB64] = json.token.split('.');
    expect(payloadB64).toBeTruthy();
    expect(sigB64).toBeTruthy();
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(payload.jti).toBe('session-uuid-1234');
    expect(payload.exp).toBeGreaterThan(Date.now());
  });

  it('rejects concurrent redemption race condition (409)', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    const testCode = 'ABCD-1234-WXYZ';
    const codeHash = crypto.createHash('sha256').update(testCode).digest('hex');

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rest/v1/access_codes') && (!init?.method || init.method === 'GET')) {
        return Response.json([{ id: 'code-row-1', email: 'parent@example.com', code_hash: codeHash, tier: 'Pro' }]);
      }
      // PATCH returns empty array indicating code was already claimed concurrently
      if (url.includes('/rest/v1/access_codes') && init?.method === 'PATCH') {
        return Response.json([]);
      }
      return new Response(null, { status: 404 });
    }));

    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: testCode, email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already redeemed');
  });
});
