import { verifyFirebaseRequest } from './_auth-check';
import { readVerifiedPaidSession } from './_supabase-paid-session';

type Env = {
  FIREBASE_PROJECT_ID?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_READ_KEY?: string;
};
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/** Read-only authorization diagnostic. Never reserves credit or enables analysis. */
export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') return Response.json({ authorized: false, code: 'AUTH_REQUIRED' }, { status: identity.status === 'unavailable' ? 503 : 401, headers });
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return Response.json({ authorized: false, code: 'INVALID_CONTENT_TYPE' }, { status: 415, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ authorized: false, code: 'INVALID_REQUEST' }, { status: 400, headers }); }
  if (!body || typeof body !== 'object' || typeof (body as { sessionId?: unknown }).sessionId !== 'string') {
    return Response.json({ authorized: false, code: 'INVALID_REQUEST' }, { status: 400, headers });
  }
  const result = await readVerifiedPaidSession(env, identity.uid, (body as { sessionId: string }).sessionId);
  if (result.status !== 'verified') return Response.json({ authorized: false, code: result.status === 'denied' ? 'SESSION_DENIED' : 'DATABASE_UNAVAILABLE' }, { status: result.status === 'denied' ? 403 : 503, headers });
  return Response.json({ authorized: true, tier: result.session.tier, analyzerReady: false }, { headers });
};
