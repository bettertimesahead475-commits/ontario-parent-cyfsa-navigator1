// OCR completeness rules: a page is text, or a blank page the model confirmed, or extraction fails and names
// the unreadable pages. Empty output is never a blank page, and partial pages are never returned.
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { BLANK_PAGE_MARKER, extractPages, OCR_PAGE_ATTEMPTS } from "./pageSources.js";
import { AnalyzerError } from "./analyzerErrors.js";

async function pdfWithPages(count: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) pdf.addPage([200 + i, 200]);
  return Buffer.from(await pdf.save());
}

// Identifies which PDF page a single-page OCR input came from, by its width.
async function pageIndexOf(base64: string): Promise<number> {
  const doc = await PDFDocument.load(Buffer.from(base64, "base64"));
  return doc.getPage(0).getWidth() - 200;
}

describe("OCR completeness", () => {
  it("accepts an explicit blank-page confirmation as a blank page", async () => {
    const pages = await extractPages(await pdfWithPages(2), "application/pdf", async (b) =>
      (await pageIndexOf(b)) === 0 ? "Real text on page one, long enough to count." : BLANK_PAGE_MARKER
    );
    expect(pages.map((p) => p.status)).toEqual(["text", "blank"]);
    expect(pages[1].text).toBe("");
  });

  it("retries a transient empty response and recovers the page", async () => {
    const calls = new Map<number, number>();
    const pages = await extractPages(await pdfWithPages(1), "application/pdf", async (b) => {
      const index = await pageIndexOf(b);
      const n = (calls.get(index) ?? 0) + 1;
      calls.set(index, n);
      return n === 1 ? "" : "Recovered page text.";
    });
    expect(pages[0].text).toBe("Recovered page text.");
    expect(pages[0].status).toBe("text");
    expect(calls.get(0)).toBe(2);
  });

  it("fails and names the unreadable page when every attempt is empty, with no partial result", async () => {
    const ocr = vi.fn(async (b: string) => ((await pageIndexOf(b)) === 1 ? "" : "Readable page text here."));
    await expect(extractPages(await pdfWithPages(3), "application/pdf", ocr)).rejects.toMatchObject({
      code: "EXTRACTION_INCOMPLETE",
      statusCode: 422,
      message: expect.stringMatching(/Page 2 could not be read/),
    });
    // Page 2 was attempted the full bounded number of times, not once and not forever.
    const page2Calls = ocr.mock.calls.length - 2;
    expect(page2Calls).toBe(OCR_PAGE_ATTEMPTS);
  });

  it("keeps a real provider outage classified, so the caller can retry at the right time", async () => {
    const outage = new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "The AI service is busy. Please retry.", true);
    await expect(
      extractPages(await pdfWithPages(2), "application/pdf", async () => {
        throw outage;
      })
    ).rejects.toBe(outage);
  });

  it("does not treat an invalid-response error as an outage", async () => {
    await expect(
      extractPages(await pdfWithPages(1), "application/pdf", async () => {
        throw new AnalyzerError("AI_RESPONSE_INVALID", 422, "The OCR service returned no text for this page.", true);
      })
    ).rejects.toMatchObject({ code: "EXTRACTION_INCOMPLETE" });
  });

  it("keeps page numbers in PDF order even when earlier pages finish last", async () => {
    const pages = await extractPages(await pdfWithPages(4), "application/pdf", async (b) => {
      const index = await pageIndexOf(b);
      await new Promise((r) => setTimeout(r, (4 - index) * 15));
      return `Text of page ${index + 1}, long enough to be read.`;
    });
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(pages.map((p) => p.text)).toEqual([1, 2, 3, 4].map((n) => `Text of page ${n}, long enough to be read.`));
  });
});

describe("malformed PDF classification", () => {
  it("returns a classified 400 for a file that is not a PDF, never a raw TypeError", async () => {
    const ocr = vi.fn();
    await expect(extractPages(Buffer.from("%PDF-1.4 garbage not a pdf"), "application/pdf", ocr)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_SOURCE",
    });
    expect(ocr).not.toHaveBeenCalled();
  });
});

describe("PDF.js full-layout parsing", () => {
  it("parses text PDFs on the full-layout path with no fallback warning", async () => {
    const { extractTextFromPdfBuffer } = await import("./pageSources.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont((await import("pdf-lib")).StandardFonts.Helvetica);
      pdf.addPage([300, 300]).drawText("Full layout parsing must find this sentence.", { x: 10, y: 250, size: 10, font });
      const parsed = await extractTextFromPdfBuffer(Buffer.from(await pdf.save()));
      expect(parsed?.pages[0]?.text).toContain("Full layout parsing must find this sentence.");
      const fallbackWarnings = warn.mock.calls.filter((args) => String(args[0] ?? "").includes("Full layout extraction"));
      expect(fallbackWarnings).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
