// The saved-job pointer that lets a reload or a browser restart resume the same analysis. These tests use
// an in-memory storage that stands in for localStorage: a "reload" is a fresh read from the same storage.
import { describe, expect, it } from "vitest";
import {
  SAVED_ANALYSIS_JOB_KEY,
  forgetAnalysisJobId,
  keepsSavedJobAfterError,
  readSavedAnalysisJobId,
  saveAnalysisJobId,
  type JobStorage,
} from "./analysisJobResume";

function memoryStorage(): JobStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwingStorage: JobStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const JOB = "req_1700000000000_abcd1234";

describe("saved analysis job", () => {
  it("survives a reload: the id saved before the reload is read back from the same storage", () => {
    const storage = memoryStorage();
    saveAnalysisJobId(JOB, storage);
    expect(storage.data.get(SAVED_ANALYSIS_JOB_KEY)).toBe(JOB);
    // A fresh page load reads the stored id again.
    expect(readSavedAnalysisJobId(storage)).toBe(JOB);
  });

  it("is forgotten once the outcome is known, so a later load does not poll it again", () => {
    const storage = memoryStorage();
    saveAnalysisJobId(JOB, storage);
    forgetAnalysisJobId(storage);
    expect(readSavedAnalysisJobId(storage)).toBeNull();
  });

  it("reads as none when nothing was saved, or when storage is unavailable", () => {
    expect(readSavedAnalysisJobId(memoryStorage())).toBeNull();
    expect(readSavedAnalysisJobId(throwingStorage)).toBeNull();
    expect(readSavedAnalysisJobId(null)).toBeNull();
  });

  it("does not throw when storage refuses a write or a removal", () => {
    expect(() => saveAnalysisJobId(JOB, throwingStorage)).not.toThrow();
    expect(() => forgetAnalysisJobId(throwingStorage)).not.toThrow();
  });
});

describe("which failures keep the saved job", () => {
  it("keeps it only for a sign-in problem", () => {
    expect(keepsSavedJobAfterError("SIGN_IN_REQUIRED")).toBe(true);
  });

  it("discards it for every other outcome, so a later Retry starts fresh", () => {
    for (const code of ["RECOVERY_TIMEOUT", "NETWORK_ERROR", "FORBIDDEN", "JOB_NOT_FOUND", "AI_RATE_LIMITED", "ANALYSIS_ID_CONFLICT", "CANCELLED", null, undefined]) {
      expect(keepsSavedJobAfterError(code), String(code)).toBe(false);
    }
  });

  it("a sign-in problem followed by a reload still resumes the same job id", () => {
    const storage = memoryStorage();
    saveAnalysisJobId(JOB, storage);
    // The poll fails with SIGN_IN_REQUIRED: the saved id is kept.
    if (!keepsSavedJobAfterError("SIGN_IN_REQUIRED")) forgetAnalysisJobId(storage);
    // After the browser restarts and the parent signs in, the same job is read back.
    expect(readSavedAnalysisJobId(storage)).toBe(JOB);
  });
});
