import { describe, expect, it, vi } from 'vitest';
import { DurableJobStorageError, loadDurableInput, loadPersistedReport, saveDurableInput, storageEffectiveStatus } from '../functions/api/_durable-analysis-jobs';

const env = { STAGING_SUPABASE_URL: 'https://synthetic.supabase.co/', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln' };
// Shapes observed from Supabase Storage in production: every error is HTTP 400 with the real status in the body.
const storage400 = (statusCode: string, code: string) =>
  new Response(JSON.stringify({ statusCode, error: code, message: code, code }), { status: 400, headers: { 'Content-Type': 'application/json' } });
const fetcherOf = (res: () => Response) => vi.fn(async () => res()) as unknown as typeof fetch;

describe('Supabase Storage status classification (queued Forensic first-step regression)', () => {
  it('reads the real status from a Storage 400 body', async () => {
    expect(await storageEffectiveStatus(storage400('404', 'not_found'))).toBe(404);
    expect(await storageEffectiveStatus(storage400('403', 'AccessDenied'))).toBe(403);
    expect(await storageEffectiveStatus(new Response('plain', { status: 400 }))).toBe(400);
    expect(await storageEffectiveStatus(new Response('{}', { status: 503 }))).toBe(503);
  });

  it('treats a missing report as "no report yet", not a permanent failure', async () => {
    // Regression: this threw a non-retryable error and failed every new queued job in under a second.
    await expect(loadPersistedReport(env, 'req_1700000000000_synthetic', fetcherOf(() => storage400('404', 'not_found')))).resolves.toBeNull();
    await expect(loadPersistedReport(env, 'req_1700000000000_synthetic', fetcherOf(() => storage400('404', 'NoSuchKey')))).resolves.toBeNull();
  });

  it('keeps Storage server errors retryable and access errors permanent', async () => {
    const server = await loadPersistedReport(env, 'req_x_synthetic1', fetcherOf(() => storage400('503', 'Unavailable'))).catch((e) => e);
    expect(server).toBeInstanceOf(DurableJobStorageError);
    expect(server.retryable).toBe(true);
    expect(server.status).toBe(503);
    const denied = await loadPersistedReport(env, 'req_x_synthetic1', fetcherOf(() => storage400('403', 'AccessDenied'))).catch((e) => e);
    expect(denied.retryable).toBe(false);
    expect(denied.status).toBe(403);
  });

  it('classifies input load and save failures by the real status as well', async () => {
    const load = await loadDurableInput(env, 'inputs/x.json', fetcherOf(() => storage400('500', 'InternalError'))).catch((e) => e);
    expect(load.retryable).toBe(true);
    const missing = await loadDurableInput(env, 'inputs/x.json', fetcherOf(() => storage400('404', 'not_found'))).catch((e) => e);
    expect(missing.retryable).toBe(false);
    expect(missing.status).toBe(404);
    const save = await saveDurableInput(env, 'inputs/x.json', { documentText: 'synthetic' }, fetcherOf(() => storage400('409', 'Duplicate'))).catch((e) => e);
    expect(save.status).toBe(409);
    expect(save.retryable).toBe(false);
  });
});
