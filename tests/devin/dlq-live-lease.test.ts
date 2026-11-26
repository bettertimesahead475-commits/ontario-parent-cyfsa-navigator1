/** Mutation gap M18: the existing lease test also passes when the lease check is deleted (missing requeue binding throws and retries). */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn(), loadReport: vi.fn(), failDlq: vi.fn(), requeueDlq: vi.fn(), completeRecovered: vi.fn(),
  releaseFree: vi.fn(), releasePaid: vi.fn(), finalizeFree: vi.fn(), finalizePaid: vi.fn(),
}));
vi.mock('../../functions/api/analyze', () => ({ handleAnalyzeRequest: vi.fn() }));
vi.mock('../../functions/api/_durable-analysis-jobs', () => ({
  claimDurableJob: vi.fn(), readDurableJob: mocks.read, loadDurableInput: vi.fn(), loadPersistedReport: mocks.loadReport,
  updateDurableJob: vi.fn(), failDeadLetterJob: mocks.failDlq, completeRecoveredJob: mocks.completeRecovered,
  requeueFromDeadLetter: mocks.requeueDlq,
  DurableJobStorageError: class DurableJobStorageError extends Error { retryable = true; },
}));
vi.mock('../../functions/api/_staging-credit-rpc', () => ({ createStagingCreditRpc: vi.fn() }));
vi.mock('../../functions/api/_free-credit-lifecycle', () => ({ finalizeFreeScan: mocks.finalizeFree, releaseFreeScan: mocks.releaseFree }));
vi.mock('../../functions/api/_paid-credit-lifecycle', () => ({ finalizePaidReservation: mocks.finalizePaid, releasePaidReservation: mocks.releasePaid }));

import { processDeadLetter } from '../../workers/analyzer-queue-consumer';

describe('dead-letter delivery for a job whose Worker lease is still live', () => {
  it('neither requeues, fails nor releases the job while a Worker holds it', async () => {
    mocks.read.mockResolvedValue({
      job_id: 'job_abcdefgh1234', owner_uid: 'user_1', mode: 'full', status: 'running', input_key: 'inputs/x.json',
      session_id: null, reservation_id: 'reservation_1', owner_bypass: false, attempt_count: 1,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    mocks.loadReport.mockResolvedValue(null);
    mocks.requeueDlq.mockResolvedValue(true);
    const send = vi.fn().mockResolvedValue(undefined);
    const msg = { body: { version: 1, jobId: 'job_abcdefgh1234' }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await processDeadLetter(msg as any, { ANALYZER_JOBS_REQUEUE: { send } } as any);
    expect(mocks.requeueDlq).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.failDlq).not.toHaveBeenCalled();
    expect(mocks.releaseFree).not.toHaveBeenCalled();
    expect(mocks.releasePaid).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledOnce();
  });
});
