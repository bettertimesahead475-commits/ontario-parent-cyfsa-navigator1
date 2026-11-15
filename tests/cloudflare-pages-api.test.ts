import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/api/[[path]]';

const request = (path = '/api/health', init?: RequestInit) =>
  new Request('https://cyfsa-navigator-git-staging.pages.dev' + path, init);

describe('Cloudflare Pages staging API boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails closed without a configured staging backend', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await onRequest({ request: request(), env: {} });
    expect(result.status).toBe(503);
    expect((await result.json()).code).toBe('STAGING_API_UNAVAILABLE');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    'http://backend.example.com/',
    'https://backend.example.com/path',
    'https://user:pass@backend.example.com/',
    'not-a-url',
    'https://cyfsa-navigator-git-staging.pages.dev/',
  ])('rejects invalid or recursive backend %s', async (backend) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await onRequest({ request: request(), env: { STAGING_API_ORIGIN: backend } });
    expect(result.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves bearer/session headers and streamed upstream body without cookies', async () => {
    const fetchSpy = vi.fn(async (_url: URL, _init: RequestInit) =>
      new Response('data: ok\\n\\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'set-cookie': 'sid=secret' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const result = await onRequest({
      request: request('/api/analyze?mode=quick', {
        method: 'POST',
        headers: {
          authorization: 'Bearer example',
          'x-ps-session': 'paid-session',
          cookie: 'sid=private',
        },
        body: 'payload',
      }),
      env: { STAGING_API_ORIGIN: 'https://cyfsa-navigator-backend-staging.pages.dev/' },
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [target, init] = fetchSpy.mock.calls[0];
    expect(String(target)).toBe('https://cyfsa-navigator-backend-staging.pages.dev/api/analyze?mode=quick');
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer example');
    expect(headers.get('x-ps-session')).toBe('paid-session');
    expect(headers.has('cookie')).toBe(false);
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(result.headers.get('content-type')).toContain('text/event-stream');
    expect(await result.text()).toBe('data: ok\\n\\n');
  });
});
