import { describe, expect, it } from "vitest";
import { PARENTAL_RIGHTS } from "../../shared/parentalRights.js";
import { RIGHT_TRIGGERS, buildSectionedReport, matchRight, reportTextForTriggers } from "../../shared/reportSections.js";
import { RIGHT_CONDITIONS } from "../../shared/parentalRights.js";

const JUDICIAL_ENDORSEMENT = {
  documentType: "Court Endorsement",
  fileSummary: "The judge adjourned the matter. The child remains in care under an interim order.",
  documentAuthority: { recordKind: "JUDICIAL_ENDORSEMENT", statement: "Legal authority." },
  redFlags: [
    {
      id: "rf1",
      category: "Authority Overreach",
      severity: "Worth Raising With Counsel",
      evidenceClassification: "JUDICIAL_FINDING",
      phraseDetected: "I find that the concerns are supported.",
      explanation: "The judge states a finding.",
      verifyRequirement: "Obtain the transcript.",
      legalReference: "",
      locationInDocument: "Page 1",
      parentActionStep: "Ask counsel.",
      quoteVerified: true,
    },
  ],
  whatIsMissing: ["The affidavit referred to in the reasons."],
};

const GROCERY_NOTE = { documentType: "Note", fileSummary: "A shopping list for the week.", redFlags: [] };

describe("right triggers", () => {
  it("has conditions and exceptions for every verified right", () => {
    for (const r of PARENTAL_RIGHTS) {
      expect(RIGHT_CONDITIONS[r.id]?.conditions.length, r.id).toBeGreaterThan(0);
      expect(RIGHT_CONDITIONS[r.id]?.exceptions.length, r.id).toBeGreaterThan(0);
    }
  });

  it("has a trigger list for every verified right, and no trigger for an unknown id", () => {
    for (const r of PARENTAL_RIGHTS) expect(RIGHT_TRIGGERS[r.id], r.id).toBeDefined();
    for (const id of Object.keys(RIGHT_TRIGGERS)) expect(PARENTAL_RIGHTS.some((r) => r.id === id), id).toBe(true);
  });

  it("returns the matched term so the reason is visible", () => {
    const entry = PARENTAL_RIGHTS.find((r) => r.id === "adjournment-limit")!;
    expect(matchRight(entry, "The matter was adjourned to June.")).toBe("adjourn");
  });

  it("does not apply any right to an unrelated document", () => {
    const sectioned = buildSectionedReport(GROCERY_NOTE);
    expect(sectioned.findings.some((f) => f.id.startsWith("R-"))).toBe(false);
  });
});

describe("Section 5 rights in the sectioned report", () => {
  it("adds only rights whose triggers appear in the report", () => {
    const sectioned = buildSectionedReport(JUDICIAL_ENDORSEMENT);
    const ids = sectioned.findings.filter((f) => f.id.startsWith("R-")).map((f) => f.id);
    expect(ids).toContain("R-adjournment-limit");
    expect(ids).toContain("R-parent-rights-in-care");
    expect(ids).toContain("R-evidence-admissibility"); // the referenced affidavit mentions "affidavit"
    expect(ids).not.toContain("R-five-day-hearing"); // no place-of-safety removal in this report
  });

  it("labels a keyword match as a candidate with its conditions not established", () => {
    const sectioned = buildSectionedReport(JUDICIAL_ENDORSEMENT);
    const right = sectioned.findings.find((f) => f.id === "R-adjournment-limit")!;
    expect(right.title).toMatch(/^Possibly relevant:/);
    expect(right.whatHappened).toMatch(/Candidate only\. .* does not show the conditions below are met\./);
    expect(right.legalTestResult).toBe("Conditions not established");
    expect(right.whatIsUnknown).toContain("The adjournment is for more than 30 days.");
    expect(right.whatIsUnknown).toContain("All parties present");
    expect(JSON.stringify(sectioned)).not.toMatch(/\bviolat|\bbreach(ed)? of|unlawful/i);
  });

  it("cites the statute with its verbatim quote and the verification status", () => {
    const sectioned = buildSectionedReport(JUDICIAL_ENDORSEMENT);
    const right = sectioned.findings.find((f) => f.id === "R-adjournment-limit")!;
    expect(right.authorities[0]).toEqual({ citation: "CYFSA s. 94(1)", status: "VERIFIED_IN_REPOSITORY_REFERENCE" });
    expect(right.whatLawSays).toContain("The court shall not adjourn a hearing for more than 30 days,");
  });

  it("keeps the analyzer's own findings and all sixteen sections", () => {
    const sectioned = buildSectionedReport(JUDICIAL_ENDORSEMENT);
    expect(sectioned.sections).toHaveLength(16);
    expect(sectioned.findings.some((f) => f.legacyId === "rf1")).toBe(true);
    expect(sectioned.sections.find((s) => s.id === "S04")!.findingIds.length).toBeGreaterThan(0);
  });

  it("does not change the input report", () => {
    const before = JSON.stringify(JUDICIAL_ENDORSEMENT);
    buildSectionedReport(JUDICIAL_ENDORSEMENT);
    expect(JSON.stringify(JUDICIAL_ENDORSEMENT)).toBe(before);
  });

  it("builds trigger text only from report content, never from operating metadata", () => {
    const text = reportTextForTriggers({
      fileSummary: "Plain",
      modelMetadata: { engineName: "Adjourn Engine" },
      forensicVerification: { overallAssessment: "Hearsay checked" },
    });
    expect(text).toContain("Plain");
    expect(text).not.toContain("Adjourn Engine");
    expect(text).not.toContain("Hearsay checked");
  });
});
