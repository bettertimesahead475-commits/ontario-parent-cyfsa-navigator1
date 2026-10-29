/**
 * Cloudflare Pages Function: GET /api/_status
 * Verifies that the Pages Functions runtime is live, independently of Vercel.
 * Deliberately exposes no secret values, credentials, or database details.
 */
interface Env {
  STAGING_API_ORIGIN?: string;
  STAGING_SUPABASE_URL?: string;
}

export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  return Response.json(
    {
      service: 'cyfsa-navigator-cloudflare-staging',
      runtime: 'cloudflare-pages-functions',
      apiMode: env.STAGING_API_ORIGIN ? 'upstream-configured' : 'not-configured',
      analyzerReady: false,
      stagingSupabaseConfigured: Boolean(env.STAGING_SUPABASE_URL),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
};
