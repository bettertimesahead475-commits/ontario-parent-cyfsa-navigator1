// T-05: the pending cross-isolate limiter, with the Supabase RPC replaced by an in-memory store that applies the
// same fixed-window rule as supabase/migrations_pending_approval/create_navigator_rate_limit_hits.sql.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS, resetRateLimitsForTests } from '../functions/api/_rate-limit';
import {
  RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS,
  RATE_LIMIT_STORE_FAILURE_MODE,
  persistentRateLimitDecision,
  persistentRateLimitResponse,
  persistentRateLimitRetryAfter,
} from '../functions/api/_persistent-rate-limit';

const ENV = { PERSISTENT_RATE_LIMITS: 'true', STAGING_SUPABASE_URL: 'https://synthetic.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_' + 'x'.repeat(40) };

function sharedStore() {
  const counts = new Map<string, number>();
  const bodies: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    urls.push(url);
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const key = body.p_key_hash + '@' + body.p_window_seconds;
    const hits = counts.get(key) ?? 0;
    if (hits >= body.p_limit) return Response.json([{ allowed: false, retry_after_seconds: 42 }]);
    counts.set(key, hits + 1);
    return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  }) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
  return { fetcher, bodies, urls, counts };
}

afterEach(() => vi.restoreAllMocks());

describe('persistent rate limiting (T-05, pending approval)', () => {
  it('enforces one limit across isolates, which the per-isolate limiter cannot', async () => {
    const store = sharedStore();
    const { limit } = RATE_LIMITS.analyze;
    const results: number[] = [];
    // Every request lands on a fresh isolate: the per-isolate counters are empty each time.
    for (let i = 0; i < limit + 3; i++) {
      resetRateLimitsForTests();
      results.push(await persistentRateLimitRetryAfter(ENV, 'analyze', 'uid:user_a', { fetcher: store.fetcher }));
    }
    expect(results.slice(0, limit)).toEqual(Array(limit).fill(0));
    expect(results.slice(limit)).toEqual([42, 42, 42]);
    resetRateLimitsForTests();
    expect(await persistentRateLimitRetryAfter(ENV, 'analyze', 'uid:user_b', { fetcher: store.fetcher })).toBe(0);
  });

  it('without the flag, makes no database call and keeps per-isolate behaviour', async () => {
    const store = sharedStore();
    const env = { ...ENV, PERSISTENT_RATE_LIMITS: undefined };
    for (let i = 0; i < RATE_LIMITS.analyze.limit; i++) expect(await persistentRateLimitRetryAfter(env, 'analyze', 'uid:u', { fetcher: store.fetcher, now: 1_000 })).toBe(0);
    expect(await persistentRateLimitRetryAfter(env, 'analyze', 'uid:u', { fetcher: store.fetcher, now: 2_000 })).toBe(59);
    expect(store.fetcher).not.toHaveBeenCalled();
  });

  it('refuses a burst in the isolate first, without a database round trip', async () => {
    const store = sharedStore();
    const { limit } = RATE_LIMITS.activateCode;
    for (let i = 0; i < limit; i++) expect(await persistentRateLimitRetryAfter(ENV, 'activateCode', 'ip:203.0.113.7', { fetcher: store.fetcher, now: 1_000 })).toBe(0);
    expect(await persistentRateLimitRetryAfter(ENV, 'activateCode', 'ip:203.0.113.7', { fetcher: store.fetcher, now: 1_500 })).toBeGreaterThan(0);
    expect(store.fetcher).toHaveBeenCalledTimes(limit);
  });

  it('sends only a SHA-256 hash of bucket and subject, with the bucket rule, to the service-role RPC', async () => {
    const store = sharedStore();
    await persistentRateLimitRetryAfter(ENV, 'requestAccess', 'uid:firebase_uid_secret', { fetcher: store.fetcher });
    const sent = JSON.stringify(store.bodies[0]);
    expect(sent).not.toContain('firebase_uid_secret');
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('requestAccess:uid:firebase_uid_secret'))), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(store.bodies[0]).toEqual({ p_key_hash: expected, p_limit: 5, p_window_seconds: 600 });
    expect(store.urls[0]).toBe('https://synthetic.supabase.co/rest/v1/rpc/navigator_rate_limit_hit');
    const init = (store.fetcher.mock.calls[0] as [string, RequestInit])[1];
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps distinct counters per bucket for the same subject', async () => {
    const store = sharedStore();
    await persistentRateLimitRetryAfter(ENV, 'analyze', 'uid:u', { fetcher: store.fetcher });
    await persistentRateLimitRetryAfter(ENV, 'extractText', 'uid:u', { fetcher: store.fetcher });
    expect(store.bodies[0].p_key_hash).not.toBe(store.bodies[1].p_key_hash);
  });

  const failures: Array<[string, () => typeof fetch, Record<string, unknown>?]> = [
    ['network error', () => vi.fn(async () => { throw new TypeError('fetch failed'); }) as any],
    ['timeout', () => vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }) as any],
    ['HTTP 503', () => vi.fn(async () => new Response('down', { status: 503 })) as any],
    ['RPC missing (404, migration not applied)', () => vi.fn(async () => Response.json({ code: 'PGRST202' }, { status: 404 })) as any],
    ['malformed reply', () => vi.fn(async () => Response.json([{ allowed: 'yes' }])) as any],
    ['empty reply', () => vi.fn(async () => Response.json([])) as any],
    ['missing service key', () => vi.fn() as any, { STAGING_SUPABASE_SERVICE_ROLE_KEY: '' }],
    ['non-HTTPS URL', () => vi.fn() as any, { STAGING_SUPABASE_URL: 'http://synthetic.supabase.co' }],
  ];

  for (const [label, makeFetcher, envOverride] of failures) {
    it(`store failure (${label}): open buckets keep the per-isolate limit, closed buckets refuse`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = { ...ENV, ...envOverride };
      for (const bucket of Object.keys(RATE_LIMIT_STORE_FAILURE_MODE) as Array<keyof typeof RATE_LIMITS>) {
        resetRateLimitsForTests();
        const retry = await persistentRateLimitRetryAfter(env, bucket, 'uid:secret_subject', { fetcher: makeFetcher() });
        expect(retry).toBe(RATE_LIMIT_STORE_FAILURE_MODE[bucket] === 'closed' ? RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS : 0);
      }
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret_subject');
    });
  }

  it('fails closed exactly for activation codes, purchase claims and access requests', () => {
    expect(Object.entries(RATE_LIMIT_STORE_FAILURE_MODE).filter(([, m]) => m === 'closed').map(([b]) => b).sort()).toEqual(['activateCode', 'claimPurchase', 'requestAccess']);
    expect(Object.keys(RATE_LIMIT_STORE_FAILURE_MODE).sort()).toEqual(Object.keys(RATE_LIMITS).sort());
  });

  it('an open bucket still enforces the per-isolate limit while the store is down', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); }) as any;
    const { limit } = RATE_LIMITS.transcribe;
    for (let i = 0; i < limit; i++) expect(await persistentRateLimitRetryAfter(ENV, 'transcribe', 'uid:u', { fetcher: down, now: 1_000 })).toBe(0);
    expect(await persistentRateLimitRetryAfter(ENV, 'transcribe', 'uid:u', { fetcher: down, now: 1_000 })).toBe(60);
  });

  it('treats a refusal without a usable retry value as 1 second', async () => {
    const fetcher = vi.fn(async () => Response.json([{ allowed: false, retry_after_seconds: null }])) as any;
    expect(await persistentRateLimitRetryAfter(ENV, 'analyze', 'uid:u', { fetcher })).toBe(1);
  });
  it('separates limit exhaustion (429 RATE_LIMITED) from an unreachable store (503 RATE_LIMIT_STORE_UNAVAILABLE)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); }) as any;
    const unavailable = await persistentRateLimitDecision(ENV, 'activateCode', 'uid:u', { fetcher: down });
    expect(unavailable).toEqual({ allowed: false, reason: 'store_unavailable', retryAfterSeconds: RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS });
    const r503 = persistentRateLimitResponse(unavailable as any);
    expect(r503.status).toBe(503);
    expect(r503.headers.get('Retry-After')).toBe(String(RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS));
    expect(await r503.json()).toMatchObject({ code: 'RATE_LIMIT_STORE_UNAVAILABLE', retryable: true });

    resetRateLimitsForTests();
    const limited = await persistentRateLimitDecision(ENV, 'activateCode', 'uid:u', { fetcher: vi.fn(async () => Response.json([{ allowed: false, retry_after_seconds: 42 }])) as any });
    expect(limited).toEqual({ allowed: false, reason: 'rate_limited', retryAfterSeconds: 42 });
    const r429 = persistentRateLimitResponse(limited as any);
    expect(r429.status).toBe(429);
    expect(r429.headers.get('Retry-After')).toBe('42');
    expect(await r429.json()).toMatchObject({ code: 'RATE_LIMITED' });

    resetRateLimitsForTests();
    const { limit } = RATE_LIMITS.activateCode;
    for (let i = 0; i < limit; i++) await persistentRateLimitDecision(ENV, 'activateCode', 'uid:v', { fetcher: down, now: 1_000 });
    // Once the per-isolate limit is used up, the refusal is a real limit even while the store is down.
    expect(await persistentRateLimitDecision(ENV, 'activateCode', 'uid:v', { fetcher: down, now: 1_000 })).toMatchObject({ allowed: false, reason: 'rate_limited' });
    expect(await persistentRateLimitDecision({ ...ENV, PERSISTENT_RATE_LIMITS: undefined }, 'analyze', 'uid:w', { fetcher: down })).toEqual({ allowed: true });
  });

  it('an open bucket reports allowed, not unavailable, while the store is down', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = vi.fn(async () => new Response('down', { status: 503 })) as any;
    expect(await persistentRateLimitDecision(ENV, 'analyze', 'uid:u', { fetcher: down })).toEqual({ allowed: true });
  });
});
