// Single source for the analyzer's time limits. api/analyzer-deadlines-config.test.ts checks these against the
// wrangler configuration and against the Cloudflare settings recorded in
// engineering/evidence/cloudflare-queue-config-20261127.json, so a change in one place fails the test.

/** Cloudflare Queue consumer invocation wall-clock limit (Workers platform limit for queue consumers). */
export const WORKER_WALL_MS = 15 * 60_000;
/** Lease a Worker takes on a durable job; every progress write renews it. */
export const JOB_LEASE_SECONDS = 240;
/** A credit or free-scan reservation untouched this long can be released by the account's next reservation. */
export const RESERVATION_TTL_MINUTES = 15;
export const RESERVATION_TTL_MS = RESERVATION_TTL_MINUTES * 60_000;
export const RESERVATION_TTL_INTERVAL = `${RESERVATION_TTL_MINUTES} minutes`;
/** Primary analyzer queue consumer settings (wrangler names). */
export const ANALYZER_QUEUE_CONSUMER = { max_batch_size: 1, max_batch_timeout: 1, max_retries: 5, retry_delay: 20, max_concurrency: 2 } as const;
/** Consumer-side retry backoff: base * 2^(attempts-1), capped. */
export const RETRY_BASE_SECONDS = 20;
export const RETRY_MAX_SECONDS = 900;
export const retryDelaySeconds = (attempts: number): number =>
  Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.min(10, Math.max(0, attempts - 1)));
