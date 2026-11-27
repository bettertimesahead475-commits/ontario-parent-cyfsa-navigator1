/**
 * Read-only Firebase ID-token verification on Cloudflare Pages.
 * No Admin SDK, service account key, database calls, or credit consumption.
 * Deployment refresh after configuring FIREBASE_PROJECT_ID in Cloudflare staging.
 */
interface Env { FIREBASE_PROJECT_ID?: string }
type Context = { request: Request; env: Env };
const jwksUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const json = (code: string, status: number) =>
  Response.json({ authenticated: false, code }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

function decodeSegment(segment: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Malformed token');
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as Record<string, unknown>;
}

// ---------------------------------------------------------------- Google signing-key cache
//
// Google publishes the Firebase token signing keys with Cache-Control: max-age. They were fetched on every
// authenticated request (one external round trip each, and every request failed during a Google blip). The key set
// is now cached per isolate for its max-age (bounded), imported keys are reused, concurrent misses share one fetch,
// and an unknown key id (rotation) triggers at most one refresh per minute. Verification itself is unchanged:
// RS256 signature, kid, audience, issuer, expiry, issued-at and auth_time are all still checked on every request.

type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type KeySet = { keys: GoogleJwk[]; expiresAt: number; imported: Map<string, Promise<CryptoKey>> };

export const JWKS_MIN_TTL_MS = 60_000;
export const JWKS_MAX_TTL_MS = 6 * 3600_000;
const JWKS_DEFAULT_TTL_MS = 5 * 60_000;
const UNKNOWN_KID_REFRESH_INTERVAL_MS = 60_000;

const KEY_FETCH_TIMEOUT_MS = 5000;
// A shared in-flight fetch older than this is abandoned: on Workers, a fetch started by a request that was then
// cancelled may never settle, and must not block every later request in the isolate.
const INFLIGHT_MAX_AGE_MS = KEY_FETCH_TIMEOUT_MS + 1000;

let cachedKeySet: KeySet | null = null;
let inflight: { promise: Promise<KeySet>; startedAt: number } | null = null;
let lastUnknownKidRefresh = 0;
export const jwksStats = { fetches: 0 };

/** For tests only. */
export function resetJwksCacheForTests(): void {
  cachedKeySet = null; inflight = null; lastUnknownKidRefresh = 0; jwksStats.fetches = 0;
}

/** Thrown when the key set cannot be obtained (or a key cannot be checked): the caller answers 503, never 401. */
class KeysUnavailable extends Error {}

/** Freshness left: max-age minus the Age of a cached response, bounded to [60 s, 6 h]. */
function freshnessMs(cacheControl: string | null, age: string | null): number {
  const m = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cacheControl || '');
  const ageSeconds = Number.parseInt(age || '0', 10);
  const remainingS = m ? Number(m[1]) - (Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds : 0) : null;
  // A response already past its freshness is used for this request only, never cached.
  if (remainingS !== null && remainingS <= 0) return 0;
  const ms = remainingS !== null ? remainingS * 1000 : JWKS_DEFAULT_TTL_MS;
  return Math.min(JWKS_MAX_TTL_MS, Math.max(JWKS_MIN_TTL_MS, ms));
}

function fetchKeySet(): Promise<KeySet> {
  if (inflight && Date.now() - inflight.startedAt < INFLIGHT_MAX_AGE_MS) return withDeadline(inflight.promise);
  const entry = { promise: null as unknown as Promise<KeySet>, startedAt: Date.now() };
  const promise = (async () => {
    jwksStats.fetches++;
    const response = await fetch(jwksUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new KeysUnavailable('JWKS unavailable');
    const body = await response.json() as { keys?: GoogleJwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) throw new KeysUnavailable('JWKS empty');
    const set: KeySet = { keys: body.keys, expiresAt: Date.now() + freshnessMs(response.headers.get('cache-control'), response.headers.get('age')), imported: new Map() };
    // An abandoned fetch that finishes after its replacement must not install an older key set.
    if (inflight === entry || !cachedKeySet) cachedKeySet = set;
    return set;
  })();
  entry.promise = promise;
  inflight = entry;
  promise.then(() => undefined, () => undefined).finally(() => { if (inflight === entry) inflight = null; });
  return withDeadline(promise);
}

/** Each waiter applies its own deadline, so a shared fetch that never settles cannot hang the caller. */
function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new KeysUnavailable('JWKS timeout')), INFLIGHT_MAX_AGE_MS); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function currentKeySet(): Promise<KeySet> {
  if (cachedKeySet && Date.now() < cachedKeySet.expiresAt) return cachedKeySet;
  return fetchKeySet(); // an expired set is never used: a failed refresh is an outage (503), not a stale accept
}

function findJwk(set: KeySet, kid: string): GoogleJwk | undefined {
  return set.keys.find(key => key.kid === kid && key.kty === 'RSA' && key.use === 'sig' && (!key.alg || key.alg === 'RS256'));
}

/** The verification key for `kid`, or null when Google does not publish it. Throws when keys are unavailable. */
async function signingKey(kid: string): Promise<CryptoKey | null> {
  let set = await currentKeySet();
  let jwk = findJwk(set, kid);
  if (!jwk) {
    if (Date.now() - lastUnknownKidRefresh < UNKNOWN_KID_REFRESH_INTERVAL_MS) {
      // Another unknown kid refreshed within the last minute. This kid may be a newly rotated key that the next
      // refresh would find, so it cannot be called invalid yet: answer "temporarily unavailable" (retryable), which
      // also means forged kids cannot sign genuine users out by exhausting the refresh budget.
      throw new KeysUnavailable('unknown kid; refresh rate-limited');
    }
    // Possibly a newly rotated key: refresh once. Bounded, so forged key ids cannot amplify into Google fetches.
    lastUnknownKidRefresh = Date.now();
    set = await fetchKeySet();
    jwk = findJwk(set, kid);
  }
  if (!jwk) return null;
  let imported = set.imported.get(kid);
  if (!imported) {
    imported = crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    set.imported.set(kid, imported);
    imported.catch(() => set.imported.delete(kid));
  }
  return imported;
}

function signatureBytes(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
}

export async function verifyFirebaseRequest(
  request: Request,
  env: Env,
): Promise<
  | { status: 'verified'; uid: string; email: string | null; emailVerified: boolean }
  | { status: 'denied' | 'unavailable' }
> {
  const response = await onRequestGet({ request, env });
  if (!response.ok) return { status: response.status === 503 ? 'unavailable' : 'denied' };
  const body = (await response.json()) as {
    authenticated?: boolean;
    uid?: string;
    email?: string | null;
    emailVerified?: boolean;
  };
  return body.authenticated && typeof body.uid === 'string'
    ? {
        status: 'verified',
        uid: body.uid,
        email: typeof body.email === 'string' ? body.email : null,
        emailVerified: Boolean(body.emailVerified),
      }
    : { status: 'denied' };
}

export const onRequestGet = async ({ request, env }: Context): Promise<Response> => {
  if (!env.FIREBASE_PROJECT_ID) return json('AUTH_NOT_CONFIGURED', 503);
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
  if (!match) return json('AUTH_REQUIRED', 401);

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = match[1].split('.');
    const header = decodeSegment(encodedHeader);
    const claims = decodeSegment(encodedPayload);
    const now = Math.floor(Date.now() / 1000);
    if (
      header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid ||
      claims.aud !== env.FIREBASE_PROJECT_ID ||
      claims.iss !== 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
      typeof claims.exp !== 'number' || claims.exp <= now ||
      typeof claims.iat !== 'number' || claims.iat > now ||
      typeof claims.auth_time !== 'number' || claims.auth_time > now
    ) return json('INVALID_FIREBASE_TOKEN', 401);

    let publicKey: CryptoKey | null;
    try {
      publicKey = await signingKey(header.kid);
    } catch {
      // Google's key service could not be reached and no unexpired key set is cached: the token cannot be verified.
      // Never accept it unverified, and never call a valid sign-in invalid: report a temporary outage.
      return json('AUTH_KEY_SERVICE_UNAVAILABLE', 503);
    }
    if (!publicKey) return json('INVALID_FIREBASE_TOKEN', 401);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', publicKey, signatureBytes(encodedSignature),
      new TextEncoder().encode(encodedHeader + '.' + encodedPayload),
    );
    if (!valid) return json('INVALID_FIREBASE_TOKEN', 401);
    return Response.json(
      {
        authenticated: true,
        uid: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: Boolean(claims.email_verified),
        provider: 'firebase',
      },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  } catch {
    return json('INVALID_FIREBASE_TOKEN', 401);
  }
};
