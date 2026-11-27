// A direct analyzer request that claims its job record and is then refused must not leave that record "running".
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDeepScanRequest } from '../functions/api/deep-scan';
import type { AnalyzerEnv } from '../functions/api/analyze';

const saved: any[] = [];
const claim = vi.fn(async (): Promise<string> => 'created');
vi.mock('../functions/api/_analysis-jobs', () => ({
  saveCompletedJob: vi.fn(async () => true),
  saveJobState: vi.fn(async (_env: unknown, state: unknown) => { saved.push(state); return true; }),
  claimJobRecord: () => claim(),
}));
vi.mock('../functions/api/_durable-analysis-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../functions/api/_durable-analysis-jobs')>()),
  jobOwnership: vi.fn(async () => 'clear'),
}));
vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: vi.fn(async () => ({ status: 'verified', uid: 'user_free_1', email: 'p@example.com', emailVerified: true })),
  onRequestGet: vi.fn(),
}));
vi.mock('../functions/api/_supabase-paid-session', () => ({ readVerifiedPaidSession: vi.fn(async () => null) }));

const env: AnalyzerEnv = {
  ANALYZER_ENABLED: 'true',
  FIREBASE_PROJECT_ID: 'test-project',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  STAGING_SUPABASE_URL: 'https://staging.supabase.co',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};
const post = () => handleDeepScanRequest(new Request('https://example.pages.dev/api/deep-scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Analysis-Id': 'req_refused_0001' },
  body: JSON.stringify({ documentText: 'Synthetic affidavit. The worker attended on a weekday.' }),
}), env);

describe('refused direct analyzer request', () => {
  beforeEach(() => { saved.length = 0; claim.mockClear(); });

  it('replaces the record it created with a failed, non-retryable state and charges nothing', async () => {
    claim.mockResolvedValueOnce('created');
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('UPGRADE_REQUIRED');
    expect(claim).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([expect.objectContaining({ jobId: 'req_refused_0001', uid: 'user_free_1', status: 'failed', error: expect.objectContaining({ code: 'UPGRADE_REQUIRED', retryable: false }) })]);
    expect(saved.some((s) => s.status === 'running')).toBe(false);
  });

  it('leaves an earlier attempt\'s record of the same id untouched (it may be live or completed)', async () => {
    claim.mockResolvedValueOnce('claimed');
    const res = await post();
    expect(res.status).toBe(403);
    expect(saved).toEqual([]);
  });
});
