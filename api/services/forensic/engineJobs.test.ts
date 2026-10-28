import { describe, expect, it } from "vitest";
import { LifecycleError } from "../lifecycleErrors";
import { CheckpointStore, InMemoryObjectStore, type EngineJobMeta } from "./checkpointStore";
import { settleDelivered, settleFailed } from "./engineJobs";

const meta = (billing: "paid" | "admin" = "paid"): EngineJobMeta => ({ jobId: "j", uid: "u", billing, sessionId: "s", tier: "Pro", reservationId: "r", billingCycle: null, userEmail: null, documentName: null, mode: "full", createdAt: 0 });
const store = () => new CheckpointStore(new InMemoryObjectStore());
const released = () => new LifecycleError(409, "RESERVATION_RELEASED", "x");

describe("settling a resumable engine job", () => {
  it("charges once, and a repeat settle does nothing", async () => {
    const s = store();
    let finalized = 0;
    const ops = { finalize: async () => void finalized++, reserveAgain: async () => ({ billingCycle: null }) };
    expect(await settleDelivered(s, meta(), ops)).toBe("CHARGED");
    expect(await settleDelivered(s, meta(), ops)).toBe("ALREADY_SETTLED");
    expect(finalized).toBe(1);
  });

  it("reserves again under the same id when the reservation lapsed, then finalizes", async () => {
    const s = store();
    const log: string[] = [];
    let first = true;
    const ops = {
      finalize: async () => {
        log.push("finalize");
        if (first) { first = false; throw released(); }
      },
      reserveAgain: async () => { log.push("reserve"); return { billingCycle: null }; },
    };
    expect(await settleDelivered(s, meta(), ops)).toBe("CHARGED");
    expect(log).toEqual(["finalize", "reserve", "finalize"]);
  });

  it("withholds the report (402) when the allowance is used up by delivery time, and stays unsettled", async () => {
    const s = store();
    const ops = {
      finalize: async () => { throw released(); },
      reserveAgain: async () => { throw new LifecycleError(402, "ANALYSIS_LIMIT_REACHED", "limit"); },
    };
    await expect(settleDelivered(s, meta(), ops)).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
    expect(await s.settled("j")).toBeNull();
  });

  it("does not bill the owner's admin runs", async () => {
    const s = store();
    expect(await settleDelivered(s, meta("admin"), { finalize: async () => { throw new Error("must not finalize"); }, reserveAgain: async () => ({ billingCycle: null }) })).toBe("NOT_BILLED");
  });

  it("releases a failed job once, and never releases a delivered one", async () => {
    const s = store();
    let releases = 0;
    expect(await settleFailed(s, meta(), async () => void releases++)).toBe(true);
    expect(await settleFailed(s, meta(), async () => void releases++)).toBe(false);
    expect(releases).toBe(1);

    const d = store();
    await settleDelivered(d, meta(), { finalize: async () => {}, reserveAgain: async () => ({ billingCycle: null }) });
    expect(await settleFailed(d, meta(), async () => void releases++)).toBe(false);
    expect(releases).toBe(1);
    await expect(settleDelivered(s, meta(), { finalize: async () => {}, reserveAgain: async () => ({ billingCycle: null }) })).rejects.toMatchObject({ code: "RESERVATION_RELEASED" });
  });
});
