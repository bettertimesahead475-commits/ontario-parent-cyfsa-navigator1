import { describe, expect, it } from "vitest";
import {
  applyReportGuards,
  applyDocumentAuthorityPolicy,
  isJudicialRecordType,
  EVIDENCE_CLASSIFICATIONS,
} from "./analyzerSections.js";
import { vi } from "vitest";
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, isVerificationRequest } from "../analyzerTestFixtures.js";
import { runSectionedAnalysis, type GenerateFn } from "./analyzerSections.js";

// Sanitized regression fixture. It reproduces the failure modes from the prior judicial-endorsement
// report: a court endorsement scored as if it were a credibility claim, judge's findings tagged as
// OPINION, and an affidavit that was referred to but not uploaded, tagged as HEARSAY. No real
// party, file number, or document text is used.
const ENDORSEMENT_TEXT = [
  "Endorsement of Justice J. Example, dated June 1, 2026.",
  "The court has reviewed the materials filed by the applicant.",
  "I find that the applicant's concerns about school attendance are supported by the reasons given.",
  "The respondent's affidavit of June 2 is referred to in these reasons but was not included in the record.",
  "The matter is adjourned to a later date. Temporary order continues.",
].join("\n");

function endorsementReport(documentType = "Court Endorsement") {
  return {
    ...COMPLETE_ANALYSIS,
    documentType,
    documentTitle: "Endorsement (sanitized)",
    completenessScore: 25,
    evidenceStrengthIndex: { ...COMPLETE_ANALYSIS.evidenceStrengthIndex, score: 28 },
    redFlags: [
      {
        id: "rf1",
        severity: "Worth Raising With Counsel",
        category: "Authority Overreach",
        evidenceClassification: "OPINION",
        phraseDetected: "I find that the applicant's concerns about school attendance are supported",
        explanation: "The judge states a finding and its basis.",
        verifyRequirement: "Obtain the hearing transcript.",
        legalReference: "",
        locationInDocument: "Page 1, Paragraph 3",
        parentActionStep: "Ask counsel what the finding relied on.",
      },
      {
        id: "rf2",
        severity: "Affects Evidentiary Weight",
        category: "Hearsay",
        evidenceClassification: "HEARSAY",
        phraseDetected: "The respondent's affidavit of June 2 is referred to in these reasons but was not included in the record.",
        explanation: "The reasons rely on an affidavit that is not in the upload.",
        verifyRequirement: "Obtain the affidavit of June 2 from the court file.",
        legalReference: "",
        locationInDocument: "Page 1, Paragraph 4",
        parentActionStep: "Request the affidavit from the court file.",
      },
    ],
    chronology: [
      {
        date: "June 1, 2026",
        event: "The court reviewed the materials and adjourned the matter.",
        locationInDocument: "Page 1, Paragraph 2",
        evidenceClassification: "OPINION",
      },
    ],
  };
}

describe("court record classification: vocabulary", () => {
  it("includes the legal-document and finding labels alongside the eight core labels", () => {
    for (const label of ["COURT_ORDER", "JUDICIAL_ENDORSEMENT", "JUDICIAL_FINDING", "PARTY_ALLEGATION", "REFERENCED_DOCUMENT_NOT_PROVIDED"]) {
      expect(EVIDENCE_CLASSIFICATIONS).toContain(label);
    }
    for (const label of ["DIRECT", "DOCUMENTARY", "CORROBORATED", "HEARSAY", "INFERENCE", "OPINION", "UNSUPPORTED", "UNCLEAR"]) {
      expect(EVIDENCE_CLASSIFICATIONS).toContain(label);
    }
  });

  it("recognises court orders and endorsements from the document type", () => {
    expect(isJudicialRecordType("Court Endorsement")).toBe(true);
    expect(isJudicialRecordType("Final Order")).toBe(true);
    expect(isJudicialRecordType("Judgment")).toBe(true);
    expect(isJudicialRecordType("Affidavit")).toBe(false);
    expect(isJudicialRecordType("Worker Observation Letter")).toBe(false);
    expect(isJudicialRecordType("Notice of Motion")).toBe(false);
  });
});

describe("court record classification: regression (sanitized judicial endorsement)", () => {
  it("withdraws the Evidence Strength Index and completeness scores for an endorsement", () => {
    const report = applyReportGuards(endorsementReport(), ENDORSEMENT_TEXT);
    expect(report.evidenceStrengthIndex.score).toBeNull();
    expect(report.evidenceStrengthIndex.scoringApplicable).toBe(false);
    expect(report.evidenceStrengthIndex.components).toEqual({});
    expect(report.completenessScore).toBeNull();
  });

  it("states that the record is not credibility-scored and that authority is not verified by the tool", () => {
    const report = applyReportGuards(endorsementReport(), ENDORSEMENT_TEXT);
    expect(report.documentAuthority).toMatchObject({
      recordKind: "JUDICIAL_ENDORSEMENT",
      scoring: "NOT_CREDIBILITY_SCORED",
    });
    expect(report.documentAuthority.authenticity).toMatch(/Not verified by this tool/);
    expect(report.documentAuthority.statement).toMatch(/legal authority/);
  });

  it("does not classify a judge's finding as an ordinary opinion", () => {
    const report = applyReportGuards(endorsementReport(), ENDORSEMENT_TEXT);
    const finding = report.redFlags.find((f: any) => f.id === "rf1");
    expect(finding.evidenceClassification).toBe("JUDICIAL_FINDING");
  });

  it("does not treat a referenced but missing affidavit as hearsay", () => {
    const report = applyReportGuards(endorsementReport(), ENDORSEMENT_TEXT);
    const missing = report.redFlags.find((f: any) => f.id === "rf2");
    expect(missing.evidenceClassification).toBe("REFERENCED_DOCUMENT_NOT_PROVIDED");
  });

  it("does not present a missing referenced record as a confirmed procedural defect", () => {
    const report = endorsementReport();
    report.redFlags[1].category = "Procedural Defect";
    report.redFlags[1].severity = "CRITICAL";
    applyDocumentAuthorityPolicy(report);
    const missing = report.redFlags.find((f: any) => f.id === "rf2");
    expect(missing.category).toBe("Referenced Record Not Provided");
    expect(missing.severity).toBe("Affects Evidentiary Weight");
  });

  it("reclassifies a judge's finding in the chronology when it is tagged as an opinion", () => {
    const report = endorsementReport();
    report.chronology[0].event = "The court found that the applicant's concerns were supported.";
    applyDocumentAuthorityPolicy(report);
    expect(report.chronology[0].evidenceClassification).toBe("JUDICIAL_FINDING");
  });

  it("leaves ordinary affidavit reports unchanged", () => {
    const original = {
      ...COMPLETE_ANALYSIS,
      documentType: "Affidavit",
      evidenceStrengthIndex: { ...COMPLETE_ANALYSIS.evidenceStrengthIndex, score: 47 },
      completenessScore: 62,
      redFlags: [
        {
          id: "rf1",
          severity: "Affects Evidentiary Weight",
          category: "Hearsay",
          evidenceClassification: "HEARSAY",
          phraseDetected: "a neighbour told me the child was left alone",
          explanation: "Second-hand account.",
          verifyRequirement: "Identify the neighbour.",
          legalReference: "",
          locationInDocument: "Page 1, Paragraph 2",
          parentActionStep: "Ask counsel about weight.",
        },
      ],
      chronology: [],
    };
    const report = applyReportGuards(structuredClone(original), DOC_AFFIDAVIT);
    expect(report.documentAuthority).toBeUndefined();
    expect(report.evidenceStrengthIndex.score).toBe(47);
    expect(report.completenessScore).toBe(62);
    expect(report.redFlags[0].evidenceClassification).toBe("HEARSAY");
  });
});

const DOC_AFFIDAVIT = "A neighbour told me the child was left alone on the evening of the event.";

describe("court record through the full sectioned pipeline (Quick Review and Forensic)", () => {
  const ok = (obj: unknown) => ({ text: JSON.stringify(obj), usage: { input_tokens: 10, output_tokens: 5 }, model: "m", durationMs: 1, stopReason: "end_turn" });
  const endorsementSections = () => {
    const r = endorsementReport();
    return { ...COMPLETE_ANALYSIS, ...r, redFlags: r.redFlags, chronology: r.chronology };
  };
  const run = (mode: "fast" | "full") => {
    const generate: GenerateFn = vi.fn(async (params: any) => ok(isVerificationRequest(params) ? VERIFICATION_RESULT : endorsementSections()));
    return runSectionedAnalysis({
      mode,
      documentText: ENDORSEMENT_TEXT,
      primaryModel: "claude-sonnet-5",
      verificationModel: mode === "full" ? "claude-opus-5" : undefined,
      generate,
      deadlineAt: Date.now() + 200_000,
      requestId: "req_court_record",
    });
  };

  for (const mode of ["fast", "full"] as const) {
    it(`withdraws scores and applies the court-record policy in ${mode} mode`, async () => {
      const { report } = await run(mode);
      expect(report.documentAuthority?.scoring).toBe("NOT_CREDIBILITY_SCORED");
      expect(report.evidenceStrengthIndex.score).toBeNull();
      expect(report.completenessScore).toBeNull();
      expect(report.redFlags.find((f: any) => f.id === "rf1").evidenceClassification).toBe("JUDICIAL_FINDING");
      expect(report.redFlags.find((f: any) => f.id === "rf2").evidenceClassification).toBe("REFERENCED_DOCUMENT_NOT_PROVIDED");
    });
  }

  it("keeps ordinary affidavits scored in Quick Review", async () => {
    const generate: GenerateFn = vi.fn(async () =>
      ok({ ...COMPLETE_ANALYSIS, documentType: "Affidavit", redFlags: [], chronology: [] })
    );
    const { report } = await runSectionedAnalysis({
      mode: "fast",
      documentText: "Affidavit text.",
      primaryModel: "claude-sonnet-5",
      generate,
      deadlineAt: Date.now() + 200_000,
      requestId: "req_affidavit",
    });
    expect(report.documentAuthority).toBeUndefined();
    expect(report.evidenceStrengthIndex.score).toBe(50);
    expect(report.completenessScore).toBe(50);
  });
});
