/**
 * Per-isolate sliding-window rate limiter. No storage, binding or recurring cost.
 *
 * Scope: it stops a single client's bursts against the cost-heavy endpoints (each Cloudflare isolate keeps
 * its own counters), so it is a first line of defence, not a global quota. Keys are the verified Firebase
 * uid where available, otherwise the connecting IP; they are hashed in memory only and never logged.
 */
export type RateLimitRule = { limit: number; windowMs: number };

export const RATE_LIMITS = {
  extractText: { limit: 20, windowMs: 60_000 },
  transcribe: { limit: 10, windowMs: 60_000 },
  analyze: { limit: 8, windowMs: 60_000 },
  activateCode: { limit: 6, windowMs: 10 * 60_000 },
  requestAccess: { limit: 5, windowMs: 10 * 60_000 },
  adminWrite: { limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

const MAX_TRACKED_KEYS = 5_000;
const hits = new Map<string, number[]>();

/** Returns 0 when allowed (and records the hit), otherwise the seconds until the next slot opens. */
export function rateLimitRetryAfter(bucket: string, subject: string, rule: RateLimitRule, now = Date.now()): number {
  const key = bucket + ':' + subject;
  const recent = (hits.get(key) || []).filter((t) => now - t < rule.windowMs);
  if (recent.length >= rule.limit) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0] + rule.windowMs - now) / 1000));
  }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  // Bounded memory: drop the least recently used keys.
  while (hits.size > MAX_TRACKED_KEYS) hits.delete(hits.keys().next().value as string);
  return 0;
}

export function rateLimitSubject(request: Request, uid?: string | null): string {
  return uid ? 'uid:' + uid : 'ip:' + (request.headers.get('cf-connecting-ip') || 'unknown');
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'Too many requests. Please wait a moment and try again. Nothing was charged.', code: 'RATE_LIMITED', retryable: true },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSeconds) } },
  );
}

/** Test helper: clears all counters. */
export function resetRateLimitsForTests(): void { hits.clear(); }
