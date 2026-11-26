import { describe, expect, it, vi } from 'vitest';

vi.mock('../../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: vi.fn(async () => ({ status: 'verified', uid: 'attacker_uid', emailVerified: false, email: null })),
  onRequestGet: vi.fn(),
}));

import { handleAnalyzeRequest, type AnalyzerEnv } from '../../functions/api/analyze';

// DEVIN-SEC-01 at the endpoint: a client-supplied analysis id whose ownership cannot be confirmed is refused
// before any credit is reserved or any report is written.
const env = {
  ANALYZER_ENABLED: 'true',
  STAGING_SUPABASE_URL: 'https://example.supabase.co',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_key_0000000000',
  ANTHROPIC_API_KEY: 'test',
  FIREBASE_PROJECT_ID: 'synthetic-project',
} as unknown as AnalyzerEnv;

function request(id: string) {
  return new Request('https://navigator.test/api/analyze', {
    method: 'POST',
    headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json', 'X-Analysis-Id': id, Accept: 'application/json' },
    body: JSON.stringify({ documentText: 'Synthetic CAS file note. '.repeat(40), mode: 'fast', stream: false }),
  });
}

describe('DEVIN-SEC-01 /api/analyze refuses ids whose ownership is unknown', () => {
  it('ledger and Storage unavailable: 503 retryable, no reservation, no write', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/rpc/analyzer_get_job')) throw new TypeError('network');
      if (url.includes('/storage/v1/object/')) return new Response('{}', { status: 503 });
      return Response.json({});
    }) as unknown as typeof fetch;
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'r1' }));
    const generate = vi.fn();
    const response = await handleAnalyzeRequest(request('req_1795545140117_victimjob002'), env, { rpc, fetcher, generate } as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'OWNERSHIP_CHECK_UNAVAILABLE', retryable: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    const writes = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST' && String((init as RequestInit).headers && JSON.stringify((init as RequestInit).headers)).includes('x-upsert'));
    expect(writes).toHaveLength(0);
  });
});
