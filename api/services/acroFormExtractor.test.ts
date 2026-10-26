import { describe, it, expect } from "vitest";
import { extractAcroFormWidgets, assertBoundedExpansion, AcroFormError, ACROFORM_MAX_BYTES, ACROFORM_MAX_VALUE_CHARS } from "./acroFormExtractor";
import { buildSyntheticAcroFormPdf, buildExpansionPdf } from "../testSupport/acroFormFixtures";

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

describe("AcroForm extractor: choice values (Phase 1 regressions)", () => {
  it("reads a combo box with nothing selected as blank, not as an unsupported value", async () => {
    const r = await extractAcroFormWidgets(await buildSyntheticAcroFormPdf({ combo: "blank" }));
    const combo = r.widgets.find(w => w.name === "court_combo")!;
    expect(combo.value).toBeNull();
    expect(r.unsupportedValues).toBe(0);
  });

  it("reads a combo box with one option selected as that option", async () => {
    const r = await extractAcroFormWidgets(await buildSyntheticAcroFormPdf({ combo: "one" }));
    expect(r.widgets.find(w => w.name === "court_combo")!.value).toBe("Name of court");
    expect(r.unsupportedValues).toBe(0);
  });

  it("withholds a multi-select value (two selections) and counts it", async () => {
    const r = await extractAcroFormWidgets(await buildSyntheticAcroFormPdf({ multiSelect: true }));
    expect(r.widgets.find(w => w.name === "several_list")!.value).toBeNull();
    expect(r.unsupportedValues).toBe(1);
  });
});

describe("AcroForm extractor: deterministic mutation (negative paths)", () => {
  // Flip bytes at seeded positions. Every outcome must be a normal read or a classified AcroFormError. Anything else is
  // a crash that could be triggered by a hostile file.
  it("never throws an unclassified error on 60 seeded byte mutations of a valid form", async () => {
    const original = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1", radioGroup: true, combo: "one" });
    let seed = 20260426;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const allowed = new Set(["NOT_A_PDF", "PDF_TOO_LARGE", "MALFORMED_OR_PROTECTED_PDF", "UNSUPPORTED_PAGE_COUNT", "TOO_MANY_WIDGETS"]);
    let classified = 0;
    let read = 0;
    for (let i = 0; i < 60; i++) {
      const bytes = Buffer.from(original);
      const flips = 1 + (next() % 8);
      for (let f = 0; f < flips; f++) {
        const pos = 5 + (next() % (bytes.length - 5));
        bytes[pos] = next() & 0xff;
      }
      try {
        await extractAcroFormWidgets(bytes);
        read++;
      } catch (e) {
        expect(e).toBeInstanceOf(AcroFormError);
        expect(allowed.has((e as AcroFormError).code)).toBe(true);
        classified++;
      }
    }
    expect(read + classified).toBe(60);
  }, 120000);

  it("classifies every truncation of a valid form as a read or a classified error", async () => {
    const original = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    for (const cut of [6, 40, 200, Math.floor(original.length / 2), original.length - 20]) {
      try {
        await extractAcroFormWidgets(original.subarray(0, cut));
      } catch (e) {
        expect(e).toBeInstanceOf(AcroFormError);
      }
    }
  }, 60000);
});

describe("AcroForm extractor: bounded expansion (denial-of-service limit)", () => {
  it("refuses a small file that expands past the budget, before any parser runs", async () => {
    const bomb = await buildExpansionPdf(40 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const t = performance.now();
    expect(await codeOf(extractAcroFormWidgets(bomb))).toBe("EXPANDED_CONTENT_TOO_LARGE");
    expect(performance.now() - t).toBeLessThan(5000);
  }, 60000);

  it("still reads a file whose content expands within the budget", async () => {
    const ok = await buildExpansionPdf(4 * 1024 * 1024);
    const r = await extractAcroFormWidgets(ok);
    expect(r.pageCount).toBe(1);
  }, 60000);

  it("does not treat non-Flate stream bytes as expansion", () => {
    const raw = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length 4 >>\nstream\nnot compressed\nendstream\nendobj\n");
    expect(() => assertBoundedExpansion(raw)).not.toThrow();
  });
});
