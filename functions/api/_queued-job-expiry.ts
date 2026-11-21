/**
 * Bounded recovery for a Forensic job that never started.
 *
 * A queued job waits for a Queue consumer. If no consumer is attached, the consumer is fail-closed, or a
 * delivery is dropped after its retries, the durable job stays "queued" forever and the parent sees an
 * endless "Waiting for an analyzer worker" message. This module fails such a job after a fixed age, so the
 * parent gets a clear result and the held credit is released. It never fails a job a consumer has claimed.
 */
import { failDeadLetterJob, type DurableJobEnv, type DurableJobRecord } from './_durable-analysis-jobs';
import { createStagingCreditRpc, type StagingRpcEnv } from './_staging-credit-rpc';
import { releasePaidReservation } from './_paid-credit-lifecycle';
import { releaseFreeScan } from './_free-credit-lifecycle';

/** A queued job older than this has not been claimed in any realistic healthy run. */
export const QUEUED_JOB_MAX_AGE_MS = 20 * 60 * 1000;

export const QUEUE_EXPIRED_FAILURE = {
  code: 'ANALYZER_QUEUE_TIMEOUT',
  message: 'The analysis did not start in time, so it was stopped. No analysis credit was charged. Please start it again.',
} as const;

export function isStaleQueuedJob(job: Pick<DurableJobRecord, 'status' | 'created_at'>, now = Date.now()): boolean {
  if (job.status !== 'queued' || !job.created_at) return false;
  const created = Date.parse(job.created_at);
  return Number.isFinite(created) && now - created > QUEUED_JOB_MAX_AGE_MS;
}

/** Returns the held credit for a failed job. Mirrors the queue consumer's release rules. */
export async function releaseJobReservation(env: StagingRpcEnv, job: DurableJobRecord): Promise<void> {
  if (job.owner_bypass || !job.reservation_id) return;
  const rpc = createStagingCreditRpc(env);
  const released = job.session_id
    ? await releasePaidReservation(job.session_id, job.job_id, job.reservation_id, rpc)
    : await releaseFreeScan(job.owner_uid, job.job_id, job.reservation_id, rpc);
  if (released.status === 'unavailable' || released.status === 'denied') {
    throw Object.assign(new Error('Credit release is not yet confirmed.'), { retryable: true, code: 'CREDIT_RELEASE_UNAVAILABLE' });
  }
}

export interface QueuedJobExpiryDeps {
  fail?: (env: DurableJobEnv, jobId: string) => Promise<DurableJobRecord | null>;
  release?: (env: StagingRpcEnv, job: DurableJobRecord) => Promise<void>;
}

/**
 * Fails a stale queued job and releases its credit. Returns the failed record, or null when the job was
 * claimed or changed by another party (then the caller keeps reporting its real state).
 * A failed release does not undo the failure: the reservation is then reconciled by its TTL.
 */
export async function expireStaleQueuedJob(
  env: DurableJobEnv & StagingRpcEnv,
  job: DurableJobRecord,
  deps: QueuedJobExpiryDeps = {},
): Promise<DurableJobRecord | null> {
  const fail = deps.fail ?? ((e: DurableJobEnv, jobId: string) => failDeadLetterJob(e, jobId, fetch, QUEUE_EXPIRED_FAILURE));
  const release = deps.release ?? releaseJobReservation;
  const failed = await fail(env, job.job_id);
  if (!failed || failed.status !== 'failed') return null;
  try {
    await release(env, failed);
  } catch (error) {
    console.error('[ANALYZER_QUEUE_TIMEOUT_RELEASE_PENDING]', error instanceof Error ? error.name : 'unknown');
  }
  return failed;
}
