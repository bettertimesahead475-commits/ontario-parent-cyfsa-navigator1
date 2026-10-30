/**
 * Server-only Supabase RPC transport for staging. Do not expose this key in
 * browser bundles or responses. The caller must have already authenticated
 * the Firebase UID and verified the paid session's database ownership.
 */
export type StagingRpcEnv = { STAGING_SUPABASE_URL?: string; STAGING_SUPABASE_SERVICE_ROLE_KEY?: string };

export function createStagingCreditRpc(env: StagingRpcEnv, fetcher: typeof fetch = fetch) {
  return async (name: string, args: Record<string, unknown>): Promise<{ status: string; reservation_id?: string | null }> => {
    if (!['paid_reserve_credit', 'paid_finalize_credit', 'paid_release_credit', 'free_reserve_scan', 'free_finalize_scan', 'free_release_scan'].includes(name)) {
      throw new Error('Unsupported credit RPC');
    }
    if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Staging RPC not configured');
    const url = new URL('/rest/v1/rpc/' + name, env.STAGING_SUPABASE_URL);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    const response = await fetcher(url.toString(), {
      method: 'POST',
      headers: {
        apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Staging credit RPC failed');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof (value as { status?: unknown }).status !== 'string') throw new Error('Invalid credit RPC response');
    return value as { status: string; reservation_id?: string | null };
  };
}
