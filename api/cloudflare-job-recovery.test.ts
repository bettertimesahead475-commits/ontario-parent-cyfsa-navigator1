import { describe, expect, it, vi, afterEach } from 'vitest';
import { onRequestGet } from '../functions/api/analyze/job/[jobId]';

describe('Cloudflare Job Recovery Endpoint (/api/analyze/job/:jobId)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns 400 for invalid or missing jobId parameter', async () => {
    const response = await onRequestGet({ params: { jobId: 'short' } });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe('INVALID_JOB_ID');
  });

  it('returns 404 not_found for unrecorded job id outside grace window', async () => {
    const response = await onRequestGet({ params: { jobId: 'req_1000000000000_expired' } });
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.code).toBe('JOB_NOT_FOUND');
    expect(json.status).toBe('not_found');
  });

  it('returns pending grace status for recently created request IDs', async () => {
    const now = Date.now();
    const jobId = `req_${now - 5000}_recentjob123`;
    const response = await onRequestGet({ params: { jobId } });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe('pending');
    expect(json.jobId).toBe(jobId);
    expect(json.createdAt).toBe(now - 5000);
  });

  it('retrieves completed job from Supabase Storage when configured', async () => {
    const mockReport = {
      overview: { summary: 'Durable recovery report', riskLevel: 'low', urgency: 'low', recommendedFirstStep: 'Review', keyStatutoryFactors: [] },
    };
    const mockJob = {
      jobId: 'req_9999999999999_savedjob',
      status: 'completed',
      report: mockReport,
      uid: 'user_123',
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('req_9999999999999_savedjob.json')) {
        return Response.json(mockJob, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }));

    // With admin secret bypass
    const response = await onRequestGet({
      request: new Request('http://localhost/api/analyze/job/req_9999999999999_savedjob', {
        headers: { 'x-admin-secret': 'valid-admin-secret' },
      }),
      env: {
        ADMIN_SECRET: 'valid-admin-secret',
        STAGING_SUPABASE_URL: 'https://staging.supabase.co',
        STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      },
      params: { jobId: 'req_9999999999999_savedjob' },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe('completed');
    expect(json.report.overview.summary).toBe('Durable recovery report');
  });
});
