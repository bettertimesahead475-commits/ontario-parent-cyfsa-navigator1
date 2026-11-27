// A Forensic run whose independent verification did not return a verdict for every finding must not be reported as a
// completed second review. Previously any parseable verifier reply was "completed", even one covering 0 of N findings.
// Mocked inference only; synthetic text.
import { describe, it, expect } from "vitest";
import { runSectionedAnalysis } from "./services/analyzerSections";
import { isSecondReviewComplete } from "../shared/reportContract";

const DOC = "Synthetic affidavit. The school concern was relayed to me by the intake worker, Morgan Placeholder. " +
  "The worker said the home was unsafe without visiting it.";
const SECTIONS: Record<string, string> = {
  "section:overview": JSON.stringify({ documentTitle: "Synthetic Application", fileSummary: "A synthetic application about the school referral received on January 9, 2026.", completeness: "Complete." }),
  "section:redFlags": JSON.stringify({ redFlags: [
    { id: "rf1", severity: "Worth Raising With Counsel", category: "Hearsay", evidenceClassification: "HEARSAY", phraseDetected: "relayed to me by the intake worker", explanation: "Second-hand.", legalReference: "" },
    { id: "rf2", severity: "Worth Raising With Counsel", category: "Unsupported conclusion", evidenceClassification: "OPINION", phraseDetected: "the home was unsafe without visiting it", explanation: "No observation.", legalReference: "" },
  ] }),
  "section:chronology": JSON.stringify({ chronology: [{ date: "January 9, 2026", event: "Referral received.", locationInDocument: "Paragraph 3", evidenceClassification: "DOCUMENTARY" }], contradictions: [] }),
  "section:guidance": JSON.stringify({ whatToVerify: ["Verify intake notes."], whatToAskALawyer: ["Is the referral hearsay?"], whatIsMissing: ["Principal's statement."], lawyerCaseBrief: ["ISSUE: hearsay."] }),
  "section:thresholds": JSON.stringify({ thresholdAnalysis: [{ thresholdChecked: "Physical Harm Risk", isMet: "Not Met", reasoning: "No harm described." }] }),
  "section:timeline": JSON.stringify({ proceduralTimelineViolations: [{ timelineRule: "30-Day Adjournment Limit", documentAssertion: "None.", evaluation: "Not applicable." }], charterAndHumanRightsIssues: [] }),
};
// The verifier is sent every finding and every threshold row (the parser adds the mandatory CYFSA rows), so a complete
// reply has a verdict for each threshold named in the prompt.
const thresholdsIn = (o: any) => [...JSON.stringify(o.messages).matchAll(/\\"thresholdChecked\\": \\"([^\\]+)\\"/g)].map((m) => m[1]);
const ALL = (o: any) => ({ findings: [{ id: "rf1", verdict: "SUPPORTED" }, { id: "rf2", verdict: "SUPPORTED" }], thresholds: thresholdsIn(o).map((t) => ({ thresholdChecked: t, verdict: "SUPPORTED" })), overallAssessment: "Checked." });

async function run(verifierReply: (o: any) => unknown) {
  const generate = async (o: any) => ({
    text: o.stage === "forensic_verification" ? JSON.stringify(verifierReply(o)) : SECTIONS[o.stage],
    model: "m", durationMs: 1, stopReason: "end_turn",
  });
  const r = await runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", verificationModel: "v", requestId: "cov", deadlineAt: Date.now() + 178_000, generate } as any);
  return r.report;
}

describe("Forensic verification coverage", () => {
  it("a reply with a verdict for every finding and threshold is a completed second review", async () => {
    const report = await run(ALL);
    expect(report.thresholdAnalysis.length).toBe(4);
    expect(report.forensicVerification).toMatchObject({ status: "completed", checkedFindings: 6, totalFindings: 6 });
  });

  it("a reply that covers only some findings is incomplete, and keeps the verdicts it did return", async () => {
    const report = await run((o) => ({ ...ALL(o), findings: [{ id: "rf1", verdict: "SUPPORTED" }] }));
    expect(report.forensicVerification).toMatchObject({ status: "incomplete", checkedFindings: 5, totalFindings: 6 });
    expect(report.forensicVerification.reason).toContain("5 of 6 findings");
    expect(report.redFlags.find((f: any) => f.id === "rf1").forensicVerification.verdict).toBe("SUPPORTED");
    expect(report.redFlags.find((f: any) => f.id === "rf2").forensicVerification).toBeUndefined();
  });

  it("a reply that covers the findings but not every threshold row is incomplete", async () => {
    const report = await run((o) => ({ ...ALL(o), thresholds: ALL(o).thresholds.slice(0, 1) }));
    expect(report.forensicVerification).toMatchObject({ status: "incomplete", checkedFindings: 3, totalFindings: 6 });
  });

  it("a parseable reply with no usable verdicts is incomplete (0 of 6), never completed", async () => {
    for (const reply of [{ verdicts: [] }, { findings: [], thresholds: [] }, { findings: [{ id: "unknown", verdict: "SUPPORTED" }] }]) {
      const report = await run(() => reply);
      expect(report.forensicVerification).toMatchObject({ status: "incomplete", checkedFindings: 0, totalFindings: 6 });
    }
  });

  it("with no red flags, a reply that covers none of the threshold rows is incomplete (0 of 4), never completed", async () => {
    const saved = SECTIONS["section:redFlags"];
    SECTIONS["section:redFlags"] = JSON.stringify({ redFlags: [] });
    try {
      const report = await run((o) => ({ findings: [], thresholds: [], overallAssessment: "Nothing to add." }));
      expect(report.redFlags).toEqual([]);
      expect(report.forensicVerification).toMatchObject({ status: "incomplete", checkedFindings: 0, totalFindings: 4 });
      const covered = await run(ALL);
      expect(covered.forensicVerification).toMatchObject({ status: "completed", checkedFindings: 4, totalFindings: 4 });
    } finally {
      SECTIONS["section:redFlags"] = saved;
    }
  });

  it("an already-saved report marked completed but covering fewer findings than it was sent is not shown as complete", () => {
    expect(isSecondReviewComplete({ status: "completed", checkedFindings: 0, totalFindings: 3 })).toBe(false);
    expect(isSecondReviewComplete({ status: "completed", checkedFindings: 2, totalFindings: 3 })).toBe(false);
    expect(isSecondReviewComplete({ status: "completed", checkedFindings: 3, totalFindings: 3 })).toBe(true);
    expect(isSecondReviewComplete({ status: "completed", checkedFindings: 0, overallAssessment: "There were no findings to verify." })).toBe(true);
    expect(isSecondReviewComplete({ status: "incomplete", checkedFindings: 3, totalFindings: 3 })).toBe(false);
    expect(isSecondReviewComplete(null)).toBe(false);
  });
});
