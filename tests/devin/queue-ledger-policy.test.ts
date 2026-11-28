import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  impl: null as null | ((req: Request, env: any, deps: any) => Promise<Response>),
  token: '',
  job: null as any,
  handlerCalls: [] as any[],
  probe: null as any,
}));

vi.mock('../../functions/api/analyze', () => ({
  handleAnalyzeRequest: (req: Request, env: any, deps: any) => {
    H.handlerCalls.push(deps);
    return H.impl!(req, env, deps);
  },
}));
vi.mock('../../functions/api/_durable-analysis-jobs', () => ({
  claimDurableJob: vi.fn(async (_env: unknown, _id: string, token: string) => { H.token = token; return H.job; }),
  readDurableJob: vi.fn(async () => H.job),
  loadDurableInput: vi.fn(async () => ({ documentText: 'Synthetic document text for policy tests.', fileName: 'synthetic.txt' })),
  loadPersistedReport: vi.fn(async () => null),
  updateDurableJob: vi.fn(async () => true),
  completeRecoveredJob: vi.fn(async () => true),
  failDeadLetterJob: vi.fn(async () => null),
  requeueFromDeadLetter: vi.fn(async () => false),
  rpc: vi.fn(),
  getDurableObject: vi.fn(),
  putDurableObjectOnce: vi.fn(),
  saveDurableInput: vi.fn(),
}));
vi.mock('../../functions/api/_staging-credit-rpc', () => ({ createStagingCreditRpc: vi.fn(() => ({})) }));
vi.mock('../../functions/api/_free-credit-lifecycle', () => ({
  finalizeFreeScan: vi.fn(async () => ({ status: 'consumed' })),
  releaseFreeScan: vi.fn(async () => ({ status: 'released' })),
}));
vi.mock('../../functions/api/_paid-credit-lifecycle', () => ({
  finalizePaidReservation: vi.fn(async () => ({ status: 'consumed' })),
  releasePaidReservation: vi.fn(async () => ({ status: 'released' })),
}));

import { processJob } from '../../workers/analyzer-queue-consumer';
import { createMemoryLedgerStore } from '../../functions/api/_job-usage-ledger';
import { createMemoryCheckpointStore } from '../../functions/api/_job-checkpoints';
import { updateDurableJob } from '../../functions/api/_durable-analysis-jobs';

const JOB_ID = 'job_policy_0001';
const failWith = (status: number, code: string, retryable: boolean) => async () =>
  new Response(JSON.stringify({ code, retryable }), { status, headers: { 'Content-Type': 'application/json' } });

function message() {
  return { body: { version: 1, jobId: JOB_ID }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
}

function harness(flag: 'on' | undefined = 'on') {
  const ledgerStore = createMemoryLedgerStore({ currentOwner: () => H.token });
  const checkpointStore = createMemoryCheckpointStore();
  const env = { ANALYZER_JOB_LEDGER: flag, ledgerStore, checkpointStore } as any;
  return { env, ledgerStore, checkpointStore };
}

const failedWrites = () =>
  (updateDurableJob as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c: any[]) => c[1]?.status === 'failed').length;

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  H.handlerCalls = [];
  (updateDurableJob as unknown as ReturnType<typeof vi.fn>).mockClear();
  H.job = { job_id: JOB_ID, owner_uid: 'owner-1', mode: 'full', status: 'queued', input_key: 'inputs/x.json', session_id: null, reservation_id: 'res_1', owner_bypass: false, attempt_count: 1 };
});

describe('queue policy with the usage ledger on', () => {
  it('an analytical failure is redelivered once, then becomes terminal', async () => {
    const { env } = harness();
    H.impl = failWith(422, 'AI_RESPONSE_INVALID', true);
    const first = message();
    await processJob(first as any, env);
    expect(first.retry).toHaveBeenCalledTimes(1);
    expect(first.ack).not.toHaveBeenCalled();

    const second = message();
    await processJob(second as any, env);
    expect(second.ack).toHaveBeenCalledTimes(1);
    expect(second.retry).not.toHaveBeenCalled();
    expect(failedWrites()).toBe(1);
  });

  it('a budget refusal is terminal on the first delivery, with no redelivery', async () => {
    const { env } = harness();
    H.impl = failWith(422, 'ANALYSIS_BUDGET_EXHAUSTED', false);
    const m = message();
    await processJob(m as any, env);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(failedWrites()).toBe(1);
  });

  it('infrastructure failures are redelivered until the delivery limit, then stop', async () => {
    const { env } = harness();
    H.impl = failWith(503, 'AI_PROVIDER_TEMPORARILY_UNAVAILABLE', true);
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const m = message();
      await processJob(m as any, env);
      outcomes.push(m.retry.mock.calls.length ? 'retry' : m.ack.mock.calls.length ? 'ack' : 'none');
    }
    expect(outcomes).toEqual(['retry', 'retry', 'ack']);
    expect(failedWrites()).toBe(1);
  });

  it('a duplicate delivery after the limit starts no provider work', async () => {
    const { env } = harness();
    H.impl = failWith(503, 'AI_PROVIDER_TEMPORARILY_UNAVAILABLE', true);
    for (let i = 0; i < 3; i += 1) await processJob(message() as any, env);
    const callsBefore = H.handlerCalls.length;
    const extra = message();
    await processJob(extra as any, env);
    expect(H.handlerCalls.length).toBe(callsBefore);
    expect(extra.ack).toHaveBeenCalledTimes(1);
  });

  it('a lost lease at start is retried without starting work and without a terminal failure', async () => {
    const ledgerStore = createMemoryLedgerStore({ currentOwner: () => 'someone-else' });
    const env = { ANALYZER_JOB_LEDGER: 'on', ledgerStore, checkpointStore: createMemoryCheckpointStore() } as any;
    H.impl = failWith(500, 'SHOULD_NOT_RUN', false);
    const m = message();
    await processJob(m as any, env);
    expect(H.handlerCalls).toHaveLength(0);
    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(failedWrites()).toBe(0);
  });

  it('the handler receives the ledger budget and a checkpoint bundle bound to this delivery', async () => {
    const { env, ledgerStore } = harness();
    H.impl = failWith(422, 'SOME_TERMINAL', false);
    await processJob(message() as any, env);
    const deps = H.handlerCalls[0];
    expect(deps.trustedJob.ledger.jobId).toBe(JOB_ID);
    expect(deps.trustedJob.ledger.limits.maxDeliveries).toBe(3);
    expect(deps.trustedJob.checkpoints).toBeDefined();
    expect((await ledgerStore.read(JOB_ID))?.deliveries).toBe(1);
  });

  it('a completed section is saved as a checkpoint and reused by the next delivery under the same version', async () => {
    const { env, ledgerStore, checkpointStore } = harness();
    const section = { chronology: [{ date: 'March 3, 2026', event: 'Synthetic.' }] };
    H.impl = async (_req, _env, deps) => {
      if (H.handlerCalls.length === 1) {
        await deps.trustedJob.checkpoints.save('chronology', section, 'v-1');
        return failWith(422, 'SOME_TERMINAL', false)();
      }
      H.probe = {
        loaded: await deps.trustedJob.checkpoints.load(['chronology', 'redFlags'], 'v-1'),
        otherVersion: await deps.trustedJob.checkpoints.load(['chronology'], 'v-2'),
      };
      return failWith(422, 'SOME_TERMINAL', false)();
    };
    await processJob(message() as any, env);
    expect(await checkpointStore.load(JOB_ID, 'chronology')).toEqual({ version: 'v-1', value: section });
    expect((await ledgerStore.read(JOB_ID))?.checkpoints.chronology).toBeDefined();

    await processJob(message() as any, env);
    expect(H.probe.loaded).toEqual({ chronology: section });
    expect(H.probe.otherVersion).toEqual({});
  });

  it('a checkpoint is never overwritten: the first saved value for a stage is kept', async () => {
    const { checkpointStore } = harness();
    await checkpointStore.save(JOB_ID, 'overview', { version: 'v-1', value: { fileSummary: 'first' } });
    const again = await checkpointStore.save(JOB_ID, 'overview', { version: 'v-1', value: { fileSummary: 'second' } });
    expect(again).toBe('exists');
    expect((await checkpointStore.load(JOB_ID, 'overview'))?.value).toEqual({ fileSummary: 'first' });
  });
});

describe('queue policy with the ledger off (unchanged default)', () => {
  it('a retryable failure is redelivered without a ledger, and the handler gets no budget', async () => {
    const env = { ANALYZER_JOB_LEDGER: undefined, ledgerStore: createMemoryLedgerStore({ currentOwner: () => H.token }), checkpointStore: createMemoryCheckpointStore() } as any;
    H.impl = failWith(503, 'AI_PROVIDER_TEMPORARILY_UNAVAILABLE', true);
    for (let i = 0; i < 4; i += 1) {
      const m = message();
      await processJob(m as any, env);
      expect(m.retry).toHaveBeenCalledTimes(1);
    }
    expect(H.handlerCalls.every((d) => d.trustedJob.ledger === undefined && d.trustedJob.checkpoints === undefined)).toBe(true);
  });
});
