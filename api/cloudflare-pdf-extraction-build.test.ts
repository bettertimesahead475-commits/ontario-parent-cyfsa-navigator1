import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { generateGemini } from '../functions/api/_gemini';

describe('PDF extraction build and OCR key regressions', () => {
  it('pins wrangler 4 so Cloudflare Pages Git builds do not bundle Functions with wrangler 3', () => {
    // Without a project wrangler, Pages builds used wrangler 3.114.17, whose bundle breaks unpdf with
    // "PDF.js could not be resolved", sending every PDF (even native-text ones) to Gemini OCR.
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const version: string = pkg.devDependencies?.wrangler ?? '';
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number(version.split('.')[0])).toBeGreaterThanOrEqual(4);
  });

  it('sends a cleaned Gemini key when the secret carries invisible characters', async () => {
    const lf = String.fromCharCode(10), zwsp = String.fromCharCode(0x200b);
    const key = 'AIzaSyD' + 'x'.repeat(32);
    const fetcher = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }));
    await generateGemini({ GEMINI_API_KEY: key.slice(0, 10) + lf + zwsp + key.slice(10) + lf }, 'gemini-2.5-flash',
      { contents: [{ role: 'user', parts: [{ text: 'synthetic' }] }] }, { fetcher: fetcher as unknown as typeof fetch, timeoutMs: 5000 } as any).catch(() => undefined);
    expect(fetcher).toHaveBeenCalled();
    const headers = (fetcher.mock.calls[0] as any)[1].headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(key);
  });
});
