// Regression: a Forensic job that no worker claims must not show "Waiting for an analyzer worker" forever.
// It is failed after QUEUED_JOB_MAX_AGE_MS, its credit is released, and a claimed job is never failed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  readDurableJob: vi.fn(),
  failDeadLetterJob: vi.fn(),
  loadPersistedReport: vi.fn(),
  releasePaid: vi.fn(async () => ({ status: 'released' })),
  releaseFree: vi.fn(async () => ({ status: 'released' })),
}));

vi.mock('../functions/api/_durable-analysis-jobs', async (orig) => ({
  ...(await orig<typeof import('../functions/api/_durable-analysis-jobs')>()),
  readDurableJob: store.readDurableJob,
  failDeadLetterJob: store.failDeadLetterJob,
  loadPersistedReport: store.loadPersistedReport,
}));
vi.mock('../functions/api/_paid-credit-lifecycle', () => ({ releasePaidReservation: store.releasePaid }));
vi.mock('../functions/api/_free-credit-lifecycle', () => ({ releaseFreeScan: store.releaseFree }));
vi.mock('../functions/api/_staging-credit-rpc', () => ({ createStagingCreditRpc: () => async () => ({}) }));

import { onRequestGet } from '../functions/api/analyze/job/[jobId]';
import { expireStaleQueuedJob, isStaleQueuedJob, QUEUED_JOB_MAX_AGE_MS, QUEUE_EXPIRED_FAILURE } from '../functions/api/_queued-job-expiry';

const JOB_ID = 'req_1790000000000_queuedjob01';
const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: JOB_ID, owner_uid: 'uid-1', mode: 'full', status: 'queued', input_key: 'inputs/x.json',
    session_id: 'sess-1', reservation_id: 'res-1', owner_bypass: false, created_at: minutesAgo(1), ...overrides,
  };
}

const adminGet = () => onRequestGet({
  request: new Request(`http://localhost/api/analyze/job/${JOB_ID}`, { headers: { 'x-admin-secret': 'admin-test' } }),
  env: { ADMIN_SECRET: 'admin-test', STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'svc-test' },
  params: { jobId: JOB_ID },
});

beforeEach(() => {
  vi.clearAllMocks();
  store.releasePaid.mockResolvedValue({ status: 'released' } as never);
});

describe('isStaleQueuedJob', () => {
  it('is stale only when queued and older than the bound', () => {
    expect(isStaleQueuedJob(job({ created_at: minutesAgo(QUEUED_JOB_MAX_AGE_MS / 60_000 + 1) }) as never, NOW)).toBe(true);
    expect(isStaleQueuedJob(job({ created_at: minutesAgo(5) }) as never, NOW)).toBe(false);
    expect(isStaleQueuedJob(job({ status: 'running', created_at: minutesAgo(90) }) as never, NOW)).toBe(false);
    expect(isStaleQueuedJob(job({ created_at: null }) as never, NOW)).toBe(false);
    expect(isStaleQueuedJob(job({ created_at: 'not-a-date' }) as never, NOW)).toBe(false);
  });
});

describe('expireStaleQueuedJob', () => {
  it('fails a queued job with the timeout code and releases its credit', async () => {
    const failed = job({ status: 'failed', error_code: QUEUE_EXPIRED_FAILURE.code });
    const release = vi.fn(async () => undefined);
    const result = await expireStaleQueuedJob({} as never, job() as never, { fail: async () => failed as never, release });
    expect(result?.status).toBe('failed');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('never fails a job a worker has claimed: the RPC returns it running and nothing is released', async () => {
    const release = vi.fn(async () => undefined);
    const result = await expireStaleQueuedJob({} as never, job() as never, { fail: async () => job({ status: 'running' }) as never, release });
    expect(result).toBeNull();
    expect(release).not.toHaveBeenCalled();
  });

  it('keeps the failure when the credit release is not yet confirmed', async () => {
    const failed = job({ status: 'failed' });
    const release = vi.fn(async () => { throw new Error('Credit release is not yet confirmed.'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await expireStaleQueuedJob({} as never, job() as never, { fail: async () => failed as never, release });
    expect(result?.status).toBe('failed');
    expect(errSpy).toHaveBeenCalledWith('[ANALYZER_QUEUE_TIMEOUT_RELEASE_PENDING]', 'Error');
    errSpy.mockRestore();
  });
});

describe('GET /api/analyze/job/:jobId for a queued job', () => {
  it('reports a stale queued job as failed with the timeout code and no charge', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store.readDurableJob.mockResolvedValue(job({ created_at: minutesAgo(45) }));
    store.failDeadLetterJob.mockResolvedValue(job({ status: 'failed', error_code: QUEUE_EXPIRED_FAILURE.code, error_message: QUEUE_EXPIRED_FAILURE.message }));
    const res = await adminGet();
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error.code).toBe('ANALYZER_QUEUE_TIMEOUT');
    expect(body.error.message).toMatch(/No analysis credit was charged/);
    expect(store.failDeadLetterJob).toHaveBeenCalledTimes(1);
    expect(store.releasePaid).toHaveBeenCalledTimes(1);
  });

  it('leaves a recently queued job queued and does not touch it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store.readDurableJob.mockResolvedValue(job({ created_at: minutesAgo(2) }));
    const res = await adminGet();
    vi.useRealTimers();
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(store.failDeadLetterJob).not.toHaveBeenCalled();
  });
});
