/**
 * Temporary Cloudflare Pages API bridge.
 *
 * IMPORTANT: This is NOT a migrated backend. It is disabled unless an operator
 * explicitly configures a trusted backend origin. Never set it to the Pages URL
 * itself (recursive proxy), and do not point it at production for write testing.
 */
import { nativeRouteMethods } from './_native-api-routes';

interface Env {
  STAGING_API_ORIGIN?: string;
}
interface Context {
  request: Request;
  env: Env;
}
export const onRequest = async ({ request, env }: Context): Promise<Response> => {
  // A native Pages Function owns this path but has no handler for this method (for example a GET
  // or a CORS preflight to the POST-only /api/extract-text). Report that precisely and never proxy
  // it. No CORS headers are added: the API is same-origin only.
  const nativeMethods = nativeRouteMethods(new URL(request.url).pathname);
  if (nativeMethods && !nativeMethods.includes('ALL') && !nativeMethods.includes(request.method.toUpperCase())) {
    return Response.json(
      { error: `This endpoint does not accept ${request.method} requests.`, code: 'METHOD_NOT_ALLOWED', allowed: nativeMethods, retryable: false },
      { status: 405, headers: { 'Cache-Control': 'no-store', Allow: nativeMethods.join(', ') } },
    );
  }

  const originValue = env.STAGING_API_ORIGIN;
  if (!originValue) {
    // Fail closed: there is no native handler and the optional staging bridge is disabled.
    return Response.json(
      { error: 'No API route matches this request.', code: 'API_ROUTE_NOT_FOUND', retryable: false },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let origin: URL;
  try {
    origin = new URL(originValue);
    // Do not permit proxying to arbitrary origins, especially the live Vercel API.
    // The staging API origin must be explicitly approved in code and separately configured.
    const allowed = 'cyfsa-navigator-backend-staging.pages.dev';
    if (origin.protocol !== 'https:' || origin.hostname !== allowed || origin.port || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
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

  const upstream = new URL(origin);
  upstream.pathname = inbound.pathname;
  upstream.search = inbound.search;
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
