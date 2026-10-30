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

  it('activates code via atomic RPC when available', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    const testCode = 'ABCD-1234-WXYZ';

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) {
        return Response.json({
          status: 'activated',
          session_id: 'atomic-session-uuid',
          tier: 'Pro',
          email: 'parent@example.com',
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
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
    expect(json.token).toBeTruthy();
  });

  it('handles atomic RPC reuse of already redeemed active session', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    const testCode = 'ABCD-1234-WXYZ';

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) {
        return Response.json({
          status: 'reused',
          session_id: 'existing-session-uuid',
          tier: 'Premium',
          email: 'parent@example.com',
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
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
    expect(json.tier).toBe('Premium');
  });

  it('successfully rolls back claimed code if session insert fails in fallback path', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    const testCode = 'ABCD-1234-WXYZ';
    const codeHash = crypto.createHash('sha256').update(testCode).digest('hex');
    let rollbackCalled = false;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      // RPC returns 404 (not installed)
      if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) {
        return new Response('function not found', { status: 404 });
      }
      // 1. SELECT candidate access codes
      if (url.includes('/rest/v1/access_codes') && (!init?.method || init.method === 'GET')) {
        return Response.json([{ id: 'code-row-1', email: 'parent@example.com', code_hash: codeHash, tier: 'Pro' }]);
      }
      // 2. PATCH claim code
      if (url.includes('/rest/v1/access_codes') && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string);
        if (body.used_at === null) {
          rollbackCalled = true;
          return Response.json([{ id: 'code-row-1' }]);
        }
        return Response.json([{ id: 'code-row-1' }]);
      }
      // 3. POST navigator_paid_sessions FAILS
      if (url.includes('/rest/v1/navigator_paid_sessions') && init?.method === 'POST') {
        return new Response('Database error', { status: 500 });
      }
      return new Response(null, { status: 404 });
    }));

    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: testCode, email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(500);
    expect(rollbackCalled).toBe(true);
    const json = await res.json();
    expect(json.code).toBe('SESSION_INSERT_FAILED');
  });

  it('rejects concurrent redemption race condition in fallback path (409)', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    const testCode = 'ABCD-1234-WXYZ';
    const codeHash = crypto.createHash('sha256').update(testCode).digest('hex');

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) {
        return new Response('function not found', { status: 404 });
      }
      if (url.includes('/rest/v1/access_codes') && (!init?.method || init.method === 'GET')) {
        return Response.json([{ id: 'code-row-1', email: 'parent@example.com', code_hash: codeHash, tier: 'Pro' }]);
      }
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
