/**
 * Cloudflare staging-only Supabase reachability diagnostic.
 *
 * Deliberately checks the Supabase Auth health endpoint, NOT database access.
 * Never sends API keys, Firebase tokens, cookies, or user data.
 * A successful result is NOT evidence that Postgres/RLS/credits work.
 */
interface Env {
  STAGING_SUPABASE_URL?: string;
}
const EXPECTED_STAGING_HOST = 'nxfhvebzzobegubefcda.supabase.co';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  if (!env.STAGING_SUPABASE_URL) {
    return Response.json({ reachable: false, code: 'STAGING_SUPABASE_NOT_CONFIGURED', databaseVerified: false }, { status: 503, headers });
  }
  let base: URL;
  try {
    base = new URL(env.STAGING_SUPABASE_URL);
    if (base.protocol !== 'https:' || base.hostname !== EXPECTED_STAGING_HOST ||
        base.pathname !== '/' || base.search || base.hash || base.username || base.password || base.port) {
      throw new Error('Unexpected staging Supabase URL');
    }
  } catch {
    return Response.json({ reachable: false, code: 'STAGING_SUPABASE_URL_REJECTED', databaseVerified: false }, { status: 503, headers });
  }
  try {
    const response = await fetch(new URL('/auth/v1/health', base), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    return Response.json({
      reachable: response.ok,
      code: response.ok ? 'STAGING_AUTH_SERVICE_REACHABLE' : 'STAGING_AUTH_SERVICE_UNAVAILABLE',
      databaseVerified: false,
    }, { status: response.ok ? 200 : 503, headers });
  } catch {
    return Response.json({ reachable: false, code: 'STAGING_AUTH_SERVICE_UNREACHABLE', databaseVerified: false }, { status: 503, headers });
  }
};
