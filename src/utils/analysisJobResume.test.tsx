// The saved-job pointer that lets a reload or a browser restart resume the same analysis. These tests use
// an in-memory storage that stands in for localStorage: a "reload" is a fresh read from the same storage.
import { describe, expect, it } from "vitest";
import {
  SAVED_ANALYSIS_JOB_KEY,
  analysisIdForRetry,
  forgetAnalysisJobId,
  keepsSavedJobAfterError,
  readSavedAnalysisJobId,
  recoveryCopy,
  recoveryStateFor,
  saveAnalysisJobId,
  showsSavedJobBanner,
  type JobStorage,
  type RecoveryState,
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

describe("which outcomes keep the saved job", () => {
  it("keeps it for a sign-in problem", () => {
    expect(keepsSavedJobAfterError("SIGN_IN_REQUIRED")).toBe(true);
  });

  it("keeps it for every uncertain outcome: the connection dropped, polling timed out, still running, or no record", () => {
    for (const code of ["NETWORK_ERROR", "STREAM_INTERRUPTED", "RECOVERY_TIMEOUT", "ANALYSIS_IN_PROGRESS", "JOB_NOT_FOUND"]) {
      expect(keepsSavedJobAfterError(code), code).toBe(true);
    }
  });

  it("keeps it when the server says the analysis already completed, so the saved report can be opened", () => {
    expect(keepsSavedJobAfterError("ANALYSIS_ALREADY_COMPLETED")).toBe(true);
  });

  it("discards it for final or unrelated outcomes", () => {
    for (const code of ["FORBIDDEN", "AI_RATE_LIMITED", "ANALYSIS_ID_CONFLICT", "CANCELLED", null, undefined]) {
      expect(keepsSavedJobAfterError(code), String(code)).toBe(false);
    }
  });

  it("a sign-in or network problem, then a reload, still resumes the same job id", () => {
    const storage = memoryStorage();
    saveAnalysisJobId(JOB, storage);
    if (!keepsSavedJobAfterError("NETWORK_ERROR")) forgetAnalysisJobId(storage);
    expect(readSavedAnalysisJobId(storage)).toBe(JOB);
  });
});

describe("recovery states the parent sees", () => {
  it("maps each uncertain or sign-in code to its own state, so they are never shown as the same problem", () => {
    expect(recoveryStateFor("SIGN_IN_REQUIRED")).toBe("sign_in");
    expect(recoveryStateFor("NETWORK_ERROR")).toBe("network");
    expect(recoveryStateFor("STREAM_INTERRUPTED")).toBe("network");
    expect(recoveryStateFor("RECOVERY_TIMEOUT")).toBe("processing");
    expect(recoveryStateFor("ANALYSIS_IN_PROGRESS")).toBe("processing");
    expect(recoveryStateFor("JOB_NOT_FOUND")).toBe("unavailable");
    expect(recoveryStateFor("ANALYSIS_ALREADY_COMPLETED")).toBe("completed");
    expect(recoveryStateFor("FORBIDDEN")).toBeNull();
  });

  it("shows the saved-job banner only where the job may still be on the server", () => {
    const shown: RecoveryState[] = ["sign_in", "network", "processing", "unavailable"];
    for (const state of shown) expect(showsSavedJobBanner(state), state).toBe(true);
    expect(showsSavedJobBanner("completed")).toBe(false);
    expect(showsSavedJobBanner("failed")).toBe(false);
    expect(showsSavedJobBanner(null)).toBe(false);
  });

  it("every state has its own wording, and no state claims a charge that was not verified", () => {
    const states: RecoveryState[] = ["sign_in", "network", "processing", "unavailable", "completed", "failed"];
    const titles = new Set(states.map((s) => recoveryCopy(s).title));
    expect(titles.size).toBe(states.length);
    for (const state of states) {
      const { body } = recoveryCopy(state);
      expect(body, state).not.toMatch(/nothing was charged|not charged|no credit was used/i);
    }
  });

  it("only the unavailable state talks about charging, and only to say a repeated request is charged at most once", () => {
    const charging = (["sign_in", "network", "processing", "unavailable", "completed", "failed"] as RecoveryState[])
      .filter((s) => /charged/i.test(recoveryCopy(s).body));
    expect(charging).toEqual(["unavailable"]);
    expect(recoveryCopy("unavailable").body).toMatch(/charged at most once/);
  });

  it("network and processing states say nothing was started again, and that the job may still run", () => {
    expect(recoveryCopy("network").body).toMatch(/may still be running/);
    expect(recoveryCopy("network").body).toMatch(/Nothing was started again/);
    expect(recoveryCopy("processing").body).toMatch(/running on the server/);
  });
});

describe("which analysis id a retry sends", () => {
  it("reuses the id this browser already started for the file", () => {
    expect(analysisIdForRetry("req_1700000000000_abcd1234", () => "req_fresh")).toBe("req_1700000000000_abcd1234");
  });

  it("uses a fresh id only for a file this browser has not started", () => {
    expect(analysisIdForRetry(undefined, () => "req_fresh")).toBe("req_fresh");
  });
});
