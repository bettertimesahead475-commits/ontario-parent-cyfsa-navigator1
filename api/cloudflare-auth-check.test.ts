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
});
