import { describe, expect, it } from "vitest";
import { buildCourtPrep } from "../../shared/courtPrep";
import { buildPrepNotes } from "../../shared/courtPrepNotes";
import { redactForExport } from "../../shared/exportRedaction";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures";
import { renderReportSectionsHtml } from "./reportSectionsHtml";

const NAME = "Zed Plaintiffname";
const FILE_NO = "FN-12345";

/** A fixture with a planted name and file number in every free-text place the exports read. */
function withPlantedIdentifiers(): any {
  const report: any = JSON.parse(JSON.stringify(ALL_REPORT_FIXTURES.casAffidavit));
  report.documentType = `Affidavit of ${NAME} ${FILE_NO}`;
  report.fileSummary = `${NAME} says the child was left alone.`;
  report.metadata = { ...(report.metadata ?? {}), fileNumber: FILE_NO, parties: [NAME] };
  for (const flag of report.redFlags ?? []) {
    flag.phraseDetected = `${NAME} was left alone`;
    flag.explanation = `${NAME} is the only source`;
  }
  return report;
}

describe("redacted HTML export", () => {
  it("removes a planted name and file number from every free-text field", () => {
    const html = renderReportSectionsHtml(withPlantedIdentifiers(), "parent", `Title ${NAME} ${FILE_NO}`, { redact: true });
    expect(html).not.toContain(NAME);
    expect(html).not.toContain(FILE_NO);
  });

  it("states that the redacted copy is not guaranteed to be anonymous", () => {
    const html = renderReportSectionsHtml(withPlantedIdentifiers(), "parent", "T", { redact: true });
    expect(html).toContain("not guaranteed to be anonymous");
  });

  it("the unredacted export keeps the same text, so the test above is meaningful", () => {
    const html = renderReportSectionsHtml(withPlantedIdentifiers(), "parent", `Title ${NAME}`, { redact: false });
    expect(html).toContain(NAME);
    expect(html).not.toContain("not guaranteed to be anonymous");
  });

  it("keeps the title caveat in the redacted copy when the original title names an order", () => {
    const report = withPlantedIdentifiers();
    report.documentType = "Final Court Order";
    const html = renderReportSectionsHtml(report, "parent", "T", { redact: true });
    expect(html).toContain("The title names an order or decision");
  });
});

describe("redacted court-preparation notes", () => {
  it("removes a planted name from the title, the timeline, and the parent's own words", () => {
    const report = withPlantedIdentifiers();
    const prep = buildCourtPrep(report);
    const responses: any = { someAllegation: { allegationFindingId: "someAllegation", parentAccount: `${NAME} was at work.`, supportingEntryIds: [], contraryEntryIds: [], unverifiedPoints: [], questionsForCounsel: [`Ask ${NAME}.`] } };
    const text = buildPrepNotes(prep, responses, `Title ${NAME}`, { redact: true });
    expect(text).not.toContain(NAME);
    expect(text).toContain("not guaranteed to be anonymous");
  });

  it("the unredacted notes keep the title, so the test above is meaningful", () => {
    const prep = buildCourtPrep(withPlantedIdentifiers());
    const text = buildPrepNotes(prep, {}, `Title ${NAME}`, { redact: false });
    expect(text).toContain(NAME);
  });
});

describe("redactForExport", () => {
  it("does not modify its input", () => {
    const report = withPlantedIdentifiers();
    const before = JSON.stringify(report);
    redactForExport(report);
    expect(JSON.stringify(report)).toBe(before);
  });

  it("keeps legal references but not analyzer severity text", () => {
    const out: any = redactForExport({ legalReference: "CYFSA s. 88", severity: "CRITICAL", explanation: "Name" });
    expect(out.legalReference).toBe("CYFSA s. 88");
    expect(out.severity).not.toBe("CRITICAL");
    expect(out.explanation).not.toBe("Name");
  });
});

describe("redaction keeps only enums and ids", () => {
  it("removes a planted name from severity, threshold, test-result, and timeline fields", () => {
    const report: any = withPlantedIdentifiers();
    report.redFlags[0].severity = `Severe, ${NAME} absent`;
    report.thresholdAnalysis = [{ thresholdChecked: `Grounds for ${NAME}`, isMet: `Yes, ${NAME} absent`, reasoning: "x", primarySourceLaw: "CYFSA s. 74" }];
    report.proceduralTimelineViolations = [{ timelineRule: `Five days for ${NAME}`, evaluation: "x", citation: "CYFSA s. 88" }];
    const html = renderReportSectionsHtml(report, "professional", "T", { redact: true });
    expect(html).not.toContain(NAME);
    expect(html).toContain("CYFSA s. 74");
  });

  it("keeps an empty parent answer empty, so it does not look written", () => {
    const out: any = redactForExport({ parentAccount: "", other: "text" });
    expect(out.parentAccount).toBe("");
    expect(out.other).not.toBe("text");
  });

  it("shows the title caveat in the unredacted court-prep notes", () => {
    const prep = buildCourtPrep(withPlantedIdentifiers());
    expect(buildPrepNotes(prep, {}, "Final Order", { redact: false })).toMatch(/title alone does not show/);
  });
});

describe("title caveat and classification in exports", () => {
  it("shows the caveat when the shown title names an order, even if documentType does not", () => {
    const report: any = withPlantedIdentifiers();
    report.documentType = "Child Protection Application";
    const html = renderReportSectionsHtml(report, "parent", "Final Order 2026", { redact: false });
    expect(html).toContain("The title names an order or decision");
  });

  it("does not export free text stored under evidenceClassification in a redacted copy", () => {
    const report: any = withPlantedIdentifiers();
    report.redFlags[0].evidenceClassification = `Hearsay from ${NAME}`;
    const html = renderReportSectionsHtml(report, "professional", "T", { redact: true });
    expect(html).not.toContain(NAME);
  });
});

describe("legal references in redacted copies", () => {
  it("removes a planted name placed in legalReference and citation prose", () => {
    const report: any = withPlantedIdentifiers();
    report.redFlags[0].legalReference = `${NAME} statute citation unverified`;
    report.redFlags[0].citation = `${NAME} CYFSA s. 74(2)`;
    const html = renderReportSectionsHtml(report, "parent", "T", { redact: true });
    expect(html).not.toContain(NAME);
  });

  it("keeps a short citation such as CYFSA s. 74(2)", () => {
    const out: any = redactForExport({ legalReference: "CYFSA s. 74(2)", citation: "s. 88" });
    expect(out.legalReference).toBe("CYFSA s. 74(2)");
    expect(out.citation).toBe("s. 88");
  });
});

describe("citation grammar", () => {
  it("does not keep a name that follows a citation", () => {
    const out: any = redactForExport({ legalReference: "s. 74 and Zed Plaintiffname", citation: "CYFSA s. 74(2) or Zed Plaintiffname" });
    expect(out.legalReference).not.toMatch(/Zed/);
    expect(out.citation).not.toMatch(/Zed/);
  });
});

describe("citation parentheses and notes caveat", () => {
  it("does not keep a name inside a citation's parentheses", () => {
    const out: any = redactForExport({ legalReference: "CYFSA s. 74(Zed)", citation: "s. 74(zqname)" });
    expect(out.legalReference).not.toMatch(/Zed/);
    expect(out.citation).not.toMatch(/zqname/i);
  });

  it("keeps the title caveat in a redacted court-prep copy when the title names an order", () => {
    const prep = buildCourtPrep(withPlantedIdentifiers());
    expect(buildPrepNotes(prep, {}, "Final Order 2026", { redact: true })).toMatch(/title alone does not show/);
  });
});
