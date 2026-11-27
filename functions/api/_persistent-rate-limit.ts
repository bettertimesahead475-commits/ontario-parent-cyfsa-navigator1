/**
 * T-05 / SEC-3: cross-isolate rate limiting on the existing Supabase project (pending owner approval).
 *
 * Not wired to any route yet. It needs supabase/migrations_pending_approval/create_navigator_rate_limit_hits.sql
 * applied and PERSISTENT_RATE_LIMITS="true"; until then it behaves exactly like the per-isolate limiter.
 * The per-isolate limiter always runs first, so bursts are refused without a database round trip, and it stays
 * the fallback when the shared store cannot be reached. Subjects are SHA-256 hashed before they leave the
 * isolate; no uid, email or IP is sent to or stored in the database, and none is logged.
 */
import { RATE_LIMITS, rateLimitRetryAfter } from './_rate-limit';
import { normalizeSupabaseKey } from './_supabase-key';

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export type PersistentRateLimitEnv = {
  PERSISTENT_RATE_LIMITS?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
};

/**
 * When the shared store is unreachable: 'open' keeps the per-isolate limit only; 'closed' refuses the request.
 * Closed buckets guard activation-code guessing and access-request spam, and both routes need the same database
 * to do anything, so refusing costs no availability.
 */
export const RATE_LIMIT_STORE_FAILURE_MODE: Record<RateLimitBucket, 'open' | 'closed'> = {
  extractText: 'open',
  transcribe: 'open',
  analyze: 'open',
  adminWrite: 'open',
  activateCode: 'closed',
  requestAccess: 'closed',
  myPayments: 'open',
  claimPurchase: 'closed',
};

export const RATE_LIMIT_STORE_TIMEOUT_MS = 1_500;
export const RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS = 30;
const RPC_NAME = 'navigator_rate_limit_hit';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sharedRetryAfter(env: PersistentRateLimitEnv, bucket: RateLimitBucket, subject: string, fetcher: typeof fetch): Promise<number> {
  const serviceKey = normalizeSupabaseKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  if (!env.STAGING_SUPABASE_URL || !serviceKey) throw new Error('rate limit store not configured');
  const url = new URL('/rest/v1/rpc/' + RPC_NAME, env.STAGING_SUPABASE_URL);
  if (url.protocol !== 'https:') throw new Error('HTTPS required');
  const rule = RATE_LIMITS[bucket];
  const response = await fetcher(url.toString(), {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      p_key_hash: await sha256Hex(bucket + ':' + subject),
      p_limit: rule.limit,
      p_window_seconds: Math.ceil(rule.windowMs / 1000),
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(RATE_LIMIT_STORE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('rate limit store HTTP ' + response.status);
  const body: unknown = await response.json();
  const row = Array.isArray(body) ? body[0] : body;
  if (!row || typeof row !== 'object' || typeof (row as any).allowed !== 'boolean') throw new Error('rate limit store malformed reply');
  if ((row as any).allowed) return 0;
  const retry = Number((row as any).retry_after_seconds);
  return Number.isFinite(retry) && retry >= 1 ? Math.ceil(retry) : 1;
}

/**
 * Same contract as rateLimitRetryAfter: 0 when allowed (the hit is recorded), otherwise seconds until a slot opens.
 */
export async function persistentRateLimitRetryAfter(
  env: PersistentRateLimitEnv,
  bucket: RateLimitBucket,
  subject: string,
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<number> {
  const local = rateLimitRetryAfter(bucket, subject, RATE_LIMITS[bucket], options.now);
  if (local) return local;
  if (env.PERSISTENT_RATE_LIMITS !== 'true') return 0;
  try {
    return await sharedRetryAfter(env, bucket, subject, options.fetcher ?? fetch);
  } catch (err: any) {
    const mode = RATE_LIMIT_STORE_FAILURE_MODE[bucket];
    console.warn(JSON.stringify({ tag: '[RATE_LIMIT_STORE_UNAVAILABLE]', bucket, mode, errorName: err?.name || 'Error' }));
    return mode === 'closed' ? RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS : 0;
  }
}
