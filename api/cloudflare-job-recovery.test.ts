import { describe, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/analyze/job/[jobId]';

describe('Cloudflare Job Recovery Endpoint (/api/analyze/job/:jobId)', () => {
  it('returns 400 for invalid or missing jobId parameter', async () => {
    const response = await onRequestGet({ params: { jobId: 'short' } });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe('INVALID_JOB_ID');
  });

  it('returns 404 not_found for unrecorded job id allowing client recovery', async () => {
    const response = await onRequestGet({ params: { jobId: 'req_1234567890_test' } });
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.code).toBe('JOB_NOT_FOUND');
    expect(json.status).toBe('not_found');
  });
});
