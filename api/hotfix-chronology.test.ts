// Regression tests for the 2026-11-26 Forensic interruption: the chronology section was cut off at its output limit,
// retries repeated it, and the run exhausted its execution budget. All inference here is mocked. Synthetic text only.
import { describe, expect, it, vi } from "vitest";
import { runOneSection, runSectionedAnalysis } from "./services/analyzerSections";

type GenParams = Parameters<Parameters<typeof runSectionedAnalysis>[0]["generate"]>[0];

const CHRONOLOGY_OK = JSON.stringify({
  chronology: [{ date: "January 9, 2026", event: "Referral received from the school.", locationInDocument: "Paragraph 3", evidenceClassification: "DOCUMENTARY" }],
  contradictions: [],
});
const DOC = "Synthetic affidavit. The school concern was relayed to me by the intake worker, Morgan Placeholder.";
const SECTION_OK: Record<string, string> = {
  "section:overview": JSON.stringify({ documentTitle: "Synthetic Application", fileSummary: "A synthetic application about October 12, 2026.", completeness: "Complete." }),
  "section:redFlags": JSON.stringify({ redFlags: [{ id: "rf1", severity: "Worth Raising With Counsel", category: "Hearsay", evidenceClassification: "HEARSAY", phraseDetected: "relayed to me by the intake worker", explanation: "Second-hand.", legalReference: "" }] }),
  "section:chronology": CHRONOLOGY_OK,
  "section:guidance": JSON.stringify({ whatToVerify: ["Verify intake notes."], whatToAskALawyer: ["Is the referral hearsay?"], whatIsMissing: ["Principal's statement."], lawyerCaseBrief: ["ISSUE: hearsay."] }),
  "section:thresholds": JSON.stringify({ thresholdAnalysis: [{ thresholdChecked: "Physical Harm Risk", isMet: "Not Met", reasoning: "No harm described." }] }),
  "section:timeline": JSON.stringify({ proceduralTimelineViolations: [{ timelineRule: "30-Day Adjournment Limit", documentAssertion: "None.", evaluation: "Not applicable." }], charterAndHumanRightsIssues: [] }),
};
const complete = (text: string) => ({ text, model: "synthetic", durationMs: 0, stopReason: "end_turn" });
const truncated = (text: string) => ({ text, model: "synthetic", durationMs: 0, stopReason: "max_tokens" });

function sectionOpts(generate: (o: GenParams) => Promise<any>, mode: "fast" | "full" = "full") {
  return { mode, documentText: DOC, primaryModel: "m", requestId: "hotfix-test", deadlineAt: Date.now() + 120_000, generate } as any;
}

describe("chronology output budget", () => {
  it("requests 8,000 output tokens for the Forensic chronology section (was 5,000)", async () => {
    const seen: number[] = [];
    const generate = vi.fn(async (o: GenParams) => { seen.push(o.max_tokens!); return complete(CHRONOLOGY_OK); });
    await runOneSection("chronology", sectionOpts(generate), {});
    expect(seen[0]).toBe(8000);
  });

  it("keeps the Quick chronology budget unchanged", async () => {
    const seen: number[] = [];
    const generate = vi.fn(async (o: GenParams) => { seen.push(o.max_tokens!); return complete(CHRONOLOGY_OK); });
    await runOneSection("chronology", sectionOpts(generate, "fast"), {});
    expect(seen[0]).toBe(3500);
  });
});

describe("a cut-off chronology is never accepted as complete", () => {
  it("when every attempt is cut off, the section fails explicitly and returns no value", async () => {
    const generate = vi.fn(async () => truncated('{"chronology":[{"date":"Jan'));
    await expect(runOneSection("chronology", sectionOpts(generate), {})).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID", retryable: true });
    expect(generate.mock.calls.length).toBeGreaterThan(1);
  });

  it("a cut-off attempt followed by a complete one yields only the complete chronology", async () => {
    const responses = [truncated('{"chronology":[{"date":"Jan'), complete(CHRONOLOGY_OK)];
    const generate = vi.fn(async () => responses.shift()!);
    const out = await runOneSection("chronology", sectionOpts(generate), {});
    expect(out.value.chronology[0].event).toBe("Referral received from the school.");
    expect(out.value.chronology).toHaveLength(1); // the cut-off fragment is not merged in
  });

  it("a cut-off response is retried with a shorter-answer instruction, not repeated verbatim", async () => {
    const responses = [truncated("{"), complete(CHRONOLOGY_OK)];
    const generate = vi.fn(async () => responses.shift()!);
    await runOneSection("chronology", sectionOpts(generate), {});
    const second = JSON.stringify((generate.mock.calls[1] as unknown as [GenParams])[0].messages);
    expect(second).toMatch(/cut off because it was too long/);
  });
});

describe("Forensic dispatch: chronology starts before overview", () => {
  it("the first three Forensic sections started are redFlags, thresholds and chronology (verification inputs stay first)", async () => {
    const order: string[] = [];
    const generate = vi.fn(async (o: GenParams) => { order.push(o.stage!); return complete(SECTION_OK[o.stage!] ?? "{}"); });
    await runSectionedAnalysis({ mode: "full", documentText: DOC, primaryModel: "m", requestId: "dispatch-hotfix", deadlineAt: Date.now() + 120_000, generate } as any).catch(() => undefined);
    expect(order.slice(0, 3)).toEqual(["section:redFlags", "section:thresholds", "section:chronology"]);
    expect(order.indexOf("section:chronology")).toBeLessThan(order.indexOf("section:overview"));
  });
});
