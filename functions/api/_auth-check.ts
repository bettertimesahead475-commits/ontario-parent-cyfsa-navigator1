/**
 * Read-only Firebase ID-token verification on Cloudflare Pages.
 * No Admin SDK, service account key, database calls, or credit consumption.
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

function signatureBytes(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
}

export const onRequestGet = async ({ request, env }: Context): Promise<Response> => {
  if (!env.FIREBASE_PROJECT_ID) return json('AUTH_NOT_CONFIGURED', 503);
  const match = /^Bearer ([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
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

    const keysResponse = await fetch(jwksUrl, { headers: { Accept: 'application/json' } });
    if (!keysResponse.ok) return json('AUTH_KEY_SERVICE_UNAVAILABLE', 503);
    const keys = await keysResponse.json() as { keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> };
    const jwk = keys.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig' && (!key.alg || key.alg === 'RS256'));
    if (!jwk) return json('INVALID_FIREBASE_TOKEN', 401);
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', publicKey, signatureBytes(encodedSignature),
      new TextEncoder().encode(encodedHeader + '.' + encodedPayload),
    );
    if (!valid) return json('INVALID_FIREBASE_TOKEN', 401);
    return Response.json(
      { authenticated: true, uid: claims.sub, provider: 'firebase' },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  } catch {
    return json('INVALID_FIREBASE_TOKEN', 401);
  }
};
