// Behaviour of the shared runner that Quick Review, Forensic In-Depth, bulk processing and Deep Scan all use.
import { describe, expect, it, vi } from "vitest";
import { ApiResponseError, STREAM_INTERRUPTED } from "./api";
import { failureInputOf, runAnalysisWithRetry } from "./analysisRetry";

const noSleep = async () => undefined;
const REPORT = { ok: true };

describe("runAnalysisWithRetry", () => {
  it("returns the first result without retrying", async () => {
    const attempt = vi.fn(async () => REPORT);
    const recover = vi.fn();
    await expect(runAnalysisWithRetry({ attempt, recover, sleep: noSleep })).resolves.toBe(REPORT);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
  });

  it("after a dropped connection it recovers the saved job, and does not start the analysis again", async () => {
    const attempt = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const recover = vi.fn(async () => REPORT);
    await expect(runAnalysisWithRetry({ attempt, recover, sleep: noSleep })).resolves.toBe(REPORT);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("a stream interruption is recovered, not resubmitted", async () => {
    const attempt = vi.fn(async () => {
      throw new ApiResponseError("interrupted", 0, STREAM_INTERRUPTED, true);
    });
    const recover = vi.fn(async () => REPORT);
    await runAnalysisWithRetry({ attempt, recover, sleep: noSleep });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("an AI_RESPONSE_INVALID failure is retried once, the same way on every path", async () => {
    const invalid = () => new ApiResponseError("could not be formatted", 422, "AI_RESPONSE_INVALID", true);
    const attempt = vi.fn().mockRejectedValueOnce(invalid()).mockResolvedValueOnce(REPORT);
    await expect(runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep: noSleep })).resolves.toBe(REPORT);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up on AI_RESPONSE_INVALID after its attempt budget", async () => {
    const attempt = vi.fn(async () => {
      throw new ApiResponseError("invalid", 422, "AI_RESPONSE_INVALID", true);
    });
    await expect(runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep: noSleep })).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
    expect(attempt).toHaveBeenCalledTimes(2); // the first attempt plus the one retry the budget allows
  });

  it("a refusal (not retryable) is never retried", async () => {
    const attempt = vi.fn(async () => {
      throw new ApiResponseError("declined", 422, "AI_RESPONSE_INVALID", false);
    });
    await expect(runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep: noSleep })).rejects.toThrow("declined");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("a usage limit or sign-in failure is never retried", async () => {
    const attempt = vi.fn(async () => {
      throw new ApiResponseError("limit", 402, "USAGE_LIMIT_REACHED", false);
    });
    await expect(runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep: noSleep })).rejects.toMatchObject({ status: 402 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("an ANALYSIS_IN_PROGRESS answer is recovered, not started again", async () => {
    const attempt = vi.fn(async () => {
      throw new ApiResponseError("running", 409, "ANALYSIS_IN_PROGRESS", false);
    });
    const recover = vi.fn(async () => REPORT);
    await expect(runAnalysisWithRetry({ attempt, recover, sleep: noSleep })).resolves.toBe(REPORT);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("a rate limit waits before retrying and reports the wait", async () => {
    const onWait = vi.fn();
    const sleep = vi.fn(async () => undefined);
    const attempt = vi.fn().mockRejectedValueOnce(new ApiResponseError("slow down", 429, null, true, true)).mockResolvedValueOnce(REPORT);
    await runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep, onWait });
    expect(sleep).toHaveBeenCalledWith(30000);
    expect(onWait).toHaveBeenCalledWith(expect.objectContaining({ kind: "RATE_LIMITED", waitMs: 30000 }));
  });

  it("a cancelled run stops without another attempt", async () => {
    let cancelled = false;
    const attempt = vi.fn(async () => {
      cancelled = true;
      throw new TypeError("aborted");
    });
    await expect(runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep: noSleep, isCancelled: () => cancelled })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("a job the server never recorded is resubmitted, with the same analysis id in the caller's closure", async () => {
    const recover = vi.fn(async () => {
      throw new ApiResponseError("never started", 404, "JOB_NOT_FOUND", false);
    });
    const attempt = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(REPORT);
    await expect(runAnalysisWithRetry({ attempt, recover, sleep: noSleep })).resolves.toBe(REPORT);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("the total number of attempts is bounded even when every failure is retryable", async () => {
    const attempt = vi.fn(async () => {
      throw new ApiResponseError("busy", 503, null, true);
    });
    await expect(runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep: noSleep })).rejects.toThrow("busy");
    expect(attempt.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("an unknown error (not a response, not a network failure) is not retried", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("Text extraction failed");
    });
    await expect(runAnalysisWithRetry({ attempt, recover: vi.fn(), sleep: noSleep })).rejects.toThrow("Text extraction failed");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("failureInputOf", () => {
  it("maps a network TypeError to a network failure, and an unknown error to permanent", () => {
    expect(failureInputOf(new TypeError("x"))).toEqual({ network: true });
    expect(failureInputOf(new Error("x"))).toEqual({ retryable: false });
  });
});

// Guard: every request that starts an analysis or a Deep Scan must carry an analysis id. Without one, a retry after a
// lost response starts (and can charge for) a second analysis, which is the defect this policy exists to prevent.
describe("every analysis request carries an analysis id", () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../components/DocumentAnalyzerTab.tsx"), "utf8") as string;
  for (const route of ["/api/analyze", "/api/deep-scan"]) {
    it(`each apiFetch to ${route} sends X-Analysis-Id`, () => {
      const calls = [...source.matchAll(new RegExp(`apiFetch\\("${route}"`, "g"))];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const window = source.slice(call.index ?? 0, (call.index ?? 0) + 500);
        expect(window, `call at offset ${call.index}`).toMatch(/X-Analysis-Id/);
      }
    });
  }
});
