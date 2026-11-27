// Evidence for the Devin Review question on #147: with dispatch order redFlags, thresholds, chronology, guidance, timeline,
// overview and concurrency 3, overview starts last and runOneSection caps its timeout at the remaining budget. Can it exceed
// the Forensic budget? Mocked inference, fake timers, synthetic text. Section durations are the production Workers
// telemetry used by forensic-budget-replay.test.ts (chronology 7,500 output tokens at ~94 tokens/s; verification 30 s).
import { describe, it, expect, vi } from "vitest";
import { runSectionedAnalysis } from "./services/analyzerSections";

const OK: Record<string, string> = {
  "section:overview": JSON.stringify({ documentTitle: "Synthetic Application", fileSummary: "A synthetic application about October 12, 2026.", completeness: "Complete." }),
  "section:redFlags": JSON.stringify({ redFlags: [{ id: "rf1", severity: "Worth Raising With Counsel", category: "Hearsay", evidenceClassification: "HEARSAY", phraseDetected: "relayed to me by the intake worker", explanation: "Second-hand.", legalReference: "" }] }),
  "section:chronology": JSON.stringify({ chronology: [{ date: "January 9, 2026", event: "Referral received from the school.", locationInDocument: "Paragraph 3", evidenceClassification: "DOCUMENTARY" }], contradictions: [] }),
  "section:guidance": JSON.stringify({ whatToVerify: ["Verify intake notes."], whatToAskALawyer: ["Is the referral hearsay?"], whatIsMissing: ["Principal's statement."], lawyerCaseBrief: ["ISSUE: hearsay."] }),
  "section:thresholds": JSON.stringify({ thresholdAnalysis: [{ thresholdChecked: "Physical Harm Risk", isMet: "Not Met", reasoning: "No harm described." }] }),
  "section:timeline": JSON.stringify({ proceduralTimelineViolations: [{ timelineRule: "30-Day Adjournment Limit", documentAssertion: "None.", evaluation: "Not applicable." }], charterAndHumanRightsIssues: [] }),
};
const DOC = "Synthetic affidavit. The school concern was relayed to me by the intake worker, Morgan Placeholder.";
const PRODUCTION_MS: Record<string, number> = {
  "section:redFlags": 92_500, "section:thresholds": 37_700, "section:chronology": 1_500 + (7_500 / 94) * 1000,
  "section:guidance": 57_800, "section:timeline": 45_300, "section:overview": 36_700, forensic_verification: 30_000,
};
const BUDGET = 180_000 - 2_000; // aiDeadlineAt for the default FORENSIC_ANALYSIS_BUDGET_MS
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Call { stage: string; start: number; end: number; timeoutMs: number; ok: boolean }

async function replay(durations: Record<string, number>) {
  vi.useFakeTimers({ now: 0 });
  const calls: Call[] = [];
  const generate = async (o: any) => {
    const start = Date.now();
    const dur = durations[o.stage];
    if (dur > o.timeoutMs) {
      await sleep(o.timeoutMs);
      calls.push({ stage: o.stage, start, end: Date.now(), timeoutMs: o.timeoutMs, ok: false });
      throw new Error(`provider deadline of ${o.timeoutMs} ms`);
    }
    await sleep(dur);
    calls.push({ stage: o.stage, start, end: Date.now(), timeoutMs: o.timeoutMs, ok: true });
    const text = o.stage === "forensic_verification" ? JSON.stringify({ verdicts: [] }) : OK[o.stage];
    return { text, model: "m", durationMs: dur, stopReason: "end_turn" };
  };
  let ok = false, finishedAt = 0;
  const p = runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "sim", deadlineAt: BUDGET, generate } as any)
    .then(() => { ok = true; finishedAt = Date.now(); }, () => { finishedAt = Date.now(); });
  await vi.advanceTimersByTimeAsync(400_000);
  await p;
  vi.useRealTimers();
  return { ok, finishedAt, calls, first: (stage: string) => calls.find((c) => c.stage === `section:${stage}`)! };
}

const scaled = (f: number, only?: string) =>
  Object.fromEntries(Object.entries(PRODUCTION_MS).map(([k, v]) => [k, !only || k === only ? v * f : v]));

describe("Forensic budget with overview dispatched last (production section timings)", () => {
  it("overview starts at 92.5 s with an 82.5 s timeout and the run finishes ~45 s inside the budget", async () => {
    const r = await replay(PRODUCTION_MS);
    expect(r.ok).toBe(true);
    const overview = r.first("overview");
    // Overview takes the slot redFlags frees at 92.5 s; its timeout is capped at budget - start - 3 s = 82.5 s.
    expect(overview.start).toBe(92_500);
    expect(overview.timeoutMs).toBe(82_500);
    expect(overview.timeoutMs).toBeGreaterThan(2 * PRODUCTION_MS["section:overview"]);
    expect(Math.max(...r.calls.map((c) => c.start))).toBe(overview.start); // overview really is the last section started
    expect(r.finishedAt).toBeLessThan(BUDGET - 45_000);
  });

  it("overview alone must run 2.2x its production duration before its capped timeout is reached", async () => {
    expect((await replay(scaled(2.2, "section:overview"))).ok).toBe(true);
    const r = await replay(scaled(2.3, "section:overview"));
    expect(r.ok).toBe(false);
    expect(r.first("overview").ok).toBe(false);
  });

  it("under a uniform provider slowdown the first section lost is redFlags (110 s section timeout) at 1.20x, not overview", async () => {
    const fits = await replay(scaled(1.15));
    expect(fits.ok).toBe(true);
    expect(fits.first("overview").ok).toBe(true);
    const r = await replay(scaled(1.2));
    expect(r.ok).toBe(false);
    // redFlags needs 111 s: attempt 1 hits SECTION_TIMEOUT_MS.full (110 s), and the retry gets only the ~64 s left.
    expect(r.calls.filter((c) => !c.ok).map((c) => c.stage)).toEqual(["section:redFlags", "section:redFlags"]);
    expect(r.calls.filter((c) => c.stage === "section:overview").every((c) => c.ok)).toBe(true);
  });
});
