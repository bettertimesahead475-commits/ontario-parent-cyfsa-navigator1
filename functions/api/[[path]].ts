/**
 * Temporary Cloudflare Pages API bridge.
 *
 * IMPORTANT: This is NOT a migrated backend. It is disabled unless an operator
 * explicitly configures a trusted backend origin. Never set it to the Pages URL
 * itself (recursive proxy), and do not point it at production for write testing.
 */
interface Env {
  STAGING_API_ORIGIN?: string;
}
interface Context {
  request: Request;
  env: Env;
}
export const onRequest = async ({ request, env }: Context): Promise<Response> => {
  const originValue = env.STAGING_API_ORIGIN;
  if (!originValue) {
    return Response.json(
      { error: 'Cloudflare staging API is not yet configured.', code: 'STAGING_API_UNAVAILABLE', retryable: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let origin: URL;
  try {
    origin = new URL(originValue);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      throw new Error('Invalid staging backend origin');
    }
  } catch {
    return Response.json(
      { error: 'Invalid staging backend configuration.', code: 'STAGING_API_CONFIG_ERROR', retryable: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const inbound = new URL(request.url);
  if (origin.host === inbound.host) {
    return Response.json({ error: 'Recursive staging API configuration.', code: 'STAGING_API_CONFIG_ERROR' }, { status: 503 });
  }

  const upstream = new URL(inbound.pathname + inbound.search, origin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cookie'); // Session identity uses explicit bearer/session headers.
  headers.delete('cf-connecting-ip');
  headers.delete('x-forwarded-for');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('set-cookie');
  responseHeaders.delete('access-control-allow-origin');
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
};
