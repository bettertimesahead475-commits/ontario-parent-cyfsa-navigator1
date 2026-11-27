import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitSubject } from '../functions/api/_rate-limit';

vi.mock('../functions/api/_auth-check', () => ({ verifyFirebaseRequest: vi.fn(async () => ({ status: 'verified', uid: 'burst_user', emailVerified: false, email: null })) }));

describe('per-isolate rate limiting', () => {
  it('allows up to the limit in the window, then reports seconds until the next slot', () => {
    const rule = { limit: 3, windowMs: 60_000 };
    expect([0, 1, 2].map((i) => rateLimitRetryAfter('t', 'u', rule, 1_000 + i))).toEqual([0, 0, 0]);
    expect(rateLimitRetryAfter('t', 'u', rule, 2_000)).toBe(59);
    expect(rateLimitRetryAfter('t', 'other', rule, 2_000)).toBe(0); // per subject
    expect(rateLimitRetryAfter('t', 'u', rule, 61_001)).toBe(0); // window slid
  });

  it('keys on the verified uid when present, otherwise the connecting IP', () => {
    const req = new Request('https://x/', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
    expect(rateLimitSubject(req, 'abc')).toBe('uid:abc');
    expect(rateLimitSubject(req, null)).toBe('ip:203.0.113.9');
  });

  it('returns 429 with Retry-After from extract-text after a burst, before any provider work', async () => {
    const { onRequestPost } = await import('../functions/api/extract-text');
    const env = { FIREBASE_PROJECT_ID: 'p', GEMINI_API_KEY: 'AIza' + 'x'.repeat(35) } as any;
    const call = () => onRequestPost({ request: new Request('https://x/api/extract-text', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{}' }), env });
    for (let i = 0; i < RATE_LIMITS.extractText.limit; i++) expect((await call()).status).not.toBe(429);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });
});
