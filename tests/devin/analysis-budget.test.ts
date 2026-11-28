import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  committed,
  emptyLedger,
  mayRedeliver,
  recordCheckpoint,
  remainingDeadlineMs,
  reserveCall,
  settleCall,
  startDelivery,
  staleReservations,
  type BudgetLimits,
  type CallEstimate,
  type LedgerState,
} from '../../shared/analysisBudget';

const LIMITS: BudgetLimits = {
  maxDeliveries: 3,
  cumulativeDeadlineMs: 30 * 60_000,
  maxInputTokens: 1_000_000,
  maxOutputTokens: 100_000,
  maxCostUsd: 18,
};
const T0 = 1_000_000;

const call = (id: string, over: Partial<CallEstimate> = {}): CallEstimate => ({
  id, stage: 'section:overview', model: 'claude-opus-5', estInputTokens: 50_000, estOutputTokens: 8_000, estCostUsd: 0.9, ...over,
});

function started(): LedgerState {
  const r = startDelivery(emptyLedger('job_1'), T0, LIMITS);
  if (!r.ok) throw new Error('unexpected');
  return r.state;
}

describe('deliveries and the cumulative deadline', () => {
  it('counts every delivery of the job, not only the first', () => {
    let s = emptyLedger('job_1');
    for (let i = 0; i < 3; i += 1) {
      const r = startDelivery(s, T0 + i * 1000, LIMITS);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(s.deliveries).toBe(3);
    expect(startDelivery(s, T0 + 5000, LIMITS)).toEqual({ ok: false, error: 'DELIVERY_LIMIT' });
  });

  it('the deadline runs from the first delivery, so a late redelivery inherits the time already used', () => {
    const s = started();
    const later = T0 + 29 * 60_000;
    expect(remainingDeadlineMs(s, later, LIMITS)).toBe(60_000);
    expect(reserveCall(s, call('a'), later, LIMITS).ok).toBe(true);
    expect(reserveCall(s, call('a'), T0 + 31 * 60_000, LIMITS)).toEqual({ ok: false, error: 'DEADLINE_EXHAUSTED' });
  });

  it('refuses a new delivery once the deadline has passed', () => {
    const s = started();
    expect(startDelivery(s, T0 + 31 * 60_000, LIMITS)).toEqual({ ok: false, error: 'DEADLINE_EXHAUSTED' });
  });
});

describe('cumulative token and cost ceilings across deliveries', () => {
  it('an open reservation counts at its estimate, so a second delivery cannot reset the spend', () => {
    let s = started();
    const first = reserveCall(s, call('a'), T0 + 1000, LIMITS);
    if (!first.ok) throw new Error('unexpected');
    s = first.state;
    // Simulated lost lease: the first delivery never settles. A new delivery starts.
    const next = startDelivery(s, T0 + 60_000, LIMITS);
    if (!next.ok) throw new Error('unexpected');
    expect(committed(next.state).outputTokens).toBe(8_000);
  });

  it('refuses a call that would push cumulative output past the limit, with no state change', () => {
    let s = started();
    const limits = { ...LIMITS, maxOutputTokens: 20_000 };
    for (let i = 0; i < 2; i += 1) {
      const r = reserveCall(s, call(`c${i}`), T0 + 1000, limits);
      if (!r.ok) throw new Error('unexpected');
      s = r.state;
    }
    const refused = reserveCall(s, call('c2'), T0 + 1000, limits);
    expect(refused).toEqual({ ok: false, error: 'BUDGET_EXHAUSTED' });
    expect(Object.keys(s.reservations)).toHaveLength(2);
  });

  it('refuses on cost, even when tokens are within limits', () => {
    const s = started();
    expect(reserveCall(s, call('a', { estCostUsd: 19 }), T0 + 1000, LIMITS)).toEqual({ ok: false, error: 'BUDGET_EXHAUSTED' });
  });

  it('rejects a duplicate reservation id instead of counting it twice', () => {
    let s = started();
    const r = reserveCall(s, call('a'), T0 + 1000, LIMITS);
    if (!r.ok) throw new Error('unexpected');
    s = r.state;
    expect(reserveCall(s, call('a'), T0 + 1000, LIMITS)).toEqual({ ok: false, error: 'DUPLICATE_RESERVATION' });
  });
});

describe('settlement', () => {
  it('replaces the estimate with the actual usage, and records an overrun without refusing it', () => {
    let s = started();
    const r = reserveCall(s, call('a'), T0 + 1000, LIMITS);
    if (!r.ok) throw new Error('unexpected');
    const settled = settleCall(r.state, 'a', { inputTokens: 40_000, outputTokens: 12_000, costUsd: 0.8 });
    if (!settled.ok) throw new Error('unexpected');
    expect(committed(settled.state)).toEqual({ inputTokens: 40_000, outputTokens: 12_000, costUsd: 0.8 });
    expect(settled.state.reservations.a.actualOutputTokens).toBe(12_000);
  });

  it('is idempotent: settling twice does not double count', () => {
    let s = started();
    const r = reserveCall(s, call('a'), T0 + 1000, LIMITS);
    if (!r.ok) throw new Error('unexpected');
    const once = settleCall(r.state, 'a', { inputTokens: 1, outputTokens: 2, costUsd: 0.1 });
    if (!once.ok) throw new Error('unexpected');
    const twice = settleCall(once.state, 'a', { inputTokens: 1, outputTokens: 2, costUsd: 0.1 });
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(committed(twice.state).outputTokens).toBe(2);
  });

  it('rejects settlement of an unknown reservation', () => {
    expect(settleCall(started(), 'missing', { inputTokens: 0, outputTokens: 0, costUsd: 0 })).toEqual({ ok: false, error: 'UNKNOWN_RESERVATION' });
  });

  it('interrupted settlement: an unsettled reservation stays counted at its estimate and is listed as stale', () => {
    let s = started();
    const r = reserveCall(s, call('a'), T0 + 1000, LIMITS);
    if (!r.ok) throw new Error('unexpected');
    s = r.state;
    expect(committed(s).outputTokens).toBe(8_000);
    expect(staleReservations(s, T0 + 1000 + 10 * 60_000, 5 * 60_000)).toEqual(['a']);
    expect(committed(s).outputTokens).toBe(8_000);
  });
});

describe('checkpoints (partial completion)', () => {
  it('a recorded stage stays recorded for later deliveries', () => {
    const s = recordCheckpoint(started(), 'section:overview', 'digest-1');
    expect(s.checkpoints['section:overview']).toEqual({ digest: 'digest-1', deliveryIndex: 1 });
  });
});

describe('failure classification and redelivery', () => {
  it('classifies lease loss, budget exhaustion and analytical failures distinctly', () => {
    expect(classifyFailure('JOB_LEASE_LOST', true)).toBe('lease');
    expect(classifyFailure('BUDGET_EXHAUSTED', false)).toBe('budget');
    expect(classifyFailure('DEADLINE_EXHAUSTED', false)).toBe('budget');
    expect(classifyFailure('AI_RESPONSE_INVALID', true)).toBe('analytical');
    expect(classifyFailure('PROVIDER_UNAVAILABLE', true)).toBe('infrastructure');
    expect(classifyFailure('SOMETHING_TERMINAL', false)).toBe('analytical');
  });

  it('never redelivers a budget failure', () => {
    expect(mayRedeliver('budget', started(), LIMITS)).toBe(false);
  });

  it('redelivers an analytical failure once, then stops', () => {
    let s = started();
    expect(mayRedeliver('analytical', s, LIMITS)).toBe(true);
    s = (startDelivery(s, T0 + 60_000, LIMITS) as { state: LedgerState }).state;
    expect(mayRedeliver('analytical', s, LIMITS)).toBe(false);
  });

  it('redelivers infrastructure failures up to the delivery limit', () => {
    let s = started();
    expect(mayRedeliver('infrastructure', s, LIMITS)).toBe(true);
    s = (startDelivery(s, T0 + 1, LIMITS) as { state: LedgerState }).state;
    s = (startDelivery(s, T0 + 2, LIMITS) as { state: LedgerState }).state;
    expect(mayRedeliver('infrastructure', s, LIMITS)).toBe(false);
  });
});
