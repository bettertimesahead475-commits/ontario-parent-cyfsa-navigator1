/**
 * One retry policy for every analysis path: Quick Review, Forensic In-Depth, bulk processing, and Deep Scan. Pure, so the
 * server and the browser make the same decision for the same failure.
 *
 * Two rules sit above everything else:
 * 1. Every attempt for one analysis reuses one analysis id (X-Analysis-Id). The server then recognises a retry: it
 *    returns the saved report, or says the analysis is already running, instead of charging a second time.
 * 2. Once the server has accepted an analysis, a dropped connection or an unclear response is recovered by following
 *    the saved job. It is not resubmitted as a new analysis.
 */

/** The only id shape the server accepts (api/services/analyzerStreaming.ts uses the same pattern). */
export const ANALYSIS_JOB_ID_PATTERN = /^req_\d{10,16}_[a-z0-9]{4,24}$/i;

export function isAnalysisJobId(id: unknown): id is string {
  return typeof id === "string" && ANALYSIS_JOB_ID_PATTERN.test(id);
}

/**
 * A new analysis id in the server's format. The random part is always at least 8 characters, so the id is never rejected
 * and silently replaced (which would defeat the retry protection).
 */
export function newAnalysisJobId(now: number = Date.now(), random: () => number = Math.random): string {
  let token = "";
  // Bounded, so a degenerate random source cannot loop forever; the fallback still yields a valid id.
  for (let i = 0; i < 16 && token.length < 8; i++) token += random().toString(36).slice(2);
  if (token.length < 8) token = token.padEnd(8, "x");
  return `req_${now}_${token.slice(0, 12)}`;
}

/** HTTP statuses that mean the server or provider was briefly unavailable. The server maps these the same way. */
export const TRANSIENT_HTTP_STATUSES: readonly number[] = [408, 500, 502, 503, 504, 529];
export const RATE_LIMIT_STATUS = 429;

export type FailureKind =
  | "CANCELLED"
  | "NETWORK_INTERRUPTED"
  | "ALREADY_RUNNING"
  | "ALREADY_COMPLETED"
  | "NOT_STARTED"
  | "RATE_LIMITED"
  | "TRANSIENT_SERVER"
  | "INVALID_OUTPUT"
  | "PERMANENT";

/** What to do next. RECOVER_JOB follows the saved job; RESUBMIT starts another attempt with the same analysis id. */
export type RetryAction = "STOP" | "RESUBMIT" | "RECOVER_JOB";

export interface FailureInput {
  status?: number | null;
  code?: string | null;
  /** The server's own answer about retrying. Honoured when the rules above do not decide. */
  retryable?: boolean | null;
  /** The request failed before a response, or the response stream was interrupted. */
  network?: boolean;
  cancelled?: boolean;
}

export interface FailureDecision {
  kind: FailureKind;
  action: RetryAction;
  reason: string;
}

/** Decides what to do after one failed attempt. Pure: the same input always gives the same decision. */
export function classifyFailure(f: FailureInput): FailureDecision {
  const code = f.code ?? null;
  const status = f.status ?? null;
  if (f.cancelled || code === "CANCELLED") {
    return { kind: "CANCELLED", action: "STOP", reason: "The parent stopped waiting." };
  }
  if (f.network || code === "STREAM_INTERRUPTED" || code === "NETWORK_ERROR") {
    return { kind: "NETWORK_INTERRUPTED", action: "RECOVER_JOB", reason: "The connection was interrupted. The analysis may still be running." };
  }
  if (status === 409 && code === "ANALYSIS_IN_PROGRESS") {
    return { kind: "ALREADY_RUNNING", action: "RECOVER_JOB", reason: "This analysis is already running on the server." };
  }
  if (status === 409 && code === "ANALYSIS_ALREADY_COMPLETED") {
    return { kind: "ALREADY_COMPLETED", action: "RECOVER_JOB", reason: "This analysis already finished. Its saved report is recovered." };
  }
  if (code === "JOB_NOT_FOUND") {
    return { kind: "NOT_STARTED", action: "RESUBMIT", reason: "The server has no record of this analysis, so nothing was started or charged." };
  }
  if (status === RATE_LIMIT_STATUS || code === "AI_RATE_LIMITED") {
    return { kind: "RATE_LIMITED", action: "RESUBMIT", reason: "The AI service is rate-limited." };
  }
  if (code === "AI_RESPONSE_INVALID") {
    // A failed analysis releases its credit on the server, so one more attempt costs nothing when it fails.
    return f.retryable === false
      ? { kind: "PERMANENT", action: "STOP", reason: "The analysis was refused." }
      : { kind: "INVALID_OUTPUT", action: "RESUBMIT", reason: "The AI response was not usable. A fresh attempt may succeed." };
  }
  if (f.retryable === false) {
    return { kind: "PERMANENT", action: "STOP", reason: "This cannot succeed by retrying (for example, sign-in, a usage limit, or an unreadable document)." };
  }
  if ((status !== null && TRANSIENT_HTTP_STATUSES.includes(status)) || code === "AI_PROVIDER_TEMPORARILY_UNAVAILABLE" || code === "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE") {
    return { kind: "TRANSIENT_SERVER", action: "RESUBMIT", reason: "The service was briefly unavailable." };
  }
  if (f.retryable === true) {
    return { kind: "TRANSIENT_SERVER", action: "RESUBMIT", reason: "The server said this can be retried." };
  }
  return { kind: "PERMANENT", action: "STOP", reason: "The failure is not known to be temporary." };
}

/**
 * Retries allowed for each kind within one analysis run, not counting the first attempt. So TRANSIENT_SERVER: 2 means at
 * most three requests in total. The overall total is capped by MAX_TOTAL_ATTEMPTS.
 */
export const RETRY_LIMITS: Record<FailureKind, number> = {
  CANCELLED: 0,
  NETWORK_INTERRUPTED: 3,
  ALREADY_RUNNING: 4,
  ALREADY_COMPLETED: 2,
  NOT_STARTED: 2,
  RATE_LIMITED: 2,
  TRANSIENT_SERVER: 2,
  INVALID_OUTPUT: 1,
  PERMANENT: 0,
};

export const MAX_TOTAL_ATTEMPTS = 6;

/**
 * Server-side attempt budgets, shared so every analysis stage stays in step. A stage that still fails after its budget
 * fails the analysis honestly; it does not ship a partial report.
 */
export const SECTION_ATTEMPTS = 2;
export const VERIFICATION_ATTEMPTS = 2;
export const PROVIDER_ATTEMPTS = 2;

/** Wait before the next attempt, given how many times this kind has now occurred. */
export function retryWaitMs(kind: FailureKind, occurrence: number): number {
  const ladder: Record<FailureKind, number[]> = {
    CANCELLED: [0],
    NETWORK_INTERRUPTED: [3000, 6000, 12000],
    ALREADY_RUNNING: [3000, 5000, 8000, 12000],
    ALREADY_COMPLETED: [0, 0],
    NOT_STARTED: [2000, 4000],
    RATE_LIMITED: [30000, 60000],
    TRANSIENT_SERVER: [2000, 4000, 8000],
    INVALID_OUTPUT: [2000, 4000],
    PERMANENT: [0],
  };
  const steps = ladder[kind];
  return steps[Math.min(Math.max(occurrence, 1) - 1, steps.length - 1)];
}

/** Whether a further attempt of this kind is allowed, given its occurrence count and the running total of attempts made. */
export function mayRetry(kind: FailureKind, occurrence: number, totalAttempts: number): boolean {
  return occurrence <= RETRY_LIMITS[kind] && totalAttempts < MAX_TOTAL_ATTEMPTS;
}
