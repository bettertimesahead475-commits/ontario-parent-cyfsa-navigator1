import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mapPdfFields,
  usableForAnalysis,
  compareWithDocx,
  pdfFieldKind,
  type PdfWidgetInput
} from "./officialFormPdfSemanticMap";

// Synthetic widgets only. No test here reads a court form. Each widget's printed text is written out.
function w(overrides: Partial<PdfWidgetInput> & { name: string }): PdfWidgetInput {
  return { page: 1, type: "Tx", left: "", above: "", below: "", ...overrides };
}

const COURT_FILE = w({ name: "field-a", above: "Court File Number" });

describe("pdfFieldKind", () => {
  it("maps pdfjs field types, and leaves an absent type unknown rather than guessing", () => {
    expect(pdfFieldKind("Tx")).toBe("text");
    expect(pdfFieldKind("Btn")).toBe("checkbox");
    expect(pdfFieldKind("Ch")).toBe("choice");
    expect(pdfFieldKind("Sig")).toBe("signature");
    expect(pdfFieldKind(null)).toBe("unknown");
  });
});

describe("confirmed mappings come from printed label text", () => {
  it("confirms a text field whose printed caption matches a rule, and records the evidence", () => {
    const [m] = mapPdfFields([COURT_FILE]);
    expect(m.status).toBe("CONFIRMED_BY_LABEL");
    expect(m.role).toBe("COURT_FILE_NUMBER");
    expect(m.ruleIds).toEqual(["court-file-number"]);
    expect(m.evidenceLabel).toBe("Court File Number");
    expect(m.reason).toBeNull();
  });

  it("never uses the field name as evidence: a name that says 'courtFileNumber' with no printed caption stays unresolved", () => {
    const [m] = mapPdfFields([w({ name: "Court File Number", above: "" })]);
    expect(m.status).toBe("UNRESOLVED");
    expect(m.role).toBeNull();
    expect(m.reason).toBe("NO_PRINTED_LABEL_NEARBY");
  });
});

describe("duplicate names", () => {
  it("confirms a name shared across pages when every widget carries the same printed caption", () => {
    const [m] = mapPdfFields([
      w({ name: "Court File Number", page: 1, above: "Court File Number" }),
      w({ name: "Court File Number", page: 2, above: "Court File Number" })
    ]);
    expect(m.status).toBe("CONFIRMED_BY_LABEL");
    expect(m.widgetCount).toBe(2);
    expect(m.pages).toEqual([1, 2]);
  });

  it("stays unresolved when widgets sharing one name disagree about the printed label", () => {
    const [m] = mapPdfFields([
      w({ name: "shared", page: 1, above: "Court File Number" }),
      w({ name: "shared", page: 2, above: "" })
    ]);
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("CONFLICTING_WIDGET_LABELS");
  });

  it("stays unresolved when one widget matches a rule and another, under the same name, matches a different role", () => {
    const [m] = mapPdfFields([
      w({ name: "shared", page: 1, above: "Court File Number" }),
      w({ name: "shared", page: 2, above: "(Name of court)" })
    ]);
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("AMBIGUOUS_LABEL");
  });

  it("keeps two distinct field names as two distinct mappings, even when the printed text repeats", () => {
    const out = mapPdfFields([w({ name: "a", above: "Court File Number" }), w({ name: "b", above: "Court File Number" })]);
    expect(out.map(m => m.fieldName)).toEqual(["a", "b"]);
    expect(out.every(m => m.status === "CONFIRMED_BY_LABEL")).toBe(true);
  });
});

describe("ambiguous labels fail closed", () => {
  it("leaves a field UNRESOLVED when its printed text satisfies two rules with different roles", () => {
    const [m] = mapPdfFields([w({ name: "x", above: "Court File Number (Name of court)" })]);
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("AMBIGUOUS_LABEL");
    expect(m.role).toBeNull();
    expect(usableForAnalysis(m)).toBe(false);
  });

  it("does not confirm a choice field whose label is not one of the rules", () => {
    const [m] = mapPdfFields([w({ name: "court", type: "Ch", above: "Some other heading" })]);
    expect(m.kind).toBe("choice");
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("NO_RULE");
  });
});

describe("checkboxes and radio groups", () => {
  it("leaves a checkbox with no printed text unresolved, as NO_PRINTED_LABEL_NEARBY", () => {
    const [m] = mapPdfFields([w({ name: "chk", type: "Btn" })]);
    expect(m.kind).toBe("checkbox");
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("NO_PRINTED_LABEL_NEARBY");
  });

  it("leaves a checkbox with printed text but no rule unresolved, as NO_RULE", () => {
    const [m] = mapPdfFields([w({ name: "chk", type: "Btn", left: "I/We agree with the following facts" })]);
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("NO_RULE");
  });

  it("does not distinguish a radio group from a checkbox by field type alone, so a shared-name group stays unresolved", () => {
    // Two widgets, one name, both Btn with no printed text. A radio group has the same shape here, so it cannot
    // be confirmed on the evidence available and must not be assigned a meaning.
    const out = mapPdfFields([w({ name: "group", type: "Btn", page: 1 }), w({ name: "group", type: "Btn", page: 2 })]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("UNRESOLVED");
    expect(out[0].widgetCount).toBe(2);
  });
});

describe("signatures", () => {
  it("leaves a signature with no printed caption unresolved, as SIGNATURE_NO_LABEL", () => {
    const [m] = mapPdfFields([w({ name: "sig", type: "Sig", above: "Some unrelated heading" })]);
    expect(m.kind).toBe("signature");
    expect(m.reason).toBe("SIGNATURE_NO_LABEL");
  });

  it("confirms a commissioner signature only from the printed caption below it", () => {
    const [m] = mapPdfFields([
      w({ name: "sig2", type: "Sig", below: "Commissioner for taking affidavits (Type or print name below)" })
    ]);
    expect(m.status).toBe("CONFIRMED_BY_LABEL");
    expect(m.role).toBe("COMMISSIONER_SIGNATURE");
  });
});

describe("missing values", () => {
  it("records a field with no printed text anywhere in its window as NO_PRINTED_LABEL_NEARBY, not as a guess", () => {
    const [m] = mapPdfFields([w({ name: "row1", type: "Tx" })]);
    expect(m.reason).toBe("NO_PRINTED_LABEL_NEARBY");
    expect(m.role).toBeNull();
  });
});

describe("analysis gating", () => {
  it("allows a confirmed mapping to feed analysis and blocks every unresolved one", () => {
    const [ok] = mapPdfFields([COURT_FILE]);
    const [blocked] = mapPdfFields([w({ name: "row1" })]);
    expect(usableForAnalysis(ok)).toBe(true);
    expect(usableForAnalysis(blocked)).toBe(false);
  });
});

describe("DOCX comparison by concept", () => {
  it("reports shared, PDF-only and DOCX-only concepts without claiming field equivalence", () => {
    const cmp = compareWithDocx(["COURT_FILE_NUMBER", "COMMISSIONER_NAME"], ["courtFileNumber", "statementOfFactsBody"]);
    expect(cmp.sharedConcepts).toEqual(["COURT_FILE_NUMBER"]);
    expect(cmp.pdfOnlyConcepts).toEqual(["COMMISSIONER_NAME"]);
    expect(cmp.docxOnlyKeys).toEqual(["statementOfFactsBody"]);
  });

  it("treats a party-agnostic PDF concept as shared when either party's DOCX key is present", () => {
    const cmp = compareWithDocx(["PARTY_ADDRESS_FOR_SERVICE"], ["respondentNameAndAddressForService"]);
    expect(cmp.sharedConcepts).toEqual(["PARTY_ADDRESS_FOR_SERVICE"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Recorded evidence. These read the committed snapshot and mapping record. They do not read any court form.
// ---------------------------------------------------------------------------------------------------------------
const compatDir = fileURLToPath(new URL("../../scripts/official-forms/compat/", import.meta.url));
const snapshot = JSON.parse(fs.readFileSync(`${compatDir}pdf-widgets-2026-10-26.json`, "utf8")) as {
  forms: Record<string, { formNumber: string; acroFormUniqueNames: string[]; widgets: PdfWidgetInput[] }>;
};
const record = JSON.parse(fs.readFileSync(`${compatDir}pdf-semantic-map-2026-10-26.json`, "utf8")) as {
  forms: Record<string, { confirmed: number; fieldsMapped: number; nonWidgetParentNodes: string[]; mappings: any[] }>;
};

describe("recorded mapping record", () => {
  it("is exactly what the mapper produces from the recorded widgets (no drift)", () => {
    for (const [fileName, entry] of Object.entries(snapshot.forms)) {
      const key = entry.formNumber.startsWith("unmatched") ? "UNMATCHED-33B(PDF)" : entry.formNumber;
      expect(record.forms[key], key).toBeDefined();
      expect(record.forms[key].mappings, fileName).toEqual(mapPdfFields(entry.widgets));
    }
  });

  it("accounts for every AcroForm field: mapped fields plus non-widget parent nodes equal the unique AcroForm names", () => {
    for (const [fileName, entry] of Object.entries(snapshot.forms)) {
      const key = entry.formNumber.startsWith("unmatched") ? "UNMATCHED-33B(PDF)" : entry.formNumber;
      const r = record.forms[key];
      expect(r.fieldsMapped + r.nonWidgetParentNodes.length, fileName).toBe(entry.acroFormUniqueNames.length);
    }
  });

  it("records a reason for every unresolved field and a role plus evidence for every confirmed field", () => {
    for (const r of Object.values(record.forms)) {
      for (const m of r.mappings) {
        if (m.status === "CONFIRMED_BY_LABEL") {
          expect(m.role).not.toBeNull();
          expect(m.reason).toBeNull();
        } else {
          expect(m.role).toBeNull();
          expect(m.reason).not.toBeNull();
        }
      }
    }
  });

  it("states 14A coverage as recorded: 19 of 20 fields confirmed", () => {
    expect(record.forms["14A"].confirmed).toBe(19);
    expect(record.forms["14A"].fieldsMapped).toBe(20);
  });

  it("confirms the recorded count for every form (regression on coverage)", () => {
    const expected: Record<string, number> = { "35.1A": 11, "33C": 7, "33B.1": 6, "14A": 19, "8B": 12, "UNMATCHED-33B(PDF)": 6 };
    for (const [key, n] of Object.entries(expected)) expect(record.forms[key].confirmed, key).toBe(n);
  });
});

describe("radio groups and checkbox export values", () => {
  it("treats widgets that share a name with different export values as a radio group, and never confirms it", () => {
    const [m] = mapPdfFields([
      w({ name: "placement", type: "Btn", exportValue: "temporary", above: "Court File Number" }),
      w({ name: "placement", type: "Btn", exportValue: "permanent", above: "Court File Number" })
    ]);
    expect(m.kind).toBe("radio");
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("RADIO_GROUP_NOT_CONFIRMED");
    expect(m.exportValues).toEqual(["permanent", "temporary"]);
  });

  it("keeps a checkbox whose widgets share one export value as a checkbox", () => {
    const [m] = mapPdfFields([
      w({ name: "chk", type: "Btn", exportValue: "On", page: 1 }),
      w({ name: "chk", type: "Btn", exportValue: "On", page: 2 })
    ]);
    expect(m.kind).toBe("checkbox");
    expect(m.exportValues).toEqual(["On"]);
  });
});

describe("column-header provenance", () => {
  it("records column headers and flags a header printed on more than one page (a continuation table)", () => {
    const [m] = mapPdfFields([
      w({ name: "row-a", page: 1, columnHeader: "Child's Full Legal Name" }),
      w({ name: "row-a", page: 2, columnHeader: "Child's Full Legal Name" })
    ]);
    expect(m.columnHeaders).toEqual(["Child's Full Legal Name"]);
    expect(m.headerRepeatsAcrossPages).toBe(true);
  });

  it("does not flag a header that appears on one page only", () => {
    const [m] = mapPdfFields([w({ name: "row-b", page: 1, columnHeader: "Birthdate" })]);
    expect(m.headerRepeatsAcrossPages).toBe(false);
  });

  it("never confirms a role from a column header alone, even when the header repeats", () => {
    const [m] = mapPdfFields([
      w({ name: "row-c", page: 1, columnHeader: "Court File Number" }),
      w({ name: "row-c", page: 2, columnHeader: "Court File Number" })
    ]);
    expect(m.status).toBe("UNRESOLVED");
    expect(m.reason).toBe("NO_PRINTED_LABEL_NEARBY");
  });
});
