/**
 * Cloudflare Pages Functions - Access Code Activation API.
 *
 * POST /api/activate-code
 * Redeems a one-time access code, creates a paid session bound to the verified Firebase identity,
 * and mints an HMAC-signed session token.
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

async function sha256Hex(message: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(message));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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
  const inputHash = await sha256Hex(normalizedCode);

  try {
    // 1. Look up unredeemed candidate access codes for this email
    const fetchUrl = new URL('/rest/v1/access_codes', env.STAGING_SUPABASE_URL);
    fetchUrl.searchParams.set('email', `eq.${normalizedEmail}`);
    fetchUrl.searchParams.set('used_at', 'is.null');
    fetchUrl.searchParams.set('order', 'created_at.desc');

    const searchRes = await fetch(fetchUrl.toString(), {
      headers: {
        apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!searchRes.ok) {
      return Response.json(
        { error: 'Failed to query access codes.', code: 'DB_QUERY_FAILED' },
        { status: 500, headers: DEFAULT_HEADERS }
      );
    }

    const candidates = (await searchRes.json()) as any[];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return Response.json(
        { error: 'Invalid email or code.' },
        { status: 401, headers: DEFAULT_HEADERS }
      );
    }

    // 2. Timing-safe match against code_hash
    const matched = candidates.find((c) => c.code_hash && timingSafeEqual(c.code_hash, inputHash));
    if (!matched) {
      return Response.json(
        { error: 'Invalid email or code.' },
        { status: 401, headers: DEFAULT_HEADERS }
      );
    }

    // 3. Expiration check
    if (matched.expires_at && new Date(matched.expires_at).getTime() < Date.now()) {
      return Response.json(
        { error: 'This code has expired. Contact support for a new one.' },
        { status: 401, headers: DEFAULT_HEADERS }
      );
    }

    // 4. Atomically claim code
    const claimUrl = new URL('/rest/v1/access_codes', env.STAGING_SUPABASE_URL);
    claimUrl.searchParams.set('id', `eq.${matched.id}`);
    claimUrl.searchParams.set('used_at', 'is.null');

    const claimRes = await fetch(claimUrl.toString(), {
      method: 'PATCH',
      headers: {
        apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ used_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    });

    if (!claimRes.ok) {
      return Response.json(
        { error: 'Failed to claim access code.', code: 'DB_CLAIM_FAILED' },
        { status: 500, headers: DEFAULT_HEADERS }
      );
    }

    const claimedRows = (await claimRes.json()) as any[];
    if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
      return Response.json(
        { error: 'This code was already redeemed by a concurrent request.' },
        { status: 409, headers: DEFAULT_HEADERS }
      );
    }

    // 5. Create durable paid session row
    const expiresAtDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const sessionPayload = {
      firebase_uid: identity.uid,
      email: identity.email || normalizedEmail,
      tier: matched.tier,
      access_code_id: matched.id,
      issued_at: new Date().toISOString(),
      expires_at: expiresAtDate.toISOString(),
    };

    let sessionId = crypto.randomUUID();
    let sessionExpiry = expiresAtDate.getTime();

    const sessionInsertUrl = new URL('/rest/v1/navigator_paid_sessions', env.STAGING_SUPABASE_URL);
    try {
      const sessionRes = await fetch(sessionInsertUrl.toString(), {
        method: 'POST',
        headers: {
          apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(sessionPayload),
        signal: AbortSignal.timeout(5000),
      });

      if (sessionRes.ok) {
        const sessionRows = (await sessionRes.json()) as any[];
        if (Array.isArray(sessionRows) && sessionRows.length > 0 && sessionRows[0].id) {
          sessionId = sessionRows[0].id;
          if (sessionRows[0].expires_at) {
            sessionExpiry = new Date(sessionRows[0].expires_at).getTime();
          }
        }
      }
    } catch {
      // Use fallback session UUID
    }

    // 6. Sign and issue session token
    const token = await signSessionToken(sessionId, sessionExpiry, env.SESSION_SECRET);

    return Response.json(
      {
        success: true,
        tier: matched.tier,
        token,
        email: normalizedEmail,
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  } catch (err: any) {
    return Response.json(
      { error: 'Activation could not be completed. Please try again.' },
      { status: 500, headers: DEFAULT_HEADERS }
    );
  }
};
