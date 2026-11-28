import { describe, expect, it } from 'vitest';
import { committed, emptyLedger, reserveCall, startDelivery, type BudgetLimits, type CallEstimate } from '../../shared/analysisBudget';
import { createMemoryLedgerStore, mutateLedger } from '../../functions/api/_job-usage-ledger';

const LIMITS: BudgetLimits = { maxDeliveries: 3, cumulativeDeadlineMs: 30 * 60_000, maxInputTokens: 1_000_000, maxOutputTokens: 100_000, maxCostUsd: 18 };
const NOW = 1_000_000;
const JOB = 'job_store_01';

function setup(owner: string | null = 'tok-A') {
  let current = owner;
  const store = createMemoryLedgerStore({ currentOwner: () => current });
  return { store, setOwner: (o: string | null) => { current = o; } };
}

const call = (id: string, outputTokens: number, costUsd = 0.5): CallEstimate => ({
  id, stage: 'section:overview', model: 'claude-opus-5', estInputTokens: 10_000, estOutputTokens: outputTokens, estCostUsd: costUsd,
});

describe('ledger store: compare-and-swap', () => {
  it('two concurrent reservations are both recorded (no lost update)', async () => {
    const { store } = setup();
    await mutateLedger(store, JOB, 'tok-A', (s) => startDelivery(s, NOW, LIMITS));
    const [a, b] = await Promise.all([
      mutateLedger(store, JOB, 'tok-A', (s) => reserveCall(s, call('a', 1000), NOW, LIMITS)),
      mutateLedger(store, JOB, 'tok-A', (s) => reserveCall(s, call('b', 2000), NOW, LIMITS)),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const final = store.snapshot(JOB)!;
    expect(Object.keys(final.reservations).sort()).toEqual(['a', 'b']);
    expect(committed(final).outputTokens).toBe(3000);
  });

  it('concurrent deliveries near the ceiling: the ceiling is never exceeded', async () => {
    const { store } = setup();
    const limits = { ...LIMITS, maxOutputTokens: 10_000 };
    await mutateLedger(store, JOB, 'tok-A', (s) => startDelivery(s, NOW, limits));
    const attempts = Array.from({ length: 8 }, (_, i) =>
      mutateLedger(store, JOB, 'tok-A', (s) => reserveCall(s, call(`c${i}`, 3000), NOW, limits))
    );
    const outcomes = await Promise.all(attempts);
    const accepted = outcomes.filter((o) => o.ok).length;
    const refused = outcomes.filter((o) => (o as { error?: string }).error === 'BUDGET_EXHAUSTED').length;
    expect(accepted).toBe(3);
    expect(refused).toBe(5);
    expect(committed(store.snapshot(JOB)!).outputTokens).toBeLessThanOrEqual(10_000);
  });

  it('a worker whose lease was lost cannot write, and its transition is not applied', async () => {
    const { store, setOwner } = setup('tok-A');
    await mutateLedger(store, JOB, 'tok-A', (s) => startDelivery(s, NOW, LIMITS));
    setOwner('tok-B'); // a second delivery took the lease
    const stale = await mutateLedger(store, JOB, 'tok-A', (s) => reserveCall(s, call('stale', 1000), NOW, LIMITS));
    expect(stale).toEqual({ ok: false, error: 'LEASE_LOST' });
    expect(Object.keys(store.snapshot(JOB)!.reservations)).toEqual([]);
  });

  it('a refused transition writes nothing and does not advance the version', async () => {
    const { store } = setup();
    await mutateLedger(store, JOB, 'tok-A', (s) => startDelivery(s, NOW, LIMITS));
    const before = store.snapshot(JOB)!.version;
    const refused = await mutateLedger(store, JOB, 'tok-A', (s) => reserveCall(s, call('huge', 999_999), NOW, LIMITS));
    expect(refused).toEqual({ ok: false, error: 'BUDGET_EXHAUSTED' });
    expect(store.snapshot(JOB)!.version).toBe(before);
  });

  it('versions advance by exactly one per successful write', async () => {
    const { store } = setup();
    await mutateLedger(store, JOB, 'tok-A', (s) => startDelivery(s, NOW, LIMITS));
    await mutateLedger(store, JOB, 'tok-A', (s) => reserveCall(s, call('a', 1), NOW, LIMITS));
    expect(store.snapshot(JOB)!.version).toBe(2);
  });

  it('a missing ledger starts empty for the first delivery', async () => {
    const { store } = setup();
    expect(await store.read('job_none')).toBeNull();
    const r = await mutateLedger(store, 'job_none', 'tok-A', (s) => startDelivery(s, NOW, LIMITS));
    expect(r.ok && r.state.deliveries).toBe(1);
    expect(emptyLedger('job_none').deliveries).toBe(0);
  });
});
