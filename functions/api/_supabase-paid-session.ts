import { validatePaidSessionRow, type PaidSessionRow, type VerifiedSession } from './_paid-session-validation';

export type SupabaseStagingConfig = {
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_READ_KEY?: string;
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
): Promise<SessionReadResult> {
  if (!firebaseUid || !sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return { status: 'denied' };
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_READ_KEY) return { status: 'unavailable' };
  let url: URL;
  try {
    url = new URL('/rest/v1/navigator_paid_sessions', env.STAGING_SUPABASE_URL);
    if (url.protocol !== 'https:') return { status: 'unavailable' };
    url.searchParams.set('select', 'id,firebase_uid,tier,issued_at,expires_at,revoked_at');
    url.searchParams.set('id', 'eq.' + sessionId);
    url.searchParams.set('firebase_uid', 'eq.' + firebaseUid);
    url.searchParams.set('limit', '1');
  } catch {
    return { status: 'unavailable' };
  }
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: {
        apikey: env.STAGING_SUPABASE_READ_KEY,
        Authorization: 'Bearer ' + env.STAGING_SUPABASE_READ_KEY,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { status: 'unavailable' };
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) return { status: 'unavailable' };
    if (rows.length === 0) return { status: 'denied' };
    const row = rows[0] as PaidSessionRow;
    const session = validatePaidSessionRow(row, firebaseUid, sessionId);
    return session ? { status: 'verified', session } : { status: 'denied' };
  } catch {
    return { status: 'unavailable' };
  }
}
