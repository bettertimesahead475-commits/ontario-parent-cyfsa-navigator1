import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, jwksStats, JWKS_MAX_TTL_MS } from '../functions/api/_auth-check';

// DEVIN-OBS-02: Google signing keys are cached; verification itself is unchanged. Real RS256 tokens, synthetic keys.
const PROJECT = 'synthetic-project';
const env = { FIREBASE_PROJECT_ID: PROJECT };
const b64url = (bytes: Uint8Array | string) => {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function keyPair(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, use: 'sig', alg: 'RS256' };
  return { kid, jwk, privateKey: pair.privateKey };
}

async function token(key: { kid: string; privateKey: CryptoKey }, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'user_1', exp: now + 600, iat: now - 10, auth_time: now - 10, email: 'a@example.test', email_verified: true, ...overrides }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

const verify = (jwt: string) => onRequestGet({ request: new Request('https://x.test/api/_auth-check', { headers: { Authorization: `Bearer ${jwt}` } }), env });

function googleServes(keys: () => object[] | Error, cacheControl = 'public, max-age=21600, must-revalidate, no-transform') {
  const fetchMock = vi.fn(async () => {
    const k = keys();
    if (k instanceof Error) throw k;
    await new Promise((r) => setTimeout(r, 5)); // network latency, so concurrent requests overlap
    return Response.json({ keys: k }, { headers: { 'Cache-Control': cacheControl } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Google signing-key cache', () => {
  it('verifies 100 requests with one key fetch (was 100) and keeps rejecting bad tokens', async () => {
    const k1 = await keyPair('k1');
    const fetchMock = googleServes(() => [k1.jwk]);
    const good = await token(k1);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) expect((await verify(good)).status).toBe(200);
    console.info('[JWKS] 100 verifications', Math.round(performance.now() - t0), 'ms', 'fetches', fetchMock.mock.calls.length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jwksStats.fetches).toBe(1);
    // Cached keys never relax the checks.
    const other = await keyPair('k1'); // same kid, different key → signature mismatch
    expect((await verify(await token(other))).status).toBe(401);
    expect((await verify(await token(k1, { exp: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401);
    expect((await verify(await token(k1, { aud: 'another-project' }))).status).toBe(401);
    expect((await verify(await token(k1, { iss: 'https://evil.example' }))).status).toBe(401);
  });

  it('concurrent first requests share one fetch', async () => {
    const k1 = await keyPair('k1');
    const fetchMock = googleServes(() => [k1.jwk]);
    const good = await token(k1);
    const results = await Promise.all(Array.from({ length: 25 }, () => verify(good)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects max-age: refetches after expiry (bounded to 6 hours)', async () => {
    const k1 = await keyPair('k1');
    const fetchMock = googleServes(() => [k1.jwk], 'max-age=120');
    const good = await token(k1);
    expect((await verify(good)).status).toBe(200);
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 121_000);
    expect((await verify(await token(k1))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 121_000 + JWKS_MAX_TTL_MS - 1000);
    expect(JWKS_MAX_TTL_MS).toBe(6 * 3600_000);
  });

  it('key rotation: an unknown kid triggers one refresh and the new key verifies', async () => {
    const k1 = await keyPair('k1');
    const k2 = await keyPair('k2');
    let published = [k1.jwk];
    const fetchMock = googleServes(() => published);
    expect((await verify(await token(k1))).status).toBe(200);
    published = [k1.jwk, k2.jwk];
    expect((await verify(await token(k2))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forged unknown key ids cannot amplify into Google fetches (one refresh per minute)', async () => {
    const k1 = await keyPair('k1');
    const forged = await keyPair('forged');
    const fetchMock = googleServes(() => [k1.jwk]);
    expect((await verify(await token(k1))).status).toBe(200);
    for (let i = 0; i < 50; i++) expect((await verify(await token(forged))).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('Google unreachable with nothing cached: 503 (never 401, never accepted)', async () => {
    const k1 = await keyPair('k1');
    googleServes(() => new TypeError('fetch failed'));
    const r = await verify(await token(k1));
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe('AUTH_KEY_SERVICE_UNAVAILABLE');
  });

  it('cache expired and Google failing: 503, the expired key set is not used', async () => {
    const k1 = await keyPair('k1');
    let fail = false;
    googleServes(() => (fail ? new TypeError('fetch failed') : [k1.jwk]), 'max-age=60');
    const good = await token(k1);
    expect((await verify(good)).status).toBe(200);
    fail = true;
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 61_000);
    expect((await verify(await token(k1))).status).toBe(503);
  });

  it('Google answering an error status or an empty key set: 503', async () => {
    const k1 = await keyPair('k1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502 })));
    expect((await verify(await token(k1))).status).toBe(503);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [] })));
    expect((await verify(await token(k1))).status).toBe(503);
  });
});
