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
 * Whether a failure keeps the saved job. Only a sign-in problem does. The analysis may still be running
 * or already paid for, so it is resumed after sign-in. Every other outcome is final, or is reported with
 * its own action, and the saved id is forgotten.
 */
export function keepsSavedJobAfterError(code: string | null | undefined): boolean {
  return code === SIGN_IN_REQUIRED_CODE;
}
