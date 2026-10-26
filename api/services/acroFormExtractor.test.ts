import { describe, it, expect } from "vitest";
import { extractAcroFormWidgets, AcroFormError, ACROFORM_MAX_BYTES, ACROFORM_MAX_VALUE_CHARS } from "./acroFormExtractor";
import { buildSyntheticAcroFormPdf } from "../testSupport/acroFormFixtures";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AcroFormError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

describe("AcroForm extractor: rejects unsafe or unsupported input", () => {
  it("rejects bytes that are not a PDF", async () => {
    expect(await codeOf(extractAcroFormWidgets(Buffer.from("hello world")))).toBe("NOT_A_PDF");
  });

  it("rejects a file over the size limit before parsing it", async () => {
    const big = Buffer.alloc(ACROFORM_MAX_BYTES + 1, 0x20);
    expect(await codeOf(extractAcroFormWidgets(big))).toBe("PDF_TOO_LARGE");
  });

  it("rejects a malformed PDF without throwing an unclassified error", async () => {
    const code = await codeOf(extractAcroFormWidgets(Buffer.from("%PDF-1.4\nnot really a pdf at all")));
    expect(["MALFORMED_OR_PROTECTED_PDF", "UNSUPPORTED_PAGE_COUNT"]).toContain(code);
  });
});

describe("AcroForm extractor: reads widgets with provenance", () => {
  it("reads names, pages, types, entered values, export values, and printed text", async () => {
    const r = await extractAcroFormWidgets(await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1", radioGroup: true }));
    expect(r.pageCount).toBe(1);
    const court = r.widgets.find(w => w.name === "court_number_field")!;
    expect(court).toMatchObject({ page: 1, type: "Tx", value: "CV-1", above: "Court File Number" });
    expect(court.rect).toHaveLength(4);
    const radio = r.widgets.filter(w => w.name === "placement_choice");
    expect(radio).toHaveLength(2);
    expect(radio[0].exportValue).not.toBe(radio[1].exportValue);
  });

  it("keeps a name that appears on two pages as two widgets with the same name and different pages", async () => {
    const r = await extractAcroFormWidgets(await buildSyntheticAcroFormPdf({ conflictingDuplicate: true, courtFileValue: "CV-1" }));
    const pages = r.widgets.filter(w => w.name === "court_number_field").map(w => w.page);
    expect(pages.sort()).toEqual([1, 2]);
    expect(r.acroFormUniqueNames.filter(n => n === "court_number_field")).toHaveLength(1);
  });

  it("keeps the server-extracted page text the analyzer reads, keyed by page", async () => {
    const r = await extractAcroFormWidgets(await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" }));
    expect(r.pageText.get(1) ?? "").toContain("Court File Number");
  });

  it("withholds an overlong entered value and counts it, rather than passing it through", async () => {
    const r = await extractAcroFormWidgets(await buildSyntheticAcroFormPdf({ courtFileValue: "x".repeat(ACROFORM_MAX_VALUE_CHARS + 50) }));
    const court = r.widgets.find(w => w.name === "court_number_field")!;
    expect(court.value).toBeNull();
    // The widget is kept (it is still present); only its value is withheld and counted.
    expect(r.unsupportedValues).toBeGreaterThanOrEqual(1);
    expect(r.rejectedWidgets.count).toBe(0);
  });
});
