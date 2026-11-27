/**
 * Queue Worker progress writes are heartbeats, not part of the analysis. A transient ledger failure during a
 * progress write (Supabase 5xx or transport timeout) previously rejected the running analysis, so a healthy
 * Forensic run was abandoned and redelivered from the start. A write that reports the lease is lost still stops it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(), claim: vi.fn(), read: vi.fn(), loadInput: vi.fn(), loadReport: vi.fn(), update: vi.fn(),
  releaseFree: vi.fn(), releasePaid: vi.fn(), finalizeFree: vi.fn(), finalizePaid: vi.fn(),
}));
vi.mock('../../functions/api/analyze', () => ({ handleAnalyzeRequest: mocks.analyze }));
vi.mock('../../functions/api/_durable-analysis-jobs', () => ({
  claimDurableJob: mocks.claim, readDurableJob: mocks.read, loadDurableInput: mocks.loadInput, loadPersistedReport: mocks.loadReport,
  updateDurableJob: mocks.update, failDeadLetterJob: vi.fn(), completeRecoveredJob: vi.fn(), requeueFromDeadLetter: vi.fn(),
  DurableJobStorageError: class DurableJobStorageError extends Error { retryable = true; },
}));
vi.mock('../../functions/api/_staging-credit-rpc', () => ({ createStagingCreditRpc: vi.fn() }));
vi.mock('../../functions/api/_free-credit-lifecycle', () => ({ finalizeFreeScan: mocks.finalizeFree, releaseFreeScan: mocks.releaseFree }));
vi.mock('../../functions/api/_paid-credit-lifecycle', () => ({ finalizePaidReservation: mocks.finalizePaid, releasePaidReservation: mocks.releasePaid }));

import { processJob } from '../../workers/analyzer-queue-consumer';

const JOB = {
  job_id: 'job_heartbeat1234', owner_uid: 'user_1', mode: 'full', status: 'running', input_key: 'inputs/x.json',
  session_id: null, reservation_id: 'reservation_1', owner_bypass: false, attempt_count: 1,
};
const transient = () => Object.assign(new Error('Durable job database request failed.'), { name: 'DurableJobStorageError', retryable: true });
const message = () => ({ body: { version: 1, jobId: JOB.job_id }, attempts: 1, ack: vi.fn(), retry: vi.fn() });

/** The analyzer reports progress twice, then succeeds and persists the report (as the real handler does). */
function analyzerReportingProgress() {
  mocks.analyze.mockImplementation(async (_req: Request, _env: unknown, deps: any) => {
    await deps.trustedJob.onProgress('reviewing_evidence', 35, 'Analyzing.');
    await deps.trustedJob.onProgress('preparing_report', 96, 'Assembling.');
    mocks.loadReport.mockResolvedValue({ summary: 'synthetic' });
    return Response.json({ summary: 'synthetic' }, { status: 200 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue({ ...JOB });
  mocks.loadReport.mockResolvedValue(null);
  mocks.loadInput.mockResolvedValue({ documentText: 'Synthetic case note.', fileName: 'synthetic.txt' });
  mocks.finalizeFree.mockResolvedValue({ status: 'consumed' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('queue Worker progress heartbeat', () => {
  it('a transient progress-write failure does not abandon a running analysis', async () => {
    mocks.update.mockRejectedValueOnce(transient()).mockResolvedValue(true);
    analyzerReportingProgress();
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(mocks.finalizeFree).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'completed', workerToken: expect.any(String) }));
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('[ANALYZER_PROGRESS_WRITE_FAILED]', expect.stringContaining('"stage":"reviewing_evidence"'));
  });

  it('a progress write that reports the lease is lost stops the run without finalizing or releasing', async () => {
    mocks.update.mockResolvedValue(false);
    let progressError: unknown;
    mocks.analyze.mockImplementation(async (_req: Request, _env: unknown, deps: any) => {
      try { await deps.trustedJob.onProgress('reviewing_evidence', 35, 'Analyzing.'); }
      catch (error) { progressError = error; }
      return Response.json({ error: 'stopped', code: 'ANALYSIS_FAILED', retryable: true }, { status: 500 });
    });
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(progressError).toMatchObject({ code: 'JOB_LEASE_LOST', retryable: true });
    expect(mocks.finalizeFree).not.toHaveBeenCalled();
    expect(mocks.releaseFree).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledOnce();
  });

  it('a retryable analyzer failure is logged with its code and attempt (previously silent)', async () => {
    mocks.update.mockResolvedValue(true);
    mocks.analyze.mockResolvedValue(Response.json({ error: 'cut off', code: 'AI_RESPONSE_INVALID', retryable: true }, { status: 422 }));
    const msg = message();
    await processJob(msg as any, {} as any);
    expect(msg.retry).toHaveBeenCalledOnce();
    expect(mocks.releaseFree).not.toHaveBeenCalled();
    const logged = (console.warn as any).mock.calls.find((c: unknown[]) => c[0] === '[ANALYZER_JOB_RETRY_SCHEDULED]');
    expect(logged).toBeTruthy();
    expect(JSON.parse(logged[1])).toEqual({ code: 'AI_RESPONSE_INVALID', httpStatus: 422, mode: 'full', jobAttempt: 1, deliveryAttempt: 1, delaySeconds: 20 });
  });

  it('logs each claim with the durable attempt count, without identifiers', async () => {
    mocks.claim.mockResolvedValue({ ...JOB, attempt_count: 3 });
    mocks.update.mockResolvedValue(true);
    analyzerReportingProgress();
    await processJob({ ...message(), attempts: 2 } as any, {} as any);
    const logged = (console.info as any).mock.calls.find((c: unknown[]) => c[0] === '[ANALYZER_JOB_CLAIMED]');
    expect(JSON.parse(logged[1])).toEqual({ mode: 'full', jobAttempt: 3, deliveryAttempt: 2, paid: false });
    expect(logged[1]).not.toContain('user_1');
    expect(logged[1]).not.toContain(JOB.job_id);
  });
});
