// Page OCR runs with bounded concurrency; page numbers must still follow the PDF's page order.
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractPages, OCR_CONCURRENCY } from "./pageSources.js";

async function pdfWithPages(count: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
}

describe("extractPages OCR concurrency", () => {
  it("OCRs pages concurrently (bounded) and keeps page order", async () => {
    let active = 0;
    let peak = 0;
    let call = 0;
    const ocr = async () => {
      const mine = ++call;
      active++;
      peak = Math.max(peak, active);
      // Earlier pages finish LAST, so ordering by completion would scramble the result.
      await new Promise((r) => setTimeout(r, 60 - mine * 5));
      active--;
      return `text of call ${mine}`;
    };
    const started = Date.now();
    const pages = await extractPages(await pdfWithPages(8), "application/pdf", ocr);
    const elapsed = Date.now() - started;

    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pages.map((p) => p.text)).toEqual(Array.from({ length: 8 }, (_, i) => `text of call ${i + 1}`));
    expect(peak).toBe(OCR_CONCURRENCY);
    expect(elapsed).toBeLessThan(8 * 60); // faster than strictly sequential
  });

  it("propagates an OCR failure instead of returning partial pages", async () => {
    const ocr = async (_b: string) => {
      throw new Error("ocr down");
    };
    await expect(extractPages(await pdfWithPages(3), "application/pdf", ocr)).rejects.toThrow("ocr down");
  });
});
