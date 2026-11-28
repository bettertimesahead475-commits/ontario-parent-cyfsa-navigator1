/** Test fixtures for the free-trial policy (functions/api/_free-trial.ts). Synthetic values only. */
export const SPEND_CAPS_OFF = {
  FREE_TRIAL_IP_DAILY_LIMIT: 'off',
  FREE_TRIAL_MAX_ATTEMPTS: 'off',
  FREE_TRIAL_IP_MONTHLY_LIMIT: 'off',
  FREE_QUICK_PLATFORM_DAILY_LIMIT: 'off',
  FREE_FORENSIC_PLATFORM_DAILY_LIMIT: 'off',
  FREE_OCR_PLATFORM_DAILY_LIMIT: 'off',
  PAID_PLATFORM_DAILY_LIMIT: 'off',
  FREE_TRIAL_PAUSE_AT_PAID_DAILY: 'off',
} as const;

export const VERIFIED_FREE_EMAIL = 'synthetic.parent@example.com';

/** Wraps a fetch mock so free_usage counter reads return the given analyses_used per key (missing key: no row). */
export function withFreeUsage<F extends (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
  inner: F,
  rows: Record<string, number> = {},
): F {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rest/v1/free_usage')) {
      const key = decodeURIComponent(new URL(url).searchParams.get('uid')!.slice(3));
      return Response.json(key in rows ? [{ analyses_used: rows[key] }] : []);
    }
    return inner(input, init);
  }) as F;
}

/** A verified free account; its email is derived from the uid so each synthetic user has its own entitlement keys. */
export const freeIdentity = (uid: string) => ({ status: 'verified' as const, uid, email: `${uid}@example.com`, emailVerified: true });

/** Credit RPC stand-in under which every free-trial counter has room. */
export const roomyCounterRpc = async (name: string) =>
  name === 'free_reserve_scan' ? { status: 'reserved', reservation_id: 'free_res_synthetic' } : { status: 'consumed' };

export const SYNTHETIC_SUPABASE = { STAGING_SUPABASE_URL: 'https://synthetic.supabase.test', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic_not_a_key' } as const;
