// Forensic latency model. MEASUREMENT KIND: SIMULATED. No provider is called and nothing here is a production
// measurement. It runs the real Forensic scheduler (runSectionedAnalysis) with each provider call replaced by a timer,
// to show how concurrency changes the critical path. Real numbers need the owner-approved paid comparison
// (engineering/reviews/paid-comparison-budget-20261128.md); report those as REAL, never mix the two.
//
// Per-call durations (seconds). Observed: total Forensic run about 171 s on 2026-11-28 (14.7 KB document, one attempt).
// The per-section split below is the modelled set from engineering/reviews/release-candidate-20261126.md
// (assumptions, not measurements), with verification at 31 s.
import { describe, expect, it } from "vitest";
import { runSectionedAnalysis } from "../../api/services/analyzerSections";
import { completeVerification } from "../../api/analyzerTestFixtures";

type GenParams = Parameters<Parameters<typeof runSectionedAnalysis>[0]["generate"]>[0];

export const MEASUREMENT_KIND = "SIMULATED" as const;
const MODELLED_SECONDS: Record<string, number> = {
  "section:redFlags": 88, "section:chronology": 60, "section:guidance": 40, "section:timeline": 30,
  "section:overview": 25, "section:thresholds": 20, forensic_verification: 31,
};
/** Real milliseconds per modelled second. Small enough for CI, large enough that timer jitter stays under 1 s modelled. */
const MS_PER_SECOND = 4;

const SECTIONS: Record<string, unknown> = {
  "section:overview": { documentTitle: "Synthetic Application", fileSummary: "This synthetic document is a child protection application alleging a lack of supervision on October 12, 2026.", completenessScore: 80, evidenceStrengthIndex: { score: 60, components: {} } },
  "section:redFlags": { redFlags: [{ id: "rf1", severity: "Worth Raising With Counsel", category: "Hearsay", evidenceClassification: "HEARSAY", phraseDetected: "relayed to me by the intake worker", explanation: "Second-hand report.", verifyRequirement: "Request intake notes.", legalReference: "CYFSA s. 101", locationInDocument: "Paragraph 3" }] },
  "section:chronology": { chronology: [{ date: "January 9, 2026", event: "Referral received from the school.", locationInDocument: "Paragraph 3", evidenceClassification: "DOCUMENTARY" }], contradictions: [] },
  "section:guidance": { whatToVerify: ["Verify intake notes."], whatToAskALawyer: ["Question: Is the referral hearsay?"], whatIsMissing: ["Principal's statement."], lawyerCaseBrief: ["ISSUE: Hearsay referral."] },
  "section:thresholds": { thresholdAnalysis: [{ thresholdChecked: "Physical Harm Risk", isMet: "Not Met", reasoning: "No harm described." }] },
  "section:timeline": { proceduralTimelineViolations: [{ timelineRule: "30-Day Adjournment Limit", documentAssertion: "None.", evaluation: "Not applicable." }], charterAndHumanRightsIssues: ["Section 7.", "Section 15.", "CYFSA Section 2."] },
  forensic_verification: { findings: [{ id: "rf1", verdict: "SUPPORTED", recommendedSeverity: "Worth Raising With Counsel", note: "Supported." }], thresholds: [], overallAssessment: "Consistent." },
};
const DOC = "Synthetic affidavit. The school concern was relayed to me by the intake worker, Morgan Placeholder.";

async function simulate(maxConcurrency: number) {
  const t0 = Date.now();
  let calls = 0;
  const generate = async (options: GenParams) => {
    calls++;
    const stage = options.stage!;
    await new Promise((r) => setTimeout(r, (MODELLED_SECONDS[stage] ?? 0) * MS_PER_SECOND));
    const body = stage === "forensic_verification" ? completeVerification(SECTIONS[stage] as any, options) : SECTIONS[stage] ?? {};
    return { text: JSON.stringify(body), model: "simulated", durationMs: 0, stopReason: "end_turn" };
  };
  const run = await runSectionedAnalysis({
    mode: "full", documentText: DOC, primaryModel: "simulated", verificationModel: "simulated", requestId: `latency-model-${maxConcurrency}`,
    deadlineAt: Date.now() + 120_000, generate, maxConcurrency,
  });
  return { kind: MEASUREMENT_KIND, maxConcurrency, calls, modelledSeconds: Math.round((Date.now() - t0) / MS_PER_SECOND), run };
}

describe(`Forensic latency model (${MEASUREMENT_KIND}; not a production measurement)`, () => {
  it("concurrency 6 removes the second wave; the critical path is then redFlags plus verification", async () => {
    const at3 = await simulate(3);
    const at6 = await simulate(6);
    console.info(JSON.stringify({ tag: "[FORENSIC_LATENCY_MODEL]", kind: MEASUREMENT_KIND, results: [at3, at6].map(({ run: _r, ...rest }) => rest) }));
    expect(at3.run.report.forensicVerification?.status).toBe("completed");
    expect(at6.run.report.forensicVerification?.status).toBe("completed");
    // Same work either way: 6 sections plus 1 verification call. Concurrency changes time, not spend.
    expect(at3.calls).toBe(7);
    expect(at6.calls).toBe(7);
    const floor = MODELLED_SECONDS["section:redFlags"] + MODELLED_SECONDS.forensic_verification; // 119 s
    expect(at6.modelledSeconds).toBeGreaterThanOrEqual(floor - 2);
    expect(at6.modelledSeconds).toBeLessThan(floor + 15);
    expect(at6.modelledSeconds).toBeLessThanOrEqual(at3.modelledSeconds + 2);
  }, 30_000);
});
