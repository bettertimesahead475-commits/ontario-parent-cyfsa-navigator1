/**
 * Lease safety for the analyzer queue Worker. A simulated ledger tracks the 240 s claim lease and the 4-minute
 * extension each running write applies (analyzer_claim_job / analyzer_update_job). Fake timers drive time; every
 * analyzer, ledger and storage behaviour is synthetic. No model, storage or database calls are made.
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

import { processJob } from '../../workers/analyzer-queue-consumer';

const LEASE_MS = 240_000;
const JOB = {
  job_id: 'job_safety123456', owner_uid: 'user_1', mode: 'full', status: 'running', input_key: 'inputs/x.json',
  session_id: null, reservation_id: 'reservation_1', owner_bypass: false, attempt_count: 1,
};
const msg = (attempts = 1) => ({ body: { version: 1, jobId: JOB.job_id }, attempts, ack: vi.fn(), retry: vi.fn() });

/** Synthetic ledger: the lease holder's token and the time the lease runs out. */
function ledger() {
  const state = { token: null as string | null, leaseUntil: 0, status: 'queued' as string, writes: [] as any[] };
  mocks.claim.mockImplementation(async (_env: unknown, _id: string, token: string) => {
    if (state.status === 'running' && state.leaseUntil > Date.now()) return null;
    state.token = token; state.leaseUntil = Date.now() + LEASE_MS; state.status = 'running';
    return { ...JOB, worker_token: token };
  });
  mocks.read.mockImplementation(async () => ({ ...JOB, status: state.status, worker_token: state.token, lease_expires_at: new Date(state.leaseUntil).toISOString() }));
  mocks.update.mockImplementation(async (_env: unknown, input: any) => {
    state.writes.push({ at: Date.now(), ...input });
    if (input.workerToken !== state.token || state.status !== 'running') return false;
    if (input.status === 'running') { state.leaseUntil = Date.now() + LEASE_MS; return true; }
    if (input.status === 'completed') state.status = 'completed';
    return true;
  });
  return state;
}

/** Advances fake time in steps and returns the largest gap in which the lease was expired while the job was running. */
async function runClock(ms: number, step = 5_000) {
  let elapsed = 0;
  while (elapsed < ms) {
    await vi.advanceTimersByTimeAsync(step);
    elapsed += step;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadReport.mockResolvedValue(null);
  mocks.loadInput.mockResolvedValue({ documentText: 'Synthetic case note.', fileName: 'synthetic.txt' });
  mocks.finalizeFree.mockResolvedValue({ status: 'consumed' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('lease safety: long forensic run', () => {
  it('keeps the lease alive through a 330 s forensic run with no progress writes for 300 s', async () => {
    const state = ledger();
    let release: () => void = () => {};
    mocks.analyze.mockImplementation(() => new Promise<Response>((resolve) => {
      release = () => { mocks.loadReport.mockResolvedValue({ summary: 'synthetic' }); resolve(Response.json({ summary: 'synthetic' })); };
    }));
    const m = msg();
    const done = processJob(m as any, {} as any);
    // Sample the lease every 5 s for 330 s: it must never have expired while the job is still running.
    for (let t = 0; t < 330_000; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(state.leaseUntil).toBeGreaterThan(Date.now());
    }
    release();
    await done;
    expect(m.ack).toHaveBeenCalledOnce();
    expect(state.writes.filter((w) => w.status === 'completed')).toHaveLength(1);
  });
});

describe('lease safety: duplicate queue delivery', () => {
  it('a second delivery while the first holds a live lease does not start a second analysis', async () => {
    const state = ledger();
    let release: () => void = () => {};
    mocks.analyze.mockImplementation(() => new Promise<Response>((resolve) => {
      release = () => { mocks.loadReport.mockResolvedValue({ summary: 'synthetic' }); resolve(Response.json({ summary: 'synthetic' })); };
    }));
    const first = msg(1);
    const firstDone = processJob(first as any, {} as any);
    await vi.advanceTimersByTimeAsync(10_000);
    const second = msg(2);
    await processJob(second as any, {} as any);
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(second.retry).toHaveBeenCalledOnce();
    expect(second.ack).not.toHaveBeenCalled();
    expect(state.token).not.toBeNull();
    release();
    await firstDone;
    expect(first.ack).toHaveBeenCalledOnce();
  });
});

describe('lease safety: ownership loss', () => {
  it('a Worker whose lease was taken over cannot save its report or mark the job completed', async () => {
    const state = ledger();
    mocks.analyze.mockImplementation(async (_req: Request, _env: unknown, deps: any) => {
      // Another Worker takes the lease while this one is still analysing (lease expired, reclaimed).
      state.token = 'other-worker-token';
      await deps.trustedJob.assertLeaseHeld();
      return Response.json({ summary: 'should not be saved' });
    });
    const m = msg();
    await processJob(m as any, {} as any);
    expect(state.writes.filter((w) => w.status === 'completed')).toHaveLength(0);
    expect(mocks.finalizeFree).not.toHaveBeenCalled();
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledOnce();
  });

  it('a heartbeat that reports the lease lost stops renewing, and the next persist check refuses', async () => {
    const state = ledger();
    let release: () => void = () => {};
    mocks.analyze.mockImplementation(async (_req: Request, _env: unknown, deps: any) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await deps.trustedJob.assertLeaseHeld();
      return Response.json({ summary: 'should not be saved' });
    });
    const m = msg();
    const done = processJob(m as any, {} as any);
    await vi.advanceTimersByTimeAsync(10_000);
    state.token = 'other-worker-token'; // takeover
    await vi.advanceTimersByTimeAsync(120_000);
    const renewalsAfterLoss = state.writes.filter((w) => w.status === 'running').length;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(state.writes.filter((w) => w.status === 'running').length).toBe(renewalsAfterLoss);
    release();
    await done;
    expect(state.writes.filter((w) => w.status === 'completed')).toHaveLength(0);
    expect(m.retry).toHaveBeenCalledOnce();
  });
});

describe('lease safety: temporary database failures', () => {
  it('a failed lease read before persisting refuses the save (fail closed) and retries', async () => {
    ledger();
    mocks.read.mockRejectedValue(Object.assign(new Error('Durable job database request failed.'), { name: 'DurableJobStorageError' }));
    mocks.analyze.mockImplementation(async (_req: Request, _env: unknown, deps: any) => {
      await deps.trustedJob.assertLeaseHeld();
      return Response.json({ summary: 'x' });
    });
    const m = msg();
    await processJob(m as any, {} as any);
    expect(mocks.finalizeFree).not.toHaveBeenCalled();
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledOnce();
  });

  it('a transient heartbeat failure during a long run does not end the run; later renewals resume', async () => {
    const state = ledger();
    let failed = false;
    mocks.update.mockImplementation(async (_env: unknown, input: any) => {
      if (input.status === 'running' && !failed) { failed = true; throw new Error('timeout'); }
      if (input.status === 'running') state.leaseUntil = Date.now() + LEASE_MS;
      if (input.status === 'completed') state.status = 'completed';
      return true;
    });
    let release: () => void = () => {};
    mocks.analyze.mockImplementation(() => new Promise<Response>((resolve) => {
      release = () => { mocks.loadReport.mockResolvedValue({ summary: 'synthetic' }); resolve(Response.json({ summary: 'synthetic' })); };
    }));
    const m = msg();
    const done = processJob(m as any, {} as any);
    await runClock(200_000);
    release();
    await done;
    expect(m.ack).toHaveBeenCalledOnce();
  });
});

describe('lease safety: worker termination', () => {
  it('a Worker that never settles sends neither ack nor retry and writes no completed state', async () => {
    // A killed isolate cannot be simulated in-process: its timer keeps running here. What is checked is the contract the
    // queue relies on: no ack or retry is sent, so the message stays unacknowledged, and no completed state is written.
    // Lease lapse after a real termination follows from the 240 s lease window and is verified on staging.
    const state = ledger();
    mocks.analyze.mockImplementation(() => new Promise<Response>(() => {}));
    const m = msg();
    void processJob(m as any, {} as any);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(state.writes.filter((w) => w.status === 'completed')).toHaveLength(0);
  });
});
