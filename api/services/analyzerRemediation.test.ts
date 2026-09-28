import { describe, it, expect, vi, beforeEach } from "vitest";
import { isTransientError, withTransientRetry } from "./transientRetry.js";
import { formatAnalyzerErrorResponse, AnalyzerError } from "./analyzerErrors.js";
import { LifecycleError } from "./lifecycleErrors.js";

describe("Analyzer Reliability & Remediation Test Suite", () => {
  describe("transientRetry module", () => {
    it("correctly identifies transient transport and network errors", () => {
      expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
      expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
      expect(isTransientError(new Error("socket hang up"))).toBe(true);
      expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isTransientError({ statusCode: 503, message: "Service Unavailable" })).toBe(true);
      expect(isTransientError({ statusCode: 502, message: "Bad Gateway" })).toBe(true);
    });

    it("does NOT classify permanent errors as transient", () => {
      expect(isTransientError(new Error("Unauthorized"))).toBe(false);
      expect(isTransientError({ statusCode: 401, message: "Unauthenticated" })).toBe(false);
      expect(isTransientError({ statusCode: 403, message: "Forbidden" })).toBe(false);
      expect(isTransientError({ statusCode: 400, message: "Bad Request" })).toBe(false);
      expect(isTransientError({ statusCode: 402, message: "Payment Required" })).toBe(false);
    });

    it("retries transient failures up to maxAttempts and returns result on success", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new TypeError("fetch failed");
        }
        return "success";
      };

      const result = await withTransientRetry(fn, { maxAttempts: 3, initialDelayMs: 10 });
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("fails immediately without retrying for permanent non-transient errors", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new LifecycleError(401, "ACCESS_DENIED", "Sign in required");
      };

      await expect(withTransientRetry(fn, { maxAttempts: 3, initialDelayMs: 10 })).rejects.toThrow("Sign in required");
      expect(attempts).toBe(1);
    });

    it("throws original error when maxAttempts are exhausted for transient failures", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new TypeError("fetch failed");
      };

      await expect(withTransientRetry(fn, { maxAttempts: 3, initialDelayMs: 10 })).rejects.toThrow("fetch failed");
      expect(attempts).toBe(3);
    });
  });

  describe("analyzerErrors taxonomy formatter", () => {
    it("formats USAGE_SERVICE_TEMPORARILY_UNAVAILABLE for transient fetch failures in usage check", () => {
      const err = new LifecycleError(503, "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE", "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment.");
      const formatted = formatAnalyzerErrorResponse(err);

      expect(formatted.code).toBe("USAGE_SERVICE_TEMPORARILY_UNAVAILABLE");
      expect(formatted.statusCode).toBe(503);
      expect(formatted.retryable).toBe(true);
      expect(formatted.error).toContain("Your document is safe");
    });

    it("formats USAGE_LIMIT_REACHED for 402 status", () => {
      const formatted = formatAnalyzerErrorResponse({ statusCode: 402, message: "Free limit reached" });
      expect(formatted.code).toBe("USAGE_LIMIT_REACHED");
      expect(formatted.statusCode).toBe(402);
      expect(formatted.retryable).toBe(false);
    });

    it("formats AI_RATE_LIMITED for 429 status or rate limit message", () => {
      const formatted = formatAnalyzerErrorResponse({ statusCode: 429, message: "Rate limit exceeded" });
      expect(formatted.code).toBe("AI_RATE_LIMITED");
      expect(formatted.statusCode).toBe(429);
      expect(formatted.retryable).toBe(true);
    });

    it("formats AI_PROVIDER_TEMPORARILY_UNAVAILABLE for 503 status", () => {
      const formatted = formatAnalyzerErrorResponse({ statusCode: 503, message: "Overloaded" });
      expect(formatted.code).toBe("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
      expect(formatted.statusCode).toBe(503);
      expect(formatted.retryable).toBe(true);
    });
  });
});
