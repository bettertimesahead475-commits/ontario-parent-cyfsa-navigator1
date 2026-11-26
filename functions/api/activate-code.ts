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
import { normalizeApiKey } from './_supabase-key';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitSubject, rateLimitedResponse } from './_rate-limit';
import { trimCharacters } from '../../shared/linearText';

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
  // trimCharacters(..., '=', end) is exactly .replace(/=+$/, '') without a backtracking pattern (btoa pads with at most two '=').
  return trimCharacters(btoa(binary).replace(/\+/g, '-').replace(/\//g, '_'), '=', { end: true });
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
  {
    const retryAfter = rateLimitRetryAfter('activateCode', rateLimitSubject(request, identity.uid), RATE_LIMITS.activateCode);
    if (retryAfter) return rateLimitedResponse(retryAfter);
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

  // An access code is bound to the purchase email. The typed email alone proves nothing, so a code redeemed
  // by an account whose verified Google email is different must also present the purchase's payment
  // reference number (shown when access was requested and used in the e-transfer memo).
  const signedInEmail = identity.emailVerified ? identity.email?.toLowerCase().trim() : null;
  const reference = typeof body?.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  const referenceRequired = () => Response.json(
    { error: 'This code was purchased with a different email than the one you are signed in with. Enter the payment reference number from your access request to confirm the purchase is yours.', code: 'PURCHASE_REFERENCE_REQUIRED' },
    { status: 403, headers: DEFAULT_HEADERS },
  );
  // Same answer as an unknown code: never reveal which part did not match.
  const invalid = () => Response.json({ error: 'Invalid email or code.' }, { status: 401, headers: DEFAULT_HEADERS });

  // Ownership is decided here, server-side, before the atomic redemption:
  // - a code bound to an email is redeemable only with that email; from a differently signed-in account the
  //   purchase's payment reference must also be presented;
  // - a paid code tied to a payment but not (yet) bound to an email (legacy / manual issuance) is customer-specific:
  //   it needs the matching payment reference AND a verified signed-in email, which redemption then binds to it;
  // - a code with neither email nor payment reference is a transferable promotional code.
  // An unknown code goes to the RPC, which answers it the same way as before.
  const purchase = await readCodePurchase(env, normalizedCode);
  if (purchase === 'unavailable') {
    return Response.json({ error: 'Activation service temporarily unavailable. Please try again.', code: 'NETWORK_TIMEOUT' }, { status: 503, headers: DEFAULT_HEADERS });
  }
  if (purchase) {
    const boundEmail = (purchase.email ?? '').toLowerCase().trim();
    const purchaseReference = typeof purchase.reference_number === 'string' ? purchase.reference_number.trim().toUpperCase() : '';
    const referenceMatches = purchaseReference !== '' && reference !== '' && constantTimeEqual(purchaseReference, reference);
    if (boundEmail) {
      if (signedInEmail !== normalizedEmail) {
        if (!reference) return referenceRequired();
        if (boundEmail !== normalizedEmail || !referenceMatches) return invalid();
      } else if (boundEmail !== normalizedEmail) {
        return invalid();
      }
    } else if (purchaseReference) {
      if (!signedInEmail || signedInEmail !== normalizedEmail) return invalid();
      if (!reference) return referenceRequired();
      if (!referenceMatches) return invalid();
    }
  } else if (signedInEmail !== normalizedEmail && !reference) {
    return referenceRequired();
  }

  // ATOMIC RPC: Call PostgreSQL stored procedure redeem_access_code_atomic
  const rpcUrl = new URL('/rest/v1/rpc/redeem_access_code_atomic', env.STAGING_SUPABASE_URL);

  try {
    const rpcRes = await fetch(rpcUrl.toString(), {
      method: 'POST',
      headers: {
        apikey: (normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? ''),
        Authorization: `Bearer ${(normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? '')}`,
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

    // Fixed customer messages per outcome. The RPC's own fields are never shown, so no database detail can leak.
    const OUTCOMES: Record<string, { status: number; error: string }> = {
      invalid: { status: 401, error: 'Invalid email or code.' },
      expired: { status: 401, error: 'This code has expired. Contact support for a new one.' },
      consumed: { status: 409, error: 'This code was already redeemed.' },
      denied: { status: 400, error: 'This code cannot be activated on this account. Contact support.' },
    };
    const outcome = OUTCOMES[String(rpcData.status)];
    if (outcome) return Response.json({ error: outcome.error }, { status: outcome.status, headers: DEFAULT_HEADERS });
    return Response.json(
      { error: 'Activation could not be completed. Please try again.', code: 'ACTIVATION_FAILED' },
      { status: 500, headers: DEFAULT_HEADERS }
    );
  } catch (err: any) {
    return Response.json(
      { error: 'Activation service temporarily unavailable. Please try again.', code: 'NETWORK_TIMEOUT' },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }
};

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Reads only the purchase email and reference for a code, by the same SHA-256 hash the redemption RPC uses. */
async function readCodePurchase(env: Env, normalizedCode: string): Promise<{ email: string | null; reference_number: string | null } | null | 'unavailable'> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedCode));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const url = new URL('/rest/v1/access_codes', env.STAGING_SUPABASE_URL);
    url.searchParams.set('select', 'email,reference_number');
    url.searchParams.set('code_hash', 'eq.' + hash);
    url.searchParams.set('limit', '1');
    const key = normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? '';
    const res = await fetch(url.toString(), { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return 'unavailable';
    const rows = await res.json() as Array<{ email: string | null; reference_number: string | null }>;
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return 'unavailable';
  }
}
