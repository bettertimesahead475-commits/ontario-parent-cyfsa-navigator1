import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/api/_supabase-reachability';
const staging = 'https://nxfhvebzzobegubefcda.supabase.co/';
describe('Cloudflare staging Supabase reachability isolation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('fails closed when not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await onRequestGet({ env: {} });
    expect(r.status).toBe(503);
    expect((await r.json()).databaseVerified).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each([
    'https://qboidsfpjuxeqtfotryj.supabase.co/',
    'https://evil.example/',
    'http://nxfhvebzzobegubefcda.supabase.co/',
    'https://nxfhvebzzobegubefcda.supabase.co/other',
  ])('refuses non-staging URL %s', async url => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await onRequestGet({ env: { STAGING_SUPABASE_URL: url } });
    expect(r.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each([401, 403])('classifies HTTP %i as reachable but requiring credentials, not database-verified', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    const r = await onRequestGet({ env: { STAGING_SUPABASE_URL: staging } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      reachable: true,
      code: 'STAGING_AUTH_CREDENTIALS_REQUIRED',
      databaseVerified: false,
      upstreamStatus: status,
    });
  });
  it('does not classify HTTP 404 as a healthy or reachable auth service', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const r = await onRequestGet({ env: { STAGING_SUPABASE_URL: staging } });
    expect(r.status).toBe(503);
    expect((await r.json()).databaseVerified).toBe(false);
  });
  it('probes only the staging auth health endpoint without credentials', async () => {
    const fetchSpy = vi.fn(async (_url: URL, _options: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await onRequestGet({ env: { STAGING_SUPABASE_URL: staging } });
    expect(r.status).toBe(200);
    expect((await r.json()).databaseVerified).toBe(false);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(staging + 'auth/v1/health');
    expect(options.method).toBe('GET');
    expect(options.headers).toEqual({ Accept: 'application/json' });
  });
});
