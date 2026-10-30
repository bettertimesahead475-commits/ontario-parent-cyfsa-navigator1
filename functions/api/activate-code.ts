/**
 * Cloudflare Pages Functions - Access Code Activation API.
 *
 * POST /api/activate-code
 * Redeems a one-time access code, creates a paid session bound to the verified Firebase identity,
 * and mints an HMAC-signed session token.
 *
 * Strictly executes via atomic PostgreSQL RPC `redeem_access_code_atomic`.
 * Fails closed if the atomic RPC is unavailable (no unsafe REST multi-step fallback).
 */
import { verifyFirebaseRequest } from './_auth-check';

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

interface Env {
  FIREBASE_PROJECT_ID?: string;
  SESSION_SECRET?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signSessionToken(jti: string, expiresAt: number, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const payloadStr = JSON.stringify({ jti, exp: expiresAt });
  const payloadBytes = enc.encode(payloadStr);
  const payload = toBase64Url(payloadBytes);

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sig = toBase64Url(new Uint8Array(sigBuffer));
  return `${payload}.${sig}`;
}

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { code, email } = body || {};
  if (!code || !email || typeof code !== 'string' || typeof email !== 'string') {
    return Response.json(
      { error: 'Code and email are required.' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  // Cryptographically verify identity via Firebase ID token
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified' || !identity.uid) {
    return Response.json(
      { error: 'Please sign in to activate your access code.', code: 'SIGN_IN_REQUIRED' },
      { status: 401, headers: DEFAULT_HEADERS }
    );
  }

  if (!env.SESSION_SECRET) {
    return Response.json(
      { error: 'Session signing service is not configured.', code: 'SESSION_CONFIG_ERROR' },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }

  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: 'Activation service is not configured.', code: 'ACTIVATION_NOT_READY' },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedCode = code.toUpperCase().trim();

  // ATOMIC RPC: Call PostgreSQL stored procedure redeem_access_code_atomic
  const rpcUrl = new URL('/rest/v1/rpc/redeem_access_code_atomic', env.STAGING_SUPABASE_URL);

  try {
    const rpcRes = await fetch(rpcUrl.toString(), {
      method: 'POST',
      headers: {
        apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        p_firebase_uid: identity.uid,
        p_code: normalizedCode,
        p_email: normalizedEmail,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!rpcRes.ok) {
      if (rpcRes.status === 404) {
        return Response.json(
          { error: 'Atomic access code redemption service is pending database migration.', code: 'RPC_NOT_INSTALLED' },
          { status: 503, headers: DEFAULT_HEADERS }
        );
      }
      return Response.json(
        { error: 'Activation database error. Please try again.', code: 'DB_ERROR' },
        { status: 500, headers: DEFAULT_HEADERS }
      );
    }

    const rpcData = (await rpcRes.json()) as any;
    if (!rpcData || typeof rpcData !== 'object') {
      return Response.json(
        { error: 'Invalid response from activation service.', code: 'INVALID_RPC_RESPONSE' },
        { status: 500, headers: DEFAULT_HEADERS }
      );
    }

    if (rpcData.status === 'activated' || rpcData.status === 'reused') {
      const expTime = rpcData.expires_at ? new Date(rpcData.expires_at).getTime() : Date.now() + 30 * 86400000;
      const token = await signSessionToken(rpcData.session_id, expTime, env.SESSION_SECRET);
      return Response.json(
        {
          success: true,
          tier: rpcData.tier,
          token,
          email: normalizedEmail,
          reused: rpcData.status === 'reused',
        },
        { status: 200, headers: DEFAULT_HEADERS }
      );
    }

    if (rpcData.status === 'invalid') {
      return Response.json({ error: rpcData.error || 'Invalid email or code.' }, { status: 401, headers: DEFAULT_HEADERS });
    }
    if (rpcData.status === 'expired') {
      return Response.json({ error: rpcData.error || 'This code has expired. Contact support for a new one.' }, { status: 401, headers: DEFAULT_HEADERS });
    }
    if (rpcData.status === 'consumed') {
      return Response.json({ error: rpcData.error || 'This code was already redeemed.' }, { status: 409, headers: DEFAULT_HEADERS });
    }
    if (rpcData.status === 'denied') {
      return Response.json({ error: rpcData.error || 'Access denied.' }, { status: 400, headers: DEFAULT_HEADERS });
    }

    return Response.json(
      { error: rpcData.error || 'Activation could not be completed.' },
      { status: 500, headers: DEFAULT_HEADERS }
    );
  } catch (err: any) {
    return Response.json(
      { error: 'Activation service temporarily unavailable. Please try again.', code: 'NETWORK_TIMEOUT' },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }
};
