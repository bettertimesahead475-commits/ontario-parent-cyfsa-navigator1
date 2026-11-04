import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/api/_auth-check';

const endpoint = 'https://cyfsa-navigator-git-staging.pages.dev/api/_auth-check';
const invoke = (authorization?: string, projectId?: string) =>
  onRequestGet({
    request: new Request(endpoint, { headers: authorization ? { Authorization: authorization } : {} }),
    env: projectId ? { FIREBASE_PROJECT_ID: projectId } : {},
  });
const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('Cloudflare native Firebase token verification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails closed without Firebase project configuration', async () => {
    const response = await invoke();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('requires a bearer token', async () => {
    const response = await invoke(undefined, 'test-project');
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('AUTH_REQUIRED');
  });

  it('rejects unsigned and malformed tokens without network calls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const token of ['Bearer abc.def.ghi', 'Bearer broken', 'Bearer ']) {
      expect((await invoke(token, 'test-project')).status).toBe(401);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects wrong audience before fetching Google public keys', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const now = Math.floor(Date.now() / 1000);
    const token = [
      segment({ alg: 'RS256', kid: 'key-id' }),
      segment({ aud: 'another-project', iss: 'https://securetoken.google.com/another-project', sub: 'user1', iat: now, exp: now + 3600, auth_time: now }),
      'c2ln',
    ].join('.');
    const response = await invoke('Bearer ' + token, 'test-project');
    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('accepts a correctly signed Firebase JWT and rejects a tampered signature', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }],
    })));
    const now = Math.floor(Date.now() / 1000);
    const header = segment({ alg: 'RS256', kid: 'test-key' });
    const payload = segment({
      aud: 'test-project',
      iss: 'https://securetoken.google.com/test-project',
      sub: 'test-user',
      iat: now - 30,
      auth_time: now - 60,
      exp: now + 3600,
    });
    const input = header + '.' + payload;
    const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input))).toString('base64url');
    const good = await invoke('Bearer ' + input + '.' + signature, 'test-project');
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ authenticated: true, uid: 'test-user' });
    const modifiedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    const bad = await invoke('Bearer ' + input + '.' + modifiedSignature, 'test-project');
    expect(bad.status).toBe(401);
    expect((await bad.json()).authenticated).toBe(false);
  });

  it('rejects expired tokens before fetching keys', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const now = Math.floor(Date.now() / 1000);
    const token = [
      segment({ alg: 'RS256', kid: 'test-key' }),
      segment({ aud: 'test-project', iss: 'https://securetoken.google.com/test-project', sub: 'user', iat: now - 7200, auth_time: now - 7200, exp: now - 1 }),
      'c2ln',
    ].join('.');
    const response = await invoke('Bearer ' + token, 'test-project');
    expect(response.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

});
