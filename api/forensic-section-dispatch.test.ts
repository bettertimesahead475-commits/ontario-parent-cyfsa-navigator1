import { describe, expect, it, vi } from "vitest";
import { runSectionedAnalysis } from "./services/analyzerSections";

type GenParams = Parameters<Parameters<typeof runSectionedAnalysis>[0]["generate"]>[0];

// Synthetic, non-identifying section outputs that pass validation.
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
const ok = (stage: string) => ({ text: JSON.stringify(SECTIONS[stage] ?? {}), model: "synthetic", durationMs: 0, stopReason: "end_turn" });

describe("forensic section dispatch", () => {
  it("bounds cost when every section fails: each section is attempted at most twice and never via provider retries", async () => {
    const generate = vi.fn(async (_options: GenParams) => ({ text: "{}", model: "claude-opus-test", durationMs: 0, stopReason: "end_turn" }));
    await expect(runSectionedAnalysis({
      mode: "full", documentText: "Synthetic Ontario child protection affidavit.", primaryModel: "claude-opus-test",
      requestId: "forensic-dispatch-test", deadlineAt: Date.now() + 120_000, generate,
    })).rejects.toThrow();
    const calls = generate.mock.calls.map(([options]) => options);
    const perStage = new Map<string, number>();
    for (const c of calls) perStage.set(c.stage!, (perStage.get(c.stage!) ?? 0) + 1);
    expect(perStage.size).toBe(3); // default Forensic concurrency 3; no new section starts after a failure
    expect([...perStage.values()].every((n) => n <= 2)).toBe(true);
    expect(calls.every((options) => options.retries === 0)).toBe(true);
    expect(calls.some((options) => options.stage === "forensic_verification")).toBe(false);
  });

  it("dispatches Forensic longest-first with the verification inputs leading, three at a time", async () => {
    const order: string[] = [];
    const generate = vi.fn(async (options: GenParams) => { order.push(options.stage!); return ok(options.stage!); });
    await runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "order-test", deadlineAt: Date.now() + 60_000, generate });
    // Chronology moved up behind the verification inputs (2026-11-26 hotfix): it previously started last.
    expect(order.slice(0, 3)).toEqual(["section:redFlags", "section:thresholds", "section:chronology"]);
  });

  it("honours an explicit concurrency cap", async () => {
    let inFlight = 0, peak = 0;
    const generate = vi.fn(async (options: GenParams) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return ok(options.stage!); });
    await runSectionedAnalysis({ mode: "fast", documentText: DOC, primaryModel: "m", requestId: "cap-test", deadlineAt: Date.now() + 60_000, generate, maxConcurrency: 2 });
    expect(peak).toBe(2);
  });

  it("starts all sections together and starts verification before the slowest unrelated section finishes", async () => {
    const t0 = Date.now(); const startedAt: Record<string, number> = {}; const finishedAt: Record<string, number> = {};
    const delays: Record<string, number> = { "section:guidance": 120, "section:timeline": 100 };
    const generate = vi.fn(async (options: GenParams) => {
      startedAt[options.stage!] = Date.now() - t0;
      await new Promise((r) => setTimeout(r, delays[options.stage!] ?? 10));
      finishedAt[options.stage!] = Date.now() - t0;
      return ok(options.stage!);
    });
    const run = await runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "overlap-test", deadlineAt: Date.now() + 120_000, generate, maxConcurrency: 6 });
    const sectionStarts = Object.entries(startedAt).filter(([k]) => k.startsWith("section:")).map(([, v]) => v);
    expect(Math.max(...sectionStarts)).toBeLessThan(40); // no second wave
    expect(startedAt.forensic_verification).toBeLessThan(finishedAt["section:guidance"]); // overlapped
    // The final report keeps every section, the guards, and the verification marks.
    expect(run.report.forensicVerification?.status).toBe("completed");
    expect(run.report.redFlags[0].forensicVerification?.verdict).toBe("SUPPORTED");
    expect(run.report.redFlags[0].quoteVerified).toBe(true);
    expect(run.report.whatToVerify).toEqual(["Verify intake notes."]);
    expect(run.report.complianceMatrix).toBeDefined();
  });

  it("fails cleanly, without a dangling verification, when a section fails after verification started", async () => {
    const generate = vi.fn(async (options: GenParams) => {
      if (options.stage === "section:guidance") { await new Promise((r) => setTimeout(r, 30)); return { text: "{}", model: "m", durationMs: 0, stopReason: "end_turn" }; }
      return ok(options.stage!);
    });
    await expect(runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "fail-after-verify", deadlineAt: Date.now() + 120_000, generate })).rejects.toThrow();
    expect(generate.mock.calls.some(([o]) => o.stage === "forensic_verification")).toBe(true);
  });
});

describe("targeted Forensic re-runs (independent review finding 3)", () => {
  it("still verifies, via the full report, when the run does not include both verification inputs", async () => {
    const generate = vi.fn(async (options: GenParams) => ok(options.stage!));
    const run = await runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "targeted-test", deadlineAt: Date.now() + 60_000, generate, targetSections: ["guidance", "timeline"] });
    expect(run.report.forensicVerification).toBeDefined();
    expect(generate.mock.calls.map(([o]) => o.stage)).toEqual(expect.arrayContaining(["section:guidance", "section:timeline"]));
  });
});
