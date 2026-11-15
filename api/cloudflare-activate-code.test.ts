import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/activate-code';
import * as authCheck from '../functions/api/_auth-check';

describe('Cloudflare Activate Code API - Atomic RPC Only (/api/activate-code)', () => {
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

  it('fails closed with 503 if RPC is not installed', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('Function not found', { status: 404 })));

    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD-1234-WXYZ', email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe('RPC_NOT_INSTALLED');
  });

  it('activates code via atomic RPC when available', async () => {
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
    expect(json.reused).toBe(false);
  });

  it('handles atomic RPC idempotency reuse of active session', async () => {
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
    expect(json.reused).toBe(true);
  });

  it('rejects concurrent redemption or already consumed code with 409', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) {
        return Response.json({
          status: 'consumed',
          error: 'This code was already redeemed.',
          code: 'CODE_ALREADY_USED',
        });
      }
      return new Response(null, { status: 404 });
    }));

    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD-1234-WXYZ', email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already redeemed');
  });

  it('rejects expired code with 401', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_456',
      email: 'parent@example.com',
      emailVerified: true,
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/rpc/redeem_access_code_atomic')) {
        return Response.json({
          status: 'expired',
          error: 'This code has expired. Contact support for a new one.',
          code: 'CODE_EXPIRED',
        });
      }
      return new Response(null, { status: 404 });
    }));

    const req = new Request('http://localhost/api/activate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'EXPD-1234-WXYZ', email: 'parent@example.com' }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('expired');
  });
});
