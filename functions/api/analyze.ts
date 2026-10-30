/** Cloudflare staging analyzer stays disabled until the model execution adapter
 * and free-usage accounting pass integration tests. Never proxy to production. */
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const onRequestPost = async (): Promise<Response> =>
  Response.json({ code: 'STAGING_ANALYZER_NOT_READY', analyzerReady: false },
    { status: 503, headers });
