import { describe, it, expect } from "vitest";
import { applyReportGuards } from "./analyzerSections";
import { mapPdfFields, type PdfWidgetInput } from "./officialFormPdfSemanticMap";
import { buildFormFieldFact, guardFormFieldFacts, FIELD_NOT_ESTABLISHED_TEXT, reportableRoles } from "./formFieldFacts";

const SOURCE = { formNumber: "14A", sourceSha256: "a".repeat(64) };

// Synthetic widgets with printed text written out. The field names are deliberately misleading, so any mapping
// that relied on the name would fail these tests.
const widgets: PdfWidgetInput[] = [
  { name: "looks_like_a_court_number", page: 1, type: "Tx", left: "", above: "Court File Number", below: "" },
  { name: "innocent_name_but_no_printed_label", page: 1, type: "Tx", left: "", above: "", below: "" },
  { name: "conflicting", page: 1, type: "Tx", left: "", above: "Court File Number", below: "" },
  { name: "conflicting", page: 2, type: "Tx", left: "", above: "", below: "" }
];
const mapped = mapPdfFields(widgets);
const byName = (n: string) => mapped.find(m => m.fieldName === n)!;

describe("buildFormFieldFact", () => {
  it("states a label role only when the mapping confirmed it from printed text", () => {
    const fact = buildFormFieldFact(byName("looks_like_a_court_number"), "1234", SOURCE);
    expect(fact.labelRoleStatus).toBe("CONFIRMED_BY_LABEL");
    expect(fact.labelRole).toBe("COURT_FILE_NUMBER");
    expect(fact.printedLabel).toBe("Court File Number");
    expect(fact.reportText).toContain('printed as "Court File Number"');
    expect(fact.reportText).toContain('contains "1234"');
    expect(fact.reportText).toContain("does not show who entered the value");
  });

  it("never states a role for an unresolved field, even when a value is present", () => {
    const fact = buildFormFieldFact(byName("innocent_name_but_no_printed_label"), "Jordan Lee", SOURCE);
    expect(fact.labelRole).toBeNull();
    expect(fact.labelRoleStatus).toBe("NOT_ESTABLISHED");
    expect(fact.reportText).toBe(FIELD_NOT_ESTABLISHED_TEXT);
    expect(fact.enteredValue).toBe("Jordan Lee");
  });

  it("keeps presence and an empty value separate: a blank field is still present and is not dropped", () => {
    const fact = buildFormFieldFact(byName("innocent_name_but_no_printed_label"), "   ", SOURCE);
    expect(fact.presence).toBe("FIELD_PRESENT");
    expect(fact.enteredValue).toBeNull();
  });

  it("never attributes a party or assesses legal significance from a field alone", () => {
    const fact = buildFormFieldFact(byName("looks_like_a_court_number"), "1234", SOURCE);
    expect(fact.partyAttribution).toBe("NOT_DETERMINED");
    expect(fact.legalSignificance).toBe("NOT_ASSESSED");
  });

  it("treats a conflicting mapping as not established", () => {
    expect(byName("conflicting").status).toBe("UNRESOLVED");
    const fact = buildFormFieldFact(byName("conflicting"), null, SOURCE);
    expect(fact.labelRole).toBeNull();
    expect(fact.reportText).toBe(FIELD_NOT_ESTABLISHED_TEXT);
  });
});

describe("guardFormFieldFacts (server boundary)", () => {
  it("removes a role and replaces the text of a fact that claims confirmation without a printed label", () => {
    const report: Record<string, any> = {
      formFieldFacts: [
        { formNumber: "14A", fieldName: "x", pages: [1], enteredValue: "v", labelRole: "COURT_FILE_NUMBER", labelRoleStatus: "CONFIRMED_BY_LABEL", printedLabel: null, reportText: "The respondent is in breach." }
      ]
    };
    guardFormFieldFacts(report);
    const [fact] = report.formFieldFacts;
    expect(fact.labelRole).toBeNull();
    expect(fact.labelRoleStatus).toBe("NOT_ESTABLISHED");
    expect(fact.reportText).toBe(FIELD_NOT_ESTABLISHED_TEXT);
    expect(fact.partyAttribution).toBe("NOT_DETERMINED");
    expect(fact.legalSignificance).toBe("NOT_ASSESSED");
  });

  it("ignores caller-supplied report text: the text is always recomputed from the confirmed fields", () => {
    const report = {
      formFieldFacts: [
        { formNumber: "14A", fieldName: "x", pages: [1], enteredValue: null, labelRole: "COURT_FILE_NUMBER", labelRoleStatus: "CONFIRMED_BY_LABEL", printedLabel: "Court File Number", reportText: "The respondent is in breach of an order." }
      ]
    };
    guardFormFieldFacts(report);
    expect(report.formFieldFacts[0].reportText).not.toContain("breach");
    expect(report.formFieldFacts[0].reportText).toContain("is blank");
  });

  it("does nothing to a report without field facts", () => {
    const report = { redFlags: [] as unknown[] };
    expect(guardFormFieldFacts(report)).toEqual({ redFlags: [] });
  });
});

describe("analyzer boundary: applyReportGuards carries field facts through the same guard", () => {
  it("shows confirmed roles, keeps unresolved fields as entered only, and leaves the rest of the report intact", () => {
    const report: Record<string, any> = {
      overview: { summary: "A summary." },
      redFlags: [
        { id: "r1", severity: "low", category: "x", phraseDetected: "not a quote in the source", explanation: "e", verifyRequirement: "v", legalReference: "" }
      ],
      thresholdAnalysis: [],
      proceduralTimelineViolations: [],
      formFieldFacts: [
        buildFormFieldFact(byName("looks_like_a_court_number"), "1234", SOURCE),
        buildFormFieldFact(byName("innocent_name_but_no_printed_label"), "Jordan Lee", SOURCE)
      ]
    };
    applyReportGuards(report, null, "");
    // The rest of the report is not rejected by an unresolved field.
    expect(report.overview.summary).toBe("A summary.");
    expect(report.redFlags).toHaveLength(1);
    expect(report.redFlags[0].quoteVerified).toBeNull();
    expect(reportableRoles(report)).toEqual(["COURT_FILE_NUMBER"]);
    expect(report.formFieldFacts[1].reportText).toBe(FIELD_NOT_ESTABLISHED_TEXT);
    expect(report.formFieldFacts[1].enteredValue).toBe("Jordan Lee");
  });

  it("leaves no unconfirmed role anywhere in the serialized report", () => {
    const report: Record<string, any> = {
      redFlags: [],
      thresholdAnalysis: [],
      proceduralTimelineViolations: [],
      formFieldFacts: [
        buildFormFieldFact(byName("innocent_name_but_no_printed_label"), "x", SOURCE),
        buildFormFieldFact(byName("conflicting"), "y", SOURCE)
      ]
    };
    applyReportGuards(report, null, "");
    const json = JSON.stringify(report);
    expect(json).not.toContain('"labelRole":"');
    expect(json).not.toContain("COURT_FILE_NUMBER");
  });

  it("still applies to a report whose sources are authenticated pages (the guard does not depend on the quote path)", () => {
    const pages = new Map<number, string>([[1, "Court File Number 1234"]]);
    const report: Record<string, any> = {
      redFlags: [],
      thresholdAnalysis: [],
      proceduralTimelineViolations: [],
      formFieldFacts: [{ formNumber: "14A", fieldName: "f", pages: [1], enteredValue: "x", labelRole: "COURT_NAME", labelRoleStatus: "CONFIRMED_BY_LABEL", printedLabel: null, reportText: "" }]
    };
    applyReportGuards(report, pages, "");
    expect(report.sourceProvenance).toBe("authenticated_pages");
    expect(report.formFieldFacts[0].labelRole).toBeNull();
  });
});

describe("displayText: untrusted PDF text is cleaned before it is shown", () => {
  it("removes control and bidi-override characters and collapses whitespace", async () => {
    const { displayText } = await import("./formFieldFacts");
    expect(displayText("Court\u0000 File‮  Number\n")).toBe("Court File Number");
    expect(displayText("\u0007\u009b")).toBe("");
  });

  it("bounds long text", async () => {
    const { displayText, DISPLAY_TEXT_MAX_CHARS } = await import("./formFieldFacts");
    expect(displayText("x".repeat(DISPLAY_TEXT_MAX_CHARS + 500)).length).toBe(DISPLAY_TEXT_MAX_CHARS);
  });

  it("applies the same cleaning to a fact that arrives in a report", async () => {
    const report: Record<string, any> = {
      formFieldFacts: [{ formNumber: "14A", fieldName: "a‮b", pages: [1], enteredValue: "x\u0000y", labelRole: null, labelRoleStatus: "NOT_ESTABLISHED", printedLabel: null, reportText: "" }]
    };
    guardFormFieldFacts(report);
    expect(report.formFieldFacts[0].fieldName).toBe("a b");
    expect(report.formFieldFacts[0].enteredValue).toBe("x y");
  });
});
