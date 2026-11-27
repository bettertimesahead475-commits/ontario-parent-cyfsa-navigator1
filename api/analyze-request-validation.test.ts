// Request validation in front of the analyzer: every refusal happens before any credit is reserved or model called.
import { describe, expect, it, vi } from 'vitest';
import { handleAnalyzeRequest, withHardDeadline, type AnalyzerEnv } from '../functions/api/analyze';

vi.mock('../functions/api/_auth-check', () => ({ verifyFirebaseRequest: vi.fn(async () => ({ status: 'verified', uid: 'free_uid', emailVerified: false, email: null })) }));

const env = { ANALYZER_ENABLED: 'true', FIREBASE_PROJECT_ID: 'p', ANTHROPIC_API_KEY: 'sk-ant-synthetic', STAGING_SUPABASE_URL: 'https://synthetic.supabase.co/', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln' } as AnalyzerEnv;
const missing = () => new Response(JSON.stringify({ statusCode: '404', error: 'not_found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
const post = (body: string | object, id = '') => new Request('https://x.test/api/analyze', {
  method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', ...(id ? { 'X-Analysis-Id': id } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const deps = () => ({ rpc: vi.fn(), generate: vi.fn(), fetcher: vi.fn(async (url: string) => url.includes('/rpc/') ? Response.json(null) : missing()) as unknown as typeof fetch });

describe('analyze request validation', () => {
  it('refuses incomplete configuration, invalid JSON and an unknown mode without reserving credit', async () => {
    for (const [request, e, status, code] of [
      [post({ documentText: 'x' }), { ...env, ANTHROPIC_API_KEY: '' }, 503, 'CONFIGURATION_ERROR'],
      [post('{not json'), env, 400, 'INVALID_REQUEST'],
      [post({ documentText: 'Synthetic note.', mode: 'deep' }), env, 400, 'INVALID_ANALYSIS_MODE'],
    ] as const) {
      const d = deps();
      const res = await handleAnalyzeRequest(request, e as AnalyzerEnv, d);
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code });
      expect(d.rpc).not.toHaveBeenCalled();
      expect(d.generate).not.toHaveBeenCalled();
    }
  });

  it('decodes a plain-text file upload (data URL or bare base64) as the document, and rejects undecodable data as empty', async () => {
    const seen: string[] = [];
    for (const base64 of [`data:text/plain;base64,${btoa('Synthetic plain-text note.')}`, btoa('Synthetic plain-text note.')]) {
      const d = deps();
      d.rpc.mockImplementation(async () => ({ status: 'limit' }));
      const res = await handleAnalyzeRequest(post({ fileData: { base64, mimeType: 'text/plain' }, mode: 'fast', stream: false }), env, d);
      expect(res.status).toBe(402);
      seen.push((await res.json()).code);
    }
    expect(seen).toEqual(['FREE_LIMIT_REACHED', 'FREE_LIMIT_REACHED']);
    const bad = deps();
    const res = await handleAnalyzeRequest(post({ fileData: { base64: '%%%not-base64%%%' } }), env, bad);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(bad.rpc).not.toHaveBeenCalled();
  });

  it('a free scan already running or finished under the same id is not started again', async () => {
    for (const status of ['joined', 'consumed']) {
      const d = deps();
      d.rpc.mockImplementation(async () => ({ status }));
      const res = await handleAnalyzeRequest(post({ documentText: 'Synthetic note.', mode: 'fast', stream: false }), env, d);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'ANALYSIS_IN_PROGRESS', jobId: expect.any(String) });
      expect(d.generate).not.toHaveBeenCalled();
    }
  });

  it('withHardDeadline rejects with the supplied error when the work does not settle in time', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const raced = withHardDeadline(never, 1_000, () => new Error('deadline'));
    vi.advanceTimersByTime(1_000);
    await expect(raced).rejects.toThrow('deadline');
    vi.useRealTimers();
  });
});
