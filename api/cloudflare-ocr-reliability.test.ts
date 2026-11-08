import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateGemini, resolveGeminiModel } from '../functions/api/_gemini';
import { extractDocument } from '../functions/api/_document-extraction';

const env = { GEMINI_API_KEY: 'not-a-real-key' };
const success = () => Response.json({ candidates: [{ content: { parts: [{ text: 'Actual transcription.' }] }, finishReason: 'STOP' }] });
const fixture = (name: string) => fs.readFileSync(`tests/fixtures/synthetic/${name}`).toString('base64');
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('OCR provider deadlines and bounded retry', () => {
  it('pins the PDF-capable default and honors an explicit model without fallback', () => {
    expect(resolveGeminiModel({}, 'ocr')).toBe('gemini-2.5-flash');
    expect(resolveGeminiModel({ GEMINI_OCR_MODEL: 'gemini-2.5-flash-lite' }, 'ocr')).toBe('gemini-2.5-flash-lite');
  });
  it('bounds a response body that stalls after successful headers', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
    const rejected = expect(generateGemini(env, 'gemini-2.5-flash', {}, { fetcher: fetcher as typeof fetch, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(21);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds a transport that ignores AbortSignal and does not resubmit it', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const rejected = expect(generateGemini(env, 'gemini-2.5-flash', {}, { fetcher: fetcher as typeof fetch, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(21); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('honors Retry-After for a transient 429 then succeeds on the same model', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: 'rate limit' } }, { status: 429, headers: { 'Retry-After': '1' } })).mockResolvedValueOnce(success());
    const result = generateGemini(env, 'gemini-2.5-flash', {}, { fetcher, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2); await expect(result).resolves.toMatchObject({ text: 'Actual transcription.' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => url.endsWith('/gemini-2.5-flash:generateContent'))).toBe(true);
  });
  it('caps retries for provider 500 errors', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json({ error: { message: 'internal' } }, { status: 500 }));
    const rejected = expect(generateGemini(env, 'gemini-2.5-flash', {}, { fetcher, timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'PROVIDER_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(251); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([[400, 'private-document-sentinel', 'BAD_REQUEST'], [429, 'daily quota exhausted', 'QUOTA_EXHAUSTED']])('does not retry permanent/quota failure %s or log provider text', async (status, message, kind) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn(async () => Response.json({ error: { message } }, { status: Number(status) }));
    await expect(generateGemini(env, 'gemini-2.5-flash', {}, { fetcher, timeoutMs: 5000 })).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(message);
  });
  it('rejects a successful HTTP response containing no usable text', async () => {
    await expect(generateGemini(env, 'gemini-2.5-flash', {}, { fetcher: vi.fn(async () => Response.json({ candidates: [{ content: { parts: [] } }] })), timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
  });
});

describe('partial document evidence', () => {
  it('keeps searchable pages and marks only the failed scanned page as not processed', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { message: 'unsupported generation field' } }, { status: 400 }));
    const result = await extractDocument({ base64: fixture('05-mixed-text-and-scan.pdf'), mimeType: 'application/pdf', fileName: 'mixed.pdf' }, env, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.pages.map(page => page.status)).toEqual(['ok', 'not_processed', 'ok']);
    expect(result.extractedText).toContain('[Page 3]');
    expect(result.incomplete.join(' ')).toContain('page(s) 2');
  });
  it('retains successful OCR pages when another page fails', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => ++calls === 2 ? Response.json({ error: { message: 'bad request' } }, { status: 400 }) : success());
    const result = await extractDocument({ base64: fixture('04-scanned-3-pages.pdf'), fileName: 'scan.pdf' }, env, { fetcher });
    expect(result.pages.filter(page => page.status === 'ok')).toHaveLength(2);
    expect(result.pages.filter(page => page.status === 'not_processed')).toHaveLength(1);
    expect(result.ocr?.calls).toBe(2);
    expect(result.incomplete.length).toBeGreaterThan(0);
  });
  it('stops later batches after a permanent model error and preserves its classification', async () => {
    const pdf = await PDFDocument.create(); for (let i = 0; i < 7; i++) pdf.addPage();
    const fetcher = vi.fn(async () => Response.json({ error: { message: 'model not supported for generateContent' } }, { status: 400 }));
    await expect(extractDocument({ base64: Buffer.from(await pdf.save()).toString('base64'), fileName: 'scan.pdf' }, env, { fetcher })).rejects.toMatchObject({ kind: 'MODEL_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('marks truncated OCR as partial rather than complete', async () => {
    const fetcher = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: 'Only the beginning.' }] }, finishReason: 'MAX_TOKENS' }] }));
    const result = await extractDocument({ base64: fixture('06-image.png'), fileName: 'scan.png' }, env, { fetcher });
    expect(result.pages[0].status).toBe('partial');
    expect(result.incomplete.length).toBeGreaterThan(0);
  });
  it('bounds a stalled local PDF parser before any provider request', async () => {
    const fetcher = vi.fn();
    await expect(extractDocument({ base64: fixture('03-digital-3-pages.pdf'), fileName: 'digital.pdf' }, env, { fetcher, timeoutMs: 10, getDocumentProxy: vi.fn(() => new Promise(() => {})) as any })).rejects.toMatchObject({ status: 504, code: 'EXTRACTION_TIMEOUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
