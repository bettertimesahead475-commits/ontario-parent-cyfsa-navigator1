// Stage 10 slice 8: per-account WRITE limiter for the professional-access lifecycle
// (create invitation, accept invitation, revoke). STAGE_10_COMPLETION_DECISIONS.md C2 / §11.
//
// INSTANCE-LOCAL, NOT DISTRIBUTED. The budget lives in this process's memory. On a serverless
// platform every warm instance keeps its own budget and a cold start begins with an empty one, so
// the effective ceiling across the deployment is (limit x concurrently warm instances). It is a
// per-account abuse brake, never a globally enforced limit. The existing per-IP /api limiter in
// api/_server.ts stays in place in front of it; this does not replace it.
//
// KEY: the Firebase uid of a successfully verified ID token -- the authenticated account. Never an
// email, never an invitation token (raw or digested), never an IP. Callers must consume only AFTER
// authentication, so an unauthenticated request can never spend anyone's budget.

export const LIFECYCLE_WRITE_LIMIT = 30;
export const LIFECYCLE_WRITE_WINDOW_MS = 15 * 60 * 1000;
// Bounds memory: expired windows are swept once the map grows past this many accounts.
const SWEEP_THRESHOLD = 10_000;

export interface LimitDecision {
  allowed: boolean;
  /** Whole seconds until this account's window resets (only meaningful when refused). */
  retryAfterSeconds: number;
}

export interface AccountWriteLimiter {
  consume(accountKey: string): LimitDecision;
  /** Test support: clears every budget. */
  reset(): void;
  /** Test support: number of accounts currently tracked. */
  size(): number;
  /** Test support: the keys currently held (to prove what is and is not stored). */
  keys(): string[];
}

export function createAccountWriteLimiter(options: {
  limit?: number;
  windowMs?: number;
  now?: () => number;
} = {}): AccountWriteLimiter {
  const limit = options.limit ?? LIFECYCLE_WRITE_LIMIT;
  const windowMs = options.windowMs ?? LIFECYCLE_WRITE_WINDOW_MS;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();

  function sweep(t: number): void {
    for (const [key, w] of windows) if (t - w.start >= windowMs) windows.delete(key);
  }

  return {
    consume(accountKey: string): LimitDecision {
      if (typeof accountKey !== 'string' || !accountKey) {
        // No verified account, no budget: refuse rather than share a bucket.
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
      const t = now();
      if (windows.size > SWEEP_THRESHOLD) sweep(t);
      let w = windows.get(accountKey);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(accountKey, w);
      }
      const retryAfterSeconds = Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
      if (w.count >= limit) return { allowed: false, retryAfterSeconds };
      w.count += 1;
      return { allowed: true, retryAfterSeconds };
    },
    reset() { windows.clear(); },
    size() { return windows.size; },
    keys() { return [...windows.keys()]; },
  };
}

/** The process-wide limiter used by the mounted lifecycle routes. */
export const lifecycleWriteLimiter: AccountWriteLimiter = createAccountWriteLimiter();
