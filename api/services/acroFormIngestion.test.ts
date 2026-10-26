import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestAcroFormPdf, attributeRows, enteredValueFor, isHeaderLike } from "./acroFormIngestion";
import type { ExtractedWidget } from "./acroFormExtractor";
import { buildSyntheticAcroFormPdf } from "../testSupport/acroFormFixtures";
import { applyReportGuards } from "./analyzerSections";
import { FIELD_NOT_ESTABLISHED_TEXT } from "./formFieldFacts";

const factFor = (facts: { fieldName: string }[], name: string) => facts.find(f => f.fieldName === name) as any;

describe("ingestion: printed-text evidence only", () => {
  it("confirms a label role from printed text and carries the entered value, page, and source hash", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" }));
    const f = factFor(r.facts, "court_number_field");
    expect(f).toMatchObject({ labelRole: "COURT_FILE_NUMBER", labelRoleStatus: "CONFIRMED_BY_LABEL", enteredValue: "CV-1", pages: [1] });
    expect(f.printedLabel).toBe("Court File Number");
    expect(f.sourceSha256).toBe(r.sourceSha256);
    expect(r.identity).toBe("UNIDENTIFIED");
    expect(r.formNumber).toBeNull();
  });

  it("never attributes a party or assesses legal significance from any field", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1", radioGroup: true, unlabelledField: true }));
    for (const f of r.facts) {
      expect(f.partyAttribution).toBe("NOT_DETERMINED");
      expect(f.legalSignificance).toBe("NOT_ASSESSED");
    }
  });

  it("keeps an unlabelled field as present with its blank value, and never states a role for it", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ unlabelledField: true }));
    const f = factFor(r.facts, "stray_field");
    expect(f.presence).toBe("FIELD_PRESENT");
    expect(f.enteredValue).toBeNull();
    expect(f.labelRole).toBeNull();
    expect(f.reportText).toBe(FIELD_NOT_ESTABLISHED_TEXT);
  });

  it("treats a radio group as unresolved, never confirmed, and counts it", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ radioGroup: true }));
    const f = factFor(r.facts, "placement_choice");
    expect(f.labelRoleStatus).toBe("NOT_ESTABLISHED");
    expect(f.labelRole).toBeNull();
    expect(r.summary.radioGroups).toBe(1);
  });

  it("reports one fact for a name on two pages, with both pages listed", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ conflictingDuplicate: true, courtFileValue: "CV-1" }));
    expect(r.facts.filter(f => f.fieldName === "court_number_field")).toHaveLength(1);
    expect(factFor(r.facts, "court_number_field").pages).toEqual([1, 2]);
  });
});

describe("row attribution: only where printed evidence supports it", () => {
  it("attributes each widget to its row when a header-like caption repeats over a real column of rows", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ unambiguousRow: true }));
    expect(factFor(r.facts, "child_name_row").rowAttribution).toEqual({ status: "ATTRIBUTED", rowLabel: "Child 1" });
    expect(factFor(r.facts, "child_name_row_two").rowAttribution).toEqual({ status: "ATTRIBUTED", rowLabel: "Child 2" });
  });

  it("leaves a row UNRESOLVED when the same printed row label appears on two rows of one page", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ ambiguousRows: true }));
    expect(factFor(r.facts, "child_row_one").rowAttribution.status).toBe("UNRESOLVED");
    expect(factFor(r.facts, "child_row_two").rowAttribution.status).toBe("UNRESOLVED");
  });

  it("leaves a widget with no printed row label UNRESOLVED", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ unlabelledField: true }));
    expect(factFor(r.facts, "stray_field").rowAttribution.status).toBe("UNRESOLVED");
  });

  it("requires a printed row label before attributing a row, even when a column header is present", () => {
    const w = (over: Partial<ExtractedWidget>): ExtractedWidget => ({
      name: "n", page: 1, type: "Tx", rect: [0, 0, 10, 10], exportValue: null, value: null,
      columnHeader: "Name", left: "", above: "", below: "", ...over
    });
    expect(attributeRows([w({})])[0]).toEqual({ status: "UNRESOLVED", reason: "NO_PRINTED_ROW_LABEL" });
  });
});

describe("row attribution rules, directly", () => {
  const w = (over: Partial<ExtractedWidget>): ExtractedWidget => ({
    name: "n", page: 1, type: "Tx", rect: [0, 0, 10, 10], exportValue: null, value: null,
    columnHeader: "Name", left: "", above: "", below: "", ...over
  });

  it("treats short captions as headers and sentences or fragments as not", () => {
    expect(isHeaderLike("Child's Full Legal Name")).toBe(true);
    expect(isHeaderLike("(Name of court)")).toBe(true);
    expect(isHeaderLike("A COURT CASE HAS BEEN STARTED AGAINST YOU IN THIS COURT. THE DETAILS ARE SET OUT")).toBe(false);
    expect(isHeaderLike("subject to society supervision")).toBe(false);
    expect(isHeaderLike("efore me")).toBe(false);
  });

  it("does not attribute a row when the caption sits over a single widget (not a table column)", () => {
    const rows = attributeRows([w({ left: "Child 1", rect: [0, 100, 10, 110] })]);
    expect(rows[0]).toEqual({ status: "UNRESOLVED", reason: "NO_REPEATED_COLUMN" });
  });

  it("does not attribute a row under a sentence-like caption, even when the caption repeats", () => {
    const sentence = "This is a sentence that runs on.";
    const rows = attributeRows([
      w({ left: "Child 1", columnHeader: sentence, rect: [0, 100, 10, 110] }),
      w({ left: "Child 2", columnHeader: sentence, rect: [0, 60, 10, 70] })
    ]);
    expect(rows.map(r => r.status)).toEqual(["UNRESOLVED", "UNRESOLVED"]);
  });

  it("attributes rows under a header-like caption that repeats over two distinct rows", () => {
    const rows = attributeRows([
      w({ left: "Child 1", rect: [0, 100, 10, 110] }),
      w({ left: "Child 2", rect: [0, 60, 10, 70] })
    ]);
    expect(rows).toEqual([
      { status: "ATTRIBUTED", rowLabel: "Child 1" },
      { status: "ATTRIBUTED", rowLabel: "Child 2" }
    ]);
  });
});

describe("entered values: duplicates must agree", () => {
  it("returns the value when all widgets sharing a name agree, including all-blank", () => {
    expect(enteredValueFor(["CV-1", "CV-1"])).toEqual({ value: "CV-1", conflict: false });
    expect(enteredValueFor([null, null])).toEqual({ value: null, conflict: false });
  });

  it("withholds the value and flags a conflict when widgets sharing a name disagree", () => {
    expect(enteredValueFor(["CV-1", "CV-2"])).toEqual({ value: null, conflict: true });
    expect(enteredValueFor(["CV-1", null])).toEqual({ value: null, conflict: true });
  });
});

describe("analyzer boundary on ingested facts", () => {
  it("passes ingested facts through applyReportGuards without a confirmed role for any unresolved field", async () => {
    const r = await ingestAcroFormPdf(await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1", radioGroup: true, unlabelledField: true, ambiguousRows: true }));
    const report = applyReportGuards({ formFieldFacts: r.facts, redFlags: [], thresholdAnalysis: [], proceduralTimelineViolations: [] }, null, "");
    for (const f of report.formFieldFacts) {
      if (f.labelRoleStatus !== "CONFIRMED_BY_LABEL") {
        expect(f.labelRole).toBeNull();
        expect(f.reportText).toBe(FIELD_NOT_ESTABLISHED_TEXT);
      }
    }
    expect(factFor(report.formFieldFacts, "court_number_field").labelRole).toBe("COURT_FILE_NUMBER");
  });
});

// Real official PDFs (when present): each blank "Name of court" combo box is blank, not withheld.
const CURRENT_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e-current";
const currentManifest = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/official-forms/current-manifest.json"), "utf8")
) as { files: { formNumber: string; fileName: string }[] };
const realReady = currentManifest.files.every(f => fs.existsSync(path.join(CURRENT_DIR, f.fileName)));
const realDescribe = realReady ? describe : describe.skip;

realDescribe("real official PDFs: withheld-value regression (Phase 1)", () => {
  for (const f of currentManifest.files) {
    it(`${f.formNumber}: no value is withheld, and the court-name box is read as entered`, async () => {
      const r = await ingestAcroFormPdf(fs.readFileSync(path.join(CURRENT_DIR, f.fileName)));
      expect(r.summary.unsupportedValues).toBe(0);
      const court = r.facts.find(x => x.fieldName === "Name of court");
      if (f.formNumber === "14A") expect(court?.enteredValue).toBe("Name of court");
      else if (court) expect(court.enteredValue).toBeNull();
    });
  }
});
