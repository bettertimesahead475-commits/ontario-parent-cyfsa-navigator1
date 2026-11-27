import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SCANNED_PDF = fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/synthetic/04-scanned-3-pages.pdf')).toString('base64');
import { handleExtractRequest, type ExtractEnv } from '../functions/api/extract-text';

const mockAuth = vi.fn();

vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: (req: Request, env: any) => mockAuth(req, env),
  onRequestGet: vi.fn(),
}));

describe('Cloudflare Text Extraction Endpoint (/api/extract-text)', () => {
  const env: ExtractEnv = {
    FIREBASE_PROJECT_ID: 'test-project',
  };

  it('rejects unauthenticated extract requests with 401', async () => {
    mockAuth.mockResolvedValueOnce({ status: 'denied' });
    const request = new Request('https://staging.example/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileData: { base64: 'abc', mimeType: 'text/plain' } }),
    });

    const response = await handleExtractRequest(request, env);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.code).toBe('SIGN_IN_REQUIRED');
  });

  it('successfully extracts plain text from base64 document', async () => {
    mockAuth.mockResolvedValueOnce({ status: 'verified', uid: 'user_123' });
    const rawText = 'Superior Court of Justice\nAffidavit of Evidence';
    const base64 = btoa(rawText);

    const request = new Request('https://staging.example/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({
        fileData: {
          base64,
          mimeType: 'text/plain',
          fileName: 'affidavit.txt',
        },
      }),
    });

    const response = await handleExtractRequest(request, env);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.extractedText).toBe(rawText);
    expect(json.characters).toBe(rawText.length);
    expect(json.pages).toHaveLength(1);
    expect(json.pages[0].extractionMethod).toBe('PLAIN_TEXT');
  });

  it('returns 503 OCR_SERVICE_UNCONFIGURED for PDF when GEMINI_API_KEY is missing', async () => {
    mockAuth.mockResolvedValueOnce({ status: 'verified', uid: 'user_123' });
    const request = new Request('https://staging.example/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({
        fileData: {
          base64: SCANNED_PDF,
          mimeType: 'application/pdf',
          fileName: 'order.pdf',
        },
      }),
    });

    const response = await handleExtractRequest(request, env);
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.code).toBe('OCR_SERVICE_UNCONFIGURED');
  });

  it('successfully uses Gemini OCR when GEMINI_API_KEY is configured', async () => {
    mockAuth.mockResolvedValueOnce({ status: 'verified', uid: 'user_123' });

    const mockFetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('generativelanguage.googleapis.com');
      // The key travels in a header, never in the URL.
      expect(url).not.toContain('test-gemini-key');
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-gemini-key');
      const body = JSON.parse(init?.body as string);
      expect(body.contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Extracted text from PDF via Gemini OCR' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const request = new Request('https://staging.example/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({
        fileData: {
          base64: SCANNED_PDF,
          mimeType: 'application/pdf',
          fileName: 'order.pdf',
        },
      }),
    });

    const response = await handleExtractRequest(request, { ...env, GEMINI_API_KEY: 'test-gemini-key' }, { fetcher: mockFetcher as any });
    expect(response.status).toBe(200);
    const json = await response.json();
    // Three scanned pages: one OCR call each, every result attributed to its page.
    expect(mockFetcher).toHaveBeenCalledTimes(3);
    expect(json.pages.map((p: any) => [p.pageNumber, p.extractionMethod])).toEqual([[1, 'OCR'], [2, 'OCR'], [3, 'OCR']]);
    expect(json.extractedText).toMatch(/^\[Page 1\]\nExtracted text from PDF via Gemini OCR/);
  });
});
