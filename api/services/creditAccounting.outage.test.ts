import { describe, expect, it, vi } from "vitest";
import { finalizeAnalysisCreditWithRetry, isBillingOutage } from "./creditAccounting.js";
import { LifecycleError } from "./lifecycleErrors.js";

// Every failed credit RPC is reported as USAGE_SERVICE_TEMPORARILY_UNAVAILABLE. That is an outage, which may be retried
// and, if it persists, must hold the report. A released or missing reservation is a final outcome, never retried.
const outage = () => new LifecycleError(503, "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE", "unavailable");
const released = () => new LifecycleError(409, "RESERVATION_RELEASED", "expired");
const params = {} as any;

describe("billing outages versus final reservation outcomes", () => {
  it("classifies only the usage outage code as an outage", () => {
    expect(isBillingOutage(outage())).toBe(true);
    expect(isBillingOutage(released())).toBe(false);
    expect(isBillingOutage(new Error("boom"))).toBe(false);
  });

  it("retries an outage and returns the balance when a later attempt succeeds", async () => {
    const finalize = vi.fn().mockRejectedValueOnce(outage()).mockResolvedValueOnce({ used: 1 });
    await expect(finalizeAnalysisCreditWithRetry(params, { attempts: 3, delayMs: 0, finalize })).resolves.toEqual({ used: 1 });
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it("does not retry a final outcome such as a released reservation", async () => {
    const err = released();
    const finalize = vi.fn().mockRejectedValue(err);
    await expect(finalizeAnalysisCreditWithRetry(params, { attempts: 3, delayMs: 0, finalize })).rejects.toBe(err);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt budget on a persistent outage, surfacing the outage (so the report is held)", async () => {
    const err = outage();
    const finalize = vi.fn().mockRejectedValue(err);
    await expect(finalizeAnalysisCreditWithRetry(params, { attempts: 3, delayMs: 0, finalize })).rejects.toBe(err);
    expect(finalize).toHaveBeenCalledTimes(3);
  });
});
