// A direct analyzer request that claims its job record and is then refused must not leave that record "running",
// and must charge nothing. Covers all six refusal codes, a failed state write, and an earlier attempt's record.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';
import { effectiveJob, RUNNING_JOB_STALE_MS } from '../functions/api/_analysis-jobs';

const saved: any[] = [];
const claim = vi.fn(async (): Promise<string> => 'created');
const save = vi.fn(async (_env: unknown, state: unknown) => { saved.push(state); return true; });
const paidSession = vi.fn(async (): Promise<any> => ({ status: 'verified', session: { id: SESSION } }));
const paidReserve = vi.fn(async (): Promise<any> => ({ status: 'reserved', reservation_id: 'r1' }));
const freeReserve = vi.fn(async (): Promise<any> => ({ status: 'reserved', reservation_id: 'r1' }));
const SESSION = '22222222-2222-4222-8222-222222222222';

vi.mock('../functions/api/_analysis-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../functions/api/_analysis-jobs')>()),
  saveCompletedJob: vi.fn(async () => true),
  saveJobState: (env: unknown, state: unknown) => save(env, state),
  claimJobRecord: () => claim(),
}));
vi.mock('../functions/api/_durable-analysis-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../functions/api/_durable-analysis-jobs')>()),
  jobOwnership: vi.fn(async () => 'clear'),
}));
vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: vi.fn(async () => ({ status: 'verified', uid: 'user_refused_1', email: 'p@example.com', emailVerified: true })),
  onRequestGet: vi.fn(),
}));
vi.mock('../functions/api/_supabase-paid-session', () => ({ readVerifiedPaidSession: () => paidSession() }));
vi.mock('../functions/api/_paid-credit-reservation', () => ({ reserveVerifiedPaidCredit: () => paidReserve() }));
vi.mock('../functions/api/_free-credit-reservation', () => ({ reserveFreeScan: () => freeReserve() }));

const env: AnalyzerEnv = {
  ANALYZER_ENABLED: 'true',
  FIREBASE_PROJECT_ID: 'test-project',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  STAGING_SUPABASE_URL: 'https://staging.supabase.co',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};
const post = (body: Record<string, unknown>) => handleAnalyzeRequest(new Request('https://example.pages.dev/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Analysis-Id': 'req_refused_0001' },
  body: JSON.stringify({ documentText: 'Synthetic affidavit. The worker attended on a weekday.', ...body }),
}), env, { rpc: vi.fn() as any });

const cases: Array<{ code: string; status: number; body: Record<string, unknown>; arrange: () => void }> = [
  { code: 'SESSION_INVALID', status: 403, body: { sessionId: SESSION }, arrange: () => paidSession.mockResolvedValueOnce({ status: 'denied' }) },
  { code: 'CREDIT_LIMIT_REACHED', status: 402, body: { sessionId: SESSION }, arrange: () => paidReserve.mockResolvedValueOnce({ status: 'limit' }) },
  { code: 'RESERVATION_UNAVAILABLE', status: 503, body: { sessionId: SESSION }, arrange: () => paidReserve.mockResolvedValueOnce({ status: 'unavailable' }) },
  { code: 'UPGRADE_REQUIRED', status: 403, body: { mode: 'full' }, arrange: () => {} },
  { code: 'FREE_LIMIT_REACHED', status: 402, body: {}, arrange: () => freeReserve.mockResolvedValueOnce({ status: 'limit' }) },
  { code: 'RESERVATION_UNAVAILABLE', status: 503, body: {}, arrange: () => freeReserve.mockResolvedValueOnce({ status: 'unavailable' }) },
];

describe('refused direct analyzer request', () => {
  beforeEach(() => {
    saved.length = 0;
    claim.mockReset().mockResolvedValue('created');
    save.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each(cases.map((c, i) => [`${c.code} (${i < 3 ? 'paid' : 'free'})`, c] as const))('%s: replaces the record it created with a failed, non-retryable state', async (_label, c) => {
    c.arrange();
    const res = await post(c.body);
    expect(res.status).toBe(c.status);
    expect((await res.json()).code).toBe(c.code);
    expect(saved).toEqual([expect.objectContaining({ jobId: 'req_refused_0001', uid: 'user_refused_1', status: 'failed', error: expect.objectContaining({ code: c.code, retryable: false }) })]);
    expect(saved.some((s) => s.status === 'running')).toBe(false);
  });

  it('a refusal reserves nothing it could leave charged: no reservation is attempted after the plan or session check fails', async () => {
    paidSession.mockResolvedValueOnce({ status: 'denied' });
    paidReserve.mockClear(); freeReserve.mockClear();
    await post({ sessionId: SESSION });
    await post({ mode: 'full' });
    expect(paidReserve).not.toHaveBeenCalled();
    expect(freeReserve).not.toHaveBeenCalled();
  });

  it('retries a failed state write once, then logs it; the status endpoint later reports the record timed out', async () => {
    save.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const first = await post({ mode: 'full' });
    expect(first.status).toBe(403);
    expect(save).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('ANALYSIS_REFUSAL_STATE_UNSAVED'));

    save.mockClear();
    save.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const second = await post({ mode: 'full' });
    expect(second.status).toBe(403);
    expect((await second.json()).code).toBe('UPGRADE_REQUIRED');
    expect(save).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ANALYSIS_REFUSAL_STATE_UNSAVED]'));
    // The record left behind is the claim's "running" state; it cannot be polled forever.
    const left = { jobId: 'req_refused_0001', uid: 'user_refused_1', status: 'running', updatedAt: 0 };
    expect(effectiveJob(left, RUNNING_JOB_STALE_MS + 1)).toMatchObject({ status: 'timed_out', error: { retryable: true } });
  });

  it('leaves an earlier attempt\'s record of the same id untouched (it may be live or completed)', async () => {
    claim.mockResolvedValueOnce('claimed');
    const res = await post({ mode: 'full' });
    expect(res.status).toBe(403);
    expect(saved).toEqual([]);
  });
});
