// Stage 10 slice 8: the instance-local per-account lifecycle write limiter.
import { describe, expect, it } from 'vitest';
import { createAccountWriteLimiter, LIFECYCLE_WRITE_LIMIT, LIFECYCLE_WRITE_WINDOW_MS, lifecycleWriteLimiter } from './lifecycleWriteLimiter.js';

describe('createAccountWriteLimiter', () => {
  it('allows exactly `limit` writes per account per window, then refuses with a Retry-After', () => {
    let t = 1_000_000;
    const l = createAccountWriteLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect([1, 2, 3].map(() => l.consume('uid-a').allowed)).toEqual([true, true, true]);
    const refused = l.consume('uid-a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(60);
    t += 30_000;
    expect(l.consume('uid-a')).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it('a new window restores the budget', () => {
    let t = 0;
    const l = createAccountWriteLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(l.consume('uid-a').allowed).toBe(true);
    expect(l.consume('uid-a').allowed).toBe(false);
    t = 1000;
    expect(l.consume('uid-a').allowed).toBe(true);
  });

  it('accounts have separate budgets: exhausting one never affects another', () => {
    const l = createAccountWriteLimiter({ limit: 2 });
    l.consume('uid-a'); l.consume('uid-a'); l.consume('uid-a');
    expect(l.consume('uid-a').allowed).toBe(false);
    expect(l.consume('uid-b').allowed).toBe(true);
    expect(l.consume('uid-b').allowed).toBe(true);
    expect(l.consume('uid-b').allowed).toBe(false);
  });

  it('an empty or missing key never shares a bucket: it is refused', () => {
    const l = createAccountWriteLimiter({ limit: 5 });
    for (const k of ['', undefined as any, null as any, 42 as any]) expect(l.consume(k).allowed).toBe(false);
    expect(l.size()).toBe(0);
  });

  it('expired windows are swept once the map grows large (bounded memory)', () => {
    let t = 0;
    const l = createAccountWriteLimiter({ limit: 1, windowMs: 10, now: () => t });
    for (let i = 0; i <= 10_001; i++) l.consume(`uid-${i}`);
    expect(l.size()).toBe(10_002);
    t = 20;
    l.consume('uid-new');
    expect(l.size()).toBe(1);
  });

  it('the production defaults are conservative: 30 lifecycle writes per 15 minutes per account', () => {
    expect(LIFECYCLE_WRITE_LIMIT).toBe(30);
    expect(LIFECYCLE_WRITE_WINDOW_MS).toBe(15 * 60 * 1000);
    lifecycleWriteLimiter.reset();
    for (let i = 0; i < 30; i++) expect(lifecycleWriteLimiter.consume('uid-default').allowed).toBe(true);
    expect(lifecycleWriteLimiter.consume('uid-default').allowed).toBe(false);
    lifecycleWriteLimiter.reset();
  });
});
