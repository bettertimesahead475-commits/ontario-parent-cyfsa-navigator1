// Staging provider check (admin, allow-listed UIDs only): executor delegation, model listing, the failure
// diagnostics that must never echo credentials, and request validation. Mocked network; no paid inference.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { verify, pipeline, listModels } = vi.hoisted(() => ({ verify: vi.fn(), pipeline: vi.fn(), listModels: vi.fn() }));
vi.mock('../functions/api/_auth-check', () => ({ verifyFirebaseRequest: verify }));
vi.mock('../api/services/analyzerSections', () => ({ runSectionedAnalysis: pipeline }));
vi.mock('../functions/api/_gemini', async (orig) => ({ ...(await orig<typeof import('../functions/api/_gemini')>()), listGeminiModels: listModels }));
import { handleProviderCheck } from '../functions/api/admin/analyzer-provider-check';
import { GeminiError } from '../functions/api/_gemini';
import { AnalyzerError } from './services/analyzerErrors';

const ANTHROPIC_KEY = 'sk-ant-api03-syntheticSyntheticSyntheticKey00';
const env = { FIREBASE_PROJECT_ID: 'cyfsa-navigator-e2e-20261108', ANALYZER_ENABLED: 'false', STAGING_PROVIDER_CHECKS_ENABLED: 'true', STAGING_PROVIDER_CHECK_UIDS: 'dedicated-user', ANTHROPIC_API_KEY: ANTHROPIC_KEY };
const call = (method: string, body?: string, e: Record<string, unknown> = env) =>
  handleProviderCheck(new Request('https://cyfsa-navigator-staging.pages.dev/api/admin/analyzer-provider-check', { method, headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json' }, body }), e as any);
const fetchMock = vi.fn();

beforeEach(() => { vi.clearAllMocks(); verify.mockResolvedValue({ status: 'verified', uid: 'dedicated-user' }); listModels.mockResolvedValue(['gemini-2.5-flash']); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('provider check: executor delegation', () => {
  it('GET and POST go to the staging executor with the caller token and the fixed mode only', async () => {
    const checkProvider = vi.fn(async (_t: string, mode: string) => ({ status: 207, body: { delegated: mode } }));
    const withExecutor = { ...env, ANALYZER_PROVIDER_EXECUTOR: { checkProvider } };
    const get = await call('GET', undefined, withExecutor);
    expect([get.status, await get.json()]).toEqual([207, { delegated: 'models' }]);
    const post = await call('POST', JSON.stringify({ mode: 'full' }), withExecutor);
    expect([post.status, await post.json()]).toEqual([207, { delegated: 'full' }]);
    expect(checkProvider.mock.calls.map((c) => c[0])).toEqual(['firebase-token', 'firebase-token']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pipeline).not.toHaveBeenCalled();
  });
});

describe('provider check: model listing', () => {
  it('lists the configured and available models', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5' }] }));
    const response = await call('GET');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ availableGeminiModels: ['gemini-2.5-flash'], availableAnthropicModels: ['claude-sonnet-5', 'claude-opus-5'] });
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe(ANTHROPIC_KEY);
  });

  it('reports a Gemini listing failure by kind, without failing the Anthropic listing', async () => {
    listModels.mockRejectedValueOnce(new GeminiError('AUTH_FAILED'));
    fetchMock.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await (await call('GET')).json()).toMatchObject({ geminiFailure: { code: 'GEMINI_AUTH_FAILED' }, availableGeminiModels: [] });
    listModels.mockRejectedValueOnce(new Error('dns'));
    fetchMock.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await (await call('GET')).json()).toMatchObject({ geminiFailure: { code: 'GEMINI_UNAVAILABLE' } });
  });

  it('an Anthropic auth failure returns key-shape facts and redacted public errors, never the key, an email or an IP', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(`{"error":"invalid x-api-key ${ANTHROPIC_KEY}"}`, { status: 401 }))
      .mockImplementation(async (url: string) => new Response(`<p>denied for ops@example.com from 203.0.113.7 key ${ANTHROPIC_KEY} AIza${'x'.repeat(30)}</p>`, { status: 403, headers: { 'x-url': url } }));
    const response = await call('GET');
    const text = await response.text();
    expect(response.status).toBe(200);
    for (const leaked of [ANTHROPIC_KEY, 'ops@example.com', '203.0.113.7', 'AIza' + 'x'.repeat(30), '<p>']) expect(text).not.toContain(leaked);
    const body = JSON.parse(text);
    expect(body.credentialShapes.anthropic).toMatchObject({ present: true, containsExpectedPrefix: true, hasWhitespace: false });
    expect(body.credentialShapes.gemini).toMatchObject({ present: false });
    expect(body.unauthenticatedControl.map((c: any) => c.host)).toEqual(['generativelanguage.googleapis.com', 'api.anthropic.com']);
    expect(body.unauthenticatedControl[1].publicUnauthenticatedError).toContain('[credential]');
    // The control probes carry no credentials.
    for (const [, init] of fetchMock.mock.calls.slice(1)) expect(init.headers).toBeUndefined();
  });
});

describe('provider check: request validation and failures', () => {
  it('rejects other methods and non-JSON bodies', async () => {
    expect((await call('PUT', '{}')).status).toBe(405);
    expect((await call('POST', 'not json')).status).toBe(400);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('a report without a usable summary is a 502 AI_RESPONSE_INVALID, not a success', async () => {
    pipeline.mockResolvedValueOnce({ report: { fileSummary: 'short' }, usageByModel: {}, sectionTimingsMs: {} });
    const response = await call('POST', JSON.stringify({ mode: 'fast' }));
    expect([response.status, (await response.json()).code]).toEqual([502, 'AI_RESPONSE_INVALID']);
  });

  it('maps analyzer and Gemini errors to their codes and statuses', async () => {
    pipeline.mockRejectedValueOnce(new AnalyzerError('ANALYSIS_TIMED_OUT', 504, 'Timed out.', true));
    const timedOut = await call('POST', JSON.stringify({ mode: 'full' }));
    expect([timedOut.status, (await timedOut.json()).code]).toEqual([504, 'ANALYSIS_TIMED_OUT']);
    pipeline.mockRejectedValueOnce(new GeminiError('RATE_LIMITED'));
    const limited = await call('POST', JSON.stringify({ mode: 'fast' }));
    expect([limited.status, (await limited.json()).code]).toEqual([502, 'GEMINI_RATE_LIMITED']);
  });
});
