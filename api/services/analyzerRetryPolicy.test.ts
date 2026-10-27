// Regression tests for shared/analyzerRetryPolicy.ts: the one decision every analysis path uses.
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_JOB_ID_PATTERN,
  classifyFailure,
  isAnalysisJobId,
  mayRetry,
  MAX_TOTAL_ATTEMPTS,
  newAnalysisJobId,
  retryWaitMs,
} from "../../shared/analyzerRetryPolicy";
import { isValidAnalysisJobId } from "./analyzerStreaming";

describe("analysis ids", () => {
  it("every generated id is accepted by the server's validator", () => {
    for (let i = 0; i < 200; i++) {
      const id = newAnalysisJobId();
      expect(isAnalysisJobId(id), id).toBe(true);
      expect(isValidAnalysisJobId(id), id).toBe(true);
    }
  });

  it("the client and server use the same pattern", () => {
    expect(ANALYSIS_JOB_ID_PATTERN.source).toBe("^req_\\d{10,16}_[a-z0-9]{4,24}$");
  });

  it("pads a degenerate random source rather than producing an id the server would reject", () => {
    const id = newAnalysisJobId(1_700_000_000_000, () => 0.5);
    expect(isAnalysisJobId(id)).toBe(true);
  });

  it("a degenerate random source that yields nothing still terminates with a valid id", () => {
    const id = newAnalysisJobId(1_700_000_000_000, () => 0);
    expect(isAnalysisJobId(id)).toBe(true);
  });

  it("rejects ids the server would replace", () => {
    expect(isAnalysisJobId("req_123_abc")).toBe(false);
    expect(isAnalysisJobId("not-an-id")).toBe(false);
  });
});

describe("classifyFailure: stopping", () => {
  it("a cancelled wait stops", () => {
    expect(classifyFailure({ cancelled: true }).action).toBe("STOP");
    expect(classifyFailure({ code: "CANCELLED" }).action).toBe("STOP");
  });

  it("sign-in, usage-limit, forensic-upgrade and unreadable-document failures never retry", () => {
    expect(classifyFailure({ status: 401, code: "ACCESS_DENIED", retryable: false }).action).toBe("STOP");
    expect(classifyFailure({ status: 402, code: "USAGE_LIMIT_REACHED", retryable: false }).action).toBe("STOP");
    expect(classifyFailure({ status: 403, code: "FORENSIC_UPGRADE_REQUIRED", retryable: false }).action).toBe("STOP");
    expect(classifyFailure({ status: 422, code: "EXTRACTION_FAILED", retryable: false }).action).toBe("STOP");
  });

  it("a refusal (AI_RESPONSE_INVALID marked not retryable) stops", () => {
    expect(classifyFailure({ status: 422, code: "AI_RESPONSE_INVALID", retryable: false }).action).toBe("STOP");
  });

  it("an error with no information is permanent", () => {
    expect(classifyFailure({}).kind).toBe("PERMANENT");
    expect(classifyFailure({}).action).toBe("STOP");
  });
});

describe("classifyFailure: recovering a saved job, never resubmitting it", () => {
  it("a dropped connection recovers the job", () => {
    expect(classifyFailure({ network: true })).toMatchObject({ kind: "NETWORK_INTERRUPTED", action: "RECOVER_JOB" });
    expect(classifyFailure({ code: "STREAM_INTERRUPTED" }).action).toBe("RECOVER_JOB");
    expect(classifyFailure({ code: "NETWORK_ERROR" }).action).toBe("RECOVER_JOB");
  });

  it("an analysis the server says is already running is recovered, not started again", () => {
    expect(classifyFailure({ status: 409, code: "ANALYSIS_IN_PROGRESS" })).toMatchObject({ kind: "ALREADY_RUNNING", action: "RECOVER_JOB" });
  });

  it("an analysis the server says already finished is recovered", () => {
    expect(classifyFailure({ status: 409, code: "ANALYSIS_ALREADY_COMPLETED" })).toMatchObject({ kind: "ALREADY_COMPLETED", action: "RECOVER_JOB" });
  });

  it("an analysis the server never recorded can safely be submitted again", () => {
    expect(classifyFailure({ status: 404, code: "JOB_NOT_FOUND" })).toMatchObject({ kind: "NOT_STARTED", action: "RESUBMIT" });
  });
});

describe("classifyFailure: resubmitting a transient failure", () => {
  it("rate limits are resubmitted", () => {
    expect(classifyFailure({ status: 429, code: "AI_RATE_LIMITED" })).toMatchObject({ kind: "RATE_LIMITED", action: "RESUBMIT" });
    expect(classifyFailure({ status: 429 }).kind).toBe("RATE_LIMITED");
  });

  it("temporary provider and server outages are resubmitted", () => {
    for (const status of [408, 500, 502, 503, 504, 529]) {
      expect(classifyFailure({ status, retryable: true }).kind, String(status)).toBe("TRANSIENT_SERVER");
    }
    expect(classifyFailure({ code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE" }).action).toBe("RESUBMIT");
  });

  it("a usable-output failure is resubmitted once: the server releases the credit when an attempt fails", () => {
    expect(classifyFailure({ status: 422, code: "AI_RESPONSE_INVALID", retryable: true })).toMatchObject({ kind: "INVALID_OUTPUT", action: "RESUBMIT" });
  });

  it("a server that says a failure is retryable is trusted when no rule above applies", () => {
    expect(classifyFailure({ status: 418, retryable: true }).action).toBe("RESUBMIT");
  });

  it("a client error that is not temporary is not retried", () => {
    expect(classifyFailure({ status: 400, retryable: false }).action).toBe("STOP");
    expect(classifyFailure({ status: 404, code: "EMPTY_DOCUMENT" }).action).toBe("STOP");
  });
});

describe("attempt budgets and waits", () => {
  it("each kind has a bounded number of attempts, and a total cap applies", () => {
    expect(mayRetry("INVALID_OUTPUT", 1, 1)).toBe(true);
    expect(mayRetry("INVALID_OUTPUT", 2, 2)).toBe(false);
    expect(mayRetry("TRANSIENT_SERVER", 2, 1)).toBe(true);
    expect(mayRetry("TRANSIENT_SERVER", 3, 3)).toBe(false);
    expect(mayRetry("TRANSIENT_SERVER", 1, MAX_TOTAL_ATTEMPTS)).toBe(false);
    expect(mayRetry("PERMANENT", 1, 1)).toBe(false);
  });

  it("waits grow with each occurrence and never fall below zero", () => {
    expect(retryWaitMs("TRANSIENT_SERVER", 1)).toBeLessThan(retryWaitMs("TRANSIENT_SERVER", 3));
    expect(retryWaitMs("RATE_LIMITED", 1)).toBeGreaterThanOrEqual(30000);
    expect(retryWaitMs("PERMANENT", 1)).toBe(0);
  });
});
