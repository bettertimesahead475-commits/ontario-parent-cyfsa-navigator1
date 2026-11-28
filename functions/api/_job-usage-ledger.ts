/**
 * Storage for the per-job usage ledger (shared/analysisBudget.ts). Every change is a compare-and-swap on `version`, so two
 * deliveries that race cannot lose each other's reservations. A write also names the worker token that holds the job
 * lease; a stale worker (lease lost) is refused, so it cannot record spend or checkpoints for a job it no longer owns.
 *
 * Production uses the RPC store, backed by the pending migration create_navigator_analysis_ledger.sql. That migration
 * is not applied. Tests use the in-memory store, which applies the same rules.
 */
import {
  emptyLedger,
  type BudgetLimits,
  type LedgerError,
  type LedgerState,
  type Transition,
} from '../../shared/analysisBudget';
import { rpc, type DurableJobEnv } from './_durable-analysis-jobs';

export type WriteResult = 'written' | 'conflict' | 'not_owner';

export interface LedgerStore {
  read(jobId: string): Promise<LedgerState | null>;
  /** Writes `next` only if the stored version equals `expectedVersion` and `workerToken` still holds the lease. */
  write(next: LedgerState, expectedVersion: number, workerToken: string): Promise<WriteResult>;
}

export type MutateOutcome<T> =
  | { ok: true; state: LedgerState; value?: T }
  | { ok: false; error: LedgerError | 'CONFLICT_EXHAUSTED' | 'LEASE_LOST' };

/**
 * Reads the ledger, applies a pure transition, and writes it back with a compare-and-swap. Retries on conflicts with
 * fresh state. A transition refusal is returned without writing anything.
 */
export async function mutateLedger<T>(
  store: LedgerStore,
  jobId: string,
  workerToken: string,
  transition: (state: LedgerState) => Transition<T>,
  maxAttempts = 8
): Promise<MutateOutcome<T>> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = (await store.read(jobId)) ?? emptyLedger(jobId);
    const step = transition(current);
    if (step.ok === false) return { ok: false, error: step.error };
    const next: LedgerState = { ...step.state, version: current.version + 1 };
    const result = await store.write(next, current.version, workerToken);
    if (result === 'written') return { ok: true, state: next, value: step.value };
    if (result === 'not_owner') return { ok: false, error: 'LEASE_LOST' };
    // Conflict: another writer advanced the version. Re-read and apply the transition again.
  }
  return { ok: false, error: 'CONFLICT_EXHAUSTED' };
}

/** In-memory store with the same semantics as the SQL function. For tests and the isolated validation harness. */
export function createMemoryLedgerStore(options: { currentOwner: () => string | null }): LedgerStore & { snapshot(jobId: string): LedgerState | null } {
  const rows = new Map<string, LedgerState>();
  return {
    async read(jobId) {
      const row = rows.get(jobId);
      return row ? structuredClone(row) : null;
    },
    async write(next, expectedVersion, workerToken) {
      if (options.currentOwner() !== workerToken) return 'not_owner';
      const row = rows.get(next.jobId);
      const storedVersion = row ? row.version : 0;
      if (storedVersion !== expectedVersion) return 'conflict';
      rows.set(next.jobId, structuredClone(next));
      return 'written';
    },
    snapshot(jobId) {
      const row = rows.get(jobId);
      return row ? structuredClone(row) : null;
    },
  };
}

/** Production store: two RPCs, analyzer_job_ledger_read and analyzer_job_ledger_write (see the pending migration). */
export function createRpcLedgerStore(env: DurableJobEnv, fetcher: typeof fetch = fetch): LedgerStore {
  return {
    async read(jobId) {
      return await rpc<LedgerState | null>(env, 'analyzer_job_ledger_read', { p_job_id: jobId }, fetcher);
    },
    async write(next, expectedVersion, workerToken) {
      const result = await rpc<string>(env, 'analyzer_job_ledger_write', {
        p_job_id: next.jobId,
        p_expected_version: expectedVersion,
        p_worker_token: workerToken,
        p_state: next,
      }, fetcher);
      if (result === 'written' || result === 'conflict' || result === 'not_owner') return result;
      throw new Error('Unexpected ledger write result.');
    },
  };
}

/** Limits by mode. Cost ceilings use the rate card in shared/analysisBudget.ts; they are set to the Stage 1 proposal, not approved. */
export const JOB_LIMITS: Record<'fast' | 'full', BudgetLimits> = {
  fast: { maxDeliveries: 3, cumulativeDeadlineMs: 15 * 60_000, maxInputTokens: 400_000, maxOutputTokens: 60_000, maxCostUsd: 6 },
  full: { maxDeliveries: 3, cumulativeDeadlineMs: 30 * 60_000, maxInputTokens: 1_200_000, maxOutputTokens: 150_000, maxCostUsd: 18 },
};
