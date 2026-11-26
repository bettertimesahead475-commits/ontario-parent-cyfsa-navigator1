// DEVIN review of the 2026-11-26 chronology hotfix: a mocked-inference replay of the owner's interrupted Forensic run.
// Section durations, the 5,000-token chronology cut-offs and the ~94 tokens/s output rate come from Cloudflare Workers
// telemetry for that run; verification takes 30 s (upper bound from the 2026-11-25 run). On be46ad7 every chronology
// longer than 5,000 tokens fails at ~175 s, as the two failed production attempts did (174.4 s, 174.7 s). Fake timers;
// no network. Synthetic text only.
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
const D: Record<string, number> = { "section:redFlags": 92_500, "section:guidance": 57_800, "section:thresholds": 37_700, "section:timeline": 45_300, "section:overview": 36_700 };
const TOK_PER_S = 94, TTFT = 1_500, VERIFY_MS = 30_000, BUDGET = 180_000 - 2_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function replay(chronologyTokens: number) {
  vi.useFakeTimers({ now: 0 });
  const log: string[] = [];
  const generate = async (o: any) => {
    const t0 = Date.now();
    let dur: number, res: any;
    if (o.stage === "forensic_verification") { dur = VERIFY_MS; res = { text: JSON.stringify({ verdicts: [] }), model: "v", durationMs: 0, stopReason: "end_turn" }; }
    else if (o.stage === "section:chronology") {
      const retry = JSON.stringify(o.messages).includes("cut off because it was too long");
      const need = retry ? 3_500 : chronologyTokens;
      const out = Math.min(need, o.max_tokens);
      dur = TTFT + (out / TOK_PER_S) * 1000;
      res = { text: need > o.max_tokens ? '{"chronology":[{"date":"Jan' : OK[o.stage], model: "m", durationMs: 0, stopReason: need > o.max_tokens ? "max_tokens" : "end_turn", usage: { input_tokens: 1, output_tokens: out } };
    } else { dur = D[o.stage]; res = { text: OK[o.stage], model: "m", durationMs: 0, stopReason: "end_turn" }; }
    if (dur > o.timeoutMs) { await sleep(o.timeoutMs); log.push(`${o.stage}@${t0 / 1000}s deadline(${o.timeoutMs / 1000}s)`); throw new Error(`provider deadline of ${o.timeoutMs} ms`); }
    await sleep(dur);
    log.push(`${o.stage}@${t0 / 1000}-${Date.now() / 1000}s ${res.stopReason}`);
    return res;
  };
  let outcome = "";
  const p = runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "sim", deadlineAt: BUDGET, generate } as any)
    .then((r) => { outcome = `SUCCESS at ${Date.now() / 1000}s chronologyAttempts=${r.attempts.chronology}`; }, (e) => { outcome = `FAILED at ${Date.now() / 1000}s (${e.code || e.message})`; });
  await vi.advanceTimersByTimeAsync(400_000);
  await p;
  vi.useRealTimers();
  return { outcome, log };
}

describe("owner-run replay: Forensic completes inside its execution budget", () => {
  it.each([5_500, 6_500, 7_500])("chronology needing %i output tokens completes in one attempt", async (n) => {
    const { outcome } = await replay(n);
    expect(outcome).toMatch(/^SUCCESS at (\d+(\.\d+)?)s chronologyAttempts=1$/);
    expect(Number(outcome.match(/at ([\d.]+)s/)![1])).toBeLessThan(150);
  });

  it("chronology longer than 8,000 tokens is cut off, retried shorter, and still completes inside the budget", async () => {
    const { outcome, log } = await replay(9_000);
    expect(outcome).toMatch(/^SUCCESS at [\d.]+s chronologyAttempts=2$/);
    expect(log.some((l) => l.startsWith("section:chronology@0-") && l.endsWith("max_tokens"))).toBe(true);
  });
});
