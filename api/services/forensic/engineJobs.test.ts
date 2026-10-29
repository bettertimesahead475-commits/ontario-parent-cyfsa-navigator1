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

describe("engine retention schedule", () => {
  it("is scheduled in vercel.json", async () => {
    const { readFileSync } = await import("node:fs");
    const v = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));
    expect(v.crons.map((c: any) => c.path)).toContain("/api/admin/forensic-engine/purge");
  });
});

describe("the resumable call budget covers the largest case the route accepts", () => {
  it("investigates all ten documents of a maximum-size multi-pass case and delivers the report", async () => {
    const { advanceEngineJob, isFatal, startEngineJob, MAX_PLAN_MODEL_STEPS, RESUMABLE_LIMITS } = await import("./engineJobs");
    const { MAX_ADDITIONAL_DOCUMENTS } = await import("./integration");
    const n = 1 + MAX_ADDITIONAL_DOCUMENTS;
    const names = ["Ash", "Bay", "Cy", "Dee", "Eli", "Fox", "Gil", "Hal", "Ivy", "Jo"];
    const documents = names.slice(0, n).map((name, i) => ({
      id: `d${i}`, title: `Record ${name}`, kind: "CAS_RECORD" as const, extractionMethod: "TEXT_LAYER" as const,
      // Over singlePassMaxChars in total, so each document is investigated separately and then synthesized.
      text: `[Page 1]\n${name} reported the visit was cancelled.\n` + "Background. ".repeat(2_000),
    }));
    const s = store();
    const calls: Record<string, number> = {};
    const generate = async (p: any, model: string) => {
      const stage = String(p.stage);
      calls[stage] = (calls[stage] ?? 0) + 1;
      const doc = /id="(d\d+)"/.exec(String(p.messages[0].content))?.[1];
      const name = doc ? names[Number(doc.slice(1))] : "";
      const text =
        stage === "forensic_investigation"
          ? JSON.stringify({ findings: [{ id: "F1", title: `${name} cancellation`, statement: `${name} says the ${name} visit was cancelled.`, evidenceClass: "A", supporting: [{ documentId: doc, quote: `${name} reported the visit was cancelled.` }] }] })
          : stage === "forensic_adversarial_review"
            ? JSON.stringify({ reviews: [] })
            : JSON.stringify({ findings: [] });
      return { text, model, durationMs: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    };
    expect(await startEngineJob({ store: s, meta: { ...meta(), jobId: "big" }, documents, investigatorModel: "claude-opus-5", extractorModel: "claude-sonnet-5" })).toBe(true);
    const r = await advanceEngineJob({ store: s, jobId: "big", generate, deadlineAt: Date.now() + 600_000, minModelStepMs: 1 });
    expect(r.status).toBe("COMPLETE");
    const report = (r as any).state.report;
    expect(calls.forensic_investigation).toBe(n);
    expect(calls.forensic_synthesis).toBe(1);
    expect(calls.forensic_adversarial_review).toBe(1);
    expect(isFatal(report)).toBe(false);
    expect(report.incompleteness.join(" ")).not.toMatch(/budget/i);
    expect(RESUMABLE_LIMITS.maxCalls).toBeGreaterThan(MAX_PLAN_MODEL_STEPS);
  });
});
