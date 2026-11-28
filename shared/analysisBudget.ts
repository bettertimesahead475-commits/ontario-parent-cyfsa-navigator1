/**
 * Per-job usage ledger: pure state transitions. One job can be delivered several times (queue redelivery), and each
 * delivery can make several provider calls. This module decides, before each call, whether the job's cumulative
 * limits still allow it, and records what each call actually used. No I/O: storage and concurrency live in
 * functions/api/_job-usage-ledger.ts, which applies these transitions with a compare-and-swap on `version`.
 *
 * Accounting rules (conservative by design):
 *   - An open reservation counts at its estimate until it is settled.
 *   - A reservation that is never settled (interrupted run, lost lease) stays counted at its estimate forever.
 *     It is never silently dropped, so a crash cannot be used to make spend disappear from the ledger.
 *   - A settled reservation counts at its actual usage, even when that exceeds the estimate (the overrun is recorded).
 *   - Limits are cumulative across every delivery of the job, not per delivery.
 */

export interface BudgetLimits {
  /** Maximum queue deliveries that may start a run of this job. */
  maxDeliveries: number;
  /** Wall-clock time allowed from the first delivery to the start of any further provider call. */
  cumulativeDeadlineMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number;
}

export type ReservationState = 'open' | 'settled';

export interface Reservation {
  id: string;
  stage: string;
  model: string;
  estInputTokens: number;
  estOutputTokens: number;
  estCostUsd: number;
  openedAt: number;
  state: ReservationState;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualCostUsd?: number;
}

export interface LedgerState {
  jobId: string;
  /** Compare-and-swap version. Incremented by the store on every successful write. */
  version: number;
  deliveries: number;
  firstStartedAt: number | null;
  reservations: Record<string, Reservation>;
  /** Stages whose validated output is stored. A later delivery reuses them instead of calling the provider again. */
  checkpoints: Record<string, { digest: string; deliveryIndex: number }>;
}

export type LedgerError =
  | 'DELIVERY_LIMIT'
  | 'DEADLINE_EXHAUSTED'
  | 'BUDGET_EXHAUSTED'
  | 'DUPLICATE_RESERVATION'
  | 'UNKNOWN_RESERVATION';

export type Transition<T = LedgerState> = { ok: true; state: LedgerState; value?: T } | { ok: false; error: LedgerError };

export function emptyLedger(jobId: string): LedgerState {
  return { jobId, version: 0, deliveries: 0, firstStartedAt: null, reservations: {}, checkpoints: {} };
}

export interface Committed {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Spend counted against the limits: settled actuals plus every unsettled reservation at its estimate. */
export function committed(state: LedgerState): Committed {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const r of Object.values(state.reservations)) {
    if (r.state === 'settled') {
      inputTokens += r.actualInputTokens ?? 0;
      outputTokens += r.actualOutputTokens ?? 0;
      costUsd += r.actualCostUsd ?? 0;
    } else {
      inputTokens += r.estInputTokens;
      outputTokens += r.estOutputTokens;
      costUsd += r.estCostUsd;
    }
  }
  return { inputTokens, outputTokens, costUsd };
}

/** Milliseconds left of the cumulative deadline. Infinity before the first delivery has started. */
export function remainingDeadlineMs(state: LedgerState, now: number, limits: BudgetLimits): number {
  if (state.firstStartedAt === null) return limits.cumulativeDeadlineMs;
  return limits.cumulativeDeadlineMs - (now - state.firstStartedAt);
}

export function startDelivery(state: LedgerState, now: number, limits: BudgetLimits): Transition {
  if (state.firstStartedAt !== null && remainingDeadlineMs(state, now, limits) <= 0) {
    return { ok: false, error: 'DEADLINE_EXHAUSTED' };
  }
  if (state.deliveries >= limits.maxDeliveries) return { ok: false, error: 'DELIVERY_LIMIT' };
  return {
    ok: true,
    state: {
      ...state,
      deliveries: state.deliveries + 1,
      firstStartedAt: state.firstStartedAt ?? now,
    },
  };
}

export interface CallEstimate {
  id: string;
  stage: string;
  model: string;
  estInputTokens: number;
  estOutputTokens: number;
  estCostUsd: number;
}

/**
 * Reserves one provider call. Refused, with no state change, when the call would exceed any cumulative limit or the
 * deadline has passed. A refused call is never sent, so it costs nothing.
 */
export function reserveCall(state: LedgerState, call: CallEstimate, now: number, limits: BudgetLimits): Transition<Reservation> {
  if (state.reservations[call.id]) return { ok: false, error: 'DUPLICATE_RESERVATION' };
  if (state.firstStartedAt !== null && remainingDeadlineMs(state, now, limits) <= 0) {
    return { ok: false, error: 'DEADLINE_EXHAUSTED' };
  }
  const spent = committed(state);
  if (
    spent.inputTokens + call.estInputTokens > limits.maxInputTokens ||
    spent.outputTokens + call.estOutputTokens > limits.maxOutputTokens ||
    spent.costUsd + call.estCostUsd > limits.maxCostUsd
  ) {
    return { ok: false, error: 'BUDGET_EXHAUSTED' };
  }
  const reservation: Reservation = { ...call, openedAt: now, state: 'open' };
  return { ok: true, state: { ...state, reservations: { ...state.reservations, [call.id]: reservation } }, value: reservation };
}

export interface ActualUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Settles a reservation at its actual usage. Settling the same reservation twice with the same usage is a no-op. */
export function settleCall(state: LedgerState, id: string, actual: ActualUsage): Transition {
  const r = state.reservations[id];
  if (!r) return { ok: false, error: 'UNKNOWN_RESERVATION' };
  if (r.state === 'settled') return { ok: true, state };
  const settled: Reservation = {
    ...r,
    state: 'settled',
    actualInputTokens: actual.inputTokens,
    actualOutputTokens: actual.outputTokens,
    actualCostUsd: actual.costUsd,
  };
  return { ok: true, state: { ...state, reservations: { ...state.reservations, [id]: settled } } };
}

/** Records that a stage's validated output is stored, so no later delivery needs to produce it again. */
export function recordCheckpoint(state: LedgerState, stage: string, digest: string): LedgerState {
  return {
    ...state,
    checkpoints: { ...state.checkpoints, [stage]: { digest, deliveryIndex: state.deliveries } },
  };
}

/** Open reservations older than the TTL. They are still counted; this only lists them for diagnostics and settlement. */
export function staleReservations(state: LedgerState, now: number, ttlMs: number): string[] {
  return Object.values(state.reservations)
    .filter((r) => r.state === 'open' && now - r.openedAt > ttlMs)
    .map((r) => r.id)
    .sort();
}

/**
 * Failure classes used by the queue consumer. Only infrastructure failures may be redelivered with the same budget.
 * Analytical failures are terminal after one redelivery, and budget or deadline exhaustion is always terminal.
 */
export type FailureClass = 'infrastructure' | 'analytical' | 'budget' | 'lease';

export function classifyFailure(code: string, retryable: boolean): FailureClass {
  if (code === 'JOB_LEASE_LOST' || code === 'ANALYSIS_LEASE_LOST') return 'lease';
  if (code === 'BUDGET_EXHAUSTED' || code === 'DELIVERY_LIMIT' || code === 'DEADLINE_EXHAUSTED' || code === 'ANALYSIS_BUDGET_EXHAUSTED') return 'budget';
  if (code === 'AI_RESPONSE_INVALID') return 'analytical';
  return retryable ? 'infrastructure' : 'analytical';
}

/** Whether a failure of this class may be redelivered, given how many deliveries have already started. */
export function mayRedeliver(failure: FailureClass, state: LedgerState, limits: BudgetLimits, analyticalRedeliveries = 1): boolean {
  if (failure === 'budget') return false;
  if (state.deliveries >= limits.maxDeliveries) return false;
  if (failure === 'analytical') return state.deliveries <= analyticalRedeliveries;
  return true;
}

/**
 * Rate card, USD per million tokens. UNVERIFIED: these are the highest Opus 5 and Sonnet 5 rates seen on the public
 * pricing page on 2026-11-28 (see engineering/reviews/paid-comparison-budget-20261128.md). Unknown models are charged at
 * the highest rate, so an unlisted model can only make the ceiling tighter, never looser.
 */
export const RATE_CARD_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 10, output: 50 },
  'claude-sonnet-5': { input: 2, output: 10 },
};
const HIGHEST_RATE = { input: 10, output: 50 };

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = RATE_CARD_USD_PER_MTOK[model] ?? HIGHEST_RATE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
