/**
 * Queue Worker branches that decide credits and redelivery: invalid messages, claim failures, owner-bypass jobs,
 * unconfirmed persistence or finalization, permanent failures and dead-letter recovery. Mocked I/O only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(), claim: vi.fn(), read: vi.fn(), loadInput: vi.fn(), loadReport: vi.fn(), update: vi.fn(),
  failDlq: vi.fn(), completeRecovered: vi.fn(), requeue: vi.fn(),
  releaseFree: vi.fn(), releasePaid: vi.fn(), finalizeFree: vi.fn(), finalizePaid: vi.fn(),
}));
vi.mock('../../functions/api/analyze', () => ({ handleAnalyzeRequest: mocks.analyze }));
vi.mock('../../functions/api/_durable-analysis-jobs', () => ({
  claimDurableJob: mocks.claim, readDurableJob: mocks.read, loadDurableInput: mocks.loadInput, loadPersistedReport: mocks.loadReport,
  updateDurableJob: mocks.update, failDeadLetterJob: mocks.failDlq, completeRecoveredJob: mocks.completeRecovered, requeueFromDeadLetter: mocks.requeue,
  DurableJobStorageError: class DurableJobStorageError extends Error { retryable = true; },
}));
vi.mock('../../functions/api/_staging-credit-rpc', () => ({ createStagingCreditRpc: vi.fn() }));
vi.mock('../../functions/api/_free-credit-lifecycle', () => ({ finalizeFreeScan: mocks.finalizeFree, releaseFreeScan: mocks.releaseFree }));
vi.mock('../../functions/api/_paid-credit-lifecycle', () => ({ finalizePaidReservation: mocks.finalizePaid, releasePaidReservation: mocks.releasePaid }));

import consumer, { errorResponse, processDeadLetter, processJob } from '../../workers/analyzer-queue-consumer';

const JOB = {
  job_id: 'job_branches1234', owner_uid: 'user_1', mode: 'full', status: 'running', input_key: 'inputs/x.json',
  session_id: null, reservation_id: 'reservation_1', owner_bypass: false, attempt_count: 1,
};
const message = (body: unknown = { version: 1, jobId: JOB.job_id }) => ({ body, attempts: 1, ack: vi.fn(), retry: vi.fn() });
const succeedAndPersist = (persisted: unknown = { summary: 'synthetic' }) => mocks.analyze.mockImplementation(async () => {
  mocks.loadReport.mockResolvedValue(persisted);
  return Response.json({ summary: 'synthetic' }, { status: 200 });
});
const statuses = () => mocks.update.mock.calls.map((c) => c[1].status);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue({ ...JOB });
  mocks.loadReport.mockResolvedValue(null);
  mocks.loadInput.mockResolvedValue({ documentText: 'Synthetic case note.', fileName: 'synthetic.txt' });
  mocks.update.mockResolvedValue(true);
  mocks.finalizeFree.mockResolvedValue({ status: 'consumed' });
  mocks.releaseFree.mockResolvedValue({ status: 'released' });
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

describe('errorResponse', () => {
  it('falls back to a status-derived retry decision for a non-object or non-JSON body, and never keeps upstream text', async () => {
    expect(await errorResponse(new Response('null', { status: 429 }))).toEqual({ code: 'ANALYSIS_FAILED', error: 'The analysis failed.', retryable: true });
    expect(await errorResponse(new Response('<html>bad gateway</html>', { status: 400 }))).toEqual({ code: 'ANALYSIS_FAILED', error: 'The analysis failed.', retryable: false });
    expect(await errorResponse(Response.json({ code: 'X', error: 'provider said sk-ant-secret', retryable: false }, { status: 503 }))).toEqual({ code: 'X', error: 'The analysis failed.', retryable: false });
  });
});

describe('processJob', () => {
  it('acknowledges an invalid message without claiming anything', async () => {
    const msg = message({ nope: true });
    await processJob(msg as any, {} as any);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[ANALYZER_QUEUE_INVALID_MESSAGE]');
  });

  it('a claim failure is logged by class and status only and the delivery is retried without running', async () => {
    mocks.claim.mockRejectedValue(Object.assign(new Error('db down for user_1'), { name: 'DurableJobStorageError', status: 503, retryable: false }));
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 20 });
    expect(mocks.analyze).not.toHaveBeenCalled();
    const [, logged] = (console.error as any).mock.calls.find((c: unknown[]) => c[0] === '[ANALYZER_CLAIM_FAILED]');
    expect(JSON.parse(logged)).toEqual({ errorClass: 'DurableJobStorageError', httpStatus: 503, retryable: false });
    expect(logged).not.toContain('user_1');
  });

  it('an owner-bypass job is completed without a credit finalization, and a permanent failure releases nothing', async () => {
    mocks.claim.mockResolvedValue({ ...JOB, owner_bypass: true, reservation_id: null });
    succeedAndPersist();
    const ok = message();
    await processJob(ok as any, {} as any);
    expect(ok.ack).toHaveBeenCalledOnce();
    expect(statuses().at(-1)).toBe('completed');
    expect(mocks.finalizeFree).not.toHaveBeenCalled();

    mocks.loadReport.mockResolvedValue(null);
    mocks.analyze.mockResolvedValue(Response.json({ code: 'AI_REQUEST_REJECTED', retryable: false }, { status: 400 }));
    const failed = message();
    await processJob(failed as any, {} as any);
    expect(failed.ack).toHaveBeenCalledOnce();
    expect(statuses().at(-1)).toBe('failed');
    expect(mocks.releaseFree).not.toHaveBeenCalled();
  });

  it('a permanent failure whose failed state cannot be written neither releases the credit nor acknowledges', async () => {
    mocks.analyze.mockResolvedValue(Response.json({ code: 'AI_REQUEST_REJECTED', retryable: false }, { status: 400 }));
    mocks.update.mockResolvedValue(false);
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(mocks.releaseFree).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledOnce();
  });

  it('a success whose report cannot be re-read is not finalized or completed', async () => {
    succeedAndPersist(null);
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(mocks.finalizeFree).not.toHaveBeenCalled();
    expect(statuses()).not.toContain('completed');
    expect(statuses().at(-1)).toBe('queued');
    expect(mocks.update.mock.calls.at(-1)![1]).toMatchObject({ errorCode: 'ANALYSIS_PERSISTENCE_FAILED', retryable: true });
    expect(msg.retry).toHaveBeenCalledOnce();
  });

  it('a success whose finalization is not confirmed is retried, not completed, and keeps the reservation', async () => {
    succeedAndPersist();
    mocks.finalizeFree.mockResolvedValue({ status: 'unavailable' });
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(statuses()).not.toContain('completed');
    expect(mocks.update.mock.calls.at(-1)![1]).toMatchObject({ status: 'queued', errorCode: 'CREDIT_FINALIZATION_UNAVAILABLE' });
    expect(mocks.releaseFree).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledOnce();
  });

  it('a thrown non-retryable error fails the job, releases the reservation and acknowledges', async () => {
    mocks.loadInput.mockRejectedValue(Object.assign(new Error('Stored document input is invalid.'), { retryable: false, code: 'INPUT_INVALID' }));
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(mocks.update.mock.calls.at(-1)![1]).toMatchObject({ status: 'failed', errorCode: 'INPUT_INVALID', retryable: false });
    expect(mocks.releaseFree).toHaveBeenCalledWith('user_1', JOB.job_id, 'reservation_1', undefined);
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('skips the pre-analysis Storage recovery read on a fresh first attempt, but checks Storage on retries', async () => {
    succeedAndPersist();
    const first = message();
    await processJob(first as any, {} as any);
    // Only the post-analysis persistence verification read runs on attempt 1.
    expect(mocks.loadReport).toHaveBeenCalledTimes(1);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(first.ack).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ ...JOB, attempt_count: 2 });
    mocks.loadReport.mockResolvedValue({ summary: 'recovered' });
    mocks.update.mockResolvedValue(true);
    mocks.finalizeFree.mockResolvedValue({ status: 'consumed' });
    const retryMsg = { ...message(), attempts: 2 };
    await processJob(retryMsg as any, {} as any);
    expect(mocks.loadReport).toHaveBeenCalledTimes(1);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.finalizeFree).toHaveBeenCalledOnce();
    expect(retryMsg.ack).toHaveBeenCalledOnce();
  });
});

describe('processDeadLetter', () => {
  it('acknowledges a job that no longer exists', async () => {
    mocks.read.mockResolvedValue(null);
    const msg = message();
    await processDeadLetter(msg as any, {} as any);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(mocks.releaseFree).not.toHaveBeenCalled();
  });

  it('releases the reservation of a job that already failed before acknowledging', async () => {
    mocks.read.mockResolvedValue({ ...JOB, status: 'failed' });
    const msg = message();
    await processDeadLetter(msg as any, {} as any);
    expect(mocks.releaseFree).toHaveBeenCalledOnce();
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('a persisted report whose finalization is unconfirmed is retried, not completed', async () => {
    mocks.read.mockResolvedValue({ ...JOB, status: 'queued' });
    mocks.loadReport.mockResolvedValue({ summary: 'synthetic' });
    mocks.finalizeFree.mockResolvedValue({ status: 'unavailable' });
    const msg = message();
    await processDeadLetter(msg as any, {} as any);
    expect(mocks.completeRecovered).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledOnce();
  });
});

describe('queue entry point', () => {
  const env = { ANALYZER_ENABLED: 'true' } as any;
  it('rejects a batch from an unexpected queue', async () => {
    await expect(consumer.queue({ queue: 'someone-elses-queue', messages: [] } as any, env)).rejects.toThrow('Unexpected analyzer queue');
  });

  it('routes primary-queue messages to processJob', async () => {
    succeedAndPersist();
    const msg = message();
    await consumer.queue({ queue: 'cyfsa-analyzer-jobs', messages: [msg] } as any, env);
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(msg.ack).toHaveBeenCalledOnce();
  });
});
