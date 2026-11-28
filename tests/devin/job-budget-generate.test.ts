import { describe, expect, it, vi } from 'vitest';
import { committed, startDelivery, type BudgetLimits } from '../../shared/analysisBudget';
import { createMemoryLedgerStore, mutateLedger, type LedgerStore } from '../../functions/api/_job-usage-ledger';
import { withJobBudget } from '../../functions/api/_job-budget-generate';
import { AnalyzerError } from '../../api/services/analyzerErrors';

const JOB = 'job_budget_01';
const TOKEN = 'token-A';
const LIMITS: BudgetLimits = { maxDeliveries: 3, cumulativeDeadlineMs: 30 * 60_000, maxInputTokens: 1_000_000, maxOutputTokens: 20_000, maxCostUsd: 18 };

function fixture(owner: string | null = TOKEN) {
  let current = owner;
  const store = createMemoryLedgerStore({ currentOwner: () => current });
  let n = 0;
  const ctx = { store, jobId: JOB, workerToken: TOKEN, limits: LIMITS, now: () => 1_000_000, newId: () => `call-${++n}` };
  return { store, ctx, setOwner: (o: string | null) => { current = o; } };
}

const params = (max = 8000, stage = 'section:overview') => ({
  system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'doc '.repeat(200) }] }], max_tokens: max, stage,
});
const ok = (input = 1000, output = 500) => ({
  text: '{}', model: 'claude-opus-5', durationMs: 1, stopReason: 'end_turn', usage: { input_tokens: input, output_tokens: output },
});

async function started(store: LedgerStore) {
  const r = await mutateLedger(store, JOB, TOKEN, (s) => startDelivery(s, 1_000_000, LIMITS));
  if (!r.ok) throw new Error('setup failed');
}

describe('provider calls are reserved and settled through the job ledger', () => {
  it('a successful call is settled at the provider-reported usage', async () => {
    const { store, ctx } = fixture();
    await started(store);
    const generate = vi.fn(async () => ok(1200, 640)) as any;
    const budgeted = withJobBudget(generate, ctx);
    await budgeted(params(), 'claude-opus-5');
    expect(generate).toHaveBeenCalledTimes(1);
    const final = store.snapshot(JOB)!;
    expect(final.reservations['call-1'].state).toBe('settled');
    expect(committed(final)).toMatchObject({ inputTokens: 1200, outputTokens: 640 });
  });

  it('refuses a call that would exceed the cumulative output limit, and never sends it', async () => {
    const { store, ctx } = fixture();
    await started(store);
    const generate = vi.fn(async () => ok(1000, 15_000)) as any;
    const budgeted = withJobBudget(generate, ctx);
    await budgeted(params(15_000), 'claude-opus-5');
    await expect(budgeted(params(8000), 'claude-opus-5')).rejects.toMatchObject({ code: 'ANALYSIS_BUDGET_EXHAUSTED', retryable: false });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('a second delivery inherits the first delivery spend', async () => {
    const { store, ctx } = fixture();
    await started(store);
    await withJobBudget(vi.fn(async () => ok(1000, 15_000)) as any, ctx)(params(15_000), 'claude-opus-5');
    await mutateLedger(store, JOB, TOKEN, (s) => startDelivery(s, 2_000_000, LIMITS));
    const second = vi.fn(async () => ok()) as any;
    await expect(withJobBudget(second, { ...ctx, now: () => 2_000_000 })(params(8000), 'claude-opus-5')).rejects.toBeInstanceOf(AnalyzerError);
    expect(second).not.toHaveBeenCalled();
  });

  it('a failed call is settled at its estimate and the error is rethrown unchanged', async () => {
    const { store, ctx } = fixture();
    await started(store);
    const boom = new Error('provider overloaded');
    const budgeted = withJobBudget((async () => { throw boom; }) as any, ctx);
    await expect(budgeted(params(4000), 'claude-opus-5')).rejects.toBe(boom);
    const r = store.snapshot(JOB)!.reservations['call-1'];
    expect(r.state).toBe('settled');
    expect(r.actualOutputTokens).toBe(4000);
  });

  it('a lost lease stops the call before it is sent', async () => {
    const { store, ctx, setOwner } = fixture();
    await started(store);
    setOwner('token-B');
    const generate = vi.fn(async () => ok()) as any;
    const err = await withJobBudget(generate, ctx)(params(), 'claude-opus-5').catch((e) => e);
    expect(err).toBeInstanceOf(AnalyzerError);
    expect(err.code).toBe('ANALYSIS_LEASE_LOST');
    expect(err.retryable).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('when settlement cannot be recorded, the reservation keeps counting at its estimate', async () => {
    const { store, ctx } = fixture();
    await started(store);
    const flaky: LedgerStore = {
      read: (id) => store.read(id),
      write: async (next, v, t) => (next.reservations['call-1']?.state === 'settled' ? Promise.reject(new Error('db down')) : store.write(next, v, t)),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await withJobBudget(vi.fn(async () => ok(1000, 300)) as any, { ...ctx, store: flaky })(params(8000), 'claude-opus-5');
    expect(store.snapshot(JOB)!.reservations['call-1'].state).toBe('open');
    expect(committed(store.snapshot(JOB)!).outputTokens).toBe(8000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
