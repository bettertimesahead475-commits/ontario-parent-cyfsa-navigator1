/** Status endpoint branches: failed-retry lookup errors, missing saved reports, in-progress progress, ledger outages. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn(), report: vi.fn(), latest: vi.fn() }));
vi.mock('../../functions/api/_auth-check', () => ({ verifyFirebaseRequest: (...args: unknown[]) => mocks.verify(...args) }));
vi.mock('../../functions/api/_durable-analysis-jobs', async (orig) => ({
  ...(await orig<typeof import('../../functions/api/_durable-analysis-jobs')>()),
  readDurableJob: mocks.read, loadPersistedReport: mocks.report, latestOwnAttempt: mocks.latest,
}));

import { onRequestGet } from '../../functions/api/analyze/job/[jobId]';
import { DurableJobStorageError } from '../../functions/api/_durable-analysis-jobs';

const KEY = 'sb_secret_syntheticSyntheticSynthetic123';
const env: any = { FIREBASE_PROJECT_ID: 'firebase-test', STAGING_SUPABASE_URL: 'https://project.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: KEY };
const get = async () => {
  const response = await onRequestGet({ request: new Request('https://navigator.test/api/analyze/job/job_status_1234', { headers: { Authorization: 'Bearer t' } }), env, params: { jobId: 'job_status_1234' } });
  return { status: response.status, body: await response.json() as any };
};
const owned = (patch: Record<string, unknown>) => mocks.read.mockResolvedValueOnce({ job_id: 'job_status_1234', owner_uid: 'owner_user', ...patch });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ status: 'verified', uid: 'owner_user' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('durable job status branches', () => {
  it('a failed job whose retry lookup errors still reports the original failure', async () => {
    owned({ status: 'failed', error_code: 'AI_REQUEST_REJECTED', retryable: false });
    mocks.latest.mockRejectedValueOnce(new Error('lookup failed'));
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'failed', error: { code: 'AI_REQUEST_REJECTED', retryable: false } });
  });

  it('a completed job whose saved report cannot be read is a retryable 503, never an empty success', async () => {
    owned({ status: 'completed' });
    mocks.report.mockResolvedValueOnce(null);
    expect(await get()).toEqual({ status: 503, body: { error: 'The saved report is temporarily unavailable.', code: 'ANALYSIS_PERSISTENCE_FAILED', retryable: true } });
  });

  it('in-progress jobs report bounded progress: never 100 before completion, and defaults for missing values', async () => {
    owned({ status: 'running', stage: 'verifying_findings', progress: 140 });
    expect((await get()).body).toEqual({ jobId: 'job_status_1234', status: 'running', currentStage: 'verifying_findings', percent: 99, message: 'Analysis is running.' });
    owned({ status: 'queued', progress: null });
    expect((await get()).body).toEqual({ jobId: 'job_status_1234', status: 'queued', currentStage: 'queued', percent: 10, message: 'Waiting for an analyzer worker.' });
    owned({ status: 'running', progress: -5 });
    expect((await get()).body).toMatchObject({ currentStage: 'running', percent: 0 });
  });

  it('a ledger that is not configured tells the client to stop polling; the log has no job id, uid or key', async () => {
    mocks.read.mockRejectedValueOnce(new DurableJobStorageError('Durable job storage is not configured.', true, 500));
    expect(await get()).toEqual({ status: 503, body: { error: 'Analysis status is temporarily unavailable.', code: 'JOB_STATUS_NOT_CONFIGURED', retryable: false } });
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).toContain('JOB_STATUS_UNAVAILABLE');
    for (const secret of ['job_status_1234', 'owner_user', KEY]) expect(logged).not.toContain(secret);
  });

  it('a transient or unknown ledger error is a retryable 503; a non-retryable storage error is not', async () => {
    mocks.read.mockRejectedValueOnce(new TypeError('network'));
    expect((await get()).body).toMatchObject({ code: 'JOB_STATUS_UNAVAILABLE', retryable: true });
    mocks.read.mockRejectedValueOnce(new DurableJobStorageError('Durable job database request failed.', false, 401));
    expect((await get()).body).toMatchObject({ code: 'JOB_STATUS_UNAVAILABLE', retryable: false });
  });
});
