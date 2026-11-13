import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(), claim: vi.fn(), read: vi.fn(), loadInput: vi.fn(), loadReport: vi.fn(), update: vi.fn(), failDlq: vi.fn(),
  finalizeFree: vi.fn(), finalizePaid: vi.fn(), releaseFree: vi.fn(), releasePaid: vi.fn(), createRpc: vi.fn(), completeRecovered: vi.fn(), requeueDlq: vi.fn(),
}));

vi.mock('../functions/api/analyze', () => ({ handleAnalyzeRequest: mocks.handle }));
vi.mock('../functions/api/_durable-analysis-jobs', () => ({
  claimDurableJob: mocks.claim, readDurableJob: mocks.read, loadDurableInput: mocks.loadInput,
  loadPersistedReport: mocks.loadReport, updateDurableJob: mocks.update, failDeadLetterJob: mocks.failDlq,
  completeRecoveredJob: mocks.completeRecovered,
  requeueFromDeadLetter: mocks.requeueDlq,
  DurableJobStorageError: class DurableJobStorageError extends Error { retryable = true; },
}));
vi.mock('../functions/api/_staging-credit-rpc', () => ({ createStagingCreditRpc: mocks.createRpc }));
vi.mock('../functions/api/_free-credit-lifecycle', () => ({ finalizeFreeScan: mocks.finalizeFree, releaseFreeScan: mocks.releaseFree }));
vi.mock('../functions/api/_paid-credit-lifecycle', () => ({ finalizePaidReservation: mocks.finalizePaid, releasePaidReservation: mocks.releasePaid }));

import consumer, { processDeadLetter, processJob, retryDelay } from '../workers/analyzer-queue-consumer';

const job = (mode: 'fast' | 'full' = 'fast') => ({
  job_id: 'job_abcdefgh1234', owner_uid: 'user_1', mode, status: 'running' as const,
  input_key: 'inputs/job_abcdefgh1234.json', session_id: null, reservation_id: 'reservation_1', owner_bypass: false,
});

function message(body: unknown = { version: 1, jobId: 'job_abcdefgh1234' }, attempts = 1) {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() };
}

describe('durable analyzer queue consumer', () => {
  it.each(['cyfsa-analyzer-jobs', 'cyfsa-analyzer-dead-letter'])('does no work on %s while disabled', async (queue) => {
    vi.clearAllMocks();
    const msg = message();
    await consumer.queue({ queue, messages: [msg] }, { ANALYZER_ENABLED: 'false' });
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 900 });
    expect(msg.ack).not.toHaveBeenCalled();
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'TRUE', '0'])('does no work with non-enabled flag %s', async (flag) => {
    vi.clearAllMocks();
    const msg = message();
    await consumer.queue({ queue: 'cyfsa-analyzer-jobs', messages: [msg] }, { ANALYZER_ENABLED: flag });
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 900 });
    expect(msg.ack).not.toHaveBeenCalled();
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue(job());
    mocks.read.mockResolvedValue(job());
    mocks.loadInput.mockResolvedValue({ documentText: 'Private evidence text' });
    mocks.loadReport.mockReset().mockResolvedValueOnce(null).mockResolvedValue({ fileSummary: 'Saved report' });
    mocks.update.mockResolvedValue(true);
    mocks.requeueDlq.mockResolvedValue(false);
    mocks.handle.mockResolvedValue(Response.json({ report: true }));
    mocks.createRpc.mockReturnValue(vi.fn());
    mocks.finalizeFree.mockResolvedValue({ status: 'consumed' });
    mocks.finalizePaid.mockResolvedValue({ status: 'consumed' });
    mocks.releaseFree.mockResolvedValue({ status: 'released' });
    mocks.releasePaid.mockResolvedValue({ status: 'released' });
  });

  it('processes Quick and Forensic jobs through the shared analyzer handler with the requested mode', async () => {
    for (const mode of ['fast', 'full'] as const) {
      mocks.claim.mockResolvedValueOnce(job(mode));
      mocks.loadReport.mockReset().mockResolvedValueOnce(null).mockResolvedValue({ fileSummary: 'Saved report' });
      const msg = message();
      await processJob(msg, {} as any);
      const request = mocks.handle.mock.calls.at(-1)?.[0] as Request;
      expect((await request.clone().json()).mode).toBe(mode);
      expect(mocks.handle.mock.calls.at(-1)?.[2].trustedJob.mode).toBe(mode);
      expect(msg.ack).toHaveBeenCalledOnce();
    }
  });

  it('retries release of a terminal failed job before acknowledging its delivery', async () => {
    mocks.claim.mockResolvedValue(null);
    mocks.read.mockResolvedValue({ ...job(), status: 'failed' });
    mocks.releaseFree.mockResolvedValueOnce({ status: 'unavailable' }).mockResolvedValue({ status: 'released' });
    const first = message();
    await processJob(first, {} as any);
    expect(first.ack).not.toHaveBeenCalled();
    expect(first.retry).toHaveBeenCalledOnce();
    const second = message(undefined, 2);
    await processJob(second, {} as any);
    expect(second.ack).toHaveBeenCalledOnce();
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it('routes the isolated staging dead-letter queue through dead-letter recovery', async () => {
    mocks.read.mockResolvedValue({ ...job(), status: 'completed' });
    const msg = message();
    await consumer.queue({ queue: 'cyfsa-staging-analyzer-dead-letter', messages: [msg] }, {
      ANALYZER_ENABLED: 'true',
      ANALYZER_JOBS_QUEUE_NAME: 'cyfsa-staging-analyzer-jobs',
      ANALYZER_JOBS_DLQ_NAME: 'cyfsa-staging-analyzer-dead-letter',
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('acks duplicate delivery after another consumer completed the job', async () => {
    mocks.claim.mockResolvedValue(null);
    mocks.read.mockResolvedValue({ ...job(), status: 'completed' });
    const msg = message();
    await processJob(msg, {} as any);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it('lets only one concurrent delivery claim and execute the same job', async () => {
    let claimed = false;
    mocks.claim.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return job();
    });
    const a = message(); const b = message();
    await Promise.all([processJob(a, {} as any), processJob(b, {} as any)]);
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect([a.ack.mock.calls.length + b.ack.mock.calls.length, a.retry.mock.calls.length + b.retry.mock.calls.length]).toEqual([1, 1]);
  });

  it('retries a transient Storage read failure with exponential delay', async () => {
    mocks.loadInput.mockRejectedValueOnce(Object.assign(new Error('Storage unavailable'), { retryable: true, code: 'STORAGE_READ_FAILED' }));
    const msg = message(undefined, 3);
    await processJob(msg, {} as any);
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'queued', errorCode: 'STORAGE_READ_FAILED' }));
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: retryDelay(3) });
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it('recovers from a Worker failure by returning the claim to queued for redelivery', async () => {
    mocks.handle.mockRejectedValueOnce(new Error('simulated worker termination'));
    const msg = message(undefined, 2);
    await processJob(msg, {} as any);
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'queued', retryable: true }));
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: retryDelay(2) });
  });

  it('finalizes a previously persisted report on retry without rerunning analysis', async () => {
    mocks.loadReport.mockReset().mockResolvedValue({ fileSummary: 'Saved report' });
    const msg = message();
    await processJob(msg, {} as any);
    expect(mocks.handle).not.toHaveBeenCalled();
    expect(mocks.finalizeFree).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'completed', progress: 100 }));
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('routes a completed Quick/Forensic report through the idempotent finalizer exactly once per worker attempt', async () => {
    const msg = message();
    await processJob(msg, {} as any);
    expect(mocks.finalizeFree).toHaveBeenCalledOnce();
    expect(mocks.loadReport).toHaveBeenCalledTimes(2);
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('does not consume a credit twice if the Worker stops after finalization but before completion is recorded', async () => {
    let consumed = false;
    mocks.finalizeFree.mockImplementation(async () => {
      if (!consumed) consumed = true;
      return { status: 'consumed' };
    });
    mocks.update.mockReset().mockResolvedValueOnce(false).mockResolvedValue(true);
    mocks.loadReport.mockReset().mockResolvedValueOnce(null).mockResolvedValue({ fileSummary: 'Persisted before finalization' });
    const first = message(undefined, 1);
    await processJob(first, {} as any);
    expect(first.retry).toHaveBeenCalledOnce();
    const retry = message(undefined, 2);
    await processJob(retry, {} as any);
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.finalizeFree).toHaveBeenCalledTimes(2);
    expect(consumed).toBe(true);
    expect(retry.ack).toHaveBeenCalledOnce();
  });

  it('marks exhausted jobs failed and releases their reserved credit from the dead-letter consumer', async () => {
    mocks.failDlq.mockResolvedValue({ ...job(), status: 'failed' });
    const msg = message();
    await processDeadLetter(msg, {} as any);
    expect(mocks.failDlq).toHaveBeenCalledWith(expect.anything(), 'job_abcdefgh1234');
    expect(mocks.releaseFree).toHaveBeenCalledOnce();
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('recovers a report already persisted before a job exhausted normal queue delivery', async () => {
    mocks.read.mockResolvedValue({ ...job(), status: 'queued' });
    mocks.loadReport.mockReset().mockResolvedValue({ fileSummary: 'Saved report' });
    mocks.completeRecovered.mockResolvedValue(true);
    const msg = message();
    await processDeadLetter(msg, {} as any);
    expect(mocks.finalizeFree).toHaveBeenCalledOnce();
    expect(mocks.completeRecovered).toHaveBeenCalledWith(expect.anything(), 'job_abcdefgh1234');
    expect(mocks.failDlq).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('waits for an active Worker lease instead of failing the job from the DLQ', async () => {
    const expiresAt = new Date(Date.now() + 45_000).toISOString();
    mocks.read.mockResolvedValue({ ...job(), lease_expires_at: expiresAt, attempt_count: 1 });
    mocks.loadReport.mockReset().mockResolvedValue(null);
    const msg = message();
    await processDeadLetter(msg, {} as any);
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: expect.any(Number) });
    expect(mocks.failDlq).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('requeues an abandoned job from DLQ using only the opaque job ID', async () => {
    mocks.read.mockResolvedValue({ ...job(), status: 'queued', attempt_count: 1 });
    mocks.loadReport.mockReset().mockResolvedValue(null);
    mocks.requeueDlq.mockResolvedValue(true);
    const send = vi.fn().mockResolvedValue(undefined);
    const msg = message();
    await processDeadLetter(msg, { ANALYZER_JOBS_REQUEUE: { send } } as any);
    expect(send).toHaveBeenCalledWith({ version: 1, jobId: 'job_abcdefgh1234' });
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('does not transition a DLQ job to queued when the producer binding is missing', async () => {
    mocks.read.mockResolvedValue({ ...job(), status: 'queued', attempt_count: 1 });
    mocks.loadReport.mockReset().mockResolvedValue(null);
    mocks.requeueDlq.mockResolvedValue(true);
    const msg = message();
    await processDeadLetter(msg, {} as any);
    expect(mocks.requeueDlq).not.toHaveBeenCalled();
    expect(mocks.failDlq).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledOnce();
  });

  it('dispatches the dead-letter queue to its terminal handler', async () => {
    mocks.failDlq.mockResolvedValue(null);
    const msg = message();
    await consumer.queue({ queue: 'cyfsa-analyzer-dead-letter', messages: [msg] }, { ANALYZER_ENABLED: 'true' } as any);
    expect(msg.ack).toHaveBeenCalledOnce();
  });
});
