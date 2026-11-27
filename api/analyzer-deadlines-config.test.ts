// NAV-004: the analyzer's time limits come from shared/analyzerDeadlines.ts. This test ties them to the wrangler files,
// to the Cloudflare settings read from the account on 2026-11-27 (engineering/evidence/cloudflare-queue-config-20261127.json),
// and models queue waiting time and submit-time reservation work against the reservation TTL.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANALYZER_QUEUE_CONSUMER, JOB_LEASE_SECONDS, RESERVATION_TTL_INTERVAL, RESERVATION_TTL_MS, WORKER_WALL_MS, retryDelaySeconds,
} from '../shared/analyzerDeadlines';
import { RESERVATION_TTL, RESERVATION_TTL_MS as CREDIT_TTL_MS } from './services/creditAccounting';
import { FREE_SCAN_RESERVATION_TTL } from './services/freeScanReservation';
import { retryDelay } from '../workers/analyzer-queue-consumer';

const root = resolve(__dirname, '..');
const jsonc = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const evidence = JSON.parse(readFileSync(resolve(root, 'engineering/evidence/cloudflare-queue-config-20261127.json'), 'utf8'));
const primaryConsumer = (file: string, queue: string) => jsonc(file).queues.consumers.find((c: { queue: string }) => c.queue === queue);

// Forensic Worker execution from api/forensic-lifecycle-replay.test.ts (production timings, typical latency).
const FORENSIC_EXEC_MS = 133_900;
// Submit-time work after the reservation is written and before the message is sent (analyze.ts queued path):
// durable input save (storage), job create (RPC), job record claim (storage), queue send. Slow-latency profile.
const SUBMIT_AFTER_RESERVE_MS = 4_000 + 2_000 + 4_000 + 2_000;

describe('analyzer deadline configuration', () => {
  it('uses one reservation TTL for paid credits and free scans', () => {
    expect(RESERVATION_TTL).toBe(RESERVATION_TTL_INTERVAL);
    expect(FREE_SCAN_RESERVATION_TTL).toBe(RESERVATION_TTL_INTERVAL);
    expect(CREDIT_TTL_MS).toBe(RESERVATION_TTL_MS);
    expect(RESERVATION_TTL_INTERVAL).toBe('15 minutes');
  });

  it('the consumer backoff is the shared one, and every delay fits the relay\'s 900 s cap', () => {
    for (let a = 1; a <= 12; a++) {
      expect(retryDelay(a)).toBe(retryDelaySeconds(a));
      expect(retryDelay(a)).toBeLessThanOrEqual(900);
    }
  });

  it.each([
    ['wrangler.analyzer-queue-staging.jsonc', 'cyfsa-staging-analyzer-jobs'],
    ['wrangler.production-analyzer-queue-consumer.jsonc', 'cyfsa-analyzer-jobs'],
  ])('%s primary consumer matches the shared settings', (file, queue) => {
    expect(primaryConsumer(file, queue)).toMatchObject(ANALYZER_QUEUE_CONSUMER);
  });

  it('the deployed staging consumer (the one production Pages sends to) matches the shared settings', () => {
    expect(evidence.pages.production_queue_producer.ANALYZER_JOBS_QUEUE).toBe('cyfsa-staging-analyzer-jobs');
    const live = evidence.queues['cyfsa-staging-analyzer-jobs'].consumer;
    expect({
      max_batch_size: live.batch_size, max_batch_timeout: live.max_wait_time_ms / 1000, max_retries: live.max_retries,
      retry_delay: live.retry_delay, max_concurrency: live.max_concurrency,
    }).toEqual(ANALYZER_QUEUE_CONSUMER);
    // The production consumer is deliberately not attached (ANALYZER_ENABLED "false").
    expect(evidence.queues['cyfsa-analyzer-jobs'].consumer).toBeNull();
  });

  it('a Forensic run stays inside the Worker wall limit and its lease', () => {
    expect(FORENSIC_EXEC_MS).toBeLessThan(WORKER_WALL_MS);
    expect(JOB_LEASE_SECONDS * 1000).toBeLessThan(WORKER_WALL_MS);
    expect(JOB_LEASE_SECONDS * 1000).toBeGreaterThan(36_700 + 30_000); // longest gap between progress writes in the replay
  });
});

/** Start time of each job when N are sent together to a consumer with `concurrency` slots. */
const startTimes = (n: number, concurrency: number, execMs: number) => Array.from({ length: n }, (_, i) => Math.floor(i / concurrency) * execMs);

describe('queue waiting time vs reservation TTL (criterion B)', () => {
  it('three Forensic jobs with max_concurrency 2: the third waits one execution and is finalized inside the TTL', () => {
    const starts = startTimes(3, ANALYZER_QUEUE_CONSUMER.max_concurrency, FORENSIC_EXEC_MS);
    expect(starts[2]).toBeGreaterThanOrEqual(FORENSIC_EXEC_MS);
    const reservationAgeAtFinalize = SUBMIT_AFTER_RESERVE_MS + starts[2] + FORENSIC_EXEC_MS;
    expect(reservationAgeAtFinalize).toBeLessThan(RESERVATION_TTL_MS);
  });

  it('documents the safe backlog: with no retries, up to 10 Forensic jobs ahead still finalize inside the TTL', () => {
    const safe = (ahead: number) => SUBMIT_AFTER_RESERVE_MS + startTimes(ahead + 1, ANALYZER_QUEUE_CONSUMER.max_concurrency, FORENSIC_EXEC_MS)[ahead] + FORENSIC_EXEC_MS < RESERVATION_TTL_MS;
    expect(safe(10)).toBe(true);
    expect(safe(12)).toBe(false);
  });

  it('a job retried through every delivery exceeds the TTL: the gap reconcile_skip_live_analyzer_jobs.sql closes (pending approval)', () => {
    let age = SUBMIT_AFTER_RESERVE_MS;
    for (let attempt = 1; attempt <= ANALYZER_QUEUE_CONSUMER.max_retries; attempt++) age += FORENSIC_EXEC_MS + retryDelaySeconds(attempt) * 1000;
    age += FORENSIC_EXEC_MS;
    expect(age).toBeGreaterThan(RESERVATION_TTL_MS);
  });
});
