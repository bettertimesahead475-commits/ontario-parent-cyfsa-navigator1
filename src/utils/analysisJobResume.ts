// The analysis job a browser is waiting on is remembered in localStorage, so a reload or a restart of
// the browser can pick it up again and poll the same job. Nothing here starts, charges for, or re-sends
// an analysis: it only stores and reads the job id, and decides which failures keep that id.

export const SAVED_ANALYSIS_JOB_KEY = "OPA_ACTIVE_ANALYZER_JOB_ID";

/** Storage the page can use. Private windows and blocked site data can make these accessors throw. */
export interface JobStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): JobStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved job id, or null when there is none or storage is unavailable. */
export function readSavedAnalysisJobId(storage: JobStorage | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(SAVED_ANALYSIS_JOB_KEY) || null;
  } catch {
    return null;
  }
}

/** Remembers the job a browser is waiting on. Failure to store is not fatal: the job can still be polled this session. */
export function saveAnalysisJobId(id: string, storage: JobStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SAVED_ANALYSIS_JOB_KEY, id);
  } catch {
    // Storage refused the write (quota, private mode). The job still runs; a reload just cannot resume it.
  }
}

/** Forgets the saved job. Called only once the outcome is known: completed, failed, or not started. */
export function forgetAnalysisJobId(storage: JobStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SAVED_ANALYSIS_JOB_KEY);
  } catch {
    // Nothing to do: a stale id is re-checked on the next load and then cleared.
  }
}

/** The error code that means the parent must sign in again before the job can be seen. */
export const SIGN_IN_REQUIRED_CODE = "SIGN_IN_REQUIRED";

/**
 * Outcomes where the server may still hold the analysis, or where the browser cannot tell: the connection
 * dropped, polling ran out of time, the job is still running, or the server has no record of it. The saved
 * id is kept so the same job can be checked again. A new analysis id is never used for these.
 */
export const UNCERTAIN_OUTCOME_CODES: ReadonlySet<string> = new Set([
  "NETWORK_ERROR",
  "STREAM_INTERRUPTED",
  "RECOVERY_TIMEOUT",
  "ANALYSIS_IN_PROGRESS",
  "JOB_NOT_FOUND",
]);

/**
 * Whether a failure keeps the saved job. A sign-in problem and every uncertain outcome keep it: the analysis
 * may be running or already paid for, so the same job is resumed. Any other outcome is final, or reported
 * with its own action, and the saved id is forgotten.
 */
export function keepsSavedJobAfterError(code: string | null | undefined): boolean {
  return (
    code === SIGN_IN_REQUIRED_CODE ||
    code === "ANALYSIS_ALREADY_COMPLETED" ||
    (code != null && UNCERTAIN_OUTCOME_CODES.has(code))
  );
}

/** The state a browser is in, as the parent should see it. */
export type RecoveryState = "sign_in" | "network" | "processing" | "unavailable" | "completed" | "failed";

/**
 * Maps a server or client code to the state shown. Returns null for codes that are not recovery states
 * (for example a refused request), which keep their own message.
 */
export function recoveryStateFor(code: string | null | undefined): RecoveryState | null {
  switch (code) {
    case SIGN_IN_REQUIRED_CODE:
      return "sign_in";
    case "NETWORK_ERROR":
    case "STREAM_INTERRUPTED":
      return "network";
    case "RECOVERY_TIMEOUT":
    case "ANALYSIS_IN_PROGRESS":
      return "processing";
    case "JOB_NOT_FOUND":
      return "unavailable";
    case "ANALYSIS_ALREADY_COMPLETED":
      return "completed";
    default:
      return null;
  }
}

/**
 * What the parent is told in each state. Wording makes only claims the code supports: nothing is said to be
 * uncharged, and "charged at most once" is said only for a paid analysis, which reuses one request id.
 */
export function recoveryCopy(state: RecoveryState): { title: string; body: string } {
  switch (state) {
    case "sign_in":
      return {
        title: "Sign in to see your analysis",
        body: "Your analysis is saved and was not started again. Sign in and it will be shown.",
      };
    case "network":
      return {
        title: "The server is unavailable right now",
        body: "Your analysis may still be running. Nothing was started again. Check again when your connection is back.",
      };
    case "processing":
      return {
        title: "Analysis still processing",
        body: "The analysis is running on the server. The result will be shown when it finishes.",
      };
    case "unavailable":
      return {
        title: "The server has no record of this analysis",
        body: "Starting again reuses the same request, so a paid analysis is charged at most once.",
      };
    case "completed":
      return { title: "Analysis completed", body: "Your report is ready." };
    case "failed":
      return { title: "Analysis failed", body: "The analysis could not be completed. Its credit is released, so you can try again." };
  }
}

/** States that keep the saved job and offer the banner. Completed and failed never keep it. */
export function showsSavedJobBanner(state: RecoveryState | null): boolean {
  return state === "sign_in" || state === "network" || state === "processing" || state === "unavailable";
}

/**
 * The analysis id a Retry or Start-again sends. The id is reused whenever this browser already started this
 * file's analysis and has not seen it complete. The server answers a repeated id from its saved record: a
 * completed report is returned, a running analysis is reported as in progress, and a released attempt runs
 * again under one credit reservation (see the paid-credit tests). A fresh id is used only for a file this
 * browser has not started yet.
 */
export function analysisIdForRetry(
  knownIdForFile: string | undefined,
  createFreshId: () => string
): string {
  return knownIdForFile ?? createFreshId();
}
