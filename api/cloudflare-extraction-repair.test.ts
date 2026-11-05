import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { classifyGeminiStatus, generateGemini } from '../functions/api/_gemini';
import { extractDocument } from '../functions/api/_document-extraction';

describe('extraction repair regressions', () => {
  it('separates provider request errors from a PDF decoding rejection', () => {
    expect(classifyGeminiStatus(400, '{"error":{"message":"The document has no pages"}}')).toBe('PDF_REJECTED');
    expect(classifyGeminiStatus(400, '{"error":{"message":"Invalid generationConfig field"}}')).toBe('BAD_REQUEST');
    expect(classifyGeminiStatus(400, '{"error":{"message":"API key not valid"}}')).toBe('AUTH_FAILED');
    expect(classifyGeminiStatus(400, '{"error":{"message":"Model is not supported for generateContent"}}')).toBe('MODEL_UNAVAILABLE');
  });

  it('does not include Gemini thought parts in OCR text', async () => {
    const fetcher = vi.fn(async () => Response.json({
      candidates: [{ content: { parts: [{ thought: true, text: 'Private reasoning' }, { text: 'Sworn before me.' }] }, finishReason: 'STOP' }],
    }));
    const result = await generateGemini({ GEMINI_API_KEY: 'fake' }, 'gemini-2.5-flash', {}, { fetcher: fetcher as typeof fetch, timeoutMs: 1000 });
    expect(result.text).toBe('Sworn before me.');
  });

  it('serializes independently parseable OCR pages without object streams and preserves page provenance', async () => {
    const source = await PDFDocument.create();
    source.addPage(); source.addPage();
    const bytes = await source.save();
    let calls = 0;
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const data = body.contents[0].parts[0].inlineData;
      expect(data.mimeType).toBe('application/pdf');
      const sent = Buffer.from(data.data, 'base64');
      expect((await PDFDocument.load(sent)).getPageCount()).toBe(1);
      expect(sent.toString('latin1')).not.toContain('/Type /ObjStm');
      calls++;
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Page text from OCR' }] }, finishReason: 'STOP' }] });
    });
    const result = await extractDocument({ base64: Buffer.from(bytes).toString('base64'), fileName: 'scan.pdf', mimeType: 'application/pdf' }, { GEMINI_API_KEY: 'fake' }, { fetcher: fetcher as typeof fetch });
    expect(calls).toBe(2);
    expect(result.pages.map(p => p.sourceLocation.page)).toEqual([1, 2]);
    expect(result.extractedText).toContain('[Page 2]');
    expect(result.extractedText).not.toContain('JVBER');
  });
});
