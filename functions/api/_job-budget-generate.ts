/**
 * Puts the per-job usage ledger in front of every provider call of a queued analysis. Before a call is sent, its
 * worst-case usage is reserved against the job's cumulative limits; a refused call is never sent. After the call, the
 * reservation is settled at the provider's reported usage. A failed call is settled at its estimate, because the
 * provider may still have billed it. If settlement itself cannot be written, the reservation stays open and keeps
 * counting at its estimate (conservative; see shared/analysisBudget.ts).
 */
import type { GenerateFn, GenerateResult } from '../../api/services/analyzerSections';
import { AnalyzerError } from '../../api/services/analyzerErrors';
import { costUsd, reserveCall, settleCall, type BudgetLimits } from '../../shared/analysisBudget';
import { mutateLedger, type LedgerStore } from './_job-usage-ledger';

export interface JobBudgetContext {
  store: LedgerStore;
  jobId: string;
  workerToken: string;
  limits: BudgetLimits;
  now?: () => number;
  newId?: () => string;
}

/** Worst-case input size from the request text: about four characters per token, the same rule the planning budget uses. */
export function estimateInputTokens(params: { system?: string; messages: unknown[] }): number {
  const chars = (params.system ?? '').length + JSON.stringify(params.messages).length;
  return Math.ceil(chars / 4);
}

function budgetRefusal(error: 'BUDGET_EXHAUSTED' | 'DEADLINE_EXHAUSTED' | 'DELIVERY_LIMIT' | 'DUPLICATE_RESERVATION' | 'UNKNOWN_RESERVATION' | 'LEASE_LOST' | 'CONFLICT_EXHAUSTED'): Error {
  if (error === 'LEASE_LOST' || error === 'CONFLICT_EXHAUSTED') {
    return new AnalyzerError("ANALYSIS_LEASE_LOST", 503, "The analysis job lease is no longer held by this worker.", true);
  }
  return new AnalyzerError('ANALYSIS_BUDGET_EXHAUSTED', 422, 'The analysis reached its usage limit. No further work was started.', false);
}

export function withJobBudget(generate: GenerateFn, ctx: JobBudgetContext): GenerateFn {
  const now = ctx.now ?? (() => Date.now());
  const newId = ctx.newId ?? (() => crypto.randomUUID());
  return async (params, model): Promise<GenerateResult> => {
    const id = newId();
    const estInputTokens = estimateInputTokens(params);
    const estOutputTokens = params.max_tokens ?? 8192;
    const estCostUsd = costUsd(model, estInputTokens, estOutputTokens);
    const reserved = await mutateLedger(ctx.store, ctx.jobId, ctx.workerToken, (s) =>
      reserveCall(s, { id, stage: params.stage ?? 'unknown', model, estInputTokens, estOutputTokens, estCostUsd }, now(), ctx.limits)
    );
    if (reserved.ok === false) throw budgetRefusal(reserved.error);

    const settle = async (usage: { inputTokens: number; outputTokens: number; costUsd: number }): Promise<void> => {
      try {
        const done = await mutateLedger(ctx.store, ctx.jobId, ctx.workerToken, (s) => settleCall(s, id, usage));
        if (done.ok === false) console.warn('[ANALYSIS_SETTLEMENT_NOT_RECORDED]', JSON.stringify({ reason: done.error }));
      } catch {
        console.warn('[ANALYSIS_SETTLEMENT_NOT_RECORDED]', JSON.stringify({ reason: 'store_unavailable' }));
      }
    };

    let result: GenerateResult;
    try {
      result = await generate(params, model);
    } catch (error) {
      await settle({ inputTokens: estInputTokens, outputTokens: estOutputTokens, costUsd: estCostUsd });
      throw error;
    }
    const inputTokens = result.usage?.input_tokens ?? estInputTokens;
    const outputTokens = result.usage?.output_tokens ?? estOutputTokens;
    await settle({ inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) });
    return result;
  };
}
