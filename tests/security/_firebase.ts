// Mints Firebase-shaped RS256 ID tokens with locally generated keys, and serves the "Google" key set from a stubbed
// fetch. The real verifyFirebaseRequest is used end to end; nothing leaves the process.
import { vi } from 'vitest';
import { resetJwksCacheForTests } from '../../functions/api/_auth-check';

export const PROJECT = 'cyfsa-security-test';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes).toString('base64url');

type Pair = CryptoKeyPair;
const gen = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<Pair>;

export interface Firebase {
  /** Every non-key-set request the code under test made, in order. */
  calls: Array<{ url: string; method: string; body?: string }>;
  /** Route Supabase/provider traffic here; default: 500 for everything. */
  respond: (url: string, init: RequestInit) => Response | Promise<Response>;
  token: (claims?: Record<string, unknown>, opts?: { signer?: 'google' | 'attacker'; kid?: string; alg?: string; header?: Record<string, unknown> }) => Promise<string>;
}

export async function installFirebase(): Promise<Firebase> {
  resetJwksCacheForTests();
  const google = await gen();
  const attacker = await gen();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', google.publicKey)), kid: 'google-k1', use: 'sig', alg: 'RS256' };
  const fb: Firebase = {
    calls: [],
    respond: () => new Response('{}', { status: 500 }),
    async token(claims = {}, opts = {}) {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'google-k1', typ: 'JWT', ...opts.header };
      const payload = { aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'user_a', iat: now - 60, auth_time: now - 60, exp: now + 3600, email: 'a@example.test', email_verified: true, ...claims };
      const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
      const key = (opts.signer === 'attacker' ? attacker : google).privateKey;
      const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)));
      return `${signingInput}.${b64url(sig)}`;
    },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === JWKS_URL) return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=3600' } });
    fb.calls.push({ url, method: (init.method || 'GET').toUpperCase(), body: typeof init.body === 'string' ? init.body : undefined });
    return fb.respond(url, init);
  }));
  return fb;
}

/** A fetcher for handlers that take one explicitly; it shares the same call log. */
export const sharedFetcher = () => ((input: any, init?: any) => (globalThis.fetch as any)(input, init)) as typeof fetch;
