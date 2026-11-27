import { afterEach, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/api/[[path]]';

afterEach(() => vi.unstubAllGlobals());

it('keeps requests and their credentials on the configured backend even with a double-slash path', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const response = await onRequest({
    request: new Request('https://cyfsanavigator.com//other.example/endpoint?test=1', {
      headers: { Authorization: 'Bearer synthetic-token' },
    }),
    env: { STAGING_API_ORIGIN: 'https://cyfsa-navigator-backend-staging.pages.dev' },
  });

  expect(response.status).toBe(204);
  const [url, options] = fetcher.mock.calls[0];
  expect(url.href).toBe('https://cyfsa-navigator-backend-staging.pages.dev//other.example/endpoint?test=1');
  expect(options.headers.get('Authorization')).toBe('Bearer synthetic-token');
});
