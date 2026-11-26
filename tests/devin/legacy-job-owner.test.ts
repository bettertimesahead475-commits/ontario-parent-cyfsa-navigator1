/** Mutation gap M11: no test covered the owner check on legacy Storage-only analysis jobs. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn() }));
vi.mock('../../functions/api/_auth-check', () => ({ verifyFirebaseRequest: (...a: unknown[]) => mocks.verify(...a) }));
vi.mock('../../functions/api/_durable-analysis-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../functions/api/_durable-analysis-jobs')>()),
  readDurableJob: mocks.read,
}));

import { onRequestGet } from '../../functions/api/analyze/job/[jobId]';

const env: any = { FIREBASE_PROJECT_ID: 'synthetic', STAGING_SUPABASE_URL: 'https://synthetic.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const jobId = 'legacy_job_12345678';
const call = () => onRequestGet({ request: new Request(`https://navigator.test/api/analyze/job/${jobId}`, { headers: { Authorization: 'Bearer t' } }), env, params: { jobId } });

describe('legacy Storage-only analysis job status', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubStorage = () => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ jobId, uid: 'owner_user', status: 'completed', report: { documentTitle: 'Private synthetic report' } })));

  it('refuses another signed-in user and does not return the report', async () => {
    mocks.verify.mockResolvedValue({ status: 'verified', uid: 'intruder_user' });
    mocks.read.mockResolvedValue(null);
    stubStorage();
    const res = await call();
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('Private synthetic report');
  });

  it('refuses a legacy job record that names no owner', async () => {
    mocks.verify.mockResolvedValue({ status: 'verified', uid: 'intruder_user' });
    mocks.read.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ jobId, status: 'completed', report: { documentTitle: 'Private synthetic report' } })));
    expect((await call()).status).toBe(403);
  });

  it('returns the report to its owner', async () => {
    mocks.verify.mockResolvedValue({ status: 'verified', uid: 'owner_user' });
    mocks.read.mockResolvedValue(null);
    stubStorage();
    const res = await call();
    expect(res.status).toBe(200);
  });
});
