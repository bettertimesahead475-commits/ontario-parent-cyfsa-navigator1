import { describe, expect, it } from "vitest";
import {
  REPORT_SCHEMA_VERSION,
  REPORT_SECTIONS,
  adaptLegacyReport,
  placeRedFlag,
  presentForParent,
  presentForProfessional,
} from "../../shared/reportContract.js";

// Sanitized fixture: no real names, file numbers, or document text.
const COURT_ENDORSEMENT = {
  documentType: "Court Endorsement",
  fileSummary: "The judge reviewed the materials and adjourned the matter.",
  documentAuthority: {
    recordKind: "JUDICIAL_ENDORSEMENT",
    scoring: "NOT_CREDIBILITY_SCORED",
    authenticity: "Not verified by this tool.",
    status: "Current status not determinable from this document alone.",
    statement: "A court order has legal authority, subject to its terms and current status.",
  },
  evidenceStrengthIndex: { score: null, components: {}, scoringApplicable: false, limitations: "Not scored." },
  completenessScore: null,
  metadata: { fileNumber: "FC-00-0000" },
  redFlags: [
    {
      id: "rf1",
      category: "Authority Overreach",
      severity: "Worth Raising With Counsel",
      evidenceClassification: "JUDICIAL_FINDING",
      phraseDetected: "I find that the concerns are supported by the reasons given.",
      explanation: "The judge states a finding and its basis.",
      verifyRequirement: "Obtain the hearing transcript.",
      legalReference: "",
      locationInDocument: "Page 1, Paragraph 3",
      parentActionStep: "Ask counsel what the finding relied on.",
      quoteVerified: true,
    },
    {
      id: "rf2",
      category: "Referenced Record Not Provided",
      severity: "Affects Evidentiary Weight",
      evidenceClassification: "REFERENCED_DOCUMENT_NOT_PROVIDED",
      phraseDetected: "The affidavit of June 2 is referred to but was not included.",
      explanation: "The reasons rely on an affidavit that is not in the upload.",
      verifyRequirement: "Obtain the affidavit from the court file.",
      legalReference: "",
      locationInDocument: "Page 1, Paragraph 4",
      parentActionStep: "Request the affidavit.",
      quoteVerified: true,
    },
  ],
  chronology: [{ date: "June 1, 2026", event: "The court adjourned the matter.", locationInDocument: "Page 1", evidenceClassification: "COURT_ORDER" }],
  whatIsMissing: ["The affidavit referred to in the reasons."],
  whatToVerify: ["Obtain the affidavit from the court file."],
  whatToAskALawyer: ["Question: What did the finding rely on? | Still unknown: the transcript."],
  lawyerCaseBrief: ["ISSUE — judicial finding — DOCUMENT EVIDENCE — Page 1."],
  // Fields that must never reach the contract:
  modelMetadata: { engineName: "Engine", usage: { inputTokens: 1, outputTokens: 2 }, cost: { totalCostUsd: 0.5 }, model: "claude-x" },
  forensicVerification: { status: "completed", model: "claude-opus-5", checkedFindings: 2, overallAssessment: "Mostly supported." },
  disclaimer: "This document is generated for informational/educational purposes only.",
};

const ORDINARY_AFFIDAVIT = {
  documentType: "Affidavit",
  fileSummary: "A worker describes concerns about supervision.",
  evidenceStrengthIndex: { score: 47, components: { firsthandKnowledge: { score: 10, max: 20, explanation: "x" } }, limitations: "Heuristic only." },
  completenessScore: 62,
  redFlags: [
    {
      id: "rf1",
      category: "Hearsay",
      severity: "Affects Evidentiary Weight",
      evidenceClassification: "HEARSAY",
      phraseDetected: "a neighbour told me the child was left alone",
      explanation: "Second-hand account.",
      verifyRequirement: "Identify the neighbour.",
      legalReference: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.",
      citationStatus: "UNVERIFIED",
      locationInDocument: "Page 1, Paragraph 2",
      parentActionStep: "Ask counsel about weight.",
      quoteVerified: true,
    },
    {
      id: "rf2",
      category: "Authority Overreach",
      severity: "Worth Raising With Counsel",
      evidenceClassification: "UNSUPPORTED",
      phraseDetected: "The child was at risk.",
      explanation: "No record supports this statement.",
      verifyRequirement: "Request the risk assessment.",
      legalReference: "CYFSA s.74(2)",
      citationStatus: "CONFIRMED_REFERENCE",
      locationInDocument: "Page 2",
      parentActionStep: "Ask for the risk assessment.",
      quoteVerified: false,
    },
  ],
  contradictions: [{ description: "Dates differ.", locations: ["Page 1", "Page 3"], significance: "Possible error." }],
  whatIsMissing: ["Worker notes."],
  thresholdAnalysis: [{ thresholdChecked: "Grounds (s. 74)", isMet: "Inconclusive", reasoning: "Allegations only.", primarySourceLaw: "CYFSA 2017, Section 74" }],
};

describe("report contract: section order", () => {
  it("defines exactly sixteen sections with stable ids, in order", () => {
    expect(REPORT_SECTIONS.map((s) => s.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(REPORT_SECTIONS.map((s) => s.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`)
    );
    expect(new Set(REPORT_SECTIONS.map((s) => s.slug)).size).toBe(16);
  });

  it("uses the Phase 1 titles", () => {
    expect(REPORT_SECTIONS[0].title).toBe("Your Case at a Glance");
    expect(REPORT_SECTIONS[8].title).toBe("Possible Procedural and Legal Concerns");
    expect(REPORT_SECTIONS[15].title).toBe("Sources, Verification and Full Forensic Record");
  });

  it("returns all sixteen sections from the adapter, even for an empty report", () => {
    const c = adaptLegacyReport({});
    expect(c.sections.map((s) => s.id)).toEqual(REPORT_SECTIONS.map((s) => s.id));
    expect(c.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
  });
});

describe("legacy adapter: finding preservation", () => {
  it("keeps every red flag, chronology entry, and list item as a finding", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    const flagIds = c.findings.filter((f) => f.legacyId?.startsWith("rf")).map((f) => f.legacyId);
    expect(flagIds.sort()).toEqual(["rf1", "rf2"]);
    expect(c.findings.filter((f) => f.kind === "MISSING_RECORD")).toHaveLength(1);
    expect(c.findings.filter((f) => f.kind === "CONTRADICTION")).toHaveLength(1);
  });

  it("places each red flag in exactly one section", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    const flagFindings = c.findings.filter((f) => f.legacyId?.startsWith("rf"));
    expect(flagFindings).toHaveLength(2);
    for (const f of flagFindings) {
      const hits = c.sections.filter((s) => s.findingIds.includes(f.id));
      expect(hits).toHaveLength(1);
    }
  });

  it("gives every finding a unique id and a section that lists it", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    const ids = c.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of c.findings) {
      expect(c.sections.find((s) => s.id === f.sectionId)!.findingIds).toContain(f.id);
    }
  });

  it("produces the same ids when the same legacy report is adapted twice", () => {
    const a = adaptLegacyReport(COURT_ENDORSEMENT).findings.map((f) => f.id);
    const b = adaptLegacyReport(structuredClone(COURT_ENDORSEMENT)).findings.map((f) => f.id);
    expect(a).toEqual(b);
  });

  it("does not modify the legacy object", () => {
    const before = JSON.stringify(ORDINARY_AFFIDAVIT);
    adaptLegacyReport(ORDINARY_AFFIDAVIT);
    expect(JSON.stringify(ORDINARY_AFFIDAVIT)).toBe(before);
  });
});

describe("legacy adapter: source and authority preservation", () => {
  it("keeps the page or paragraph locator and the quoted text", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    const f = c.findings.find((x) => x.legacyId === "rf1")!;
    expect(f.sources[0].locator).toBe("Page 1, Paragraph 3");
    expect(f.sources[0].quote).toContain("I find that the concerns");
  });

  it("maps citation status to an explicit authority status", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    expect(c.findings.find((x) => x.legacyId === "rf1")!.authorities[0].status).toBe("CITATION_UNVERIFIED");
    expect(c.findings.find((x) => x.legacyId === "rf2")!.authorities[0].status).toBe("INTERNAL_REFERENCE_MATCH");
  });

  it("keeps the analyzer's statutory test result as given", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    expect(c.findings.find((x) => x.title === "Grounds (s. 74)")!.legalTestResult).toBe("Inconclusive");
  });
});

describe("legal effect wording and statute status", () => {
  it("does not copy analyzer wording about legal effect into the court-record finding", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    const court = c.findings.find((f) => f.kind === "JUDICIAL_ENDORSEMENT")!;
    expect(court.whyItMatters).not.toMatch(/legal authority/);
    expect(court.whyItMatters).toMatch(/does not show its legal effect/);
  });

  it("attaches the unverified warning to statute text with no confirmed status", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    const unverified = c.findings.find((x) => x.legacyId === "rf1")!;
    const confirmed = c.findings.find((x) => x.legacyId === "rf2")!;
    expect(unverified.whatLawSays).toMatch(/unverified/i);
    expect(confirmed.whatLawSays).not.toMatch(/Citation unverified/);
  });
});

describe("contradictions need two source passages", () => {
  it("treats a contradiction with two locations as a possible concern", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    const f = c.findings.find((x) => x.kind === "CONTRADICTION")!;
    expect(f.concern).toBe("POSSIBLE_CONCERN");
    expect(f.sources.map((s) => s.locator)).toEqual(["Page 1", "Page 3"]);
  });

  it("keeps a contradiction with one location but does not treat it as confirmed", () => {
    const c = adaptLegacyReport({
      documentType: "Worker Summary",
      contradictions: [{ description: "Dates differ.", locations: ["Page 1"], significance: "Possible error." }],
    });
    const f = c.findings.find((x) => x.kind === "CONTRADICTION")!;
    expect(f.concern).toBe("NOT_INDEPENDENTLY_VERIFIED");
    expect(f.uncertainty).toMatch(/second passage is needed/);
  });
});

describe("section status matches its content", () => {
  it("marks Section 6 not applicable, not populated, for a court document with no evidence items", () => {
    const c = adaptLegacyReport({ documentType: "Court Endorsement", documentAuthority: { recordKind: "JUDICIAL_ENDORSEMENT" }, redFlags: [] });
    const s6 = c.sections.find((s) => s.id === "S06")!;
    expect(s6.status).toBe("NOT_APPLICABLE");
    expect(s6.findingIds).toEqual([]);
  });

  it("never marks a section populated with no findings", () => {
    const reports = [ORDINARY_AFFIDAVIT, COURT_ENDORSEMENT, {}];
    for (const r of reports) {
      for (const s of adaptLegacyReport(r).sections) {
        if (s.status === "POPULATED") expect(s.findingIds.length, s.id).toBeGreaterThan(0);
      }
    }
  });

  it("does not describe Section 6 as having no evidence items when it lists some", () => {
    const s6 = adaptLegacyReport(ORDINARY_AFFIDAVIT).sections.find((s) => s.id === "S06")!;
    expect(s6.findingIds.length).toBeGreaterThan(0);
    expect(s6.note).not.toMatch(/No evidence-strength data was produced\.$/);
  });
});

describe("court records and missing records", () => {
  it("puts the court document in S04, with no evidence score in S06", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    expect(c.sections.find((s) => s.id === "S04")!.status).toBe("POPULATED");
    expect(c.sections.find((s) => s.id === "S06")!.findingIds).toEqual([]);
    expect(c.findings.find((f) => f.kind === "JUDICIAL_FINDING")).toBeDefined();
  });

  it("does not treat a missing referenced affidavit as a procedural concern", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    const missing = c.findings.find((f) => f.legacyId === "rf2")!;
    expect(missing.kind).toBe("REFERENCED_RECORD_NOT_PROVIDED");
    expect(missing.concern).toBe("MISSING_INFORMATION");
    expect(missing.sectionId).toBe("S08");
    expect(c.sections.find((s) => s.id === "S09")!.findingIds).toEqual([]);
  });

  it("marks a non-court document's S04 as not applicable", () => {
    expect(adaptLegacyReport(ORDINARY_AFFIDAVIT).sections.find((s) => s.id === "S04")!.status).toBe("NOT_APPLICABLE");
  });

  it("does not place a judicial finding in S06 or S09 by classification alone", () => {
    expect(placeRedFlag("JUDICIAL_FINDING", "Authority Overreach", true)).toBe("S04");
  });
});

describe("empty, incomplete, and unavailable sections", () => {
  it("marks sections with no analyzer source as NOT_GENERATED", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    for (const id of ["S10", "S11", "S14", "S15"]) {
      expect(c.sections.find((s) => s.id === id)!.status).toBe("NOT_GENERATED");
    }
  });

  it("marks a present-but-empty source as EMPTY, not POPULATED", () => {
    const c = adaptLegacyReport({ documentType: "Affidavit", redFlags: [], chronology: [] });
    expect(c.sections.find((s) => s.id === "S03")!.status).toBe("EMPTY");
  });

  it("handles null, non-object, and partial input without throwing", () => {
    for (const input of [null, undefined, "text", 42, [], { redFlags: "not a list" }]) {
      const c = adaptLegacyReport(input);
      expect(c.sections).toHaveLength(16);
      expect(c.findings).toEqual([]);
    }
  });

  it("records warnings for missing fields instead of guessing", () => {
    const c = adaptLegacyReport({});
    expect(c.warnings.length).toBeGreaterThan(0);
  });
});

describe("customer-cost and provider-metadata privacy", () => {
  it("does not copy cost, token, or model fields into the contract", () => {
    const serialized = JSON.stringify(adaptLegacyReport(COURT_ENDORSEMENT));
    expect(serialized).not.toMatch(/claude-|usage|totalCost|inputTokens|outputTokens|engineName|"model"/);
  });

  it("keeps the verification outcome but not the verifying model", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    expect(c.runNotes.join(" ")).toMatch(/Independent second review: completed; 2 findings checked/);
    expect(JSON.stringify(c)).not.toMatch(/claude-opus/);
  });
});

describe("no invented findings", () => {
  it("creates no finding that has no matching legacy item", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    const legacyTexts = JSON.stringify(ORDINARY_AFFIDAVIT);
    for (const f of c.findings) {
      const anchor = f.legacyId ?? f.title;
      expect(legacyTexts.includes(anchor) || f.sectionId === "S06" || f.kind === "SUMMARY" || legacyTexts.includes(f.whatHappened.slice(0, 20))).toBe(true);
    }
  });

  it("does not claim court decisions, forms, or deadlines the analyzer never produced", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    for (const id of ["S10", "S11", "S14", "S15"]) {
      expect(c.findings.some((f) => f.sectionId === id)).toBe(false);
    }
  });

  it("leaves supporting, contrary, and related links empty when the analyzer gave none", () => {
    for (const f of adaptLegacyReport(ORDINARY_AFFIDAVIT).findings) {
      expect(f.supportingFindingIds).toEqual([]);
      expect(f.contraryFindingIds).toEqual([]);
      expect(f.relatedFindingIds).toEqual([]);
    }
  });
});

describe("parent and professional parity", () => {
  it("both presentations list the same findings in the same section order", () => {
    const c = adaptLegacyReport(COURT_ENDORSEMENT);
    const parent = presentForParent(c);
    const pro = presentForProfessional(c);
    expect(parent.map((s) => s.id)).toEqual(pro.map((s) => s.id));
    expect(parent.map((s) => s.findings.map((f) => f.id))).toEqual(pro.map((s) => s.findings.map((f) => f.id)));
  });

  it("the professional view keeps sources and authorities the parent view also shows", () => {
    const c = adaptLegacyReport(ORDINARY_AFFIDAVIT);
    const parent = presentForParent(c).flatMap((s) => s.findings);
    const pro = presentForProfessional(c).flatMap((s) => s.findings);
    for (const p of parent) {
      const match = pro.find((x) => x.id === p.id)!;
      expect(match.sourceLocators).toEqual(p.sourceLocators);
      expect(match.whatHappened).toBe(p.whatHappened);
    }
    expect(JSON.stringify(pro)).not.toContain("legacyId"); // internal to the contract
    expect(pro.some((x) => x.authorities.length > 0)).toBe(true);
  });

  it("the parent view uses plain concern labels, not internal status codes", () => {
    const parentLabels = presentForParent(adaptLegacyReport(ORDINARY_AFFIDAVIT))
      .flatMap((s) => s.findings)
      .map((f) => f.concernLabel);
    expect(parentLabels.join(" ")).not.toMatch(/POSSIBLE_CONCERN|MISSING_INFORMATION|NOT_INDEPENDENTLY/);
  });
});

describe("Section 6 status, findings, and note agree across document types", () => {
  const COURT_ORDER_WITH_HEARSAY = {
    ...COURT_ENDORSEMENT,
    documentType: "Court Order",
    documentAuthority: { ...COURT_ENDORSEMENT.documentAuthority, recordKind: "JUDICIAL_ORDER" },
    redFlags: [
      {
        id: "hs1",
        category: "Hearsay",
        severity: "Affects Evidentiary Weight",
        evidenceClassification: "HEARSAY",
        phraseDetected: "a neighbour said the child was left alone",
        explanation: "Second-hand account recorded in the order.",
        verifyRequirement: "Identify the source.",
        legalReference: "",
      },
    ],
  };
  const AFFIDAVIT_WITHOUT_SCORE = { documentType: "Affidavit", fileSummary: "A short statement.", redFlags: [], evidenceStrengthIndex: null, completenessScore: null };
  const CONTRADICTORY = {
    documentType: "Affidavit",
    fileSummary: "Two accounts of the same visit disagree.",
    evidenceStrengthIndex: { score: 30, components: {}, limitations: "Heuristic only." },
    completenessScore: 40,
    redFlags: [
      {
        id: "ct1",
        category: "Contradiction",
        severity: "Affects Evidentiary Weight",
        evidenceClassification: "CONTRADICTION",
        phraseDetected: "I was home all evening",
        explanation: "Conflicts with the earlier statement about the visit.",
        verifyRequirement: "Compare with the other account.",
        legalReference: "",
      },
    ],
  };
  const CASES: Record<string, unknown> = {
    ordinaryAffidavitWithScore: ORDINARY_AFFIDAVIT,
    affidavitWithoutScore: AFFIDAVIT_WITHOUT_SCORE,
    courtEndorsement: COURT_ENDORSEMENT,
    courtOrderWithHearsayFlag: COURT_ORDER_WITH_HEARSAY,
    emptyReport: {},
    contradictoryEvidence: CONTRADICTORY,
  };

  for (const [name, report] of Object.entries(CASES)) {
    it(`keeps Section 6 consistent for ${name}`, () => {
      const s6 = adaptLegacyReport(report).sections.find((s) => s.id === "S06")!;
      if (s6.status === "POPULATED") expect(s6.findingIds.length, "populated needs findings").toBeGreaterThan(0);
      else expect(s6.findingIds, "no findings unless populated").toEqual([]);
      if (s6.note.includes("No evidence-strength score was produced")) {
        expect((report as { evidenceStrengthIndex?: { score?: unknown } }).evidenceStrengthIndex?.score ?? null, "note denies a score that exists").toBeNull();
      }
    });
  }

  it("keeps a real evidence-strength score visible in Section 6's note", () => {
    const s6 = adaptLegacyReport(ORDINARY_AFFIDAVIT).sections.find((s) => s.id === "S06")!;
    expect(s6.note).not.toMatch(/No evidence-strength score was produced/);
  });

  it("does not hide a hearsay finding in a court order", () => {
    const s6 = adaptLegacyReport(COURT_ORDER_WITH_HEARSAY).sections.find((s) => s.id === "S06")!;
    expect(s6.status).toBe("POPULATED");
    expect(s6.findingIds.length).toBeGreaterThan(0);
  });

  it("keeps the contradiction visible without a verified score", () => {
    const c = adaptLegacyReport(CONTRADICTORY);
    expect(c.sections.find((s) => s.id === "S06")!.status).toBe("POPULATED");
  });
});
