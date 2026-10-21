import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EVENT_TYPE_LABEL,
  VERIFIED_DEADLINE_RULES,
  buildCourtPrep,
  buildChronology,
  buildEvidenceIndex,
  checkResponse,
  dateChecks,
  parseWrittenDate,
  type FactualResponse,
} from "../../shared/courtPrep.js";
import { buildSectionedReport } from "../../shared/reportSections.js";
import { COURT_FORMS } from "../../shared/courtPrepForms.js";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures.js";
import { REAL_ONTARIO_FORM_CANDIDATES } from "./officialFormSourceManifest.js";

const DATED = {
  documentType: "Worker Summary",
  fileSummary: "Summary of visits.",
  redFlags: [
    { id: "rf1", category: "Unsupported Claim", severity: "Affects Evidentiary Weight", evidenceClassification: "UNSUPPORTED", phraseDetected: "The child was left alone.", explanation: "No record.", verifyRequirement: "Obtain the log.", legalReference: "", locationInDocument: "Page 2", parentActionStep: "Ask.", quoteVerified: true },
  ],
  chronology: [
    { date: "March 5, 2026", event: "The worker visited the home.", locationInDocument: "Page 3", evidenceClassification: "DOCUMENTARY" },
    { date: "March 3, 2026", event: "The worker says the child was left alone.", locationInDocument: "Page 1", evidenceClassification: "PARTY_ALLEGATION" },
    { date: "sometime in spring", event: "A neighbour mentioned concerns.", locationInDocument: "Page 4", evidenceClassification: "HEARSAY" },
  ],
  contradictions: [
    { description: "The summary dates the visit to March 3, 2026; the log dates it to March 5, 2026.", locations: ["Page 1", "Page 3"], significance: "Dates differ." },
  ],
  whatIsMissing: [],
};

describe("chronology", () => {
  it("sorts dated rows first in date order and keeps unparsed rows last", () => {
    const rows = buildChronology(buildSectionedReport(DATED));
    const dates = rows.map((r) => r.dateAsWritten);
    expect(dates.indexOf("March 3, 2026")).toBeLessThan(dates.indexOf("March 5, 2026"));
    expect(dates[dates.length - 1]).toBe("sometime in spring");
  });

  it("types each row from the analyzer finding, never inventing a type", () => {
    const rows = buildChronology(buildSectionedReport(DATED));
    const byEvent = Object.fromEntries(rows.map((r) => [r.event, r.eventType]));
    expect(byEvent["The worker says the child was left alone."]).toBe("ALLEGED_EVENT");
    expect(byEvent["The worker visited the home."]).toBe("DOCUMENT_EVENT");
    expect(byEvent["A neighbour mentioned concerns."]).toBe("UNCLASSIFIED_EVENT");
  });

  it("flags a date that another passage contradicts, and cites both", () => {
    const rows = buildChronology(buildSectionedReport(DATED));
    const disputed = rows.find((r) => r.dateAsWritten === "March 3, 2026")!;
    expect(disputed.disputedByFindingIds.length).toBeGreaterThan(0);
    expect(dateChecks(rows).find((c) => c.dateAsWritten === "March 3, 2026")!.status).toBe("DISPUTED_NEEDS_CONFIRMATION");
  });

  it("keeps the source reference on every row", () => {
    for (const row of buildChronology(buildSectionedReport(DATED))) {
      expect(row.source.length).toBeGreaterThan(0);
      expect(row.source[0].locator).not.toBe("");
    }
  });

  it("types a court endorsement's dated entry as a court order", () => {
    const rows = buildChronology(buildSectionedReport(ALL_REPORT_FIXTURES.judicialEndorsement));
    expect(rows.some((r) => r.eventType === "COURT_ORDER")).toBe(true);
  });

  it("parses only unambiguous calendar dates", () => {
    expect(parseWrittenDate("March 3, 2026")).toBe("2026-03-03");
    expect(parseWrittenDate("03/03/2026")).toBeNull();
    expect(parseWrittenDate("sometime in spring")).toBeNull();
  });

  it("gives a stated hearing date its own type, never a completed-hearing type", () => {
    const rows = buildChronology(
      buildSectionedReport({ ...DATED, metadata: { hearingDate: "June 1, 2026" } })
    );
    const hearing = rows.find((r) => r.eventType === "STATED_HEARING_DATE");
    expect(hearing?.dateAsWritten).toBe("June 1, 2026");
    expect(EVENT_TYPE_LABEL.STATED_HEARING_DATE).toMatch(/not confirmed as held/);
  });

  it("returns no rows for a report with no timeline", () => {
    expect(buildChronology(buildSectionedReport({ documentType: "Note" }))).toEqual([]);
  });
});

describe("evidence index", () => {
  it("has one entry per distinct passage, linked to every citing finding", () => {
    const contract = buildSectionedReport(DATED);
    const index = buildEvidenceIndex(contract);
    const keys = index.map((e) => `${e.documentId}|${e.locator}|${e.quote}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of index) expect(entry.findingIds.length).toBeGreaterThan(0);
  });

  it("gives the same ids when built twice", () => {
    const a = buildEvidenceIndex(buildSectionedReport(DATED)).map((e) => e.id);
    const b = buildEvidenceIndex(buildSectionedReport(DATED)).map((e) => e.id);
    expect(a).toEqual(b);
  });
});

describe("factual responses", () => {
  const index = buildEvidenceIndex(buildSectionedReport(DATED));
  const base: FactualResponse = {
    allegationFindingId: "x",
    parentAccount: "",
    supportingEntryIds: [],
    contraryEntryIds: [],
    unverifiedPoints: [],
    questionsForCounsel: [],
  };

  it("does not treat an empty response as written", () => {
    expect(checkResponse(base, index).status).toBe("NOT_YET_WRITTEN");
  });

  it("reports evidence references that are not in the index", () => {
    const r = checkResponse({ ...base, parentAccount: "I was at work.", supportingEntryIds: ["E-missing"] }, index);
    expect(r.problems[0]).toMatch(/E-missing/);
  });

  it("marks a written account with no records as having no records", () => {
    expect(checkResponse({ ...base, parentAccount: "I was at work." }, index).status).toBe("WRITTEN_WITHOUT_RECORDS");
  });

  it("marks a written account with a record as having records", () => {
    const id = index[0].id;
    expect(checkResponse({ ...base, parentAccount: "I was at work.", supportingEntryIds: [id] }, index).status).toBe("WRITTEN_WITH_RECORDS");
  });
});

describe("deadlines and dates", () => {
  it("calculates no deadline: no verified rule is connected", () => {
    expect(VERIFIED_DEADLINE_RULES).toHaveLength(0);
  });

  it("never describes a stated date as a deadline or as due", () => {
    const prep = buildCourtPrep(DATED);
    const text = JSON.stringify(prep.dateChecks);
    expect(text).not.toMatch(/deadline|\bdue\b|must be filed/i);
    expect(prep.dateChecks.every((c) => c.status.endsWith("NEEDS_CONFIRMATION"))).toBe(true);
  });
});

describe("form information", () => {
  it("matches the repository manifest exactly: number, title, version, and effective date", () => {
    const manifest = REAL_ONTARIO_FORM_CANDIDATES.map((f) => ({
      formNumber: f.formNumber,
      title: f.officialTitle,
      versionDate: f.versionDateRaw,
      effectiveDate: f.effectiveDateRaw,
    })).sort((a, b) => a.formNumber.localeCompare(b.formNumber));
    const local = COURT_FORMS.map((f) => ({
      formNumber: f.formNumber,
      title: f.title,
      versionDate: f.versionDate,
      effectiveDate: f.effectiveDate,
    })).sort((a, b) => a.formNumber.localeCompare(b.formNumber));
    expect(local).toEqual(manifest);
  });

  it("shows every form's currentness as unknown", () => {
    expect(COURT_FORMS.every((f) => f.currentness === "UNKNOWN")).toBe(true);
  });
});

describe("workspace isolation", () => {
  it("builds from one report only, with no shared state between calls", () => {
    const a = buildCourtPrep(DATED);
    const b = buildCourtPrep(ALL_REPORT_FIXTURES.casAffidavit);
    expect(a.contract.documentId).toBe(b.contract.documentId);
    expect(a.chronology.some((r) => r.event === "The worker visited the home.")).toBe(true);
    expect(b.chronology.some((r) => r.event === "The worker visited the home.")).toBe(false);
  });
});
