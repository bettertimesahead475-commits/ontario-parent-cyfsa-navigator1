// OCR cost and failure safeguards. These tests count calls to the paid OCR function, so they check cost behavior
// directly. Completeness rules are unchanged: a page is text, or a confirmed blank, or extraction fails and names it.
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  extractPages,
  OCR_CONCURRENCY,
  OCR_GLOBAL_CONCURRENCY,
  OCR_PAGE_ATTEMPTS,
  ocrSlotsInUseForTesting,
} from "./pageSources.js";
import { AnalyzerError } from "./analyzerErrors.js";

async function pdfWithPages(count: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) pdf.addPage([200 + i, 200]);
  return Buffer.from(await pdf.save());
}

async function pageIndexOf(base64: string): Promise<number> {
  const doc = await PDFDocument.load(Buffer.from(base64, "base64"));
  return doc.getPage(0).getWidth() - 200;
}

const READABLE = "Readable page text that is long enough to be a real page.";

describe("retry classification", () => {
  it("does not retry a provider failure at page level (the OCR call already retried across models)", async () => {
    const outage = new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "busy", true);
    let calls = 0;
    await expect(
      extractPages(await pdfWithPages(1), "application/pdf", async () => {
        calls++;
        throw outage;
      })
    ).rejects.toBe(outage);
    expect(calls).toBe(1);
  });

  it("does not retry a blocked page: the same refusal would come back", async () => {
    let calls = 0;
    await expect(
      extractPages(await pdfWithPages(1), "application/pdf", async () => {
        calls++;
        throw new AnalyzerError("AI_RESPONSE_INVALID", 422, "The OCR service blocked this page's content.", false);
      })
    ).rejects.toMatchObject({ code: "EXTRACTION_INCOMPLETE", message: expect.stringMatching(/Page 1 could not be read/) });
    expect(calls).toBe(1);
  });

  it("retries an empty response once, then fails the page, never reporting it blank", async () => {
    let calls = 0;
    await expect(
      extractPages(await pdfWithPages(1), "application/pdf", async () => {
        calls++;
        return "";
      })
    ).rejects.toMatchObject({ code: "EXTRACTION_INCOMPLETE" });
    expect(calls).toBe(OCR_PAGE_ATTEMPTS);
    expect(OCR_PAGE_ATTEMPTS).toBe(2);
  });
});

describe("bounded fan-out after a failure", () => {
  it("stops taking new pages once a provider failure occurs, instead of paying for every remaining page", async () => {
    let calls = 0;
    const outage = new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "busy", true);
    await expect(
      extractPages(await pdfWithPages(20), "application/pdf", async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        throw outage;
      })
    ).rejects.toBe(outage);
    // Only the pages already in flight when the first failure landed may run. The remaining pages are never sent.
    expect(calls).toBeLessThanOrEqual(OCR_CONCURRENCY);
    expect(calls).toBeLessThan(20);
  });

  it("names every page that could not be read, not only the first, when the failures are read failures", async () => {
    await expect(
      extractPages(await pdfWithPages(3), "application/pdf", async () => "")
    ).rejects.toMatchObject({ code: "EXTRACTION_INCOMPLETE", message: expect.stringContaining("Pages 1, 2, 3") });
  });
});

describe("process-wide limit on paid OCR calls", () => {
  it("never runs more than the global limit at once, across concurrent extractions", async () => {
    let active = 0;
    let peak = 0;
    const slowOcr = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return READABLE;
    };
    // Three extractions of 8 pages each would run 12 at once without a global limit.
    const pdfs = await Promise.all([pdfWithPages(8), pdfWithPages(8), pdfWithPages(8)]);
    await Promise.all(pdfs.map((pdf) => extractPages(pdf, "application/pdf", slowOcr)));
    expect(peak).toBeLessThanOrEqual(OCR_GLOBAL_CONCURRENCY);
    expect(peak).toBeGreaterThan(OCR_CONCURRENCY); // the cross-request limit, not the per-request one, is what applied
  });

  it("releases every slot, including after failures", async () => {
    const failing = async () => {
      throw new Error("ocr down");
    };
    await expect(extractPages(await pdfWithPages(4), "application/pdf", failing)).rejects.toThrow("ocr down");
    expect(ocrSlotsInUseForTesting()).toBe(0);
    await extractPages(await pdfWithPages(2), "application/pdf", async () => READABLE);
    expect(ocrSlotsInUseForTesting()).toBe(0);
  });

  it("reads correct page order under the limit (pages are still numbered by the PDF)", async () => {
    const pages = await extractPages(await pdfWithPages(5), "application/pdf", async (b) => {
      const index = await pageIndexOf(b);
      await new Promise((r) => setTimeout(r, (5 - index) * 3));
      return `Page ${index + 1} text, long enough to read.`;
    });
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(pages[4].text).toBe("Page 5 text, long enough to read.");
  });
});
