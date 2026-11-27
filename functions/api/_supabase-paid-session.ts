import { validatePaidSessionRow, type PaidSessionRow, type VerifiedSession } from './_paid-session-validation';
import { normalizeSupabaseKey } from './_supabase-key';

export type SupabaseStagingConfig = {
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_READ_KEY?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type SessionReadResult =
  | { status: 'verified'; session: VerifiedSession }
  | { status: 'denied' }
  | { status: 'unavailable' };

/**
 * Server-only, read-only staging adapter. Caller must supply the UID from a
 * cryptographically verified Firebase ID token, never from the request body.
 * This is not an authorization grant or a credit reservation.
 */
export async function readVerifiedPaidSession(
  env: SupabaseStagingConfig,
  firebaseUid: string,
  sessionId: string,
  fetcher: typeof fetch = fetch,
  { includeGrantedCredits = false }: { includeGrantedCredits?: boolean } = {},
): Promise<SessionReadResult> {
  if (!firebaseUid || !sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return { status: 'denied' };
  // navigator_paid_sessions has RLS with zero policies and grants SELECT only to service_role
  // (create_navigator_paid_sessions.sql). A separate non-service read key is therefore always
  // rejected, which surfaced to paid users as SESSION_INVALID before any credit was reserved.
  // Prefer the service-role credential that the credit reservation RPC immediately after this
  // lookup already requires, so the lookup cannot fail where the rest of the paid flow succeeds.
  const serviceKey = normalizeSupabaseKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  const readKey = serviceKey || normalizeSupabaseKey(env.STAGING_SUPABASE_READ_KEY);
  if (!env.STAGING_SUPABASE_URL || !readKey) {
    console.warn('[paid_session_read] missing runtime configuration');
    return { status: 'unavailable' };
  }
  let url: URL;
  const columns = 'id,firebase_uid,tier,issued_at,expires_at,revoked_at';
  try {
    url = new URL('/rest/v1/navigator_paid_sessions', env.STAGING_SUPABASE_URL);
    if (url.protocol !== 'https:') return { status: 'unavailable' };
    url.searchParams.set('select', includeGrantedCredits ? columns + ',granted_credits' : columns);
    url.searchParams.set('id', 'eq.' + sessionId);
    url.searchParams.set('firebase_uid', 'eq.' + firebaseUid);
    url.searchParams.set('limit', '1');
  } catch {
    return { status: 'unavailable' };
  }
  try {
    const opaqueKey = readKey.startsWith('sb_secret_') || readKey.startsWith('sb_publishable_');
    // The service-role key uses exactly the header pair the working credit RPC transport sends
    // (_staging-credit-rpc.ts). Only the legacy read-key fallback omits Bearer for opaque keys.
    const sendBearer = Boolean(serviceKey) || !opaqueKey;
    const options: RequestInit = {
      method: 'GET',
      headers: {
        apikey: readKey,
        ...(sendBearer ? { Authorization: 'Bearer ' + readKey } : {}),
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    };
    const rejectionCode = async (response: Response) => {
      const error = response.headers.get('content-type')?.split(';')[0] === 'application/json'
        ? await response.json().catch(() => null) as { code?: unknown } | null : null;
      return typeof error?.code === 'string' && /^(PGRST\d{3}|[0-9A-Z]{5})$/.test(error.code) ? error.code : null;
    };
    let response = await fetcher(url.toString(), options);
    let code = response.ok ? null : await rejectionCode(response);
    if (!response.ok && includeGrantedCredits && (code === '42703' || code === 'PGRST204')) {
      url.searchParams.set('select', columns);
      response = await fetcher(url.toString(), options);
      code = response.ok ? null : await rejectionCode(response);
    }
    if (!response.ok) {
      console.warn('[paid_session_read] upstream rejected request', {
        status: response.status,
        credential: serviceKey ? 'service_role' : 'read_key',
        keyFormat: opaqueKey ? 'opaque' : readKey.split('.').length === 3 ? 'jwt-shaped' : 'unrecognized',
        code,
        json: response.headers.get('content-type')?.split(';')[0] === 'application/json',
        supabaseRequestIdPresent: response.headers.has('sb-request-id'),
      });
      return { status: 'unavailable' };
    }
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) return { status: 'unavailable' };
    if (rows.length === 0) return { status: 'denied' };
    const row = rows[0] as PaidSessionRow;
    const session = validatePaidSessionRow(row, firebaseUid, sessionId);
    return session ? { status: 'verified', session } : { status: 'denied' };
  } catch (error) {
    console.warn('[paid_session_read] request or response failed', { errorType: error instanceof Error ? error.name : 'unknown' });
    return { status: 'unavailable' };
  }
}
