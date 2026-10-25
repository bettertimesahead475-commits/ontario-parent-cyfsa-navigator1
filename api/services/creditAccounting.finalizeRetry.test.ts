// Finalization retry: transient write failures are retried, final business outcomes are not.
// paid_finalize_credit is idempotent (consumed -> consumed), so a retry after an uncertain write cannot double-charge.
import { describe, expect, it, vi } from "vitest";
import { finalizeAnalysisCreditWithRetry } from "./creditAccounting.js";
import { LifecycleError } from "./lifecycleErrors.js";

const params = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  firebaseUid: "uid-1",
  requestId: "req_1",
  reservationId: "uid-marker",
  tier: "Premium",
};

describe("finalizeAnalysisCreditWithRetry", () => {
  it("retries a transient write failure and then succeeds, without an extra charge path", async () => {
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce({ creditsConsumed: 1 });
    await expect(finalizeAnalysisCreditWithRetry(params, { delayMs: 0, finalize })).resolves.toEqual({ creditsConsumed: 1 });
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it("does not retry a final business outcome (reservation released)", async () => {
    const released = new LifecycleError(409, "RESERVATION_RELEASED", "expired");
    const finalize = vi.fn().mockRejectedValue(released);
    await expect(finalizeAnalysisCreditWithRetry(params, { delayMs: 0, finalize })).rejects.toBe(released);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("does not retry a missing reservation", async () => {
    const missing = new LifecycleError(409, "RESERVATION_MISSING", "none");
    const finalize = vi.fn().mockRejectedValue(missing);
    await expect(finalizeAnalysisCreditWithRetry(params, { delayMs: 0, finalize })).rejects.toBe(missing);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded number of attempts and surfaces the last error", async () => {
    const failure = new Error("database unreachable");
    const finalize = vi.fn().mockRejectedValue(failure);
    await expect(finalizeAnalysisCreditWithRetry(params, { attempts: 3, delayMs: 0, finalize })).rejects.toBe(failure);
    expect(finalize).toHaveBeenCalledTimes(3);
  });

  it("passes the same request through every attempt, so the idempotent write sees one reservation", async () => {
    const finalize = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce(null);
    await finalizeAnalysisCreditWithRetry(params, { delayMs: 0, finalize });
    expect(finalize.mock.calls[0][0]).toEqual(params);
    expect(finalize.mock.calls[1][0]).toEqual(params);
  });
});
