import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn(), report: vi.fn() }));
vi.mock('../functions/api/_auth-check', () => ({ verifyFirebaseRequest: (...args: unknown[]) => mocks.verify(...args) }));
vi.mock('../functions/api/_durable-analysis-jobs', () => ({ readDurableJob: mocks.read, loadPersistedReport: mocks.report }));

import { onRequestGet } from '../functions/api/analyze/job/[jobId]';

const env: any = { FIREBASE_PROJECT_ID: 'firebase-test', STAGING_SUPABASE_URL: 'https://project.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const request = () => new Request('https://navigator.test/api/analyze/job/job_status_1234', { headers: { Authorization: 'Bearer verified-token' } });

describe('durable analysis status endpoint', () => {
  it('rejects unauthenticated job retrieval', async () => {
    mocks.verify.mockResolvedValueOnce({ status: 'invalid' });
    const response = await onRequestGet({ request: request(), env, params: { jobId: 'job_status_1234' } });
    expect(response.status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects a different Firebase user before reading the report', async () => {
    mocks.verify.mockResolvedValueOnce({ status: 'verified', uid: 'wrong_user' });
    mocks.read.mockResolvedValueOnce({ job_id: 'job_status_1234', owner_uid: 'owner_user', status: 'completed' });
    const response = await onRequestGet({ request: request(), env, params: { jobId: 'job_status_1234' } });
    expect(response.status).toBe(403);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('returns a completed report to its owner after refresh', async () => {
    mocks.verify.mockResolvedValueOnce({ status: 'verified', uid: 'owner_user' });
    mocks.read.mockResolvedValueOnce({ job_id: 'job_status_1234', owner_uid: 'owner_user', status: 'completed' });
    mocks.report.mockResolvedValueOnce({ documentTitle: 'Recovered report' });
    const response = await onRequestGet({ request: request(), env, params: { jobId: 'job_status_1234' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'completed', report: { documentTitle: 'Recovered report' } });
  });
});
