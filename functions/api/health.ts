/**
 * Cloudflare Pages Functions - Operational Health Check API.
 *
 * GET /api/health
 * Lightweight liveness probe for monitoring and status dashboards.
 */

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const onRequestGet = async (): Promise<Response> => {
  return Response.json(
    {
      status: 'ok',
      service: 'cyfsa-navigator',
      platform: 'cloudflare-pages',
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
};
