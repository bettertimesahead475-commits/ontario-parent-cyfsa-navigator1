import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';
import {
  claimDurableJob,
  completeRecoveredJob,
  failDeadLetterJob,
  loadDurableInput,
  loadPersistedReport,
  readDurableJob,
  requeueFromDeadLetter,
  updateDurableJob,
  type DurableJobRecord,
  type AnalyzerQueueBinding,
} from '../functions/api/_durable-analysis-jobs';
import { createAnalyzerQueueMessage, parseAnalyzerQueueMessage } from '../functions/api/_analyzer-queue-contract';
import { createStagingCreditRpc } from '../functions/api/_staging-credit-rpc';
import { finalizeFreeScan, releaseFreeScan } from '../functions/api/_free-credit-lifecycle';
import { finalizePaidReservation, releasePaidReservation } from '../functions/api/_paid-credit-lifecycle';

interface QueueMessageLike {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface QueueBatchLike {
  queue: string;
  messages: QueueMessageLike[];
}

export interface ConsumerEnv extends AnalyzerEnv {
  ANALYZER_JOBS_QUEUE_NAME?: string;
  ANALYZER_JOBS_DLQ_NAME?: string;
  ANALYZER_JOBS_REQUEUE?: AnalyzerQueueBinding;
}

const RETRY_BASE_SECONDS = 20;
const RETRY_MAX_SECONDS = 900;
const retryDelay = (attempts: number): number => Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.min(10, Math.max(0, attempts - 1)));

export async function errorResponse(response: Response): Promise<{ code: string; error: string; retryable: boolean }> {
  const fallback = {
    code: 'ANALYSIS_FAILED',
    error: 'The analysis failed.',
    retryable: response.status === 408 || response.status === 422 || response.status === 429 || response.status >= 500,
  };
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') return fallback;
    const data = payload as Record<string, unknown>;
    return {
      code: typeof data.code === 'string' ? data.code : fallback.code,
      // Never trust arbitrary upstream error text for durable user-visible status.
      error: fallback.error,
      retryable: typeof data.retryable === 'boolean' ? data.retryable : fallback.retryable,
    };
  } catch {
    return fallback;
  }
}

async function releaseReservation(env: ConsumerEnv, job: DurableJobRecord): Promise<void> {
  if (job.owner_bypass || !job.reservation_id) return;
  const rpc = createStagingCreditRpc(env);
  const released = job.session_id
    ? await releasePaidReservation(job.session_id, job.job_id, job.reservation_id, rpc)
    : await releaseFreeScan(job.owner_uid, job.job_id, job.reservation_id, rpc);
  if (released.status === 'unavailable' || released.status === 'denied') {
    throw Object.assign(new Error('Credit release is not yet confirmed.'), { retryable: true, code: 'CREDIT_RELEASE_UNAVAILABLE' });
  }
}

async function finalizeReservation(env: ConsumerEnv, job: DurableJobRecord): Promise<boolean> {
  if (job.owner_bypass) return true;
  const rpc = createStagingCreditRpc(env);
  const result = job.session_id
    ? await finalizePaidReservation(job.session_id, job.job_id, rpc)
    : await finalizeFreeScan(job.owner_uid, job.job_id, rpc);
  return result.status === 'consumed';
}

async function markPermanentFailure(env: ConsumerEnv, job: DurableJobRecord, workerToken: string, code: string, message: string): Promise<void> {
  if (!await updateDurableJob(env, { jobId: job.job_id, workerToken, status: 'failed', errorCode: code, errorMessage: message, retryable: false, progress: 100, stage: 'failed' })) {
    throw Object.assign(new Error('Failed job state could not be persisted.'), { retryable: true, code: 'JOB_STATE_PERSISTENCE_FAILED' });
  }
  await releaseReservation(env, job);
}

async function persistJobUpdate(env: ConsumerEnv, input: Parameters<typeof updateDurableJob>[1]): Promise<void> {
  if (!await updateDurableJob(env, input)) {
    throw Object.assign(new Error('Job state could not be persisted.'), { retryable: true, code: 'JOB_STATE_PERSISTENCE_FAILED' });
  }
}

async function processJob(message: QueueMessageLike, env: ConsumerEnv): Promise<void> {
  let parsed: ReturnType<typeof parseAnalyzerQueueMessage>;
  try { parsed = parseAnalyzerQueueMessage(message.body); }
  catch {
    console.error('[ANALYZER_QUEUE_INVALID_MESSAGE]');
    message.ack();
    return;
  }

  const token = crypto.randomUUID();
  let job: DurableJobRecord | null;
  try { job = await claimDurableJob(env, parsed.jobId, token, 240); }
  catch (error) {
    // Log only a stable error class/status; never job text, uid, URL, or keys.
    // A silent claim failure otherwise looks like a healthy Queue that never drains.
    const detail = error && typeof error === 'object'
      ? error as { name?: string; status?: number; retryable?: boolean }
      : {};
    console.error('[ANALYZER_CLAIM_FAILED]', JSON.stringify({
      errorClass: detail.name || 'unknown',
      httpStatus: typeof detail.status === 'number' ? detail.status : null,
      retryable: detail.retryable ?? true,
    }));
    message.retry({ delaySeconds: retryDelay(message.attempts) });
    return;
  }
  if (!job) {
    try {
      const current = await readDurableJob(env, parsed.jobId);
      if (!current || current.status === 'completed') { message.ack(); return; }
      if (current.status === 'failed') { await releaseReservation(env, current); message.ack(); return; }
      // A parallel delivery or an earlier Worker still owns the lease. Keep the delivery alive
      // until it finishes or its lease expires, instead of starting a second analysis.
      message.retry({ delaySeconds: Math.max(30, Math.min(240, retryDelay(message.attempts))) });
    } catch { message.retry({ delaySeconds: retryDelay(message.attempts) }); }
    return;
  }

  try {
    const recoveredReport = await loadPersistedReport(env, job.job_id, fetch, job.owner_uid);
    if (recoveredReport) {
      if (!await finalizeReservation(env, job)) throw Object.assign(new Error('Credit finalization is not yet confirmed.'), { retryable: true, code: 'CREDIT_FINALIZATION_UNAVAILABLE' });
      await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: 'completed', progress: 100, stage: 'complete' });
      message.ack();
      return;
    }

    const input = await loadDurableInput(env, job.input_key);
    const request = new Request('https://analyzer-queue.internal/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Analysis-Id': job.job_id, Accept: 'application/json' },
      body: JSON.stringify({ documentText: input.documentText, documentName: input.fileName, mode: job.mode, stream: false, analysisId: job.job_id }),
    });
    const response = await handleAnalyzeRequest(request, env, {
      trustedJob: {
        ...job,
        workerToken: token,
        onProgress: async (stage, progress, message) => {
          await persistJobUpdate(env, { jobId: job!.job_id, workerToken: token, status: 'running', stage, progress });
          void message;
        },
      },
    });
    if (!response.ok) {
      const failure = await errorResponse(response);
      if (failure.retryable) {
        await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: 'queued', errorCode: failure.code, errorMessage: failure.error, retryable: true });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      } else {
        await markPermanentFailure(env, job, token, failure.code, failure.error);
        message.ack();
      }
      return;
    }

    // The shared handler has durably stored the complete report, but deferred credit finalization.
    // Re-delivery after a crash detects that report above and only repeats the idempotent finalizer.
    if (!await loadPersistedReport(env, job.job_id, fetch, job.owner_uid)) throw Object.assign(new Error('Completed report was not persisted.'), { retryable: true, code: 'ANALYSIS_PERSISTENCE_FAILED' });
    if (!await finalizeReservation(env, job)) throw Object.assign(new Error('Credit finalization is not yet confirmed.'), { retryable: true, code: 'CREDIT_FINALIZATION_UNAVAILABLE' });
    await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: 'completed', progress: 100, stage: 'complete' });
    message.ack();
  } catch (error) {
    const retryable = !(error && typeof error === 'object' && 'retryable' in error && (error as { retryable: unknown }).retryable === false);
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : 'ANALYZER_QUEUE_FAILURE';
    // Previously silent. Class, code, storage status and attempt only: no job text, uid, URL or keys.
    console.error('[ANALYZER_JOB_FAILED]', JSON.stringify({
      code,
      errorClass: error instanceof Error ? error.name : 'unknown',
      storageStatus: error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number' ? (error as { status: number }).status : null,
      retryable,
      deliveryAttempt: message.attempts,
    }));
    const safeMessage = retryable
      ? 'The analysis could not be completed. The worker will retry it when possible.'
      : 'The analysis could not be completed. Your document is safe and no credit was used. Please start it again.';
    try {
      if (retryable) {
        await persistJobUpdate(env, { jobId: job.job_id, workerToken: token, status: 'queued', errorCode: code, errorMessage: safeMessage, retryable: true });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      } else {
        await markPermanentFailure(env, job, token, code, safeMessage);
        message.ack();
      }
    } catch {
      // Leave the message unacknowledged. Cloudflare redelivers it, and the database claim lease
      // prevents a concurrent run until the prior worker has stopped or its lease expires.
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
  }
}

async function processDeadLetter(message: QueueMessageLike, env: ConsumerEnv): Promise<void> {
  // Poison messages have no valid job ID to recover. Retrying them indefinitely
  // would block the DLQ and generate repeated invocations without useful work.
  let jobId: string;
  try {
    jobId = parseAnalyzerQueueMessage(message.body).jobId;
  } catch {
    console.error('[ANALYZER_DLQ_INVALID_MESSAGE]');
    message.ack();
    return;
  }
  try {
    const current = await readDurableJob(env, jobId);
    if (!current) { message.ack(); return; }
    if (current.status === 'completed') { message.ack(); return; }
    if (current.status === 'failed') { await releaseReservation(env, current); message.ack(); return; }
    const report = await loadPersistedReport(env, jobId, fetch, current.owner_uid);
    if (report) {
      if (!await finalizeReservation(env, current)) {
        throw new Error('Persisted report credit finalization is not yet confirmed.');
      }
      if (await completeRecoveredJob(env, jobId)) {
        message.ack();
        return;
      }
      // A second Worker can complete the same persisted report between our
      // read and the completion RPC. Verify that outcome before retrying.
      const latest = await readDurableJob(env, jobId);
      if (latest?.status === 'completed') {
        message.ack();
        return;
      }
      throw new Error('Persisted report completion is not yet confirmed.');
    }
    const leaseExpiry = current.lease_expires_at ? Date.parse(current.lease_expires_at) : 0;
    if (current.status === 'running' && Number.isFinite(leaseExpiry) && leaseExpiry > Date.now()) {
      message.retry({ delaySeconds: Math.max(1, Math.min(900, Math.ceil((leaseExpiry - Date.now()) / 1000) + 5)) });
      return;
    }
    if (current.attempt_count !== undefined && current.attempt_count < 6) {
      // Verify the producer binding before changing the durable job state.
      // Otherwise a missing binding can strand a requeued job without a queue delivery.
      if (!env.ANALYZER_JOBS_REQUEUE) throw new Error('Primary analyzer queue producer binding is not configured.');
      if (await requeueFromDeadLetter(env, jobId)) {
        await env.ANALYZER_JOBS_REQUEUE.send(createAnalyzerQueueMessage(jobId));
        message.ack();
        return;
      }
    }
    const job = await failDeadLetterJob(env, jobId);
    if (job?.status === 'failed') {
      await releaseReservation(env, job);
    } else {
      // A missing or conflicting terminal transition is not success. Another
      // worker may have completed/failed the job concurrently; re-read before
      // deciding whether to acknowledge this dead-letter delivery.
      const latest = await readDurableJob(env, jobId);
      if (latest?.status === 'failed') {
        await releaseReservation(env, latest);
      } else if (latest?.status !== 'completed' && latest !== null) {
        throw new Error('Dead-letter job was not terminally settled.');
      }
    }
  } catch (error) {
    console.error('[ANALYZER_DLQ_FINALIZATION_FAILED]', error instanceof Error ? error.name : 'unknown');
    message.retry({ delaySeconds: retryDelay(message.attempts) });
    return;
  }
  message.ack();
}

const consumer = {
  async queue(batch: QueueBatchLike, env: ConsumerEnv): Promise<void> {
    const primary = env.ANALYZER_JOBS_QUEUE_NAME || 'cyfsa-analyzer-jobs';
    const dlq = env.ANALYZER_JOBS_DLQ_NAME || 'cyfsa-analyzer-dead-letter';
    if (batch.queue !== primary && batch.queue !== dlq) throw new Error('Unexpected analyzer queue');
    // An explicitly enabled deployment alone may claim jobs; preflight and missing flags must not claim jobs, recover reports, or mutate
    // credits, including on dead-letter deliveries. Leave messages for a later run.
    if (env.ANALYZER_ENABLED !== 'true') {
      for (const message of batch.messages) message.retry({ delaySeconds: RETRY_MAX_SECONDS });
      return;
    }
    for (const message of batch.messages) {
      if (batch.queue === (env.ANALYZER_JOBS_DLQ_NAME || 'cyfsa-analyzer-dead-letter')) await processDeadLetter(message, env);
      else await processJob(message, env);
    }
  },
};

export { processDeadLetter, processJob, retryDelay };
export default consumer;
