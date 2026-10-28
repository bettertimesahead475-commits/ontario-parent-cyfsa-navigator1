/**
 * Route-level operations for resumable Forensic Engine jobs. The route reserves the credit once when the job starts
 * (existing reservation code), then each invocation advances the job; the credit is settled once when the report is
 * delivered, or released once when the job fails.
 *
 * Settlement rules:
 * - Delivered: finalize the reservation. If it lapsed while the job ran (reservations last 15 minutes), reserve again
 *   under the same request id and finalize that, so a delivered report is charged exactly once. If the allowance is
 *   used up by then, the report is withheld (402) and stays saved for a later settle.
 * - Failed: release the reservation with the starting request's reservation id. A settlement marker in the checkpoint
 *   store makes both idempotent across invocations.
 */

import { randomUUID } from "node:crypto";
import { LifecycleError } from "../lifecycleErrors.js";
import { getSupabase } from "../access.js";
import type { GenerateFn } from "../analyzerSections.js";
import type { CaseDocument, ForensicReport } from "./caseModel.js";
import { CheckpointStore, SupabaseObjectStore, type EngineJobMeta } from "./checkpointStore.js";
import { toLegacyReport, type ThinkingGenerateFn } from "./integration.js";
import { createEngineState, type ForensicLimits, type ForensicProgress } from "./pipeline.js";
import { advanceEngine, type AdvanceResult } from "./resumableRunner.js";
import { corpusSources } from "./legalCorpusAdapter.js";

/** The database corpus is consulted only when FORENSIC_CORPUS_CYFSA_SOURCE_ID is set; the bundled text always is. */
function engineCorpus() {
  let db: any = null;
  try {
    db = process.env.FORENSIC_CORPUS_CYFSA_SOURCE_ID ? getSupabase() : null;
  } catch {
    db = null;
  }
  return corpusSources(db);
}

let storeOverride: CheckpointStore | null = null;
let defaultStore: CheckpointStore | null = null;

export function setEngineStoreForTesting(store: CheckpointStore | null): void {
  storeOverride = store;
}

export function engineStore(): CheckpointStore {
  if (storeOverride) return storeOverride;
  defaultStore ??= new CheckpointStore(new SupabaseObjectStore(getSupabase()));
  return defaultStore;
}

/**
 * Per-step caps for resumable runs. Each model step can have an invocation to itself, so the caps are larger than the
 * single-invocation ROUTE_LIMITS. A model step starts only with at least STEP_MIN_MS left in the invocation.
 */
export const RESUMABLE_LIMITS: Partial<ForensicLimits> = {
  maxCalls: 16,
  extractionMaxTokens: 6_000,
  investigationMaxTokens: 24_000,
  synthesisMaxTokens: 16_000,
  reviewMaxTokens: 12_000,
  visualMaxTokens: 3_000,
  stageTimeoutMs: 200_000,
};
export const STEP_MIN_MS = 200_000;
export const LEASE_TTL_MS = 260_000;

export async function startEngineJob(params: {
  store: CheckpointStore;
  meta: EngineJobMeta;
  documents: CaseDocument[];
  investigatorModel: string;
  extractorModel: string;
  limits?: Partial<ForensicLimits>;
}): Promise<boolean> {
  const { state, media } = createEngineState({
    documents: params.documents,
    models: { extractor: params.extractorModel, investigator: params.investigatorModel, reviewer: params.investigatorModel },
    limits: { ...RESUMABLE_LIMITS, ...params.limits },
    requestId: params.meta.jobId,
  });
  return params.store.start(params.meta.jobId, params.meta, state, media);
}

export async function advanceEngineJob(params: {
  store: CheckpointStore;
  jobId: string;
  generate: ThinkingGenerateFn;
  deadlineAt: number;
  onProgress?: (p: ForensicProgress) => void | Promise<void>;
  now?: () => number;
  maxSteps?: number;
  minModelStepMs?: number;
}): Promise<AdvanceResult> {
  const latest = await params.store.latest(params.jobId);
  const investigator = latest?.state.models.investigator;
  const generate: GenerateFn = (p, model) => params.generate({ ...p, enableThinking: model === investigator && p.stage !== "forensic_extraction" }, model);
  return advanceEngine({
    store: params.store,
    jobId: params.jobId,
    owner: `${params.jobId}:${randomUUID()}`,
    deps: { generate, deadlineAt: params.deadlineAt, now: params.now, onProgress: params.onProgress, corpus: engineCorpus() },
    minModelStepMs: params.minModelStepMs ?? STEP_MIN_MS,
    leaseTtlMs: LEASE_TTL_MS,
    maxSteps: params.maxSteps,
  });
}

/** The investigation, synthesis or review did not complete: no report is delivered and the credit is released. */
export function isFatal(report: ForensicReport): boolean {
  return report.stages.some((s) => s.status === "FAILED" && (s.stage === "INVESTIGATION" || s.stage === "SYNTHESIS" || s.stage === "ADVERSARIAL_REVIEW"));
}

/** Same shape as runSectionedAnalysis's result, so the route's cost logging is unchanged. */
export function engineRunShape(report: ForensicReport, documents: CaseDocument[]) {
  const usageByModel: Record<string, { input_tokens: number; output_tokens: number }> = {};
  for (const s of report.stages) {
    if (!s.model || s.calls === 0) continue;
    const u = (usageByModel[s.model] ??= { input_tokens: 0, output_tokens: 0 });
    u.input_tokens += s.inputTokens;
    u.output_tokens += s.outputTokens;
  }
  return {
    report: toLegacyReport(report, documents),
    usageByModel,
    sectionTimingsMs: Object.fromEntries(report.stages.map((s) => [s.stage.toLowerCase(), s.durationMs])),
    attempts: Object.fromEntries(report.stages.map((s) => [s.stage.toLowerCase(), s.calls])),
    engine: report,
  };
}

export interface CreditOps {
  finalize: () => Promise<unknown>;
  /** Reserve again under the same request id. Returns the new reservation's billing cycle. */
  reserveAgain: () => Promise<{ billingCycle: string | null }>;
}

/**
 * Charges a delivered report exactly once. Idempotent: a second call after a DELIVERED marker does nothing.
 * Throws LifecycleError 402 ANALYSIS_LIMIT_REACHED when the reservation lapsed and no allowance is left.
 */
export async function settleDelivered(store: CheckpointStore, meta: EngineJobMeta, ops: CreditOps): Promise<"CHARGED" | "ALREADY_SETTLED" | "NOT_BILLED"> {
  const prior = await store.settled(meta.jobId);
  if (prior?.kind === "DELIVERED") return "ALREADY_SETTLED";
  if (prior?.kind === "RELEASED") throw new LifecycleError(409, "RESERVATION_RELEASED", "This analysis was cancelled. Please start a new analysis.");
  if (meta.billing === "admin") {
    await store.settle(meta.jobId, { kind: "DELIVERED", at: Date.now() });
    return "NOT_BILLED";
  }
  try {
    await ops.finalize();
  } catch (err) {
    if (!(err instanceof LifecycleError) || (err.code !== "RESERVATION_RELEASED" && err.code !== "RESERVATION_MISSING")) throw err;
    await ops.reserveAgain(); // throws 402 when the allowance is used up
    await ops.finalize();
  }
  await store.settle(meta.jobId, { kind: "DELIVERED", at: Date.now() });
  return "CHARGED";
}

/** Releases the credit of a job that failed. Idempotent; never releases a delivered job. */
export async function settleFailed(store: CheckpointStore, meta: EngineJobMeta, release: () => Promise<void>): Promise<boolean> {
  const prior = await store.settled(meta.jobId);
  if (prior) return false;
  if (!(await store.settle(meta.jobId, { kind: "RELEASED", at: Date.now() }))) return false;
  if (meta.billing === "paid") await release();
  return true;
}

export type { AdvanceResult };
