/**
 * Runs one analysis with the shared retry policy (shared/analyzerRetryPolicy.ts). Quick Review, Forensic In-Depth,
 * bulk processing and Deep Scan all use this, so the same failure gets the same treatment on every path.
 *
 * The caller supplies two functions:
 *  - attempt: one request for this analysis, carrying the analysis id.
 *  - recover: follows the saved job for that id. Used after an interruption or when the server reports the analysis is
 *    already running or finished. It never starts a new analysis by itself.
 */
import { classifyFailure, mayRetry, retryWaitMs, type FailureInput, type FailureKind } from "../../shared/analyzerRetryPolicy";
import { apiFetch, ApiResponseError, pollAnalysisJob, STREAM_INTERRUPTED, type AnalysisJobSnapshot } from "./api";

/** What a failure looked like to the policy. An error that is not a known response or network failure is permanent. */
export function failureInputOf(error: unknown): FailureInput {
  if (error instanceof ApiResponseError) {
    if (error.code === "CANCELLED") return { cancelled: true };
    return {
      status: error.status,
      code: error.code,
      retryable: error.retryable,
      network: error.code === STREAM_INTERRUPTED || error.code === "NETWORK_ERROR",
    };
  }
  if (error instanceof TypeError) return { network: true };
  return { retryable: false };
}

export interface AnalysisRetryWait {
  kind: FailureKind;
  waitMs: number;
  reason: string;
  /** How many attempts (of any kind) have been made so far. */
  attempts: number;
}

export interface RunAnalysisOptions<T> {
  attempt: () => Promise<T>;
  recover: () => Promise<T>;
  isCancelled?: () => boolean;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
  onWait?: (wait: AnalysisRetryWait) => void;
}

export async function runAnalysisWithRetry<T>(options: RunAnalysisOptions<T>): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const occurrences: Partial<Record<FailureKind, number>> = {};
  let attempts = 0;
  let mode: "attempt" | "recover" = "attempt";

  while (true) {
    if (options.isCancelled?.()) throw new ApiResponseError("Cancelled.", 0, "CANCELLED", false);
    try {
      attempts++;
      return mode === "attempt" ? await options.attempt() : await options.recover();
    } catch (error) {
      const decision = classifyFailure(failureInputOf(error));
      if (decision.action === "STOP") throw error;
      const occurrence = (occurrences[decision.kind] ?? 0) + 1;
      occurrences[decision.kind] = occurrence;
      if (!mayRetry(decision.kind, occurrence, attempts)) throw error;
      const waitMs = retryWaitMs(decision.kind, occurrence);
      options.onWait?.({ kind: decision.kind, waitMs, reason: decision.reason, attempts });
      if (waitMs > 0) await sleep(waitMs);
      mode = decision.action === "RECOVER_JOB" ? "recover" : "attempt";
    }
  }
}

/** Follows the saved job for an analysis id. Resolves to the report, or throws ApiResponseError with the job's failure. */
export async function recoverAnalysisReport(
  analysisId: string,
  options: { isCancelled?: () => boolean; onProgress?: (job: AnalysisJobSnapshot) => void } = {}
): Promise<any> {
  const outcome = await pollAnalysisJob(analysisId, {
    onProgress: options.onProgress,
    isCancelled: options.isCancelled,
    fetcher: apiFetch,
  });
  if (outcome.status === "completed") return outcome.report;
  throw new ApiResponseError(outcome.error.message, outcome.error.statusCode, outcome.error.code, outcome.error.retryable);
}
