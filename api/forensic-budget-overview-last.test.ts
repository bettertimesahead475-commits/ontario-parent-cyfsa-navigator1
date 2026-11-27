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
  let ok = false, finishedAt = 0, result: any = null;
  const p = runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "sim", deadlineAt: BUDGET, generate } as any)
    .then((r: any) => { ok = true; result = r; finishedAt = Date.now(); }, () => { finishedAt = Date.now(); });
  await vi.advanceTimersByTimeAsync(400_000);
  await p;
  vi.useRealTimers();
  return { ok, finishedAt, result, calls, first: (stage: string) => calls.find((c) => c.stage === `section:${stage}`)! };
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

});

// redFlags' own limit (FORENSIC_SECTION_TIMEOUT_MS.redFlags = 145 s; previously SECTION_TIMEOUT_MS.full = 110 s).
const factors = (from: number, to: number) => Array.from({ length: Math.round((to - from) / 0.05) + 1 }, (_, i) => +(from + i * 0.05).toFixed(2));
const completesInsideBudget = (r: Awaited<ReturnType<typeof replay>>) => {
  expect(r.ok).toBe(true);
  expect(r.calls.every((c) => c.ok)).toBe(true);
  expect(Math.max(...r.calls.map((c) => c.end))).toBeLessThanOrEqual(BUDGET - 3_000);
  expect(r.result.report.forensicVerification.status).toBe("completed");
};

describe("Forensic redFlags tolerance with a 145 s redFlags limit (total budget unchanged)", () => {
  it("redFlags alone completes, verified, at 1.0-1.55x its production time (it failed from 1.20x at 110 s)", async () => {
    for (const f of factors(1.0, 1.55)) completesInsideBudget(await replay(scaled(f, "section:redFlags")));
    const r = await replay(scaled(1.2, "section:redFlags"));
    expect(r.first("redFlags").timeoutMs).toBe(145_000);
    expect(r.calls.filter((c) => c.stage === "section:redFlags")).toHaveLength(1);
  });

  it("redFlags beyond its 145 s limit still fails inside the budget", async () => {
    const r = await replay(scaled(1.6, "section:redFlags"));
    expect(r.ok).toBe(false);
    expect(r.finishedAt).toBeLessThanOrEqual(BUDGET);
  });

  it("every other section alone, overview included, still completes inside the budget at 1.0-1.5x", async () => {
    for (const stage of ["section:thresholds", "section:guidance", "section:timeline", "section:overview", "forensic_verification"])
      for (const f of factors(1.0, 1.5)) completesInsideBudget(await replay(scaled(f, stage)));
    // Unchanged by this fix: chronology keeps SECTION_TIMEOUT_MS.full (110 s) and its 81.3 s production time fits up to 1.35x.
    for (const f of factors(1.0, 1.35)) completesInsideBudget(await replay(scaled(f, "section:chronology")));
  });

  it("under a uniform slowdown the run now completes up to 1.35x (was 1.15x); beyond that redFlags is not what fails", async () => {
    for (const f of factors(1.0, 1.35)) completesInsideBudget(await replay(scaled(f)));
    // At 1.4x chronology + timeline alone need 1.4 x 126.6 s > 175 s: past the budget for any redFlags limit.
    for (const f of factors(1.4, 1.5)) {
      const r = await replay(scaled(f));
      expect(r.ok).toBe(false);
      expect(r.calls.filter((c) => c.stage === "section:redFlags").every((c) => c.ok)).toBe(true);
      expect(Math.max(...r.calls.map((c) => c.end))).toBeLessThanOrEqual(BUDGET - 3_000);
    }
  });
});
