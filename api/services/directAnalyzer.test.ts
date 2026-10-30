import { describe, expect, it, vi } from "vitest";
import {
  buildDirectAnalysisPrompt,
  DIRECT_ANALYSIS_MAX_CHARS,
  DIRECT_ANALYSIS_MIN_TIME_MS,
  isEligibleForDirectAnalysis,
  runDirectAnalysis,
} from "./directAnalyzer.js";
import { AnalyzerError } from "./analyzerErrors.js";

const VALID_DIRECT_JSON = JSON.stringify({
  documentTitle: "Children's Aid Society Protection Application",
  documentType: "Protection Application",
  metadata: {
    fileNumber: "FC-26-9999",
    applicantName: "Children's Aid Society",
    respondentName: "Jane Doe",
    childNames: "Child A",
    hearingDate: "November 15, 2026",
  },
  disclaimer: "Informational only.",
  completenessScore: 85,
  completenessScoreMethod: "Standard scoring",
  evidenceStrengthIndex: {
    score: 65,
    scale: "0-100",
    label: "Evidence Strength Index",
    method: "Calculated from documented evidence.",
    components: {
      firsthandKnowledge: { score: 15, max: 20, explanation: "Worker observations" },
      sourceReliability: { score: 10, max: 15, explanation: "Named sources" },
      corroboration: { score: 10, max: 15, explanation: "Some corroborating notes" },
      documentarySupport: { score: 10, max: 15, explanation: "Police report attached" },
      internalConsistency: { score: 8, max: 10, explanation: "Internally consistent" },
      contradictoryEvidenceHandling: { score: 6, max: 10, explanation: "Acknowledges mother's statement" },
      legalAuthorityVerification: { score: 4, max: 10, explanation: "CYFSA s. 74 cited" },
      proceduralDocumentation: { score: 2, max: 5, explanation: "Service proof noted" },
    },
    calculation: "Sum of components",
    limitations: "Heuristic evaluation only.",
  },
  fileSummary:
    "This document is a formal Child Protection Application filed under the CYFSA seeking supervision orders. It alleges lack of supervision during a domestic dispute on October 12, 2026. The strongest documented support is the investigating officer's contemporaneous notes. The primary evidentiary weakness is reliance on an anonymous neighbour's telephone report. The parent should verify the 911 dispatch audio and request full society disclosure.",
  redFlags: [
    {
      id: "rf1",
      severity: "Worth Raising With Counsel",
      category: "Hearsay",
      evidenceClassification: "HEARSAY",
      phraseDetected: "An anonymous caller reported seeing the parent intoxicated.",
      explanation:
        "The passage reports a secondhand telephone allegation from an unverified source. Under Ontario child protection evidentiary standards, anonymous tips cannot substitute for firsthand observations. This document contains no independent confirmation of intoxication at that time. The allegation remains uncorroborated without toxicological records or police observations.",
      verifyRequirement: "Request 911 audio recordings and intake screening notes from the reporting date.",
      legalReference: "CYFSA s. 74",
      locationInDocument: "Page 3, Paragraph 4",
      parentActionStep: "Ask your lawyer whether to seek an order excluding the anonymous report.",
    },
  ],
  chronology: [
    {
      date: "October 12, 2026",
      event: "Society received an anonymous report alleging parent intoxication.",
      locationInDocument: "Page 3, Paragraph 4",
      evidenceClassification: "HEARSAY",
    },
  ],
  contradictions: [
    {
      description: "Worker states parent refused contact on Oct 14, but intake log notes a 20-minute phone call on Oct 14.",
      locations: ["Page 4, Para 2", "Exhibit B, Page 2"],
      significance: "Affects the worker's credibility regarding parental cooperation.",
    },
  ],
  whatToVerify: [
    "Verify the intake recording of October 14 to confirm the length and substance of the call.",
    "Obtain police CAD incident reports from October 12 to determine officer findings on scene.",
    "Request clinical notes from the family physician regarding parental health.",
  ],
  whatToAskALawyer: [
    "Question: Can the anonymous call be struck from the affidavit? | What the uploaded record shows: The worker concedes the caller refused to identify themselves | Still unknown: Whether CAS took steps to identify the caller | Source: Page 3, Paragraph 4.",
    "Question: What is our deadline to file responding materials? | What the uploaded record shows: Not determinable from the uploaded documents | Still unknown: Court hearing schedule | Source: Page 1.",
    "Question: Does the society have grounds for temporary care? | What the uploaded record shows: No immediate harm documented on scene | Still unknown: Pending drug screen results | Source: Page 5.",
  ],
  whatIsMissing: [
    "Contemporaneous police notes from the October 12 response.",
    "Any toxicological or medical assessment confirming impairment.",
    "Worker supervisor review and endorsement notes.",
  ],
  lawyerCaseBrief: [
    "ISSUE: Hearsay evidence in protection application — DOCUMENT EVIDENCE: Anonymous telephone report on Page 3 — SIGNIFICANCE: Low probative weight without corroboration — LIMITATION: CAS may argue reasonable grounds to investigate — VERIFY: Request disclosure of intake recording.",
    "ISSUE: Contradictory records regarding parental cooperation — DOCUMENT EVIDENCE: Disputed contact on October 14 — SIGNIFICANCE: Undermines society claim of avoidance — LIMITATION: Phone log does not detail discussion topics — VERIFY: Subpoena telecom records.",
    "ISSUE: Lack of firsthand observations — DOCUMENT EVIDENCE: Affiant did not attend scene — SIGNIFICANCE: Affiant's statements are information and belief under Family Law Rules 14(19) — LIMITATION: Admissible on motions with belief statement — VERIFY: Confirm whether full hearing or motion.",
  ],
});

describe("isEligibleForDirectAnalysis", () => {
  it("rejects empty or whitespace document text", () => {
    expect(isEligibleForDirectAnalysis("", Date.now() + 60_000)).toBe(false);
    expect(isEligibleForDirectAnalysis("   ", Date.now() + 60_000)).toBe(false);
  });

  it("rejects oversized documents exceeding the max character bound", () => {
    const hugeDoc = "a".repeat(DIRECT_ANALYSIS_MAX_CHARS + 1);
    expect(isEligibleForDirectAnalysis(hugeDoc, Date.now() + 60_000)).toBe(false);
  });

  it("rejects when remaining time is less than minimum budget", () => {
    const now = 100_000;
    const deadline = now + DIRECT_ANALYSIS_MIN_TIME_MS - 1;
    expect(isEligibleForDirectAnalysis("Valid document text", deadline, () => now)).toBe(false);
  });

  it("accepts valid documents within character and time boundaries", () => {
    const now = 100_000;
    const deadline = now + 90_000;
    expect(isEligibleForDirectAnalysis("Valid document text", deadline, () => now)).toBe(true);
  });
});

describe("buildDirectAnalysisPrompt", () => {
  it("includes all required Quick Review section schemas and strict rules", () => {
    const prompt = buildDirectAnalysisPrompt("The worker attended the family residence on Oct 12.");
    expect(prompt).toContain("The worker attended the family residence on Oct 12.");
    expect(prompt).toContain("documentTitle");
    expect(prompt).toContain("evidenceStrengthIndex");
    expect(prompt).toContain("redFlags");
    expect(prompt).toContain("chronology");
    expect(prompt).toContain("contradictions");
    expect(prompt).toContain("whatToAskALawyer");
    expect(prompt).toContain("VERBATIM QUOTATIONS");
    expect(prompt).toContain("EVIDENCE CLASSIFICATION");
  });

  it("includes retry correction note when supplied", () => {
    const prompt = buildDirectAnalysisPrompt("text", "Please fix missing fileSummary.");
    expect(prompt).toContain("CORRECTION REQUIRED: Please fix missing fileSummary.");
  });
});

describe("runDirectAnalysis", () => {
  const sampleDoc = "The worker attended. An anonymous caller reported seeing the parent intoxicated. The parent denied the claim.";

  it("successfully parses, validates, and emits complete direct analysis with quote verification", async () => {
    const emittedSections: string[] = [];
    const mockGenerate = vi.fn().mockResolvedValue({
      text: VALID_DIRECT_JSON,
      usage: { input_tokens: 500, output_tokens: 800 },
      model: "claude-sonnet-5",
      durationMs: 4500,
    });

    const result = await runDirectAnalysis({
      mode: "fast",
      documentText: sampleDoc,
      primaryModel: "claude-sonnet-5",
      generate: mockGenerate,
      deadlineAt: Date.now() + 90_000,
      requestId: "req_direct_test_1",
      onSectionComplete: async (key) => {
        emittedSections.push(key);
      },
    });

    expect(result).not.toBeNull();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(emittedSections).toEqual(["overview", "redFlags", "chronology", "guidance"]);

    const report = result!.report;
    expect(report.documentTitle).toBe("Children's Aid Society Protection Application");
    expect(report.evidenceStrengthIndex.score).toBe(65);
    expect(report.redFlags).toHaveLength(1);

    // Quote verification against sampleDoc
    const flag = report.redFlags[0];
    expect(flag.phraseDetected).toBe("An anonymous caller reported seeing the parent intoxicated.");
    expect(flag.quoteVerified).toBe(true);
    expect(flag.quoteVerification).toBe("EXACT");
    expect(flag.legalReference).toContain("CYFSA s. 74");

    // Chronology and guidance
    expect(report.chronology).toHaveLength(1);
    expect(report.contradictions).toHaveLength(1);
    expect(report.whatToAskALawyer).toHaveLength(3);
    expect(report.whatToAskALawyer[0]).toContain("Question:");
    expect(result!.usageByModel["claude-sonnet-5"].input_tokens).toBe(500);
    expect(result!.attempts.direct).toBe(1);
  });

  it("falls back (returns null) on oversized document without truncating or calling provider", async () => {
    const mockGenerate = vi.fn();
    const result = await runDirectAnalysis({
      mode: "fast",
      documentText: "x".repeat(DIRECT_ANALYSIS_MAX_CHARS + 10),
      primaryModel: "claude-sonnet-5",
      generate: mockGenerate,
      deadlineAt: Date.now() + 90_000,
      requestId: "req_oversized",
    });

    expect(result).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("falls back (returns null) when stopReason is max_tokens", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: '{"documentTitle": "Truncated...',
      stopReason: "max_tokens",
      model: "claude-sonnet-5",
      durationMs: 3000,
    });

    const result = await runDirectAnalysis({
      mode: "fast",
      documentText: sampleDoc,
      primaryModel: "claude-sonnet-5",
      generate: mockGenerate,
      deadlineAt: Date.now() + 90_000,
      requestId: "req_max_tokens",
    });

    expect(result).toBeNull();
  });

  it("falls back (returns null) on malformed JSON response", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: "I cannot produce JSON for this document.",
      model: "claude-sonnet-5",
      durationMs: 2000,
    });

    const result = await runDirectAnalysis({
      mode: "fast",
      documentText: sampleDoc,
      primaryModel: "claude-sonnet-5",
      generate: mockGenerate,
      deadlineAt: Date.now() + 90_000,
      requestId: "req_malformed",
    });

    expect(result).toBeNull();
  });

  it("falls back (returns null) on schema validation failure", async () => {
    // Missing fileSummary and ESI components
    const invalidJson = JSON.stringify({
      documentTitle: "Doc",
      fileSummary: "Too short",
    });

    const mockGenerate = vi.fn().mockResolvedValue({
      text: invalidJson,
      model: "claude-sonnet-5",
      durationMs: 2000,
    });

    const result = await runDirectAnalysis({
      mode: "fast",
      documentText: sampleDoc,
      primaryModel: "claude-sonnet-5",
      generate: mockGenerate,
      deadlineAt: Date.now() + 90_000,
      requestId: "req_invalid_schema",
    });

    expect(result).toBeNull();
  });

  it("falls back (returns null) on retryable provider error", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(
      new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "Service busy", true)
    );

    const result = await runDirectAnalysis({
      mode: "fast",
      documentText: sampleDoc,
      primaryModel: "claude-sonnet-5",
      generate: mockGenerate,
      deadlineAt: Date.now() + 90_000,
      requestId: "req_transient_err",
    });

    expect(result).toBeNull();
  });

  it("re-throws non-retryable provider error (e.g. invalid credentials)", async () => {
    const fatalError = new AnalyzerError("AI_PROVIDER_CONFIGURATION_ERROR", 401, "Invalid API key", false);
    const mockGenerate = vi.fn().mockRejectedValue(fatalError);

    await expect(
      runDirectAnalysis({
        mode: "fast",
        documentText: sampleDoc,
        primaryModel: "claude-sonnet-5",
        generate: mockGenerate,
        deadlineAt: Date.now() + 90_000,
        requestId: "req_fatal_err",
      })
    ).rejects.toThrow("Invalid API key");
  });
});
