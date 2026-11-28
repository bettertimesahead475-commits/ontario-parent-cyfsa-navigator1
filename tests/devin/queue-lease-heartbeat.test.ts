/**
 * A running analysis renews its database lease on a timer, not only when a stage boundary writes progress.
 * Without the timer, a section that runs longer than the 4-minute lease window lets a redelivered message claim the
 * job, so two analyses run at once. These tests use fake timers and synthetic mocks only (no model calls).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { LEASE_HEARTBEAT_MS, processJob } from '../../workers/analyzer-queue-consumer';

const JOB = {
  job_id: 'job_lease1234567', owner_uid: 'user_1', mode: 'full', status: 'running', input_key: 'inputs/x.json',
  session_id: null, reservation_id: 'reservation_1', owner_bypass: false, attempt_count: 1,
};
const message = () => ({ body: { version: 1, jobId: JOB.job_id }, attempts: 1, ack: vi.fn(), retry: vi.fn() });
const runningWrites = () => mocks.update.mock.calls.map((c) => c[1]).filter((i: any) => i.status === 'running');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue({ ...JOB });
  mocks.loadInput.mockResolvedValue({ documentText: 'Synthetic case note.', fileName: 'synthetic.txt' });
  mocks.finalizeFree.mockResolvedValue({ status: 'consumed' });
  mocks.update.mockResolvedValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The analyzer stays pending (no progress writes) until released, then succeeds and persists the report. */
function slowAnalyzer() {
  let release: () => void = () => {};
  mocks.analyze.mockImplementation(() => new Promise<Response>((resolve) => {
    release = () => {
      mocks.loadReport.mockResolvedValue({ summary: 'synthetic' });
      resolve(Response.json({ summary: 'synthetic' }, { status: 200 }));
    };
  }));
  return () => release();
}

describe('queue Worker lease heartbeat', () => {
  it('renews the lease every heartbeat interval while a section runs without progress writes', async () => {
    mocks.loadReport.mockResolvedValueOnce(null);
    const release = slowAnalyzer();
    const msg = message();
    const done = processJob(msg as any, {} as any);

    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 3 + 1000);
    const writes = runningWrites();
    expect(writes).toHaveLength(3);
    expect(writes[0]).toEqual(expect.objectContaining({ jobId: JOB.job_id, workerToken: expect.any(String), status: 'running', stage: 'reviewing_evidence', progress: 35 }));

    release();
    await done;
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('stops renewing once the analysis returns, so a finished run leaves no timer behind', async () => {
    mocks.loadReport.mockResolvedValueOnce(null);
    const release = slowAnalyzer();
    const msg = message();
    const done = processJob(msg as any, {} as any);
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS + 1000);
    release();
    await done;
    const after = runningWrites().length;
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 5);
    expect(runningWrites().length).toBe(after);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a heartbeat that reports the lease is lost stops renewing and does not fail the run by itself', async () => {
    mocks.loadReport.mockResolvedValueOnce(null);
    mocks.update.mockImplementation(async (_env: unknown, input: any) => (input.status === 'running' ? false : true));
    const release = slowAnalyzer();
    const msg = message();
    const done = processJob(msg as any, {} as any);
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 3 + 1000);
    expect(runningWrites()).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith('[ANALYZER_LEASE_LOST]', expect.stringContaining('"stage":"reviewing_evidence"'));
    release();
    await done;
    expect(mocks.finalizeFree).toHaveBeenCalledOnce();
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it('a transient heartbeat failure is logged and the next tick renews again', async () => {
    mocks.loadReport.mockResolvedValueOnce(null);
    mocks.update.mockImplementation(async (_env: unknown, input: any) => {
      if (input.status !== 'running') return true;
      if (runningWrites().length === 1) throw Object.assign(new Error('Durable job database request failed.'), { name: 'DurableJobStorageError' });
      return true;
    });
    const release = slowAnalyzer();
    const msg = message();
    const done = processJob(msg as any, {} as any);
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 2 + 1000);
    expect(console.warn).toHaveBeenCalledWith('[ANALYZER_HEARTBEAT_FAILED]', expect.stringContaining('DurableJobStorageError'));
    expect(runningWrites().length).toBe(2);
    release();
    await done;
    expect(msg.ack).toHaveBeenCalledOnce();
  });
});
